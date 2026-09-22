import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { mutate } from 'swr';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

// project imports
import MainCard from 'components/MainCard';
import PageHeader from 'components/PageHeader';
import TrialTabs from 'sections/trials/TrialTabs';
import { NESTED_PANEL } from 'sections/trials/surfaces';
import { createFlight, flightsKey, useTrial } from 'api/trials';
import FileDropCard from 'sections/trials/flight-setup/FileDropCard';
import OrthoOverview from 'sections/trials/flight-setup/OrthoOverview';
import ShapefileMapping from 'sections/trials/flight-setup/ShapefileMapping';
import PreClippedTable from 'sections/trials/flight-setup/PreClippedTable';
import RunConfigPanel from 'sections/trials/flight-setup/RunConfigPanel';
import { formatBytes, inspectShapefileSelection } from 'sections/trials/flight-setup/utils';
import { ALTITUDES, checkModelFit } from 'sections/trials/flight-setup/constants';
import { readOrtho, releaseOrtho } from 'sections/trials/flight-setup/geo/readOrtho';
import { readShapefile } from 'sections/trials/flight-setup/geo/readShapefile';
import { gridCoverage, toOverviewPlots } from 'sections/trials/flight-setup/geo/toOverviewPlots';
import { DEFAULT_FILENAME_PATTERN, MOCK_CLIPPED_FILES, MOCK_MODELS } from 'sections/trials/flight-setup/mockData';

// assets
import PictureOutlined from '@ant-design/icons/PictureOutlined';
import FileZipOutlined from '@ant-design/icons/FileZipOutlined';
import FolderOpenOutlined from '@ant-design/icons/FolderOpenOutlined';
import BorderOuterOutlined from '@ant-design/icons/BorderOuterOutlined';

const EMPTY_MAPPING = { identity: 'single', plot_id: '', row: '', col: '', genotype: '', rep: '' };

/**
 * .dbf column names are whatever the exporter felt like — PLOT_NO, Plot, plot_id,
 * id_parcelle. Guessing from the real field list saves the common case; the user
 * still confirms or corrects it in the mapping card.
 */
const FIELD_HINTS = {
  plot_id: [/^plot[_ ]?(no|id|num)?$/i, /parcelle/i, /^id$/i, /plot/i],
  row: [/^row$/i, /^ligne$/i, /^rang$/i],
  col: [/^col(umn)?$/i, /^range$/i, /^colonne$/i],
  genotype: [/^geno(type)?$/i, /^var(iety)?$/i, /accession/i, /entry/i, /cultivar/i],
  rep: [/^rep(licate)?$/i, /^block$/i, /^bloc$/i]
};

function guessMapping(fields = []) {
  const pick = (patterns) => patterns.map((re) => fields.find((f) => re.test(f))).find(Boolean) || '';
  const plotId = pick(FIELD_HINTS.plot_id);
  const row = pick(FIELD_HINTS.row);
  const col = pick(FIELD_HINTS.col);

  return {
    // no single id column but a row/column pair present → identify by position
    identity: !plotId && row && col ? 'grid' : 'single',
    plot_id: plotId,
    row,
    col,
    genotype: pick(FIELD_HINTS.genotype),
    rep: pick(FIELD_HINTS.rep)
  };
}

// ==============================|| TRIALS - FLIGHT DATE SETUP ||============================== //

