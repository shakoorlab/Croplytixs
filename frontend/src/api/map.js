import useSWR from 'swr';
import { fromUrl } from 'geotiff';

// project imports
import { fetcher } from './client';
import { flightsKey } from './trials';

// ==============================|| API - MAP FILES ||============================== //

/**
 * The flight's map files, read straight from the bucket.
 *
 * `GET …/flights/{id}/map` answers with short-lived signed links: the viewing
 * COG (natural-colour RGB in 512 px tiles, with overviews) and, once the flight
 * has results, a result version's assignment raster (which plot each canopy
 * pixel went to). geotiff.js reads them with HTTP Range requests, a few tiles at
 * a time, so drawing one plot of a 5 GB orthophoto costs a few hundred KB and
 * the API never carries the bytes (backend/app/storage.py).
 *
 * The links are credentials and expire (MAP_LINK_MINUTES, an hour by default):
 * SWR asks for fresh ones ten minutes before, and a reader opened on an old link
 * is dropped from the cache when its link is replaced.
 */

export const mapPath = (trialId, flightId, version) =>
  trialId && flightId ? `${flightsKey(trialId)}/${flightId}/map${version ? `?version=${version}` : ''}` : null;

const REFRESH_BEFORE_EXPIRY_S = 600;

/** { data: { view: {url}, result: {version, assignment: {url}, noPlotValue, plotBoxes} | null, expiresInSeconds }, error } */
export function useFlightMap(trialId, flightId, version) {
  return useSWR(mapPath(trialId, flightId, version), fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    refreshInterval: (data) => (data ? Math.max(60, data.expiresInSeconds - REFRESH_BEFORE_EXPIRY_S) * 1000 : 0)
  });
}

// ==============================|| READERS ||============================== //

// One reader per link, so stepping through plots reuses the parsed header and
// geotiff.js's block cache. Links change when they are refreshed; the few most
// recent are kept.
const readers = new Map();
const MAX_READERS = 6;

function absolute(url) {
  return new URL(url, window.location.origin).toString();
}

function isMask(image) {
  try {
    return ((image.fileDirectory.getValue('NewSubfileType') || 0) & 4) !== 0;
  } catch {
    return false;
  }
}

/** The raster behind a link: its full-resolution image and its overviews (finest first), masks left out. */
export function openRaster(url) {
  if (!readers.has(url)) {
    const opening = (async () => {
      const tiff = await fromUrl(absolute(url), { cacheSize: 200 });
      const count = await tiff.getImageCount();
      const images = [];
      for (let i = 0; i < count; i += 1) {
        const image = await tiff.getImage(i);
        if (i === 0 || !isMask(image)) images.push(image);
      }
      images.sort((a, b) => b.getWidth() - a.getWidth());
      return { tiff, images };
    })();
    opening.catch(() => readers.delete(url)); // an expired or refused link can be retried with a new one
    readers.set(url, opening);
    while (readers.size > MAX_READERS) readers.delete(readers.keys().next().value);
  }
  return readers.get(url);
}

/**
 * Reads the part of a raster covering `bbox` ([minX, minY, maxX, maxY] in its
 * CRS), from the coarsest level that still gives `maxSide` pixels across the
 * longer side. Parts outside the raster come back as `fillValue`.
 */
export async function readWindow(raster, bbox, { maxSide = 1600, samples, interleave = false, fillValue = 0 } = {}) {
  const [base] = raster.images;
  const [ox, oy] = base.getOrigin();
  const wanted = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]) / maxSide;
  let image = base;
  for (const candidate of raster.images) {
    if (Math.abs(candidate.getResolution(base)[0]) <= wanted) image = candidate;
    else break;
  }
  const [rx, ry] = image === base ? base.getResolution() : image.getResolution(base); // ry < 0: rows run south
  const window = [
    Math.floor((bbox[0] - ox) / rx),
    Math.floor((bbox[3] - oy) / ry),
    Math.ceil((bbox[2] - ox) / rx),
    Math.ceil((bbox[1] - oy) / ry)
  ];
  const data = await image.readRasters({ window, samples, interleave, fillValue });
  return {
    data,
    width: window[2] - window[0],
    height: window[3] - window[1],
    originX: ox + window[0] * rx,
    originY: oy + window[1] * ry,
    resX: rx,
    resY: ry
  };
}
