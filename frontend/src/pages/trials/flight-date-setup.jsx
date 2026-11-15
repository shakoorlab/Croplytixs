import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';

// project imports
import MainCard from 'components/MainCard';
import PageHeader from 'components/PageHeader';
import TrialTabs from 'sections/trials/TrialTabs';
import { NESTED_PANEL } from 'sections/trials/surfaces';
import { useTrial } from 'api/trials';
import { startFlightUpload } from 'api/uploads';
import FileDropCard from 'sections/trials/flight-setup/FileDropCard';
import OrthoOverview from 'sections/trials/flight-setup/OrthoOverview';
import ShapefileMapping from 'sections/trials/flight-setup/ShapefileMapping';
import FlightDetailsPanel from 'sections/trials/flight-setup/FlightDetailsPanel';
import { formatBytes, inspectShapefileSelection } from 'sections/trials/flight-setup/utils';
import { ALTITUDES } from 'sections/trials/flight-setup/constants';
import { readOrtho, releaseOrtho } from 'sections/trials/flight-setup/geo/readOrtho';
import { readShapefile } from 'sections/trials/flight-setup/geo/readShapefile';
import { gridCoverage, toOverviewPlots } from 'sections/trials/flight-setup/geo/toOverviewPlots';

// assets
import PictureOutlined from '@ant-design/icons/PictureOutlined';
import FileZipOutlined from '@ant-design/icons/FileZipOutlined';
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

  // --- staged inputs · nothing is staged on arrival -------------------------
  const [ortho, setOrtho] = useState(null);
  const [orthoError, setOrthoError] = useState(null);
  const [orthoBusy, setOrthoBusy] = useState(false);
  const [shapefile, setShapefile] = useState(null);
  const [shapefileError, setShapefileError] = useState(null);
  const [shapefileBusy, setShapefileBusy] = useState(false);

  // --- grid alignment ------------------------------------------------------
  const [offset, setOffset] = useState({ dxCm: 0, dyCm: 0, rotDeg: 0 });
  const [insetCm, setInsetCm] = useState(10);
  const [mapping, setMapping] = useState(EMPTY_MAPPING);

  // --- flight details + upload ----------------------------------------------
  // Only facts about the flight. The model and area denominator are chosen when
  // the flight is run, not when its files arrive.
  const [config, setConfig] = useState({
    flightDate: '',
    capture: '12-ms'
  });
  // Only while the API records the flight and opens its upload sessions — a
  // moment. The bytes then go in the background, and this page hands over to
  // the Flights table, where the upload's progress shows.
  const [running, setRunning] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const hasGrid = Boolean(ortho && shapefile);

  // real polygons, projected through the ortho's transform into overview pixels
  const { plots, error: projectionError } = useMemo(
    () => (hasGrid ? toOverviewPlots(ortho, shapefile, mapping) : { plots: [], error: null }),
    [hasGrid, ortho, shapefile, mapping]
  );

  const coverage = useMemo(() => (plots.length ? gridCoverage(plots, ortho) : 1), [plots, ortho]);
  const plotCount = plots.length || shapefile?.featureCount || 0;

  // the overview render is an object URL; let it go when the page does
  useEffect(() => () => releaseOrtho(ortho), [ortho]);

  // Both must describe the same ground. A shapefile in a different CRS parses
  // fine and then lands nowhere near the imagery, so this is a hard stop.
  const crsAgree = hasGrid && (shapefile.coordinateSpace === 'wgs84' ? Boolean(ortho.epsg) : Number(ortho.epsg) === Number(shapefile.epsg));

  // The shapefile is optional: without one the flight is stored with no plot
  // grid. With one, it has to fit the ortho before anything is sent.
  const blockers = useMemo(() => {
    const list = [];
    if (!ortho) list.push('No orthophoto staged.');
    if (orthoError) list.push('Orthophoto could not be read.');
    if (shapefileError) list.push('Shapefile could not be read.');
    if (projectionError) list.push('Plot polygons could not be placed on the ortho.');
    if (hasGrid && !crsAgree) list.push(`CRS mismatch — ortho is ${ortho.crs}, shapefile is ${shapefile.crs}.`);
    if (hasGrid && crsAgree && !projectionError && coverage < 0.5)
      list.push('Most plots fall outside the orthophoto — wrong shapefile, or wrong flight?');
    if (shapefile && mapping.identity === 'grid' && !(mapping.row && mapping.col)) list.push('Row and column fields are not both mapped.');
    if (shapefile && mapping.identity !== 'grid' && !mapping.plot_id) list.push('Plot ID field is not mapped.');
    if (!config.flightDate) list.push('Flight date is not set.');
    return list;
  }, [ortho, orthoError, shapefile, shapefileError, projectionError, hasGrid, crsAgree, coverage, mapping, config.flightDate]);

  // What the Upload button is about to send, shown under it.
  const uploadSummary = useMemo(() => {
    const files = [ortho?.file, ...(shapefile?.files || [])].filter(Boolean);
    if (!files.length) return null;
    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    return `${formatBytes(bytes)} · ${files.length} file${files.length === 1 ? '' : 's'}${plotCount ? ` · ${plotCount} plots` : ' · no plot grid'}`;
  }, [ortho, shapefile, plotCount]);

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
    // Copy the files out *now*. A FileList is live: the drop card clears its
    // input as soon as it has handed the list over, which empties this same
    // object, so anything read from it after an `await` comes back empty — and
    // the upload then went out with no shapefile parts at all.
    const files = Array.from(fileList);
    const inspection = inspectShapefileSelection(files);
    setShapefileError(inspection.error);
    if (!inspection.ok) {
      setShapefile(null);
      setMapping(EMPTY_MAPPING);
      return;
    }

    setShapefileBusy(true);
    try {
      const next = await readShapefile(files);
      next.files = files; // the parsed view is for the screen; the bytes still go to the API
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
   * Upload: the API records the flight and opens one upload session per file,
   * then the files go straight from this browser to the bucket, in the
   * background (api/uploads.js). This page waits only for the first step, then
   * hands over to the Flights table, where the new flight shows its progress.
   * The upload carries on while the user moves around the app.
   */
  const handleUpload = async () => {
    const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));
    const captureOption = ALTITUDES.find((a) => a.value === config.capture);

    const meta = {
      flightDate: config.flightDate,
      source: 'ortho',
      capture: config.capture,
      captureLabel: captureOption?.label,
      plots: plotCount,
      offset,
      insetCm,
      mapping: shapefile ? mapping : {},
      ortho: pick(ortho, ['name', 'bytes', 'width', 'height', 'bandCount', 'colourBandCount', 'epsg', 'crs', 'gsdCm']),
      shapefile: shapefile ? pick(shapefile, ['name', 'bytes', 'members', 'featureCount', 'fields', 'epsg', 'crs']) : null
    };
    const files = [{ role: 'ortho', file: ortho.file }, ...(shapefile?.files || []).map((file) => ({ role: 'shapefile', file }))];

    setSubmitError(null);
    setRunning(true);
    try {
      const flight = await startFlightUpload(trialId, meta, files);
      navigate(flightsUrl, { state: { uploaded: { id: flight.id, flightDate: flight.flightDate, source: flight.source } } });
    } catch (error) {
      setSubmitError(error.message);
      setRunning(false);
    }
  };

  // Full width and last, so Upload is the final step, after the shapefile fields.
  const detailsPanel = (
    <Stack sx={{ gap: 2 }}>
      <FlightDetailsPanel
        values={config}
        onChange={setConfig}
        gsdCm={ortho?.gsdCm}
        gsdSource="Read from the orthophoto’s georeferencing."
        uploading={running}
        progress={null}
        canUpload={blockers.length === 0}
        blockers={blockers}
        inputsStaged={Boolean(ortho)}
        actualBands={ortho?.colourBandCount}
        uploadSummary={uploadSummary}
        onUpload={handleUpload}
        onOverrideGsd={() => {
          // opens a dialog collecting altitude + sensor + focal length
        }}
      />

      {submitError && (
        <Alert severity="error" variant="outlined" onClose={() => setSubmitError(null)}>
          {submitError}
        </Alert>
      )}
    </Stack>
  );

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      {/* ---- header ---- */}
      <Grid size={12}>
        <PageHeader
          crumbs={[
            { label: 'Croplytix', to: '/' },
            { label: 'Field Trials', to: '/trials' },
            { label: trial?.name || trialId, to: flightsUrl },
            { label: 'Upload Imagery' }
          ]}
          title="Upload Imagery"
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
            {/* ---- do the ortho and the shapefile describe the same ground? ---- */}
            {hasGrid && (
              <Grid size={12}>
                <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                  <Chip
                    size="small"
                    label={crsAgree ? `${ortho.crs} · ortho and .shp agree` : `CRS mismatch · ${ortho.crs} vs ${shapefile.crs}`}
                    sx={{
                      color: crsAgree ? 'success.main' : 'error.main',
                      bgcolor: crsAgree ? 'success.lighter' : 'error.lighter'
                    }}
                  />
                </Stack>
              </Grid>
            )}

            {/* ---- one full-width column: files, preview, shapefile fields, then flight details + upload ---- */}
            <Grid size={12}>
              <Stack sx={{ gap: 2.5 }}>
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
                      label="Drop plot shapefile (optional)"
                      hint=".zip, or select .shp .shx .dbf .prj (and .cpg) together"
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
                        {ortho &&
                          !shapefile &&
                          'Orthophoto staged. Add its plot shapefile to check the plots line up, or upload without one: the flight is stored without a plot grid.'}
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

                {detailsPanel}
              </Stack>
            </Grid>
          </Grid>
        </TrialTabs>
      </Grid>
    </Grid>
  );
}
