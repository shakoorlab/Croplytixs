import { useState } from 'react';
import { useParams } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

// project imports
import MainCard from 'components/MainCard';
import ModelsHeader from 'sections/models/ModelsHeader';
import ModelsTabs from 'sections/models/ModelsTabs';
import CoverBinBars from 'sections/models/CoverBinBars';
import LifecycleChip from 'sections/models/LifecycleChip';
import { RUN_STATUS } from './training-runs';
import { NESTED_PANEL } from 'sections/trials/surfaces';
import { useLabelPool, useModel, useTrainingRun } from 'api/models';
import { useTrials } from 'api/trials';

// assets
import LockOutlined from '@ant-design/icons/LockOutlined';
import CheckOutlined from '@ant-design/icons/CheckOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };

const FALLBACK_TRIALS = [
  { id: 'guadeloupe-yam-2026', name: 'Guadeloupe Yam Panel 2026', plots: 144, flightDates: 7 },
  { id: 'cassava-altitude-pilot', name: 'Cassava pilot — altitude test', plots: 36, flightDates: 3 }
];

function Line({ label, value, note, tone = 'default' }) {
  const color = { default: 'text.primary', muted: 'text.disabled', accent: 'primary.main', held: 'info.main' }[tone];
  return (
    <Stack direction="row" sx={{ gap: 2, alignItems: 'baseline', py: 0.5 }}>
      <Typography variant="body2" sx={{ flex: 1, color }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ ...mono, color, fontWeight: tone === 'muted' ? 400 : 600 }}>
        {value.toLocaleString('en-US')}
      </Typography>
      <Chip size="small" label={note} sx={{ width: 96, height: 20, fontSize: '0.65rem', bgcolor: 'grey.100', color }} />
    </Stack>
  );
}

