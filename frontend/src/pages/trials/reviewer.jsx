import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';
import Tooltip from '@mui/material/Tooltip';
import LinearProgress from '@mui/material/LinearProgress';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Alert from '@mui/material/Alert';

// project imports
import { coverOf, plotLayers, predictedMask } from 'sections/trials/plotPixels';
import { FLAG_LABELS, useTrialResults } from 'api/results';
import { useFlightMap } from 'api/map';
import { useDecide } from 'api/decisions';
import formatRelative from 'utils/formatRelative';
import PlotThumb, { EDIT_TINT } from 'sections/trials/PlotThumb';
import QcChip from 'sections/trials/QcChip';
import MaskCanvas from 'sections/trials/reviewer/MaskCanvas';
import PlotView from 'sections/trials/reviewer/PlotView';
import { maskDiff } from 'sections/trials/reviewer/maskTools';

// assets
import CheckOutlined from '@ant-design/icons/CheckOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import UndoOutlined from '@ant-design/icons/UndoOutlined';
import ClearOutlined from '@ant-design/icons/ClearOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };
const NONE = [];
const OPACITIES = [0.2, 0.4, 0.6, 0.8, 1];
const QUEUE_LABELS = { queue: 'flagged + audit', flagged: 'flagged', audit: 'audit sample', reviewed: 'reviewed', all: 'all plots' };

const DECIDED = { accepted: 'Accepted', rejected: 'Rejected' };

const fmtArea = (cm2) => `${Math.round(cm2).toLocaleString('en-US').replace(/,/g, ' ')} cm²`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const plotArea = (plot) => plot.boxAreaM2 * 10000; // cm², the plot's box

function queueFor(plots, mode) {
  switch (mode) {
    case 'flagged':
      return plots.filter((plot) => plot.flag);
    case 'audit':
      return plots.filter((plot) => plot.audit);
    case 'reviewed':
      return plots.filter((plot) => plot.qc === 'accepted' || plot.qc === 'rejected');
    case 'all':
      return plots;
    default:
      return plots.filter((plot) => plot.qc === 'pending');
  }
}

function Key({ children }) {
  return (
    <Box
      component="kbd"
      sx={{
        ...mono,
        fontSize: '0.7rem',
        px: 0.6,
        py: 0.1,
        borderRadius: 0.5,
        border: '1px solid',
        borderColor: 'grey.300',
        bgcolor: 'grey.100',
        color: 'text.primary',
        lineHeight: 1.4
      }}
    >
      {children}
    </Box>
  );
}

