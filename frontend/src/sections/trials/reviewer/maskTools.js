// ==============================|| REVIEWER - MASK TOOLS ||============================== //

/**
 * Pixel-level operations on a plot mask. The mask is a flat Uint8Array in the
 * clip's native raster space (index = y * w + x), which is the same space the
 * source GeoTIFF is in — so a correction painted here is already a label the
 * training pipeline can consume, with no PNG round-trip in between.
 */

/** Paints a filled disc of `value` (1 = canopy, 0 = background) inside the valid area. */
export function paintDisc(mask, valid, w, h, cx, cy, radius, value) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(h - 1, Math.ceil(cy + radius));
  let changed = false;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) {
        const i = y * w + x;
        if (valid[i] && mask[i] !== value) {
          mask[i] = value;
          changed = true;
        }
      }
    }
  }
  return changed;
}

/** A stroke is a run of discs along the pointer's path, dense enough to leave no gaps. */
export function paintStroke(mask, valid, w, h, from, to, radius, value) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(length / Math.max(radius * 0.5, 0.5)));
  let changed = false;
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    changed = paintDisc(mask, valid, w, h, from.x + dx * t, from.y + dy * t, radius, value) || changed;
  }
  return changed;
}

/** Symmetric difference in pixels between two masks — how much a correction changed. */
export function maskDiff(a, b) {
  let count = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) count += 1;
  return count;
}
