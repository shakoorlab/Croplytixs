// ==============================|| FLIGHT SETUP - CRS HELPERS ||============================== //

/**
 * proj4 ships no EPSG database, so a code has to be turned into a definition by
 * hand. UTM/WGS84 covers essentially every drone ortho we expect, and its codes
 * are arithmetic, so they can be built rather than looked up. Anything outside
 * that returns null and the caller degrades gracefully instead of guessing.
 */
export function epsgToProj4(epsg) {
  const code = Number(epsg);
  if (!Number.isFinite(code)) return null;

  if (code === 4326) return '+proj=longlat +datum=WGS84 +no_defs';
  if (code === 3857) return '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs';
  if (code >= 32601 && code <= 32660) return `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
  if (code >= 32701 && code <= 32760) return `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`;

  return null;
}

/** Pulls the trailing AUTHORITY["EPSG","####"] out of a .prj's WKT. */
export function epsgFromWkt(wkt) {
  if (!wkt) return null;
  const matches = [...String(wkt).matchAll(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"(\d+)"\s*\]/gi)];
  if (!matches.length) return null;
  return Number(matches[matches.length - 1][1]);
}

/** Human label for a CRS, preferring the code and falling back to the WKT name. */
export function crsLabel(epsg, wkt) {
  if (epsg) return `EPSG:${epsg}`;
  const name = wkt && String(wkt).match(/^\s*(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[\s*"([^"]+)"/i);
  return name ? name[1] : 'unknown';
}

// ==============================|| AFFINE TRANSFORM ||============================== //

/**
 * A raster's map↔pixel mapping as a 6-value affine, in the GDAL ordering:
 *   x = a*col + b*row + c
 *   y = d*col + e*row + f
 * North-up rasters have b = d = 0; ModelTransformation files may not.
 */
export function makeAffine({ origin, resolution, modelTransformation }) {
  if (modelTransformation && modelTransformation.length >= 8) {
    const m = modelTransformation;
    return { a: m[0], b: m[1], c: m[3], d: m[4], e: m[5], f: m[7] };
  }
  const [originX, originY] = origin;
  const [resX, resY] = resolution;
  return { a: resX, b: 0, c: originX, d: 0, e: resY, f: originY };
}

/** Inverts the affine so map coordinates can be turned into pixel coordinates. */
export function invertAffine({ a, b, c, d, e, f }) {
  const det = a * e - b * d;
  if (!det) return null;
  return {
    a: e / det,
    b: -b / det,
    c: (b * f - e * c) / det,
    d: -d / det,
    e: a / det,
    f: (d * c - a * f) / det
  };
}

export function applyAffine(inv, x, y) {
  return [inv.a * x + inv.b * y + inv.c, inv.d * x + inv.e * y + inv.f];
}
