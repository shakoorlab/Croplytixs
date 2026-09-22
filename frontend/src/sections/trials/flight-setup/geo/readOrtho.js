import { fromBlob } from 'geotiff';

import { crsLabel, makeAffine } from './crs';

// Longest edge of the preview render. The point of the overview is "did the grid
// land on the plots", which needs far less than full resolution — and decoding
// full resolution in a tab is how you lose the tab.
const MAX_OVERVIEW_EDGE = 1600;

// ==============================|| BAND COMBINATIONS ||============================== //

/**
 * Multispectral sensors commonly write B,G,R,NIR,RE, so the first three bands
 * are *not* natural colour. These are the sensible defaults; the user can switch
 * combination in the toolbar when their band order differs.
 */
export const BAND_COMBOS = [
  { id: 'natural', label: 'Natural colour' },
  { id: 'cir', label: 'Colour infrared' }
];

export function bandIndicesFor(comboId, bandCount, alphaIndex = -1) {
  const colourBands = alphaIndex >= 0 ? alphaIndex : bandCount;
  const zero = (n) => Math.min(Math.max(n, 0), colourBands - 1);

  if (colourBands === 1) return [0, 0, 0];

  if (colourBands >= 5) {
    // B,G,R,NIR,RE
    return comboId === 'cir' ? [zero(3), zero(2), zero(1)] : [zero(2), zero(1), zero(0)];
  }
  if (colourBands === 4) {
    // R,G,B,NIR
    return comboId === 'cir' ? [zero(3), zero(0), zero(1)] : [zero(0), zero(1), zero(2)];
  }
  // plain RGB — an RGBA ortho lands here once alpha is excluded
  return [zero(0), zero(1), zero(2)];
}

// ==============================|| CONTRAST STRETCH ||============================== //

/**
 * 16-bit imagery mapped linearly onto 8 bits comes out nearly black, because the
 * useful signal occupies a narrow part of the range — so the render needs a
 * contrast stretch. This is display only and never feeds a measurement.
 *
 * The stretch is deliberately *shared* across the three display bands rather
 * than computed per band. Stretching each band to its own range normalises away
 * the differences between them, which is exactly the information colour carries:
 * vegetation is dark in red and bright in green, and per-band stretching pushes
 * both to mid-grey and turns soil magenta. One set of bounds keeps hue intact.
 */
function sharedBounds(bands, lowPct = 2, highPct = 98) {
  const sample = [];
  const perBand = Math.max(1, Math.floor(40000 / bands.length));
  bands.forEach((band) => {
    const stride = Math.max(1, Math.floor(band.length / perBand));
    for (let i = 0; i < band.length; i += stride) {
      const v = band[i];
      if (Number.isFinite(v)) sample.push(v);
    }
  });
  if (!sample.length) return [0, 1];
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor((lowPct / 100) * (sample.length - 1))];
  const hi = sample[Math.floor((highPct / 100) * (sample.length - 1))];
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

function compose(rasters, width, height, indices, alphaBand, alphaMax) {
  const [rBand, gBand, bBand] = indices.map((i) => rasters[i]);
  const [lo, hi] = sharedBounds([rBand, gBand, bBand]);
  const span = hi - lo;
  const out = new Uint8ClampedArray(width * height * 4);

  for (let p = 0, o = 0; p < width * height; p += 1, o += 4) {
    out[o] = ((rBand[p] - lo) / span) * 255;
    out[o + 1] = ((gBand[p] - lo) / span) * 255;
    out[o + 2] = ((bBand[p] - lo) / span) * 255;
    // An ortho's footprint is rarely rectangular, so the corners outside it are
    // padding. Honouring the alpha band shows them as transparent rather than as
    // a black frame that looks like part of the field.
    out[o + 3] = alphaBand ? (alphaBand[p] / alphaMax) * 255 : 255;
  }
  return new ImageData(out, width, height);
}

async function imageDataToUrl(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return URL.createObjectURL(blob);
}

/**
 * geotiff v3 keeps the IFD lazy: tags are not own properties, they come out of
 * `fileDirectory.getValue(name)`. Reading them as properties silently yields
 * undefined — which is how an alpha band goes unnoticed and an ortho renders
 * with a black surround. Falls back to property access for older versions.
 */
