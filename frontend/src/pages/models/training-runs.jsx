import { useNavigate } from 'react-router-dom';

// material-ui
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

// project imports
import ModelsHeader from 'sections/models/ModelsHeader';
import ModelsTabs from 'sections/models/ModelsTabs';
import { NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';
import { useLabelPool, useTrainingRuns } from 'api/models';
import formatRelative from 'utils/formatRelative';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };

export const RUN_STATUS = {
  queued: { label: 'queued', color: 'secondary' },
  running: { label: 'running', color: 'primary' },
  complete: { label: 'complete', color: 'warning' },
  promoted: { label: 'promoted', color: 'success' },
  rejected: { label: 'rejected', color: 'error' },
  failed: { label: 'failed', color: 'error' }
};

// ==============================|| MODELS - TRAINING RUNS ||============================== //

export default function TrainingRuns() {
  const navigate = useNavigate();
  const { data: runs } = useTrainingRuns();
  const { data: pool } = useLabelPool();

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      <Grid size={12}>
        <ModelsHeader
          crumbs={[{ label: 'Training runs' }]}
          subtitle="Anyone can start a run · every run shows what it was taught before it trains"
        />
      </Grid>

      <Grid size={12}>
        <ModelsTabs current="runs" counts={{ labels: pool.totals.corrections }}>
          <Stack sx={{ gap: 1.5 }}>
            <TableContainer sx={(theme) => ({ ...NESTED_PANEL_FRAMED(theme), '& tbody tr:last-of-type td': { borderBottom: 0 } })}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Run</TableCell>
                    <TableCell>Version</TableCell>
                    <TableCell>Base</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Training labels</TableCell>
                    <TableCell align="right">Cover MAE Δ</TableCell>
                    <TableCell>Started</TableCell>
                    <TableCell align="right">Duration</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {runs.map((run) => {
                    const status = RUN_STATUS[run.status] || RUN_STATUS.queued;
                    const mae = run.comparison?.rows.find((row) => row.metric.startsWith('Cover MAE'));
                    const training = run.dataset.baseline + run.dataset.trainingGrade + run.dataset.audit;
                    return (
                      <TableRow key={run.id} hover onClick={() => navigate(`/models/runs/${run.id}`)} sx={{ cursor: 'pointer' }}>
                        <TableCell sx={{ ...mono, fontWeight: 600 }}>#{run.number}</TableCell>
                        <TableCell sx={mono}>{run.version}</TableCell>
                        <TableCell sx={mono}>
                          {run.base || '—'}
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                            {run.mode}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
                            <Chip
                              size="small"
                              label={status.label}
                              sx={{ bgcolor: `${status.color}.lighter`, color: `${status.color}.main` }}
                            />
                            {run.error && (
                              <Tooltip title={run.error}>
                                <Typography variant="caption" color="error.main" noWrap sx={{ maxWidth: 220 }}>
                                  {run.error}
                                </Typography>
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell sx={mono} align="right">
                          {training.toLocaleString('en-US')}
                        </TableCell>
                        <TableCell
                          sx={{ ...mono, color: mae ? (mae.delta < 0 ? 'success.main' : 'error.main') : 'text.disabled' }}
                          align="right"
                        >
                          {mae ? `${mae.delta > 0 ? '+' : ''}${mae.delta.toFixed(1)} pts` : '—'}
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {run.startedBy} · {formatRelative(run.startedAt)}
                          </Typography>
                        </TableCell>
                        <TableCell sx={mono} align="right">
                          {run.durationMin} min
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                            {run.hardware}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography variant="caption" color="text.secondary">
              Cover MAE Δ is candidate minus incumbent on the frozen benchmark — negative is better. A run can improve IoU and still worsen
              the trait; run #13 is what that looks like.
            </Typography>
          </Stack>
        </ModelsTabs>
      </Grid>
    </Grid>
  );
}
