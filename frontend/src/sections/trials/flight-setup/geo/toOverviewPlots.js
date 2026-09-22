import proj4 from 'proj4';

import { applyAffine, epsgToProj4, invertAffine } from './crs';

const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

/**
 * Projects shapefile polygons into the ortho's overview pixel space.
 *
 * map coords → (inverse geotransform) → full-resolution pixels → (overview
 * scale) → overview pixels. Doing it in that order keeps the georeferencing
 * exact and confines the preview's downsampling to a single multiply, so the
 * grid lands where the imagery actually is rather than approximately near it.
 */
export function toOverviewPlots(ortho, shapefile, mapping = {}) {
  if (!ortho?.affine || !shapefile?.features?.length) return { plots: [], error: null };

  const inverse = invertAffine(ortho.affine);
  if (!inverse) return { plots: [], error: 'The orthophoto’s transform is not invertible, so plots cannot be placed on it.' };

  // A zipped shapefile arrives already reprojected to WGS84, so it needs
  // bringing back into the ortho's CRS before the transform applies.
  let toOrthoCrs = null;
  if (shapefile.coordinateSpace === 'wgs84' && ortho.epsg && Number(ortho.epsg) !== 4326) {
    const def = epsgToProj4(ortho.epsg);
    if (!def) {
      return {
        plots: [],
        error: `A zipped shapefile can't be placed on an EPSG:${ortho.epsg} ortho — select the .shp, .shx, .dbf and .prj files together instead, which keeps their original coordinates.`
      };
    }
    const converter = proj4(WGS84, def);
    toOrthoCrs = (x, y) => converter.forward([x, y]);
  }

  const scaleX = ortho.overviewWidth / ortho.width;
  const scaleY = ortho.overviewHeight / ortho.height;

  const plots = shapefile.features
    .map((feature, index) => {
      const source = feature.rings[0];
      if (!source || source.length < 3) return null;

      // shapefiles repeat the first vertex to close the ring; drop it for drawing
      const closed = source.length > 3 && source[0][0] === source[source.length - 1][0] && source[0][1] === source[source.length - 1][1];
      const vertices = closed ? source.slice(0, -1) : source;

      const ring = vertices.map(([mx, my]) => {
        const [x, y] = toOrthoCrs ? toOrthoCrs(mx, my) : [mx, my];
        const [col, row] = applyAffine(inverse, x, y);
        return [col * scaleX, row * scaleY];
      });

      const props = feature.properties || {};
      const value = (key) => (key && props[key] != null ? String(props[key]).trim() : '');

      const gridId =
        mapping.identity === 'grid' && (mapping.row || mapping.col)
          ? [value(mapping.row), value(mapping.col)].filter(Boolean).join('-')
          : '';

      return {
        plotId: gridId || value(mapping.plot_id) || String(index + 1).padStart(3, '0'),
        genotype: value(mapping.genotype),
        rep: value(mapping.rep),
        ring
      };
    })
    .filter(Boolean);

  return { plots, error: null };
}

/**
 * How much of the grid actually falls on the image. A shapefile from the wrong
 * field or the wrong CRS parses perfectly and then lands nowhere near the
 * raster, which is worth catching before anyone clips 144 empty tiles.
 */
export function gridCoverage(plots, ortho) {
  if (!plots.length || !ortho) return 1;
  const inside = plots.filter((plot) => {
    const [cx, cy] = plot.ring.reduce(([sx, sy], [x, y]) => [sx + x, sy + y], [0, 0]).map((v) => v / plot.ring.length);
    return cx >= 0 && cy >= 0 && cx <= ortho.overviewWidth && cy <= ortho.overviewHeight;
  });
  return inside.length / plots.length;
}