function tag(image, name) {
  try {
    const fd = image.getFileDirectory ? image.getFileDirectory() : image.fileDirectory;
    if (!fd) return undefined;
    return typeof fd.getValue === 'function' ? fd.getValue(name) : fd[name];
  } catch {
    return undefined;
  }
}

// ==============================|| READ ||============================== //

/**
 * Decodes an orthophoto far enough to preview it and to place plot polygons on
 * it. Returns the render plus the georeferencing needed to convert map
 * coordinates into overview pixels.
 */
export async function readOrtho(file, { combo = 'natural' } = {}) {
  const tiff = await fromBlob(file);
  const base = await tiff.getImage();

  const width = base.getWidth();
  const height = base.getHeight();
  const bandCount = base.getSamplesPerPixel();
  const geoKeys = base.getGeoKeys() || {};
  const epsg = geoKeys.ProjectedCSTypeGeoKey || geoKeys.ProjectedCRSGeoKey || geoKeys.GeographicTypeGeoKey || null;

  let origin;
  let resolution;
  try {
    origin = base.getOrigin();
    resolution = base.getResolution();
  } catch {
    origin = null;
  }

  const modelTransformation = tag(base, 'ModelTransformation');
  const georeferenced = Boolean(modelTransformation) || Boolean(origin && resolution);
  const affine = georeferenced ? makeAffine({ origin: origin || [0, 0], resolution: resolution || [1, -1], modelTransformation }) : null;

  // ground sample distance in cm, from the transform rather than assumed
  const gsdCm = affine ? Math.abs(affine.a) * 100 : null;

  const scale = Math.min(1, MAX_OVERVIEW_EDGE / Math.max(width, height));
  const overviewWidth = Math.max(1, Math.round(width * scale));
  const overviewHeight = Math.max(1, Math.round(height * scale));

  // Prefer a pyramid level near the target size — reading a reduced IFD is
  // dramatically cheaper than resampling the full-resolution raster.
  let source = base;
  const imageCount = await tiff.getImageCount();
  for (let i = 1; i < imageCount; i += 1) {
    const candidate = await tiff.getImage(i);
    const cw = candidate.getWidth();
    if (cw >= overviewWidth && cw < source.getWidth()) source = candidate;
  }

  // GDAL writes an alpha channel as an ExtraSample on top of the colour bands.
  // 0 means "unspecified" — only 1 (associated) and 2 (unassociated) are alpha.
  const extraSamples = tag(base, 'ExtraSamples');
  const extraCount = extraSamples?.length || 0;
  const hasAlpha = Boolean(extraCount && bandCount > extraCount && [1, 2].includes(Number(extraSamples[0])));
  const alphaIndex = hasAlpha ? bandCount - extraCount : -1;

  const indices = bandIndicesFor(combo, bandCount, alphaIndex);
  const requested = [...new Set(hasAlpha ? [...indices, alphaIndex] : indices)];
  const rasters = await source.readRasters({
    width: overviewWidth,
    height: overviewHeight,
    samples: requested,
    interleave: false
  });

  // readRasters returns only the requested samples, so remap onto 0..n-1
  const localIndices = indices.map((i) => requested.indexOf(i));
  const alphaBand = hasAlpha ? rasters[requested.indexOf(alphaIndex)] : null;
  const alphaMax = Number(tag(base, 'BitsPerSample')?.[alphaIndex]) === 16 ? 65535 : 255;

  const imageData = compose(rasters, overviewWidth, overviewHeight, localIndices, alphaBand, alphaMax);
  const overviewUrl = await imageDataToUrl(imageData);

  return {
    name: file.name,
    bytes: file.size,
    width,
    height,
    bandCount,
    colourBandCount: hasAlpha ? alphaIndex : bandCount,
    hasAlpha,
    epsg,
    crs: crsLabel(epsg, null),
    georeferenced,
    gsdCm: gsdCm ? Number(gsdCm.toFixed(2)) : null,
    affine,
    combo,
    overviewUrl,
    overviewWidth,
    overviewHeight,
    // ground centimetres per pixel *of the overview* — drives the nudge step
    overviewCmPerPx: gsdCm ? Number(((gsdCm * width) / overviewWidth).toFixed(3)) : null
  };
}

export function releaseOrtho(ortho) {
  if (ortho?.overviewUrl) URL.revokeObjectURL(ortho.overviewUrl);
}
