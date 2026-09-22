import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

// project imports
import ModelsHeader from 'sections/models/ModelsHeader';
import ModelsTabs from 'sections/models/ModelsTabs';
import LifecycleChip from 'sections/models/LifecycleChip';
import { NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';
import { useLabelPool, useModels } from 'api/models';

// assets
import LockOutlined from '@ant-design/icons/LockOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };

const signed = (value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

// ==============================|| MODELS - REGISTRY ||============================== //

/**
 * Every model version, scored against the frozen benchmark. IoU is the ML
 * metric; cover MAE and bias are the science metrics and sit in the same
 * table on purpose — a model can win on IoU and still sit 1.4 points high on
 * fractional cover, which is what a breeder's selection decision rides on.
 */
export default function ModelRegistry() {
  const navigate = useNavigate();
  const { data: models } = useModels();
  const { data: pool } = useLabelPool();
  const [notice, setNotice] = useState(null);

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      <Grid size={12}>
        <ModelsHeader subtitle="Cross-trial registry · one version pinned per run · promote is admin-gated" />
      </Grid>

      <Grid size={12}>
        <ModelsTabs current="registry" counts={{ labels: pool.totals.corrections }}>
          <Stack sx={{ gap: 2 }}>
            {notice && (
              <Alert severity="warning" variant="outlined" onClose={() => setNotice(null)}>
                {notice}
              </Alert>
            )}
            <TableContainer sx={(theme) => ({ ...NESTED_PANEL_FRAMED(theme), '& tbody tr:last-of-type td': { borderBottom: 0 } })}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Version</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">IoU</TableCell>
                    <TableCell align="right">Cover MAE</TableCell>
                    <TableCell align="right">Bias</TableCell>
                    <TableCell align="right">Trained on</TableCell>
                    <TableCell>Used by</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {models.map((model) => (
                    <TableRow
                      key={model.id}
                      hover
                      onClick={() => model.trainingRunId && navigate(`/models/runs/${model.trainingRunId}`)}
                      sx={{ cursor: model.trainingRunId ? 'pointer' : 'default' }}
                    >
                      <TableCell>
                        <Stack sx={{ gap: 0.25 }}>
                          <Typography variant="subtitle2" sx={mono}>
                            {model.version}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {model.family}
                            {model.base ? ` · from ${model.base}` : ''}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell sx={mono}>{model.target}</TableCell>
                      <TableCell>
                        <LifecycleChip status={model.status} />
                      </TableCell>
                      <TableCell sx={mono} align="right">
                        {model.iou.toFixed(3)}
                      </TableCell>
                      <TableCell sx={mono} align="right">
                        {model.coverMae.toFixed(1)} pts
                      </TableCell>
                      <TableCell sx={{ ...mono, color: Math.abs(model.bias) >= 1 ? 'warning.main' : 'text.primary' }} align="right">
                        {signed(model.bias)}
                      </TableCell>
                      <TableCell sx={mono} align="right">
                        {model.trainedOn.toLocaleString('en-US')}
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color={model.usedBy.length ? 'text.primary' : 'text.disabled'}>
                          {model.usedBy.length ? model.usedBy.join(', ') : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                        {model.status === 'candidate' && (
                          <Tooltip title="Locked — admin only. Promotion needs a benchmark comparison attached and every gate check green.">
                            <Button
                              size="small"
                              variant="outlined"
                              color="secondary"
                              startIcon={<LockOutlined />}
                              sx={{ textTransform: 'none' }}
                              onClick={() =>
                                setNotice(
                                  `${model.version} is a candidate, and promoting is admin-only — ask S. Velchuri. The gate on training run ${model.trainingRunId.replace('run-', '#')} still has one per-bin regression open.`
                                )
                              }
                            >
                              Promote
                            </Button>
                          </Tooltip>
                        )}
                        {model.status === 'evaluated' && model.note && (
                          <Tooltip title={model.note}>
                            <Typography variant="caption" color="text.secondary">
                              pilot
                            </Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Stack sx={{ gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Scores are against the frozen benchmark{' '}
                <Box component="span" sx={mono}>
                  bench-2026a
                </Box>{' '}
                (200 held-out plots, stratified by date × altitude × cover bin). Never against training data. The pilot row is an
                out-of-fold cross-validation estimate — no frozen benchmark existed yet.
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Promote is visibly locked, not hidden: anyone can see a candidate is ready, only an admin can act, and the button tells you
                who to ask.
              </Typography>
            </Stack>
          </Stack>
        </ModelsTabs>
      </Grid>
    </Grid>
  );
}