function Fact({ label, children }) {
  return (
    <Stack
      direction="row"
      sx={{ gap: 2, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ width: 96, flexShrink: 0, pt: 0.25 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}

const fmtMetric = (value, format) => {
  if (value == null) return '—';
  if (format === 'ratio') return value.toFixed(3);
  if (format === 'signed') return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
  return value.toFixed(1);
};

// ==============================|| MODELS - TRAINING RUN DETAIL ||============================== //

/**
 * Where the guardrails live. Composition before anything trains, coverage by
 * growth stage, per-bin metrics next to the headline ones, and a promote gate
 * that states its conditions and its consequences. The most important
 * sentence on the screen is the last one under the gate.
 */
export default function TrainingRunDetail() {
  const { runId } = useParams();
  const { data: run } = useTrainingRun(runId);
  const { data: model } = useModel(run?.modelId);
  const { data: pool } = useLabelPool();
  const { data: trials } = useTrials();

  const [logsOpen, setLogsOpen] = useState(false);
  const [rerunTrial, setRerunTrial] = useState('');
  const [notice, setNotice] = useState(null);

  const trialOptions = [...(trials?.length ? trials : FALLBACK_TRIALS)].sort((a, b) => (b.flightDates || 0) - (a.flightDates || 0));
  const chosen = trialOptions.find((trial) => trial.id === rerunTrial) || trialOptions[0];
  const rerunPlots = chosen ? Math.max(chosen.plots || 142, 142) * Math.max(chosen.flightDates || 4, 1) : 0;

  if (!run) {
    return (
      <Grid container rowSpacing={2.5} columnSpacing={2.75}>
        <Grid size={12}>
          <ModelsHeader crumbs={[{ label: 'Training runs', to: '/models/runs' }, { label: 'Not found' }]} title="Training run not found" />
        </Grid>
        <Grid size={12}>
          <Alert severity="warning" variant="outlined">
            No training run <code>{runId}</code>.
          </Alert>
        </Grid>
      </Grid>
    );
  }

  const status = RUN_STATUS[run.status] || RUN_STATUS.queued;
  const training = run.dataset.baseline + run.dataset.trainingGrade + run.dataset.audit;
  const gateOpen = run.gate.length > 0 && run.gate.every((check) => check.ok);
  const regressions = run.comparison?.rows.filter((row) => row.regression) || [];

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      <Grid size={12}>
        <ModelsHeader
          crumbs={[{ label: 'Training runs', to: '/models/runs' }, { label: `run #${run.number}` }]}
          title={`Run #${run.number} · ${run.version}`}
          subtitle={`${run.mode}${run.base ? ` from ${run.base}` : ''} · started by ${run.startedBy} · ${run.durationMin} min on ${run.hardware}`}
          actions={
            <Button
              variant="outlined"
              color="secondary"
              endIcon={<DownOutlined style={{ fontSize: '0.7rem' }} />}
              onClick={() =>
                setNotice(
                  'Dataset export will call GET /api/models/runs/{id}/dataset — the exact label set this run was taught, as a manifest plus masks.'
                )
              }
            >
              Export dataset
            </Button>
          }
        />
      </Grid>

      <Grid size={12}>
        <ModelsTabs current="runs" counts={{ labels: pool.totals.corrections }}>
          <Stack sx={{ gap: 2.5 }}>
            {notice && (
              <Alert severity="info" variant="outlined" onClose={() => setNotice(null)}>
                {notice}
              </Alert>
            )}
            {run.error && (
              <Alert severity="error" variant="outlined">
                {run.error}
              </Alert>
            )}

            <Grid container rowSpacing={2.5} columnSpacing={2.75}>
              {/* ---- left: composition, coverage, comparison ---- */}
              <Grid size={{ xs: 12, lg: 8 }}>
                <Stack sx={{ gap: 2.5 }}>
                  <MainCard title="Dataset composition" sx={NESTED_PANEL} contentSX={{ pt: 1 }}>
                    <Line label="Original training set (Label Studio import)" value={run.dataset.baseline} note="baseline" />
                    <Line label="QC corrections — training-grade" value={run.dataset.trainingGrade} note="flagged plots" tone="accent" />
                    <Line label="QC corrections — rough" value={run.dataset.roughExcluded} note="excluded" tone="muted" />
                    <Line label="Random audit sample" value={run.dataset.audit} note="unbiased" />
                    <Line label="Frozen benchmark" value={run.dataset.benchmarkHeldOut} note="held out" tone="held" />
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="body2" sx={mono}>
                      {training.toLocaleString('en-US')} training · {run.dataset.benchmarkHeldOut} evaluation · no overlap
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Exclusions are explicit: rough corrections counted for the measurement but are not boundary labels; the audit sample
                      is the unbiased slice. Anyone can see at a glance what this model was actually taught.
                    </Typography>
                  </MainCard>

                  <MainCard title="Coverage by growth stage" sx={NESTED_PANEL} contentSX={{ px: 1, pt: 1 }}>
                    <CoverBinBars baseline={run.coverage.baseline} corrections={run.coverage.corrections} />
                  </MainCard>

                  <MainCard
                    title={
                      run.comparison
                        ? `Benchmark comparison · ${run.comparison.incumbent} → ${run.comparison.candidate}`
                        : 'Benchmark comparison'
                    }
                    sx={NESTED_PANEL}
                    content={false}
                  >
                    {run.comparison ? (
                      <>
                        <TableContainer>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Metric</TableCell>
                                <TableCell align="right">{run.comparison.incumbent} (prod)</TableCell>
                                <TableCell align="right">{run.comparison.candidate}</TableCell>
                                <TableCell align="right">Δ</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {run.comparison.rows.map((row) => {
                                const improved =
                                  row.betterWhen === 'higher'
                                    ? row.delta > 0
                                    : row.betterWhen === 'lower'
                                      ? row.delta < 0
                                      : Math.abs(row.candidate) < Math.abs(row.incumbent);
                                return (
                                  <TableRow key={row.metric} sx={row.regression ? { '& td': { bgcolor: 'error.lighter' } } : undefined}>
                                    <TableCell sx={{ pl: 2.5 }}>{row.metric}</TableCell>
                                    <TableCell sx={mono} align="right">
                                      {fmtMetric(row.incumbent, row.format)}
                                    </TableCell>
                                    <TableCell sx={{ ...mono, fontWeight: 600 }} align="right">
                                      {fmtMetric(row.candidate, row.format)}
                                    </TableCell>
                                    <TableCell sx={{ ...mono, color: improved ? 'success.main' : 'error.main' }} align="right">
                                      {row.delta > 0 ? '+' : ''}
                                      {row.format === 'ratio' ? row.delta.toFixed(3) : row.delta.toFixed(1)}
                                      {row.regression ? ' ⚠' : ''}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </TableContainer>
                        <Typography
                          variant="caption"
                          color={regressions.length ? 'warning.main' : 'text.secondary'}
                          sx={{ display: 'block', px: 2.5, py: 1.5 }}
                        >
                          {regressions.length
                            ? `${regressions.length} regression${regressions.length === 1 ? '' : 's'}: ${regressions.map((row) => row.metric).join(', ')} got worse. ${
                                run.warnings[0] ? `Matches the thin bin above — ${run.warnings[0].toLowerCase()}.` : ''
                              }`
                            : 'No per-bin regressions. Aggregate-only reporting hides exactly the failures that matter, so every bin is listed.'}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ p: 2.5 }}>
                        No comparison — the run did not reach evaluation.
                      </Typography>
                    )}
                  </MainCard>
                </Stack>
              </Grid>

              {/* ---- right rail: run, gate, re-run ---- */}
              <Grid size={{ xs: 12, lg: 4 }}>
                <Stack sx={{ gap: 2.5 }}>
                  <MainCard title="Run" sx={NESTED_PANEL} contentSX={{ pt: 1 }}>
                    <Fact label="Base model">
                      <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                        <Box component="span" sx={mono}>
                          {run.base || 'none'}
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                          {run.mode}
                        </Typography>
                      </Stack>
                    </Fact>
                    <Fact label="Status">
                      <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          label={status.label}
                          sx={{ bgcolor: `${status.color}.lighter`, color: `${status.color}.main` }}
                        />
                        {model && <LifecycleChip status={model.status} />}
                        <Typography variant="caption" color="text.secondary">
                          {run.durationMin} min on {run.hardware}
                        </Typography>
                      </Stack>
                    </Fact>
                    <Fact label="Seed / config">
                      <Typography variant="body2" sx={mono}>
                        seed {run.seed} · aug: {run.augmentation} · {run.epochs} epochs
                      </Typography>
                    </Fact>
                    {run.cv && (
                      <Fact label="Out-of-fold">
                        <Typography variant="body2" sx={mono}>
                          IoU {run.cv.iou} ± {run.cv.iouSd} · MAE {run.cv.mae} · bias +{run.cv.bias} · R² {run.cv.r2}
                        </Typography>
                      </Fact>
                    )}
                    <Stack direction="row" sx={{ gap: 1, pt: 1.5 }}>
                      <Button size="small" color="secondary" onClick={() => setLogsOpen((value) => !value)} disabled={!run.logs.length}>
                        {logsOpen ? 'Hide logs' : 'View logs'}
                      </Button>
                      <Box sx={{ flex: 1 }} />
                      <Tooltip title="Runs the candidate on one trial as an explicit test — results land in a parallel set, never in the main trait series">
                        <span>
                          <Button
                            size="small"
                            color="secondary"
                            variant="outlined"
                            disabled={run.status !== 'complete'}
                            onClick={() =>
                              setNotice(
                                'Test runs land in a parallel result set on the chosen trial. Same endpoint as re-run: POST /api/trials/{id}/reruns with modelId.'
                              )
                            }
                          >
                            Test on a trial
                          </Button>
                        </span>
                      </Tooltip>
                    </Stack>
                    <Collapse in={logsOpen}>
                      <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 1, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider' }}>
                        {run.logs.map((line) => (
                          <Typography
                            key={line}
                            variant="caption"
                            sx={{ ...mono, display: 'block', whiteSpace: 'pre', color: 'text.secondary' }}
                          >
                            {line}
                          </Typography>
                        ))}
                      </Box>
                    </Collapse>
                  </MainCard>

                  <MainCard title="Promote to production" sx={NESTED_PANEL} contentSX={{ pt: 1 }}>
                    {run.gate.length ? (
                      <Stack sx={{ gap: 0.75 }}>
                        {run.gate.map((check) => (
                          <Stack key={check.key} direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                            <Box sx={{ color: check.ok ? 'success.main' : 'error.main', display: 'flex', fontSize: '0.85rem' }}>
                              {check.ok ? <CheckOutlined /> : <CloseOutlined />}
                            </Box>
                            <Typography variant="body2" color={check.ok ? 'text.primary' : 'error.main'}>
                              {check.label}
                            </Typography>
                          </Stack>
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        Nothing to promote — the run did not produce a candidate.
                      </Typography>
                    )}
                    <Tooltip
                      title={
                        run.status === 'promoted'
                          ? `Promoted ${new Date(run.promotedAt).toLocaleDateString()} by ${run.promotedBy}`
                          : gateOpen
                            ? 'Every check is green. Only an admin can promote — ask S. Velchuri.'
                            : 'Locked: promotion needs every check green and an admin. A hidden action gets rebuilt as a Slack message; a locked one tells you who to ask.'
                      }
                    >
                      <span style={{ display: 'block' }}>
                        <Button
                          fullWidth
                          variant={gateOpen ? 'contained' : 'outlined'}
                          color={gateOpen ? 'primary' : 'secondary'}
                          startIcon={<LockOutlined />}
                          disabled={run.status === 'promoted' || !run.gate.length}
                          sx={{ mt: 2, textTransform: 'none' }}
                          onClick={() =>
                            setNotice(
                              gateOpen
                                ? 'Every check is green. Promoting is admin-only — ask S. Velchuri. This will call POST /api/models/{id}/promote.'
                                : 'Locked: promotion needs every gate check green and an admin. Resolve the 80–100 % regression (pull late-season audit samples into the pool and re-run), then ask S. Velchuri.'
                            )
                          }
                        >
                          {run.status === 'promoted' ? 'Promoted' : 'Promote — admin only'}
                        </Button>
                      </span>
                    </Tooltip>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                      Promotion applies to future runs. Existing trials keep {run.comparison?.incumbent || 'their pinned'} results until
                      someone explicitly re-runs them.
                    </Typography>
                  </MainCard>

                  <MainCard title="Re-run on demand" sx={NESTED_PANEL} contentSX={{ pt: 1.5 }}>
                    <Stack sx={{ gap: 1.5 }}>
                      <FormControl size="small" fullWidth>
                        <InputLabel id="rerun-trial-label">Trial</InputLabel>
                        <Select
                          labelId="rerun-trial-label"
                          label="Trial"
                          value={chosen?.id || ''}
                          onChange={(event) => setRerunTrial(event.target.value)}
                        >
                          {trialOptions.map((trial) => (
                            <MenuItem key={trial.id} value={trial.id}>
                              {trial.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Button
                        variant="outlined"
                        fullWidth
                        sx={{ textTransform: 'none' }}
                        disabled={run.status !== 'complete' && run.status !== 'promoted'}
                        onClick={() =>
                          setNotice(
                            `Re-run of ${chosen?.name} with ${run.version} recorded — ${rerunPlots.toLocaleString('en-US')} plots into a parallel result set. Will call POST /api/trials/${chosen?.id}/reruns.`
                          )
                        }
                      >
                        Re-run {rerunPlots.toLocaleString('en-US')} plots with {run.version}
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        Creates a parallel result set. Nothing is overwritten; you get a side-by-side diff of both trait series.
                      </Typography>
                    </Stack>
                  </MainCard>
                </Stack>
              </Grid>
            </Grid>
          </Stack>
        </ModelsTabs>
      </Grid>
    </Grid>
  );
}
