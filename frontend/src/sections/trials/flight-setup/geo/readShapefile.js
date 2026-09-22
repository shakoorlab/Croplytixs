import { parseDbf, parseShp, parseZip } from 'shpjs';

import { crsLabel, epsgFromWkt } from './crs';

const readArrayBuffer = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsArrayBuffer(file);
  });

const readText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });

const byExt = (files, ext) => Array.from(files).find((f) => f.name.toLowerCase().endsWith(ext));

/** Flattens a GeoJSON geometry to its outer rings. Plot boundaries are simple polygons. */
function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((poly) => poly[0]);
  return [];
}

// ==============================|| READ ||============================== //

/**
 * Parses a plot shapefile into polygons **in the file's own coordinate system**.
 *
 * That last part is the whole trick. shpjs reprojects to WGS84 by default, which
 * would then have to be projected back into the ortho's CRS to draw. Passing no
 * transform to `parseShp` keeps the native coordinates, and since the ortho and
 * shapefile CRS must match anyway (the run is blocked otherwise), those
 * coordinates drop straight through the ortho's inverse transform.
 *
 * A zipped shapefile has no such escape hatch — `parseZip` always reprojects —
 * so that path returns WGS84 and reports it, and the caller reprojects.
 */
export async function readShapefile(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) throw new Error('No files selected.');

  const zip = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip') ? files[0] : null;

  if (zip) {
    const buffer = await readArrayBuffer(zip);
    const geojson = await parseZip(buffer);
    const collection = Array.isArray(geojson) ? geojson[0] : geojson;
    const features = (collection?.features || []).map((f) => ({ properties: f.properties || {}, rings: ringsOf(f.geometry) }));

    return {
      name: zip.name,
      bytes: zip.size,
      members: ['.zip'],
      featureCount: features.length,
      fields: Object.keys(features[0]?.properties || {}),
      // parseZip has already reprojected; the caller must bring these into the ortho CRS
      epsg: 4326,
      crs: 'EPSG:4326',
      coordinateSpace: 'wgs84',
      features
    };
  }

  const shpFile = byExt(files, '.shp');
  const dbfFile = byExt(files, '.dbf');
  const prjFile = byExt(files, '.prj');

  if (!shpFile) throw new Error('No .shp in the selection.');

  const [shpBuffer, dbfBuffer, prjText] = await Promise.all([
    readArrayBuffer(shpFile),
    dbfFile ? readArrayBuffer(dbfFile) : Promise.resolve(null),
    prjFile ? readText(prjFile) : Promise.resolve(null)
  ]);

  // no transform argument → coordinates stay in the shapefile's own CRS
  const geometries = parseShp(shpBuffer);
  const records = dbfBuffer ? parseDbf(dbfBuffer) : [];

  const features = geometries.map((geometry, i) => ({
    properties: records[i] || {},
    rings: ringsOf(geometry)
  }));

  const epsg = epsgFromWkt(prjText);

  return {
    name: shpFile.name,
    bytes: files.reduce((sum, f) => sum + f.size, 0),
    members: files.map((f) => `.${f.name.split('.').pop().toLowerCase()}`).sort(),
    featureCount: features.length,
    fields: Object.keys(features[0]?.properties || {}),
    epsg,
    crs: crsLabel(epsg, prjText),
    wkt: prjText,
    coordinateSpace: 'native',
    features
  };
}
