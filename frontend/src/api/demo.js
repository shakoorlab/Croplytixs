import useSWR from 'swr';

// ==============================|| API - DEMO IMAGERY BUNDLE ||============================== //

/**
 * The demo screens draw real plots: the Roujol A 12-12-24 clips, the canopy
 * U-Net's probability map for every one of them, and the 75 hand-drawn
 * reference masks the model was trained on. `scripts/build-demo-bundle.py`
 * packs them into three static files under `public/demo/roujol-a/`:
 *
 *   atlas.jpg   the RGB clips, laid out as the field itself (cell = row, col)
 *   masks.png   same layout — R: validity (alpha), G: canopy probability, B: reference mask
 *   index.json  one record per plot: atlas position, model output, reference stats
 *
 * This module loads the bundle once (SWR dedupes it across every component
 * that asks) and decodes masks.png into a byte array so the Reviewer can read
 * and write mask pixels directly. When per-plot results come from the API, the
 * atlas will be replaced by per-plot display renders served from the bucket;
 * the pixel helpers below stay the same because they only care about w × h.
 */

const BUNDLE_URL = `${import.meta.env.BASE_URL || '/'}demo/roujol-a`.replace(/\/{2,}/g, '/');

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}

async function loadBundle() {
  const [index, atlas, masks] = await Promise.all([
    fetch(`${BUNDLE_URL}/index.json`).then((response) => {
      if (!response.ok) throw new Error(`Could not load the demo bundle (HTTP ${response.status}).`);
      return response.json();
    }),
    loadImage(`${BUNDLE_URL}/atlas.jpg`),
    loadImage(`${BUNDLE_URL}/masks.png`)
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = masks.width;
  canvas.height = masks.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(masks, 0, 0);
  const maskData = ctx.getImageData(0, 0, masks.width, masks.height).data;

  const plots = [...index.plots].sort((a, b) => a.row - b.row || a.col - b.col);
  return {
    ...index,
    plots,
    atlas,
    maskData,
    maskWidth: masks.width,
    byStem: Object.fromEntries(plots.map((plot) => [plot.stem, plot]))
  };
}

export function useDemoBundle() {
  return useSWR('demo:roujol-a', loadBundle, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    dedupingInterval: Number.POSITIVE_INFINITY
  });
}

// ==============================|| PIXEL HELPERS ||============================== //

/**
 * A plot's three layers as flat row-major arrays (index = y * w + x):
 *   valid  1 inside the plot polygon, 0 in the nodata corners of the rotated clip
 *   prob   canopy probability 0–255
 *   ref    1 where the hand-drawn reference mask says canopy (all 0 when unlabelled)
 */
export function plotLayers(bundle, plot) {
  const { maskData, maskWidth } = bundle;
  const { x, y, w, h } = plot;
  const valid = new Uint8Array(w * h);
  const prob = new Uint8Array(w * h);
  const ref = new Uint8Array(w * h);
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      const source = ((y + j) * maskWidth + (x + i)) * 4;
      const target = j * w + i;
      valid[target] = maskData[source] > 127 ? 1 : 0;
      prob[target] = maskData[source + 1];
      ref[target] = maskData[source + 2] > 127 ? 1 : 0;
    }
  }
  return { w, h, valid, prob, ref };
}

/** The model's decision: canopy where p > 0.5, restricted to the valid area. */
export function predictedMask({ prob, valid }) {
  const mask = new Uint8Array(prob.length);
  for (let i = 0; i < prob.length; i += 1) mask[i] = valid[i] && prob[i] > 127 ? 1 : 0;
  return mask;
}

/** Fractional cover in percent — canopy pixels over valid pixels, the polygon-area denominator. */
export function coverOf(mask, valid) {
  let canopy = 0;
  let total = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (valid[i]) {
      total += 1;
      if (mask[i]) canopy += 1;
    }
  }
  return total ? (canopy / total) * 100 : 0;
}

export function countMask(mask, valid) {
  let canopy = 0;
  for (let i = 0; i < mask.length; i += 1) if (valid[i] && mask[i]) canopy += 1;
  return canopy;
}

/**
 * Paints one plot at native resolution onto an offscreen canvas: the photo,
 * the mask tinted over it, and the nodata corners dimmed. Callers draw the
 * result scaled to whatever size they need; keeping this at native size means
 * one pixel here is one pixel of the GeoTIFF, which is what the brush edits.
 */
export function renderPlot(bundle, plot, { mask = null, valid = null, tint = [140, 245, 66], opacity = 0.55, dim = 0.35 } = {}) {
  const { w, h, x, y } = plot;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bundle.atlas, x, y, w, h, 0, 0, w, h);

  if (mask || valid) {
    const image = ctx.getImageData(0, 0, w, h);
    const { data } = image;
    for (let i = 0; i < w * h; i += 1) {
      const p = i * 4;
      if (valid && !valid[i]) {
        data[p] *= dim;
        data[p + 1] *= dim;
        data[p + 2] *= dim;
      } else if (mask && mask[i]) {
        data[p] = data[p] * (1 - opacity) + tint[0] * opacity;
        data[p + 1] = data[p + 1] * (1 - opacity) + tint[1] * opacity;
        data[p + 2] = data[p + 2] * (1 - opacity) + tint[2] * opacity;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}
