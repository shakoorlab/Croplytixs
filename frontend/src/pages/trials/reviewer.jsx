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
import { coverOf, plotLayers, predictedMask, useDemoBundle } from 'api/demo';
import { FLAG_LABELS, useTrialResults } from 'api/results';
import { recordDecision } from 'api/labels';
import PlotThumb, { EDIT_TINT } from 'sections/trials/PlotThumb';
import QcChip from 'sections/trials/QcChip';
import MaskCanvas from 'sections/trials/reviewer/MaskCanvas';
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

const fmtArea = (cm2) => `${Math.round(cm2).toLocaleString('en-US').replace(/,/g, ' ')} cm²`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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
  const { data: bundle } = useDemoBundle();

  const flightId = params.get('flight') || anchorId;
  const mode = params.get('queue') || 'queue';
  const flight = flights.find((candidate) => candidate.id === flightId && candidate.status === 'complete') || null;
  const plots = flight?.results.plots || NONE;
  const plotsById = useMemo(() => Object.fromEntries(plots.map((plot) => [plot.plotId, plot])), [plots]);

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
    if (!current || !edit || !layers) return null;
    // `tick` is bumped after every stroke and undo: the mask is mutated in
    // place, so it is the only signal that the numbers below are stale
    if (tick < 0) return null;
    const maskCover = coverOf(edit.mask, layers.valid);
    const originalCover = coverOf(edit.original, layers.valid);
    const changed = maskDiff(edit.mask, edit.original);
    const liveCover = clamp(current.modelCover + (maskCover - originalCover), 0, 100);
    return { liveCover, changed, edited: changed > 0, areaCm2: (liveCover / 100) * current.plotAreaCm2 };
  }, [current, edit, layers, tick]);

  const exit = useCallback(() => navigate(`/trials/${trialId}/review?flight=${flightId || ''}`), [navigate, trialId, flightId]);

  const advance = useCallback(() => {
    if (!queue) return;
    if (index < queue.length - 1) setIndex(index + 1);
    else setDone(true);
  }, [queue, index]);

  const accept = useCallback(() => {
    if (!current || !readout) return;
    recordDecision(trialId, flight.id, current.plotId, {
      decision: 'accepted',
      edited: readout.edited,
      pixelsChanged: readout.changed,
      coverBefore: current.modelCover,
      coverAfter: readout.liveCover,
      useForTraining,
      grade: readout.edited ? grade : 'rough'
    });
    advance();
  }, [current, readout, trialId, flight, useForTraining, grade, advance]);

  const reject = useCallback(() => {
    if (!current) return;
    recordDecision(trialId, flight.id, current.plotId, {
      decision: 'rejected',
      edited: false,
      pixelsChanged: 0,
      coverBefore: current.modelCover,
      coverAfter: null,
      useForTraining: false,
      grade: null
    });
    advance();
  }, [current, trialId, flight, advance]);

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
  }, [exit, queue, index, undo, accept, reject]);

  // ---- session tally (what this browser decided since entering) ----
  const tally = useMemo(() => {
    if (!queue) return { accepted: 0, corrected: 0, rejected: 0 };
    const rows = queue.map((id) => plotsById[id]).filter(Boolean);
    return {
      accepted: rows.filter((plot) => plot.decision?.author === 'you' && plot.qc === 'accepted').length,
      corrected: rows.filter((plot) => plot.decision?.author === 'you' && plot.decision?.edited).length,
      rejected: rows.filter((plot) => plot.decision?.author === 'you' && plot.qc === 'rejected').length
    };
  }, [queue, plotsById]);

  const previousFlight = useMemo(() => {
    if (!flight) return null;
    const complete = flights.filter((candidate) => candidate.status === 'complete' && candidate.flightDate < flight.flightDate);
    return complete[0] || null;
  }, [flights, flight]);
  const previousPlot = previousFlight && current ? previousFlight.results.plots.find((plot) => plot.plotId === current.plotId) : null;

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
                  {plot?.flag ? 'flag' : plot?.audit ? 'audit' : ''}
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
          {done ? (
            <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1.5, textAlign: 'center' }}>
              <Box sx={{ fontSize: '2.5rem', color: 'success.main', display: 'flex' }}>
                <CheckOutlined />
              </Box>
              <Typography variant="h3">Queue complete</Typography>
              <Typography variant="body1" color="text.secondary">
                {tally.accepted} accepted · {tally.corrected} corrected · {tally.rejected} rejected in this session
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 420 }}>
                Corrections you opted in are now in the label pool. The trait series for {flight.flightDate} already reflects the accepted
                covers.
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
              <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                <Tooltip title="Hold space to see the photo without the mask">
                  <Chip
                    size="small"
                    icon={<EyeOutlined />}
                    label={showMask ? 'Overlay' : 'Original'}
                    onClick={() => setShowMask((value) => !value)}
                    sx={{ bgcolor: showMask ? 'primary.lighter' : 'grey.100', color: showMask ? 'primary.main' : 'text.secondary' }}
                  />
                </Tooltip>
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
                    size
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
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                    opacity
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
                1 px = {current?.demo.gsdCm} cm of ground · the brush edits the mask in the GeoTIFF&apos;s own raster grid, so nothing
                round-trips through PNG
              </Typography>
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
                G{current.genotype} · rep {current.rep} · r{current.row} c{current.col} · {flight.flightDate} · {flight.model}
              </Typography>
              <Typography variant="caption" sx={{ color: current.flag ? 'warning.main' : 'text.secondary' }}>
                {current.flag ? FLAG_LABELS[current.flag] : current.audit ? 'Audit sample — the model was confident here' : 'Auto-passed'} ·
                confidence {current.confidence.toFixed(2)}
              </Typography>
            </Stack>

            <Readout
              label="Fractional cover"
              big
              value={`${readout.liveCover.toFixed(1)} %`}
              hint={
                readout.edited
                  ? `was ${current.modelCover.toFixed(1)}% before your edit · ${readout.changed} px changed`
                  : 'model output, unedited'
              }
            />
            <Stack direction="row" sx={{ gap: 3 }}>
              <Readout label="Canopy area" value={fmtArea(readout.areaCm2)} />
              <Readout label="Plot area" value={`${(current.plotAreaCm2 / 10000).toFixed(2)} m²`} hint="polygon, nodata excluded" />
            </Stack>

            <Divider />

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
                '& .MuiToggleButton-root.Mui-selected': { color: 'primary.main', bgcolor: 'primary.lighter', borderColor: 'primary.light' }
              }}
            >
              <ToggleButton value="rough">rough fix</ToggleButton>
              <ToggleButton value="training-grade">training-grade</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary">
              rough = counts for the number, not for boundary learning
            </Typography>

            <Divider />

            <Button variant="contained" size="large" startIcon={<CheckOutlined />} onClick={accept} fullWidth>
              Accept <Box sx={{ ml: 1 }}>{<Key>A</Key>}</Box>
            </Button>
            <Button variant="outlined" color="error" startIcon={<CloseOutlined />} onClick={reject} fullWidth>
              Reject <Box sx={{ ml: 1 }}>{<Key>R</Key>}</Box>
            </Button>
            <Typography variant="caption" color="text.secondary" align="center">
              Accept advances automatically · reject drops the plot from this date&apos;s trait series
            </Typography>

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
        {[
          ['→ ←', 'next / prev'],
          ['space', 'hold original'],
          ['A', 'accept'],
          ['R', 'reject'],
          ['E', 'brush'],
          ['X', 'add / erase'],
          ['[ ]', 'size'],
          ['⌘Z', 'undo'],
          ['1–5', 'opacity'],
          ['C', 'compare date'],
          ['T', 'training contribution'],
          ['Esc', 'exit']
        ].map(([key, label]) => (
          <Typography key={key} variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Key>{key}</Key> {label}
          </Typography>
        ))}
      </Stack>
    </>
  );
}
