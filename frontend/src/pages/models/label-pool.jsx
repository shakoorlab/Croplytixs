import { useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Alert from '@mui/material/Alert';
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
import CoverBinBars from 'sections/models/CoverBinBars';
import { NESTED_PANEL, NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';
import { useLabelPool } from 'api/models';
import formatRelative from 'utils/formatRelative';

// assets
import DownOutlined from '@ant-design/icons/DownOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };

const SOURCE = {
  'qc-correction': { label: 'QC correction', color: 'primary' },
  audit: { label: 'audit stream', color: 'info' },
  imported: { label: 'imported', color: 'secondary' }
};

// ==============================|| MODELS - LABEL POOL ||============================== //

/**
 * Where corrections accumulate. Every Reviewer decision that opted in shows
 * up here in the same session — that is the return path made visible. The
 * composition view and the cover-bin chart are the two guardrails from the
 * framing: provenance (a QC fix is not a training label) and stage balance.
 */
export default function LabelPool() {
  const { data: pool } = useLabelPool();
  const [anchor, setAnchor] = useState(null);
  const [notice, setNotice] = useState(null);

  const live = pool.live.map((label) => ({
    at: label.at,
    author: label.author === 'you' ? 'you' : label.author,
    trial: label.trialId,
    plotId: label.plotId,
    grade: label.grade || 'rough',
    source: 'qc-correction',
    cover: label.coverAfter ?? label.coverBefore,
    edited: label.edited,
    live: true
  }));
  const recent = [...live, ...pool.recent].slice(0, 12);

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      <Grid size={12}>
        <ModelsHeader
          crumbs={[{ label: 'Label pool' }]}
          subtitle="Corrections become training labels as a by-product of QC · provenance on every one"
          actions={
            <>
              <Button
                variant="outlined"
                color="secondary"
                endIcon={<DownOutlined style={{ fontSize: '0.7rem' }} />}
                onClick={(event) => setAnchor(event.currentTarget)}
              >
                Export
              </Button>
              <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
                {['Label Studio JSON', 'COCO segmentation', 'PNG masks + clips'].map((option) => (
                  <MenuItem
                    key={option}
                    onClick={() => {
                      setAnchor(null);
                      setNotice(
                        `${option} export will call GET /api/labels/export — Label Studio stays a first-class citizen until the in-app brush has earned its place.`
                      );
                    }}
                  >
                    {option}
                  </MenuItem>
                ))}
              </Menu>
            </>
          }
        />
      </Grid>

      <Grid size={12}>
        <ModelsTabs current="labels" counts={{ labels: pool.totals.corrections }}>
          <Stack sx={{ gap: 2.5 }}>
            {notice && (
              <Alert severity="info" variant="outlined" onClose={() => setNotice(null)}>
                {notice}
              </Alert>
            )}

            <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap' }}>
              <StatTile label="Imported" value={pool.totals.imported.toLocaleString('en-US')} hint={pool.imported.trials.join(' · ')} />
              <StatTile
                label="Training-grade"
                value={pool.totals.trainingGrade}
                hint="QC corrections polished for boundaries"
                color="primary.main"
              />
              <StatTile label="Rough" value={pool.totals.rough} hint="count for the number, excluded from training" />
              <StatTile label="Audit sample" value={pool.totals.audit} hint="auto-passed plots, unbiased" />
              <StatTile label="Benchmark" value={pool.totals.benchmark} hint="frozen · never trains" />
            </Stack>

            <Grid container rowSpacing={2.5} columnSpacing={2.75}>
              <Grid size={{ xs: 12, lg: 5 }}>
                <MainCard title="Composition by cover bin" sx={NESTED_PANEL} contentSX={{ px: 1, pt: 1 }}>
                  <CoverBinBars baseline={pool.byBin.baseline} corrections={pool.byBin.corrections} />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, pt: 1 }}>
                    New labels come from flagged plots, and flags cluster in particular growth stages — so the pool skews without anyone
                    deciding it should. Rebalance before a run by pulling audit samples from the thin bins.
                  </Typography>
                </MainCard>
              </Grid>

              <Grid size={{ xs: 12, lg: 7 }}>
                <Stack sx={{ gap: 1 }}>
                  <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
                    <Typography variant="subtitle1">Recent labels</Typography>
                    {live.length > 0 && (
                      <Chip
                        size="small"
                        label={`${live.length} from this browser`}
                        sx={{ bgcolor: 'primary.lighter', color: 'primary.main' }}
                      />
                    )}
                  </Stack>
                  <TableContainer
                    sx={(theme) => ({
                      ...NESTED_PANEL_FRAMED(theme),
                      overflowX: 'auto',
                      '& td, & th': { whiteSpace: 'nowrap' },
                      '& tbody tr:last-of-type td': { borderBottom: 0 }
                    })}
                  >
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>When</TableCell>
                          <TableCell>Plot</TableCell>
                          <TableCell>Trial</TableCell>
                          <TableCell>Source</TableCell>
                          <TableCell>Grade</TableCell>
                          <TableCell align="right">Cover</TableCell>
                          <TableCell>Author</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {recent.map((label, i) => {
                          const source = SOURCE[label.source] || SOURCE.imported;
                          return (
                            <TableRow
                              key={`${label.plotId}-${label.at}-${i}`}
                              hover
                              sx={label.live ? { '& td': { bgcolor: 'primary.lighter' } } : undefined}
                            >
                              <TableCell>
                                <Typography variant="caption" color="text.secondary">
                                  {formatRelative(label.at)}
                                </Typography>
                              </TableCell>
                              <TableCell sx={mono}>{label.plotId}</TableCell>
                              <TableCell>
                                <Typography variant="caption" noWrap>
                                  {label.trial}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Chip
                                  size="small"
                                  label={source.label}
                                  sx={{ bgcolor: `${source.color}.lighter`, color: `${source.color}.main` }}
                                />
                              </TableCell>
                              <TableCell>
                                <Typography variant="caption" color={label.grade === 'training-grade' ? 'success.main' : 'text.secondary'}>
                                  {label.grade}
                                  {label.live && !label.edited ? ' · confirmed' : ''}
                                </Typography>
                              </TableCell>
                              <TableCell sx={mono} align="right">
                                {label.cover == null ? '—' : `${Number(label.cover).toFixed(1)}%`}
                              </TableCell>
                              <TableCell>
                                <Typography variant="caption">{label.author}</Typography>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Typography variant="caption" color="text.secondary">
                    Many labels can exist for one plot image; latest-per-author wins and disagreement stays visible.{' '}
                    <Box component="span" sx={{ color: 'text.disabled' }}>
                      Highlighted rows were recorded in this browser through the Reviewer.
                    </Box>
                  </Typography>
                </Stack>
              </Grid>
            </Grid>
          </Stack>
        </ModelsTabs>
      </Grid>
    </Grid>
  );
}
