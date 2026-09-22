// ==============================|| FLIGHT SETUP - HELPERS ||============================== //

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/**
 * A shapefile is a file *set*. Anything without a .prj has no CRS, which is the
 * fastest way to silently produce georeferenced garbage — so it is a hard block,
 * not a warning.
 */
export const REQUIRED_SHAPEFILE_MEMBERS = ['.shp', '.shx', '.dbf', '.prj'];

export function inspectShapefileSelection(fileList) {
  const names = Array.from(fileList || []).map((f) => f.name.toLowerCase());
  if (!names.length) return { ok: false, error: null, members: [] };

  // a zipped shapefile is inspected server-side; accept it optimistically
  if (names.length === 1 && names[0].endsWith('.zip')) {
    return { ok: true, error: null, members: ['.zip'], zipped: true };
  }

  const members = REQUIRED_SHAPEFILE_MEMBERS.filter((ext) => names.some((n) => n.endsWith(ext)));
  const missing = REQUIRED_SHAPEFILE_MEMBERS.filter((ext) => !members.includes(ext));

  if (missing.includes('.prj')) {
    return {
      ok: false,
      members,
      error:
        'No .prj in the selection — the shapefile carries no coordinate system, so plots cannot be located in the ortho. Re-export with the projection, or upload the whole folder as a .zip.'
    };
  }

  if (missing.length) {
    return {
      ok: false,
      members,
      error: `Incomplete shapefile — missing ${missing.join(', ')}. Select every sidecar file, or upload a .zip.`
    };
  }

  return { ok: true, error: null, members, zipped: false };
}

/** Shrinks a ring toward its centroid by `insetPx`, uniformly on all sides. */
export function insetRing(ring, insetPx) {
  if (!insetPx) return ring;

  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;

  return ring.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const shrink = Math.min(insetPx, len * 0.45);
    return [x - (dx / len) * shrink, y - (dy / len) * shrink];
  });
}

export function ringToPoints(ring) {
  return ring.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

export function ringCentroid(ring) {
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
}

/** Builds the SVG transform that applies the operator's grid nudge. */
export function offsetTransform({ dxCm, dyCm, rotDeg }, cmPerPx, cx, cy) {
  const dx = (dxCm / cmPerPx).toFixed(2);
  const dy = (dyCm / cmPerPx).toFixed(2);
  return `translate(${dx} ${dy}) rotate(${rotDeg} ${cx} ${cy})`;
}

/**
 * Turns `{plot}_{genotype}_{date}.tif` into a capture regex.
 * Kept deliberately small — the real parse happens server-side on ingest.
 */
export function patternToRegex(pattern) {
  const tokens = [];
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = escaped.replace(/\\\{(\w+)\\\}/g, (_, name) => {
    tokens.push(name);
    return '(.+?)';
  });
  try {
    return { regex: new RegExp(`^${source}$`, 'i'), tokens };
  } catch {
    return { regex: null, tokens };
  }
}
