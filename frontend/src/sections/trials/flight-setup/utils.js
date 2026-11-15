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
 * not a warning. The API checks the same rules (backend/app/routers/flights.py);
 * checking here too means a bad selection is caught before anything is sent.
 */
export const REQUIRED_SHAPEFILE_MEMBERS = ['.shp', '.shx', '.dbf', '.prj'];
const OPTIONAL_SHAPEFILE_MEMBERS = ['.cpg']; // the .dbf's text encoding

const extensionOf = (name) => (name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.')).toLowerCase() : '');
const stemOf = (name) => name.slice(0, name.length - extensionOf(name).length).toLowerCase();

export function inspectShapefileSelection(fileList) {
  const names = Array.from(fileList || []).map((f) => f.name);
  if (!names.length) return { ok: false, error: null, members: [] };

  // a zipped shapefile is parsed whole by readShapefile; accept it on its own
  if (names.length === 1 && extensionOf(names[0]) === '.zip') {
    return { ok: true, error: null, members: ['.zip'], zipped: true };
  }
  const extensions = names.map(extensionOf);
  if (extensions.includes('.zip')) {
    return { ok: false, members: [], error: 'Drop a zipped shapefile on its own, or its .shp, .shx, .dbf and .prj without the zip.' };
  }
  const stray = names.find((name) => ![...REQUIRED_SHAPEFILE_MEMBERS, ...OPTIONAL_SHAPEFILE_MEMBERS].includes(extensionOf(name)));
  if (stray) return { ok: false, members: [], error: `${stray} isn't part of a shapefile (.shp, .shx, .dbf, .prj, .cpg).` };
  const repeated = extensions.find((ext, i) => extensions.indexOf(ext) !== i);
  if (repeated) return { ok: false, members: [], error: `One shapefile per flight: there are two ${repeated} files.` };
  const stems = [...new Set(names.map(stemOf))];
  if (stems.length > 1) {
    return { ok: false, members: [], error: `These files have different names (${stems.join(', ')}). A shapefile's parts share one name.` };
  }

  const members = REQUIRED_SHAPEFILE_MEMBERS.filter((ext) => extensions.includes(ext));
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
