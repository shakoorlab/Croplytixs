// ==============================|| TRIALS - PLOT PIXELS ||============================== //

/**
 * Pixel helpers for one plot's image and masks, used by the Review thumbnails
 * and the Reviewer's brush. `source` holds a decoded image and a mask raster —
 * `{ atlas, maskData, maskWidth }`, with each plot at `{ x, y, w, h }` in them.
 * The demo bundle that used to supply them is retired; per-plot display renders
 * and mask arrays will come from the API with the results, and these helpers
 * stay the same because they only care about w × h.
 */

/**
 * A plot's three layers as flat row-major arrays (index = y * w + x):
 *   valid  1 inside the plot polygon, 0 in the nodata corners of the rotated clip
 *   prob   canopy probability 0–255
 *   ref    1 where the hand-drawn reference mask says canopy (all 0 when unlabelled)
 */
export function plotLayers(source, plot) {
  const { maskData, maskWidth } = source;
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
export function renderPlot(source, plot, { mask = null, valid = null, tint = [140, 245, 66], opacity = 0.55, dim = 0.35 } = {}) {
  const { w, h, x, y } = plot;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source.atlas, x, y, w, h, 0, 0, w, h);

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
