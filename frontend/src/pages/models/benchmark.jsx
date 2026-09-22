// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

// project imports
import MainCard from 'components/MainCard';
import StatTile from 'components/StatTile';
import ModelsHeader from 'sections/models/ModelsHeader';
import ModelsTabs from 'sections/models/ModelsTabs';
import LifecycleChip from 'sections/models/LifecycleChip';
import { NESTED_PANEL } from 'sections/trials/surfaces';
import { COVER_BINS, MODELS, useBenchmarks, useLabelPool } from 'api/models';

// assets
import LockOutlined from '@ant-design/icons/LockOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };

// ==============================|| MODELS - BENCHMARK ||============================== //

/**
 * Frozen, stratified, immutable. A benchmark image never enters a training
 * run's dataset — that is the one invariant worth enforcing in the database —
 * and a new benchmark is a new set, never an edit of the old one.
 */
export default function Benchmark() {
  const { data: benchmarks } = useBenchmarks();
  const { data: pool } = useLabelPool();

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      <Grid size={12}>
        <ModelsHeader
          crumbs={[{ label: 'Benchmark' }]}
          subtitle="Held-out plots the model never trains on · promotion means beating the incumbent here"
          actions={
            <Tooltip title="A new benchmark is a new set, never an edit. Freezing one needs labels across dates × altitudes × cover bins — draw them from the audit stream.">
              <span>
                <Button variant="outlined" color="secondary" startIcon={<PlusOutlined />} disabled>
                  New benchmark set
                </Button>
              </span>
            </Tooltip>
          }
        />
      </Grid>

      <Grid size={12}>
        <ModelsTabs current="benchmark" counts={{ labels: pool.totals.corrections }}>
          <Stack sx={{ gap: 2.5 }}>
            {benchmarks.map((bench) => (
              <MainCard
                key={bench.id}
                sx={NESTED_PANEL}
                title={
                  <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                    <Box component="span" sx={mono}>
                      {bench.name}
                    </Box>
                    <Chip
                      size="small"
                      icon={<LockOutlined />}
                      label={bench.superseded ? 'frozen · superseded' : 'frozen'}
                      sx={{ bgcolor: 'info.lighter', color: 'info.main' }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {bench.plots} plots · created {new Date(bench.createdAt).toLocaleDateString()} by {bench.createdBy}
                    </Typography>
                  </Stack>
                }
                content={false}
              >
                <Stack sx={{ p: 2.5, gap: 2 }}>
                  <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap' }}>
                    <StatTile label="Dates" value={bench.strata.dates.length} hint={bench.strata.dates.join(' · ')} />
                    <StatTile label="Altitudes" value={bench.strata.altitudes.length} hint={bench.strata.altitudes.join(' · ')} />
                    <StatTile label="Per cover bin" value={bench.strata.bins.join(' / ')} hint={COVER_BINS.join(' · ')} />
                    <StatTile label="Genotypes" value={bench.strata.genotypes} hint="stratified, no plot shared with training" />
                  </Stack>

                  <TableContainer
                    sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, '& tbody tr:last-of-type td': { borderBottom: 0 } }}
                  >
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Model</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell align="right">IoU</TableCell>
                          <TableCell align="right">Cover MAE</TableCell>
                          <TableCell align="right">Bias</TableCell>
                          {COVER_BINS.map((bin) => (
                            <TableCell key={bin} align="right">
                              <Typography variant="caption" color="text.secondary">
                                MAE {bin}
                              </Typography>
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {bench.scores.map((score) => {
                          const model = MODELS.find((candidate) => candidate.id === score.modelId);
                          const worst = Math.max(...score.byBin);
                          return (
                            <TableRow key={score.modelId} hover>
                              <TableCell sx={mono}>{model?.version || score.modelId}</TableCell>
                              <TableCell>{model && <LifecycleChip status={model.status} />}</TableCell>
                              <TableCell sx={mono} align="right">
                                {score.iou.toFixed(3)}
                              </TableCell>
                              <TableCell sx={{ ...mono, fontWeight: 600 }} align="right">
                                {score.coverMae.toFixed(1)} pts
                              </TableCell>
                              <TableCell sx={{ ...mono, color: Math.abs(score.bias) >= 1 ? 'warning.main' : 'text.primary' }} align="right">
                                {score.bias > 0 ? '+' : ''}
                                {score.bias.toFixed(1)}
                              </TableCell>
                              {score.byBin.map((value, i) => (
                                <TableCell
                                  key={COVER_BINS[i]}
                                  sx={{ ...mono, color: value === worst ? 'warning.main' : 'text.secondary' }}
                                  align="right"
                                >
                                  {value.toFixed(1)}
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Stack>
              </MainCard>
            ))}

            <Typography variant="caption" color="text.secondary">
              Report cover MAE and signed bias, not just IoU, and report them per cover bin: aggregate-only metrics hide regressions at
              closed canopy — exactly where breeders separate their best genotypes. The highlighted bin is each model&apos;s weakest.
            </Typography>
          </Stack>
        </ModelsTabs>
      </Grid>
    </Grid>
  );
}