export default function FlightDateSetup() {
  const { trialId } = useParams();
  const navigate = useNavigate();
  const { data: trial } = useTrial(trialId);

  const [sourceMode, setSourceMode] = useState('ortho');

  // --- staged inputs · nothing is staged on arrival -------------------------
  const [ortho, setOrtho] = useState(null);
  const [orthoError, setOrthoError] = useState(null);
  const [orthoBusy, setOrthoBusy] = useState(false);
  const [shapefile, setShapefile] = useState(null);
  const [shapefileError, setShapefileError] = useState(null);
  const [shapefileBusy, setShapefileBusy] = useState(false);
  const [clipped, setClipped] = useState(null);

  // --- grid alignment ------------------------------------------------------
  const [offset, setOffset] = useState({ dxCm: 0, dyCm: 0, rotDeg: 0 });
  const [insetCm, setInsetCm] = useState(10);
  const [mapping, setMapping] = useState(EMPTY_MAPPING);

  // --- pre-clipped mode ----------------------------------------------------
  const [pattern, setPattern] = useState(DEFAULT_FILENAME_PATTERN);

  // --- run -----------------------------------------------------------------
  const [config, setConfig] = useState({
    flightDate: '',
    capture: '12-ms',
    modelId: MOCK_MODELS[0].id,
    denominator: 'polygon'
  });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [submitError, setSubmitError] = useState(null);
  const [created, setCreated] = useState(null); // the flight record the API returned

  const isOrthoMode = sourceMode === 'ortho';
  const hasGrid = Boolean(ortho && shapefile);

  // real polygons, projected through the ortho's transform into overview pixels
  const { plots, error: projectionError } = useMemo(
    () => (hasGrid ? toOverviewPlots(ortho, shapefile, mapping) : { plots: [], error: null }),
    [hasGrid, ortho, shapefile, mapping]
  );

  const coverage = useMemo(() => (plots.length ? gridCoverage(plots, ortho) : 1), [plots, ortho]);
  const plotCount = isOrthoMode ? plots.length || shapefile?.featureCount || 0 : clipped?.count || 0;

  // the overview render is an object URL; let it go when the page does
  useEffect(() => () => releaseOrtho(ortho), [ortho]);

  // Both must describe the same ground. A shapefile in a different CRS parses
  // fine and then lands nowhere near the imagery, so this is a hard stop.
  const crsAgree = hasGrid && (shapefile.coordinateSpace === 'wgs84' ? Boolean(ortho.epsg) : Number(ortho.epsg) === Number(shapefile.epsg));

  const modelFit = useMemo(
    () =>
      checkModelFit(
        MOCK_MODELS.find((m) => m.id === config.modelId),
        ALTITUDES.find((a) => a.value === config.capture),
        isOrthoMode ? ortho?.colourBandCount : null
      ),
    [config.modelId, config.capture, isOrthoMode, ortho]
  );

  const blockers = useMemo(() => {
    const list = [];
    if (isOrthoMode) {
      if (!ortho) list.push('No orthophoto staged.');
      if (!shapefile) list.push('No plot shapefile staged.');
      if (orthoError) list.push('Orthophoto could not be read.');
      if (shapefileError) list.push('Shapefile could not be read.');
      if (projectionError) list.push('Plot polygons could not be placed on the ortho.');
      if (hasGrid && !crsAgree) list.push(`CRS mismatch — ortho is ${ortho.crs}, shapefile is ${shapefile.crs}.`);
      if (hasGrid && crsAgree && !projectionError && coverage < 0.5)
        list.push('Most plots fall outside the orthophoto — wrong shapefile, or wrong flight?');
      if (shapefile && mapping.identity === 'grid' && !(mapping.row && mapping.col))
        list.push('Row and column fields are not both mapped.');
      if (shapefile && mapping.identity !== 'grid' && !mapping.plot_id) list.push('Plot ID field is not mapped.');
    } else if (!clipped) {
      list.push('No plot images staged.');
    }
    if (!config.flightDate) list.push('Flight date is not set.');
    if (!modelFit.fits) list.push('Selected model does not match this capture.');
    return list;
  }, [
    isOrthoMode,
    ortho,
    orthoError,
    shapefile,
    shapefileError,
    projectionError,
    hasGrid,
    crsAgree,
    coverage,
    mapping,
    clipped,
    config.flightDate,
    modelFit.fits
  ]);

  /**
   * Polygon area is only definable when polygons exist, so switching to
   * pre-clipped images has to drop the denominator back to the clip extent.
   */
  const handleSourceMode = (value) => {
    setSourceMode(value);
    setConfig((current) => ({ ...current, denominator: value === 'ortho' ? 'polygon' : 'clip' }));
  };

  // ---- real decode --------------------------------------------------------
  // Everything the panel shows about the ortho — band count, CRS, GSD, the
  // preview itself — comes out of the file rather than being declared, so a
  // mislabelled upload is visible immediately.
  const handleOrthoSelect = async (fileList) => {
    const file = fileList[0];
    setOrthoError(null);
    setOrthoBusy(true);
    try {
      const next = await readOrtho(file, { combo: 'natural' });
      next.file = file;
      if (!next.georeferenced) {
        setOrthoError('This TIFF carries no georeferencing, so plots cannot be placed on it. Export it as a GeoTIFF.');
      }
      setOrtho((previous) => {
        releaseOrtho(previous);
        return next;
      });
      setConfig((current) => ({ ...current, flightDate: current.flightDate }));
    } catch (error) {
      setOrthoError(`Could not read that orthophoto — ${error.message}`);
      setOrtho(null);
    } finally {
      setOrthoBusy(false);
    }
  };

  // Re-decoding is the only way to change band combination; the preview is a
  // flattened 8-bit render, so the source bands are no longer available in it.
  const handleComboChange = async (combo) => {
    if (!ortho?.file) return;
    setOrthoBusy(true);
    try {
      const next = await readOrtho(ortho.file, { combo });
      setOrtho((previous) => {
        releaseOrtho(previous);
        return { ...next, file: ortho.file };
      });
    } catch (error) {
      setOrthoError(`Could not re-render that band combination — ${error.message}`);
    } finally {
      setOrthoBusy(false);
    }
  };

  const handleShapefileSelect = async (fileList) => {
    const inspection = inspectShapefileSelection(fileList);
    setShapefileError(inspection.error);
    if (!inspection.ok) {
      setShapefile(null);
      setMapping(EMPTY_MAPPING);
      return;
    }

    setShapefileBusy(true);
    try {
      const next = await readShapefile(fileList);
      next.files = Array.from(fileList); // the parsed view is for the screen; the bytes still go to the API
      setShapefile(next);
      // pre-select the mapping from the real attribute names
      setMapping(guessMapping(next.fields));
      if (!next.featureCount) setShapefileError('That shapefile contains no polygons.');
    } catch (error) {
      setShapefileError(`Could not read that shapefile — ${error.message}`);
      setShapefile(null);
      setMapping(EMPTY_MAPPING);
    } finally {
      setShapefileBusy(false);
    }
  };

  const handleClippedSelect = (fileList) => {
    const files = Array.from(fileList);
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    setClipped({ count: files.length, bytes, rows: MOCK_CLIPPED_FILES.slice(0, 5), files });
  };

  /**
   * With only a roster *count* on the trial (the plot map CSV is optional), this
   * is the honest comparison available: how many polygons carry a usable plot id,
   * versus how many plots the trial says it has. Once a roster is stored the
   * missing/unknown split becomes a real set difference.
   */
  const roster = useMemo(() => {
    if (!shapefile) return { matched: 0, missing: 0, unknown: 0, total: 0 };
    const total = trial?.plots || 0;
    const ids = new Set(plots.map((plot) => plot.plotId).filter(Boolean));
    const identified = (mapping.identity === 'grid' ? mapping.row && mapping.col : mapping.plot_id) ? ids.size : 0;
    return {
      matched: total ? Math.min(identified, total) : identified,
      missing: total ? Math.max(total - identified, 0) : 0,
      unknown: total ? Math.max(identified - total, 0) : 0,
      total: total || identified
    };
  }, [shapefile, plots, mapping, trial]);

  const flightsUrl = `/trials/${trialId}/flights`;

  /**
   * Upload = one multipart POST: a JSON `meta` part describing the flight and
   * the run configuration, plus the raw files. The API streams the files into
   * the bucket and writes one flight record. Progress here is *upload* progress
   * (bytes leaving the browser) — the clip + inference job that turns
   * `uploaded` into `complete` is the next backend slice and will report
   * its own progress on the flight record.
   */
  const handleRun = async () => {
    const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));
    const captureOption = ALTITUDES.find((a) => a.value === config.capture);
    const model = MOCK_MODELS.find((m) => m.id === config.modelId);

    const meta = {
      flightDate: config.flightDate,
      source: sourceMode,
      capture: config.capture,
      captureLabel: captureOption?.label,
      modelId: config.modelId,
      modelLabel: model?.label,
      denominator: config.denominator,
      plots: plotCount,
      offset,
      insetCm,
      mapping,
      ortho: isOrthoMode ? pick(ortho, ['name', 'bytes', 'width', 'height', 'bandCount', 'colourBandCount', 'epsg', 'crs', 'gsdCm']) : null,
      shapefile: isOrthoMode ? pick(shapefile, ['name', 'bytes', 'members', 'featureCount', 'fields', 'epsg', 'crs']) : null,
      filenamePattern: isOrthoMode ? null : pattern
    };

    setSubmitError(null);
    setCreated(null);
    setProgress(0);
    setRunning(true);
    try {
      const flight = await createFlight(
        trialId,
        {
          meta,
          ortho: isOrthoMode ? ortho.file : null,
          shapefile: isOrthoMode ? shapefile.files : [],
          clipped: isOrthoMode ? [] : clipped.files
        },
        { onProgress: setProgress }
      );
      setCreated(flight);
      // the runs page may already hold a cached list — invalidate it so the new
      // flight shows up without a reload
      mutate(flightsKey(trialId));
    } catch (error) {
      setSubmitError(error.message);
      setRunning(false);
      setProgress(0);
    }
  };

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      {/* ---- header ---- */}
      <Grid size={12}>
        <PageHeader
          crumbs={[
            { label: 'Croplytix', to: '/' },
            { label: 'Field Trials', to: '/trials' },
            { label: trial?.name || trialId, to: flightsUrl },
            { label: 'Upload imagery' }
          ]}
          title="Upload imagery"
          subtitle={trial ? `${trial.crop} · ${trial.site} · ${trial.plots} plots in roster` : undefined}
          actions={
            <Button size="small" color="secondary" onClick={() => navigate(flightsUrl)}>
              Cancel
            </Button>
          }
        />
      </Grid>

      {/* ---- workspace card: tabs + panel share one border ---- */}
      <Grid size={12}>
        <TrialTabs trialId={trialId} current="flights" flagged={trial?.flagged || 0}>
          <Grid container rowSpacing={2.5} columnSpacing={2.75}>
            {/* ---- source mode ---- */}
            <Grid size={12}>
              <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                  Source
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={sourceMode}
                  onChange={(event, value) => value && handleSourceMode(value)}
                  disabled={running}
                  sx={{
                    '& .MuiToggleButton-root.Mui-selected': {
                      color: 'primary.main',
                      bgcolor: 'primary.lighter',
                      borderColor: 'primary.light',
                      '&:hover': { bgcolor: 'primary.lighter' }
                    }
                  }}
                >
                  <ToggleButton value="ortho">Ortho + plot shapefile</ToggleButton>
                  <ToggleButton value="clipped">Pre-clipped plot images</ToggleButton>
                </ToggleButtonGroup>

                <Box sx={{ flex: 1 }} />

                {hasGrid && (
                  <Chip
                    size="small"
                    label={crsAgree ? `${ortho.crs} · ortho and .shp agree` : `CRS mismatch · ${ortho.crs} vs ${shapefile.crs}`}
                    sx={{
                      color: crsAgree ? 'success.main' : 'error.main',
                      bgcolor: crsAgree ? 'success.lighter' : 'error.lighter'
                    }}
                  />
                )}
              </Stack>
            </Grid>

            {/* ---- left column ---- */}
            <Grid size={{ xs: 12, lg: 8 }}>
              <Stack sx={{ gap: 2.5 }}>
                {isOrthoMode ? (
                  <>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <FileDropCard
                          label="Drop orthophoto"
                          hint=".tif / .tiff — GeoTIFF preferred"
                          accept=".tif,.tiff"
                          icon={<PictureOutlined />}
                          disabled={running}
                          busy={orthoBusy}
                          error={orthoError}
                          staged={
                            ortho && {
                              name: ortho.name,
                              meta: [
                                formatBytes(ortho.bytes),
                                `${ortho.width} × ${ortho.height} px`,
                                `${ortho.bandCount}-band`,
                                ortho.gsdCm ? `${ortho.gsdCm} cm/px` : 'no GSD',
                                ortho.crs
                              ]
                            }
                          }
                          onSelect={handleOrthoSelect}
                          onClear={() => {
                            releaseOrtho(ortho);
                            setOrtho(null);
                            setOrthoError(null);
                          }}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <FileDropCard
                          label="Drop plot shapefile"
                          hint=".zip, or select .shp .shx .dbf .prj together"
                          accept=".zip,.shp,.shx,.dbf,.prj,.cpg"
                          multiple
                          icon={<FileZipOutlined />}
                          disabled={running}
                          busy={shapefileBusy}
                          error={shapefileError}
                          staged={
                            shapefile && {
                              name: shapefile.name,
                              meta: [shapefile.members.join(' '), `${shapefile.featureCount} polygons`, shapefile.crs]
                            }
                          }
                          onSelect={handleShapefileSelect}
                          onClear={() => {
                            setShapefile(null);
                            setShapefileError(null);
                            setMapping(EMPTY_MAPPING);
                          }}
                        />
                      </Grid>
                    </Grid>

                    {hasGrid ? (
                      <OrthoOverview
                        ortho={ortho}
                        plots={plots}
                        offset={offset}
                        onOffsetChange={setOffset}
                        insetCm={insetCm}
                        onInsetChange={setInsetCm}
                        onComboChange={handleComboChange}
                        busy={orthoBusy}
                        disabled={running}
                      />
                    ) : (
                      <MainCard content={false} sx={NESTED_PANEL}>
                        <Stack sx={{ alignItems: 'center', gap: 1, py: 7, px: 3 }}>
                          <Box sx={{ fontSize: '1.75rem', color: 'text.disabled', display: 'flex' }}>
                            <BorderOuterOutlined />
                          </Box>
                          <Typography variant="subtitle1">Grid alignment preview</Typography>
                          <Typography variant="body2" color="text.secondary" align="center" sx={{ maxWidth: 440 }}>
                            {!ortho && !shapefile && 'Add both an orthophoto and its plot shapefile to check the grid lands on the plots.'}
                            {ortho && !shapefile && 'Orthophoto staged. Add the plot shapefile to draw the plot boundaries over it.'}
                            {!ortho && shapefile && 'Shapefile staged. Add the orthophoto to see where those plots fall.'}
                          </Typography>
                        </Stack>
                      </MainCard>
                    )}

                    <ShapefileMapping
                      fields={shapefile?.fields || []}
                      mapping={mapping}
                      onMappingChange={setMapping}
                      roster={roster}
                      disabled={running || !shapefile}
                    />
                  </>
                ) : (
                  <>
                    <FileDropCard
                      label="Drop clipped plot images"
                      hint="A folder of .tif / .tiff / .png — one file per plot"
                      accept=".tif,.tiff,.png"
                      multiple
                      directory
                      icon={<FolderOpenOutlined />}
                      disabled={running}
                      staged={
                        clipped && {
                          name: `${clipped.count} files staged`,
                          meta: [formatBytes(clipped.bytes), `${clipped.count} images`]
                        }
                      }
                      onSelect={handleClippedSelect}
                      onClear={() => setClipped(null)}
                    />
                    <PreClippedTable
                      pattern={pattern}
                      onPatternChange={setPattern}
                      rows={clipped?.rows || []}
                      totalCount={clipped?.count || 0}
                      parsedCount={clipped?.count || 0}
                      disabled={running || !clipped}
                    />
                  </>
                )}
              </Stack>
            </Grid>

            {/* ---- right rail ---- */}
            <Grid size={{ xs: 12, lg: 4 }}>
              <Stack sx={{ gap: 2 }}>
                <RunConfigPanel
                  values={config}
                  onChange={setConfig}
                  models={MOCK_MODELS}
                  gsdCm={isOrthoMode ? ortho?.gsdCm : undefined}
                  gsdSource={isOrthoMode ? 'from ortho transform' : 'from GeoTIFF transform'}
                  plotCount={plotCount}
                  estimate={isOrthoMode ? 'clip ~4 min · infer ~8 min' : 'infer ~8 min'}
                  running={running}
                  progress={progress}
                  canRun={blockers.length === 0}
                  blockers={blockers}
                  allowPolygonArea={isOrthoMode}
                  inputsStaged={isOrthoMode ? Boolean(ortho) : Boolean(clipped)}
                  actualBands={isOrthoMode ? ortho?.colourBandCount : null}
                  runLabel={isOrthoMode ? `Clip & run · ${plotCount} plots` : `Run · ${plotCount} plots`}
                  onRun={handleRun}
                  onOverrideGsd={() => {
                    // opens a dialog collecting altitude + sensor + focal length
                  }}
                />

                {submitError && (
                  <Alert severity="error" variant="outlined" onClose={() => setSubmitError(null)}>
                    {submitError}
                  </Alert>
                )}

                {created && (
                  <Alert
                    severity="success"
                    variant="outlined"
                    action={
                      <Button size="small" color="inherit" onClick={() => navigate(flightsUrl)}>
                        View flights
                      </Button>
                    }
                  >
                    Flight {created.flightDate} uploaded — {created.files?.length || 0} file{created.files?.length === 1 ? '' : 's'} stored.
                  </Alert>
                )}
              </Stack>
            </Grid>
          </Grid>
        </TrialTabs>
      </Grid>
    </Grid>
  );
}