function Readout({ label, value, hint, big = false }) {
  return (
    <Stack sx={{ gap: 0.25 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant={big ? 'h2' : 'h5'} sx={{ ...mono, lineHeight: 1.1 }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Stack>
  );
}

// ==============================|| TRIALS - REVIEWER (immersive) ||============================== //

/**
 * Full-screen, keyboard-first. The single highest-leverage screen in the
 * product, per the UX framing: a breeder fixing a number and an engineer
 * drawing a training label are doing the same thing here, so every accepted
 * mask goes to the label store with provenance — rough vs training-grade,
 * who, when — and the pool grows as a by-product of QC.
 */
export default function Reviewer() {
  const { trialId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const { trial, flights, anchorId, isLoading, error } = useTrialResults(trialId);
  // The plot's picture comes from the flight's map files in the bucket (PlotView,
  // through signed links); Accept and Reject are stored by the API (api/decisions.js).
  // Correcting the mask still runs on the old demo bundle's layers, so with none
  // the brush stays off: corrections are the next piece.
  const bundle = null;
  const decide = useDecide(trialId);
  const [saveError, setSaveError] = useState(null);
  // What this browser decided since entering, for the closing tally.
  const [session, setSession] = useState({});

  const flightId = params.get('flight') || anchorId;
  const mode = params.get('queue') || 'queue';
  // Only once its plots have arrived: the queue below is frozen the first time
  // there is a flight, so freezing it before the plots load would leave it empty.
  const flight = flights.find((candidate) => candidate.id === flightId && candidate.status === 'complete' && candidate.results) || null;
  const plots = flight?.results?.plots || NONE;
  const plotsById = useMemo(() => Object.fromEntries(plots.map((plot) => [plot.plotId, plot])), [plots]);
  const mapQuery = useFlightMap(trialId, flight?.id, flight?.results?.version);
  const links = mapQuery.data;

  // ---- queue: frozen on entry so accepting a plot does not pull the rug ----
  const [queue, setQueue] = useState(null);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (queue || !flight) return;
    const ids = queueFor(plots, mode).map((plot) => plot.plotId);
    const requested = params.get('plot');
    if (requested && plotsById[requested] && !ids.includes(requested)) ids.unshift(requested);
    setQueue(ids);
    setIndex(Math.max(ids.indexOf(requested), 0));
  }, [queue, flight, plots, mode, params, plotsById]);

  // ---- editing state ----
  const editsRef = useRef(new Map());
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((value) => value + 1), []);

  const [showMask, setShowMask] = useState(true);
  const [opacity, setOpacity] = useState(0.6);
  const [tool, setTool] = useState('brush');
  const [brushSize, setBrushSize] = useState(4);
  const [useForTraining, setUseForTraining] = useState(true);
  const [grade, setGrade] = useState('rough');
  const [compare, setCompare] = useState(false);

  const current = queue && !done ? plotsById[queue[index]] : null;
  const nextPlot = queue && !done && index < queue.length - 1 ? plotsById[queue[index + 1]] : null;
  // Results made before plots carried their box and label can't be drawn.
  const drawable = Boolean(links?.result?.plotBoxes && current?.box && current?.label != null);
  const layers = useMemo(() => (bundle && current ? plotLayers(bundle, current.demo) : null), [bundle, current]);

  const edit = useMemo(() => {
    if (!current || !layers) return null;
    let entry = editsRef.current.get(current.plotId);
    if (!entry) {
      const original = predictedMask(layers);
      entry = { original, mask: new Uint8Array(original), undo: [], version: 0 };
      editsRef.current.set(current.plotId, entry);
    }
    return entry;
  }, [current, layers]);

  // ---- readouts ----
  const readout = useMemo(() => {
    if (!current) return null;
    // Without imagery: the model's numbers, as the result has them.
    if (!edit || !layers) return { liveCover: current.cover, changed: 0, edited: false, areaCm2: current.areaCm2 };
    // `tick` is bumped after every stroke and undo: the mask is mutated in
    // place, so it is the only signal that the numbers below are stale
    if (tick < 0) return null;
    const maskCover = coverOf(edit.mask, layers.valid);
    const originalCover = coverOf(edit.original, layers.valid);
    const changed = maskDiff(edit.mask, edit.original);
    const liveCover = clamp(current.cover + (maskCover - originalCover), 0, 100);
    return { liveCover, changed, edited: changed > 0, areaCm2: (liveCover / 100) * plotArea(current) };
  }, [current, edit, layers, tick]);

  const exit = useCallback(() => navigate(`/trials/${trialId}/review?flight=${flightId || ''}`), [navigate, trialId, flightId]);

  const advance = useCallback(() => {
    if (!queue) return;
    if (index < queue.length - 1) setIndex(index + 1);
    else setDone(true);
  }, [queue, index]);

  // Saved in the background: the plot shows its new status at once and the
  // queue moves on; a failed save puts the plot back and says so.
  const commit = useCallback(
    (decision) => {
      if (!current || !flight) return;
      const plot = current;
      setSaveError(null);
      setSession((value) => ({ ...value, [plot.plotId]: decision }));
      decide(flight, plot, decision).catch((err) => {
        setSaveError(`Couldn’t save plot ${plot.plotId}: ${err.message}`);
        setSession((value) => {
          const next = { ...value };
          delete next[plot.plotId];
          return next;
        });
      });
      if (decision) advance();
    },
    [current, flight, decide, advance]
  );
  const accept = useCallback(() => commit('accepted'), [commit]);
  const reject = useCallback(() => commit('rejected'), [commit]);
  const clearDecision = useCallback(() => {
    if (current?.decision && !current.decision.stale) commit(null);
  }, [current, commit]);

  const undo = useCallback(() => {
    if (!edit || !edit.undo.length) return;
    const previous = edit.undo.pop();
    edit.mask.set(previous);
    edit.version += 1;
    bump();
  }, [edit, bump]);

  const pushUndo = useCallback(() => {
    if (!edit) return;
    edit.undo.push(new Uint8Array(edit.mask));
    if (edit.undo.length > 40) edit.undo.shift();
  }, [edit]);

  // ---- keyboard contract ----
  useEffect(() => {
    const typing = (event) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName);
    const onKeyDown = (event) => {
      if (typing(event)) return;
      const key = event.key;
      if (key === 'Escape') {
        exit();
      } else if (key === 'ArrowRight') {
        if (queue && index < queue.length - 1) setIndex(index + 1);
      } else if (key === 'ArrowLeft') {
        if (index > 0) {
          setDone(false);
          setIndex(index - 1);
        }
      } else if (key === ' ') {
        event.preventDefault();
        setShowMask(false);
      } else if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      } else if (key === 'a' || key === 'A') {
        accept();
      } else if (key === 'r' || key === 'R') {
        reject();
      } else if (key === 'u' || key === 'U') {
        clearDecision();
      } else if (key === 'e' || key === 'E') {
        setTool('brush');
      } else if (key === 'x' || key === 'X') {
        setTool((value) => (value === 'erase' ? 'brush' : 'erase'));
      } else if (key === '[') {
        setBrushSize((value) => Math.max(1, value - 1));
      } else if (key === ']') {
        setBrushSize((value) => Math.min(14, value + 1));
      } else if (key >= '1' && key <= '5') {
        setOpacity(OPACITIES[Number(key) - 1]);
      } else if (key === 'c' || key === 'C') {
        setCompare((value) => !value);
      } else if (key === 't' || key === 'T') {
        setUseForTraining((value) => !value);
      }
    };
    const onKeyUp = (event) => {
      if (event.key === ' ') setShowMask(true);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [exit, queue, index, undo, accept, reject, clearDecision]);

  // ---- session tally (what this browser decided since entering) ----
  const tally = useMemo(() => {
    const decisions = Object.values(session);
    return {
      accepted: decisions.filter((decision) => decision === 'accepted').length,
      rejected: decisions.filter((decision) => decision === 'rejected').length
    };
  }, [session]);

  const previousFlight = useMemo(() => {
    if (!flight) return null;
    const complete = flights.filter((candidate) => candidate.status === 'complete' && candidate.flightDate < flight.flightDate);
    return complete[0] || null;
  }, [flights, flight]);
  const previousPlot =
    previousFlight?.results && current ? previousFlight.results.plots.find((plot) => plot.plotId === current.plotId) : null;

  // ---------------------------------------------------------------------------

  const shell = (children) => (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        bgcolor: 'background.default',
        color: 'text.primary',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1300,
        userSelect: 'none'
      }}
    >
      {children}
    </Box>
  );

  if (isLoading || (!queue && !error && flight)) {
    return shell(
      <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <LinearProgress sx={{ width: 240, height: 2 }} />
        <Typography variant="caption" color="text.secondary">
          Loading plots…
        </Typography>
      </Stack>
    );
  }

  if (error || !flight) {
    return shell(
      <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, p: 3 }}>
        <Alert severity={error ? 'error' : 'warning'} variant="outlined">
          {error ? `Could not load results — ${error.message}` : 'That flight has no results to review yet.'}
        </Alert>
        <Button variant="outlined" color="secondary" onClick={exit}>
          Back to Review
        </Button>
      </Stack>
    );
  }

  return shell(
    <>
      {/* ---- top bar ---- */}
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          gap: 2,
          px: 2.5,
          py: 1.25,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper'
        }}
      >
        <Chip size="small" label={`Reviewing ${QUEUE_LABELS[mode] || mode}`} sx={{ bgcolor: 'warning.lighter', color: 'warning.main' }} />
        <Typography variant="subtitle1" sx={mono}>
          {done ? queue.length : index + 1} of {queue.length}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {trial?.name} · {flight.flightDate} · {flight.model}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          <Key>Esc</Key> to exit
        </Typography>
        <Button size="small" variant="outlined" color="secondary" onClick={exit}>
          Exit
        </Button>
      </Stack>

      {/* ---- body ---- */}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* queue */}
        <Stack sx={{ width: 200, borderRight: '1px solid', borderColor: 'divider', overflowY: 'auto', bgcolor: 'background.paper' }}>
          {queue.map((id, i) => {
            const plot = plotsById[id];
            const active = !done && i === index;
            let glyph = '·';
            let glyphColor = 'text.disabled';
            if (plot?.qc === 'accepted') {
              glyph = plot.decision?.edited ? '✎' : '✓';
              glyphColor = 'success.main';
            } else if (plot?.qc === 'rejected') {
              glyph = '✕';
              glyphColor = 'error.main';
            }
            return (
              <Stack
                key={id}
                direction="row"
                onClick={() => {
                  setDone(false);
                  setIndex(i);
                }}
                sx={{
                  px: 2,
                  py: 0.75,
                  gap: 1,
                  alignItems: 'center',
                  cursor: 'pointer',
                  borderLeft: '2px solid',
                  borderColor: active ? 'primary.main' : 'transparent',
                  bgcolor: active ? 'primary.lighter' : 'transparent',
                  '&:hover': { bgcolor: active ? 'primary.lighter' : 'action.hover' }
                }}
              >
                <Typography variant="body2" sx={{ ...mono, color: active ? 'primary.main' : 'text.primary', flex: 1 }}>
                  {id}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {plot?.flag ? 'Flag' : plot?.audit ? 'Audit' : ''}
                </Typography>
                <Typography variant="body2" sx={{ color: glyphColor, width: 14, textAlign: 'center' }}>
                  {glyph}
                </Typography>
              </Stack>
            );
          })}
        </Stack>

        {/* canvas */}
        <Stack sx={{ flex: 1, minWidth: 0, alignItems: 'center', p: 2.5, gap: 2, overflow: 'auto' }}>
          {/* Here rather than in the panel: the panel is gone once the queue is done,
              and the last plot's save can still fail. */}
          {saveError && (
            <Alert severity="error" variant="outlined" role="alert" onClose={() => setSaveError(null)} sx={{ alignSelf: 'stretch' }}>
              {saveError}
            </Alert>
          )}
          {done ? (
            <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1.5, textAlign: 'center' }}>
              <Box sx={{ fontSize: '2.5rem', color: 'success.main', display: 'flex' }}>
                <CheckOutlined />
              </Box>
              <Typography variant="h3">Queue complete</Typography>
              <Typography variant="body1" color="text.secondary">
                {tally.accepted} accepted · {tally.rejected} rejected in this session
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 420 }}>
                Saved for everyone on this trial. The trait series for {flight.flightDate} leaves out the rejected plots, and the CSV marks
                each plot’s review.
              </Typography>
              <Stack direction="row" sx={{ gap: 1.5, mt: 1 }}>
                <Button variant="contained" onClick={exit}>
                  Back to Review
                </Button>
                <Button variant="outlined" color="secondary" onClick={() => navigate(`/trials/${trialId}/traits`)}>
                  Open Traits
                </Button>
              </Stack>
            </Stack>
          ) : (
            <>
              {(bundle || drawable) && (
                <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Tooltip title="Hold space to see the photo without the overlay">
                    <Chip
                      size="small"
                      icon={<EyeOutlined />}
                      label={showMask ? 'Overlay' : 'Original'}
                      onClick={() => setShowMask((value) => !value)}
                      sx={{ bgcolor: showMask ? 'primary.lighter' : 'grey.100', color: showMask ? 'primary.main' : 'text.secondary' }}
                    />
                  </Tooltip>
                  {bundle && (
                    <>
                      <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={tool}
                        onChange={(event, value) => value && setTool(value)}
                        sx={{
                          '& .MuiToggleButton-root.Mui-selected': {
                            color: 'primary.main',
                            bgcolor: 'primary.lighter',
                            borderColor: 'primary.light'
                          }
                        }}
                      >
                        <ToggleButton value="brush">
                          <EditOutlined style={{ marginRight: 6 }} /> Brush <Box sx={{ ml: 0.75 }}>{<Key>E</Key>}</Box>
                        </ToggleButton>
                        <ToggleButton value="erase">
                          <ClearOutlined style={{ marginRight: 6 }} /> Erase <Box sx={{ ml: 0.75 }}>{<Key>X</Key>}</Box>
                        </ToggleButton>
                      </ToggleButtonGroup>
                      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, width: 170 }}>
                        <Typography variant="caption" color="text.secondary">
                          Size
                        </Typography>
                        <Slider
                          size="small"
                          min={1}
                          max={14}
                          value={brushSize}
                          onChange={(event, value) => setBrushSize(value)}
                          sx={{ flex: 1 }}
                        />
                        <Key>[</Key>
                        <Key>]</Key>
                      </Stack>
                      <Button size="small" color="secondary" startIcon={<UndoOutlined />} onClick={undo} disabled={!edit?.undo.length}>
                        Undo
                      </Button>
                    </>
                  )}
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                      Opacity
                    </Typography>
                    {OPACITIES.map((value, i) => (
                      <Box
                        key={value}
                        onClick={() => setOpacity(value)}
                        sx={{
                          ...mono,
                          fontSize: '0.7rem',
                          width: 22,
                          height: 22,
                          display: 'grid',
                          placeItems: 'center',
                          borderRadius: 0.5,
                          cursor: 'pointer',
                          border: '1px solid',
                          borderColor: opacity === value ? 'primary.main' : 'grey.300',
                          color: opacity === value ? 'primary.main' : 'text.secondary'
                        }}
                      >
                        {i + 1}
                      </Box>
                    ))}
                  </Stack>
                </Stack>
              )}

              {bundle ? (
                <>
                  {bundle && current && layers && edit && (
                    <MaskCanvas
                      bundle={bundle}
                      plot={current.demo}
                      layers={layers}
                      mask={edit.mask}
                      version={edit.version + tick}
                      showMask={showMask}
                      opacity={opacity}
                      tool={tool}
                      brushSize={brushSize}
                      onStrokeStart={pushUndo}
                      onPaint={bump}
                    />
                  )}

                  <Typography variant="caption" color="text.secondary" align="center">
                    1 px = {current?.demo?.gsdCm} cm of ground · the brush edits the mask in the GeoTIFF&apos;s own raster grid, so nothing
                    round-trips through PNG
                  </Typography>
                </>
              ) : drawable ? (
                <PlotView links={links} plot={current} nextPlot={nextPlot} plots={plots} showMask={showMask} opacity={opacity} />
              ) : (
                <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, textAlign: 'center', maxWidth: 520 }}>
                  {mapQuery.error ? (
                    <Alert severity="error" variant="outlined" sx={{ textAlign: 'left' }}>
                      Couldn’t get links to the map files — {mapQuery.error.message}
                    </Alert>
                  ) : !links ? (
                    <>
                      <LinearProgress sx={{ width: 200, height: 2 }} />
                      <Typography variant="caption" color="text.secondary">
                        Getting the map files…
                      </Typography>
                    </>
                  ) : (
                    <>
                      <Alert severity="info" variant="outlined" sx={{ textAlign: 'left' }}>
                        This result was made before plots could be drawn. Run it again from the flight’s page to add their pictures: it
                        reuses the canopy map, so it takes about a minute.
                      </Alert>
                      <Button variant="outlined" color="secondary" onClick={() => navigate(`/trials/${trialId}/flights/${flight.id}`)}>
                        Open the flight’s page
                      </Button>
                    </>
                  )}
                </Stack>
              )}
            </>
          )}
        </Stack>

        {/* panel */}
        {current && readout && (
          <Stack
            sx={{
              width: 320,
              borderLeft: '1px solid',
              borderColor: 'divider',
              p: 2.5,
              gap: 2,
              overflowY: 'auto',
              bgcolor: 'background.paper'
            }}
          >
            <Stack sx={{ gap: 0.5 }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <Typography variant="h3" sx={mono}>
                  {current.plotId}
                </Typography>
                <QcChip qc={current.qc} edited={current.decision?.edited} audit={current.audit} />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                G{current.genotype ?? '—'} · rep {current.rep ?? '—'} · r{current.row} c{current.col} · {flight.flightDate} · {flight.model}
              </Typography>
              <Typography variant="caption" sx={{ color: current.flag ? 'warning.main' : 'text.secondary' }}>
                {current.flag ? FLAG_LABELS[current.flag] : current.audit ? 'Audit sample — the model was confident here' : 'Auto-passed'} ·
                confidence {current.confidence.toFixed(2)}
              </Typography>
            </Stack>

            <Readout
              label="Cover in box"
              big
              value={`${readout.liveCover.toFixed(1)} %`}
              hint={
                readout.edited
                  ? `Was ${current.cover.toFixed(1)}% before your edit · ${readout.changed} px changed`
                  : 'Model output, unedited'
              }
            />
            <Stack direction="row" sx={{ gap: 3 }}>
              <Readout label="Canopy area" value={fmtArea(readout.areaCm2)} hint={bundle ? undefined : 'Including canopy past the box'} />
              <Readout label="Plot box" value={`${current.boxAreaM2.toFixed(2)} m²`} />
            </Stack>

            <Divider />

            {current.decision && (
              <Stack sx={{ gap: 0.75, alignItems: 'flex-start' }}>
                <Typography variant="body2" color={current.decision.stale ? 'warning.main' : 'text.secondary'}>
                  {current.decision.stale
                    ? `${DECIDED[current.decision.decision]} on version ${current.decision.version}; the numbers have changed since, so it needs a fresh look.`
                    : `${DECIDED[current.decision.decision]}${current.decision.by ? ` by ${current.decision.by}` : ''} · ${
                        current.decision.saving ? 'saving…' : formatRelative(current.decision.at)
                      }`}
                </Typography>
                {!current.decision.stale && (
                  <Button
                    size="small"
                    color="secondary"
                    startIcon={<UndoOutlined />}
                    onClick={clearDecision}
                    disabled={current.decision.saving}
                  >
                    Clear decision <Box sx={{ ml: 1 }}>{<Key>U</Key>}</Box>
                  </Button>
                )}
              </Stack>
            )}

            {bundle && (
              <>
                <FormControlLabel
                  control={<Checkbox checked={useForTraining} onChange={(event) => setUseForTraining(event.target.checked)} />}
                  label={
                    <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                      <Typography variant="body2">
                        {readout.edited ? 'Use this correction for training' : 'Use this mask as a training label'}
                      </Typography>
                      <Key>T</Key>
                    </Stack>
                  }
                  sx={{ mr: 0 }}
                />
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  fullWidth
                  value={grade}
                  onChange={(event, value) => value && setGrade(value)}
                  disabled={!useForTraining}
                  sx={{
                    '& .MuiToggleButton-root.Mui-selected': {
                      color: 'primary.main',
                      bgcolor: 'primary.lighter',
                      borderColor: 'primary.light'
                    }
                  }}
                >
                  <ToggleButton value="rough">Rough fix</ToggleButton>
                  <ToggleButton value="training-grade">Training-grade</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary">
                  Rough = counts for the number, not for boundary learning
                </Typography>

                <Divider />
              </>
            )}

            <Button variant="contained" size="large" startIcon={<CheckOutlined />} onClick={accept} fullWidth>
              Accept <Box sx={{ ml: 1 }}>{<Key>A</Key>}</Box>
            </Button>
            <Button variant="outlined" color="error" startIcon={<CloseOutlined />} onClick={reject} fullWidth>
              Reject <Box sx={{ ml: 1 }}>{<Key>R</Key>}</Box>
            </Button>
            <Typography variant="caption" color="text.secondary" align="center">
              Either moves to the next plot. Rejecting leaves the plot out of the trait series and marks it in the CSV.
            </Typography>

            {bundle && (
              <>
                {compare && (
                  <>
                    <Divider />
                    <Stack sx={{ gap: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        Compare · previous date
                      </Typography>
                      {previousFlight && previousPlot && bundle ? (
                        <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center' }}>
                          <PlotThumb bundle={bundle} plot={previousPlot.demo} width={120} tint={EDIT_TINT} />
                          <Stack>
                            <Typography variant="body2" sx={mono}>
                              {previousFlight.flightDate}
                            </Typography>
                            <Typography variant="body2" sx={mono}>
                              {previousPlot.cover.toFixed(1)}% → {readout.liveCover.toFixed(1)}%
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {previousFlight.dap} → {flight.dap} DAP
                            </Typography>
                          </Stack>
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No earlier date for this plot.
                        </Typography>
                      )}
                    </Stack>
                  </>
                )}
              </>
            )}
          </Stack>
        )}
      </Box>

      {/* ---- keyboard contract ---- */}
      <Stack
        direction="row"
        sx={{
          px: 2.5,
          py: 0.75,
          gap: 1.5,
          alignItems: 'center',
          borderTop: '1px solid',
          borderColor: 'divider',
          flexWrap: 'wrap',
          bgcolor: 'background.paper'
        }}
      >
        {KEYS.filter(([key]) => bundle || VIEW_KEYS.includes(key) || (drawable && PICTURE_KEYS.includes(key))).map(([key, label]) => (
          <Typography key={key} variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Key>{key}</Key> {label}
          </Typography>
        ))}
      </Stack>
    </>
  );
}

// The keyboard contract, shown along the bottom: only the keys that do something
// now. Stepping and exiting always; the overlay keys once the plot is drawn; the
// rest with editing.
const VIEW_KEYS = ['→ ←', 'A', 'R', 'U', 'Esc'];
const PICTURE_KEYS = ['space', '1–5'];
const KEYS = [
  ['→ ←', 'next / prev'],
  ['space', 'hold original'],
  ['A', 'accept'],
  ['R', 'reject'],
  ['U', 'clear decision'],
  ['E', 'brush'],
  ['X', 'add / erase'],
  ['[ ]', 'size'],
  ['⌘Z', 'undo'],
  ['1–5', 'opacity'],
  ['C', 'compare date'],
  ['T', 'training contribution'],
  ['Esc', 'exit']
];
