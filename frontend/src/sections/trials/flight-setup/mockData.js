// ==============================|| FLIGHT SETUP - MOCK FIXTURES ||============================== //

/**
 * Stand-in data so the screen renders before the ingest API exists.
 * Every shape here mirrors what the backend is expected to return, so swapping
 * these for a fetch should not require touching the components.
 */

export const OVERVIEW_W = 1120;
export const OVERVIEW_H = 460;

export const MOCK_ORTHO = {
  name: 'ortho_20260311.tif',
  bytes: 4509715660,
  bands: 5,
  bitDepth: 16,
  crs: 'EPSG:32620',
  gsdCm: 0.42,
  captureDate: '2026-03-11',
  // downsampled render produced on ingest; null renders the built-in placeholder
  overviewUrl: null,
  overviewWidth: OVERVIEW_W,
  overviewHeight: OVERVIEW_H,
  // cm of ground per pixel *of the overview* — used to convert the nudge offset
  overviewCmPerPx: 6.5
};

export const MOCK_SHAPEFILE = {
  name: 'plots_20260311.zip',
  bytes: 184320,
  crs: 'EPSG:32620',
  featureCount: 144,
  members: ['.shp', '.shx', '.dbf', '.prj'],
  // .dbf column names, for the attribute mapping selects
  fields: ['PLOT_NO', 'GENO', 'REP', 'BLOCK', 'ROW', 'RANGE', 'AREA_M2', 'Shape_Leng']
};

export const DEFAULT_MAPPING = {
  plot_id: 'PLOT_NO',
  genotype: 'GENO',
  rep: 'REP'
};

// The run panel's model list is the registry's production + candidate entries,
// so the version a flight pins is one the Models area knows about.
export { MOCK_MODELS } from 'api/models';

export const MOCK_ROSTER = { matched: 144, missing: 0, unknown: 0, total: 144 };

// ==============================|| PLOT GRID GENERATOR ||============================== //

const COLS = 16;
const ROWS = 9;
const FIELD_ROTATION = -5.5; // degrees — plots are rarely axis-aligned to the raster

/**
 * Builds 144 plot polygons in *overview pixel space*.
 * Real polygons arrive from the shapefile already projected to overview pixels
 * by the backend, so the component only ever deals in one coordinate system.
 */
function buildPlots() {
  const marginX = 70;
  const marginY = 58;
  const cellW = (OVERVIEW_W - marginX * 2) / COLS;
  const cellH = (OVERVIEW_H - marginY * 2) / ROWS;
  const gapX = cellW * 0.14;
  const gapY = cellH * 0.2;

  const cx = OVERVIEW_W / 2;
  const cy = OVERVIEW_H / 2;
  const rad = (FIELD_ROTATION * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rotate = ([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];

  const plots = [];
  let n = 0;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      n += 1;
      if (n > 144) break;

      const x0 = marginX + c * cellW + gapX / 2;
      const y0 = marginY + r * cellH + gapY / 2;
      const x1 = x0 + cellW - gapX;
      const y1 = y0 + cellH - gapY;

      plots.push({
        plotId: String(n).padStart(3, '0'),
        genotype: `TD${n % 3 === 0 ? 'r' : 'a'}${String(1000 + n * 7).slice(0, 4)}`,
        rep: (r % 3) + 1,
        areaM2: 1.44,
        ring: [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1]
        ].map(rotate)
      });
    }
  }

  return plots;
}

export const MOCK_PLOTS = buildPlots();

/**
 * The placeholder field render is drawn deliberately *offset* from the polygons
 * so the nudge control has something real to correct. Values are overview px.
 */
export const PLACEHOLDER_CANOPY_OFFSET = { x: 4.5, y: -2.5 };

// ==============================|| PRE-CLIPPED MODE FIXTURES ||============================== //

export const DEFAULT_FILENAME_PATTERN = '{plot}_{genotype}_{date}.tif';

export const MOCK_CLIPPED_FILES = [
  { file: 'P001_TDa1402_20260311.tif', plot: '001', genotype: 'TDa1402', date: '2026-03-11', bands: 5, gsdCm: 0.42 },
  { file: 'P002_TDa0977_20260311.tif', plot: '002', genotype: 'TDa0977', date: '2026-03-11', bands: 5, gsdCm: 0.42 },
  { file: 'P003_TDr2201_20260311.tif', plot: '003', genotype: 'TDr2201', date: '2026-03-11', bands: 5, gsdCm: 0.42 },
  { file: 'P004_TDa3310_20260311.tif', plot: '004', genotype: 'TDa3310', date: '2026-03-11', bands: 5, gsdCm: 0.42 },
  { file: 'P005_TDa1188_20260311.tif', plot: '005', genotype: 'TDa1188', date: '2026-03-11', bands: 5, gsdCm: 0.42 }
];
