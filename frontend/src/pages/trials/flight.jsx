import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import LinearProgress from '@mui/material/LinearProgress';
import OutlinedInput from '@mui/material/OutlinedInput';
import InputAdornment from '@mui/material/InputAdornment';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

// project imports
import MainCard from 'components/MainCard';
import PageHeader from 'components/PageHeader';
import StatTile from 'components/StatTile';
import TrialTabs from 'sections/trials/TrialTabs';
import QcChip from 'sections/trials/QcChip';
import { NESTED_PANEL, NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';
import { formatBytes } from 'sections/trials/flight-setup/utils';
import { useFlightResults } from 'api/results';
import { MODELS } from 'api/models';
import LifecycleChip from 'sections/models/LifecycleChip';
import formatRelative from 'utils/formatRelative';

// assets
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import PlayCircleOutlined from '@ant-design/icons/PlayCircleOutlined';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };
const cell = { ...mono, whiteSpace: 'nowrap' };
const NONE = [];

const STATUS = {
  uploaded: { label: 'uploaded', color: 'secondary' },
  complete: { label: 'complete', color: 'success' },
  running: { label: 'running', color: 'primary' },
  queued: { label: 'queued', color: 'secondary' },
  failed: { label: 'failed', color: 'error' }
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'edited', label: 'Corrected' },
  { key: 'rejected', label: 'Rejected' }
];

function Row({ label, children, mono: isMono = false }) {
  return (
    <Stack
      direction="row"
      sx={{ gap: 2, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ width: 118, flexShrink: 0, pt: 0.25 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0, ...(isMono && mono) }}>{children}</Box>
    </Stack>
  );
}

// ==============================|| TRIALS - FLIGHT DETAIL ||============================== //

/**
 * One flight: what went in (the manifest) and what came out (per-plot
 * results). The manifest is the reproducibility record — ortho, shapefile,
 * the grid offset that was applied, the model version that was pinned — so a
 * number in the trait series can always be traced back to how it was made.
 */
export default function FlightDetail() {
  const { trialId, flightId } = useParams();
  const navigate = useNavigate();
  const { trial, flight, flights, isLoading, error, trialError } = useFlightResults(trialId, flightId);

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const plots = flight?.results?.plots || NONE;
  const summary = flight?.results?.summary;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return plots.filter((plot) => {
      if (filter === 'flagged' && !plot.flag) return false;
      if (filter === 'edited' && !plot.decision?.edited) return false;
      if (filter === 'rejected' && plot.qc !== 'rejected') return false;
      if (needle && !`${plot.plotId} g${plot.genotype} r${plot.row}c${plot.col}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [plots, filter, search]);

  const crumbs = [
    { label: 'Croplytix', to: '/' },
    { label: 'Field Trials', to: '/trials' },
    { label: trial?.name || trialId, to: `/trials/${trialId}` }
  ];

  if (trialError) {
    return (
      <Grid container rowSpacing={2.5}>
        <Grid size={12}>
          <PageHeader crumbs={crumbs} title="Could not load trial" />
        </Grid>
        <Grid size={12}>
          <Alert severity="error" variant="outlined">
            {trialError.message}
          </Alert>
        </Grid>
      </Grid>
    );
  }

  if (!isLoading && flight === null) {
    return (
      <Grid container rowSpacing={2.5}>
        <Grid size={12}>
          <PageHeader crumbs={crumbs} title="Flight not found" />
        </Grid>
        <Grid size={12}>
          <Alert severity="warning" variant="outlined">
            No flight <code>{flightId}</code> in this trial. It may have been removed, or the link is stale.
          </Alert>
        </Grid>
      </Grid>
    );
  }

  const status = STATUS[flight?.status] || STATUS.queued;
  const model = flight ? MODELS.find((candidate) => candidate.id === flight.modelId || candidate.label === flight.model) : null;
  const openReviewer = (plotId) =>
    navigate(`/trials/${trialId}/review/session?flight=${flightId}&queue=all${plotId ? `&plot=${plotId}` : ''}`);

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      <Grid size={12}>
        <PageHeader
          crumbs={[...crumbs, { label: flight ? `Flight ${flight.flightDate}` : 'Flight' }]}
          title={flight ? `Flight ${flight.flightDate}` : 'Loading flight…'}
          subtitle={
            flight
              ? `${flight.captureLabel || flight.capture} · ${flight.source === 'ortho' ? 'ortho + .shp' : 'pre-clipped'} · ${flight.plots} plots · ${flight.createdBy || 'unknown'} · ${formatRelative(flight.createdAt)}`
              : undefined
          }
          actions={
            flight?.status === 'complete' ? (
              <Button
                variant="contained"
                startIcon={<PlayCircleOutlined />}
                onClick={() => navigate(`/trials/${trialId}/review?flight=${flightId}`)}
                color={summary?.pending ? 'primary' : 'secondary'}
              >
                {summary?.pending ? `Review ${summary.pending} flagged` : 'Open in Review'}
              </Button>
            ) : null
          }
        />
      </Grid>

      <Grid size={12}>
        <TrialTabs trialId={trialId} current="flights" flagged={flights.reduce((sum, candidate) => sum + (candidate.flagged || 0), 0)}>
          {error && (
            <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
              Could not load results — {error.message}
            </Alert>
          )}
          {isLoading && <LinearProgress sx={{ height: 2, mb: 2 }} />}

          {flight && (
            <Grid container rowSpacing={2.5} columnSpacing={2.75}>
              {/* ---- manifest ---- */}
              <Grid size={{ xs: 12, lg: 4 }}>
                <MainCard title="Run manifest" sx={NESTED_PANEL} contentSX={{ pt: 1 }}>
                  <Row label="Status">
                    <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                      <Chip size="small" label={status.label} sx={{ bgcolor: `${status.color}.lighter`, color: `${status.color}.main` }} />
                      {flight.status === 'running' && (
                        <>
                          <LinearProgress variant="determinate" value={flight.progress} sx={{ width: 90, height: 3 }} />
                          <Typography variant="caption" color="text.secondary">
                            {flight.progress}%
                          </Typography>
                        </>
                      )}
                      {flight.status === 'failed' && flight.error && (
                        <Typography variant="caption" color="error.main">
                          {flight.error}
                        </Typography>
                      )}
                    </Stack>
                  </Row>
                  <Row label="Flight date" mono>
                    {flight.flightDate}
                    {flight.dap != null && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {flight.dap} DAP
                      </Typography>
                    )}
                  </Row>
                  <Row label="Capture">{flight.captureLabel || flight.capture}</Row>
                  <Row label="Model">
                    <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Box component="span" sx={mono}>
                        {flight.model}
                      </Box>
                      {model && <LifecycleChip status={model.status} />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      pinned for this run · re-running with another version creates a parallel result set
                    </Typography>
                  </Row>
                  {flight.ortho && (
                    <Row label="Orthophoto">
                      <Typography variant="body2" sx={mono} noWrap>
                        {flight.ortho.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {[
                          flight.ortho.bytes && formatBytes(flight.ortho.bytes),
                          flight.ortho.width && `${flight.ortho.width} × ${flight.ortho.height} px`,
                          flight.ortho.bandCount && `${flight.ortho.bandCount}-band`,
                          flight.ortho.gsdCm && `${flight.ortho.gsdCm} cm/px`,
                          flight.ortho.crs
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Typography>
                    </Row>
                  )}
                  {flight.shapefile && (
                    <Row label="Plot shapefile">
                      <Typography variant="body2" sx={mono} noWrap>
                        {flight.shapefile.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {[
                          flight.shapefile.members?.join(' '),
                          flight.shapefile.featureCount && `${flight.shapefile.featureCount} polygons`,
                          flight.shapefile.crs
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Typography>
                    </Row>
                  )}
                  {flight.filenamePattern && (
                    <Row label="Filename pattern" mono>
                      {flight.filenamePattern}
                    </Row>
                  )}
                  {flight.offset && (
                    <Row label="Grid offset" mono>
                      dx {flight.offset.dxCm >= 0 ? '+' : ''}
                      {flight.offset.dxCm} cm · dy {flight.offset.dyCm >= 0 ? '+' : ''}
                      {flight.offset.dyCm} cm · rot {flight.offset.rotDeg}°{flight.insetCm != null && ` · inset ${flight.insetCm} cm`}
                    </Row>
                  )}
                  {flight.mapping && Object.keys(flight.mapping).length > 0 && (
                    <Row label="Attribute map" mono>
                      {['plot_id', 'row', 'col', 'genotype', 'rep']
                        .filter((key) => flight.mapping[key])
                        .map((key) => `${key} ← ${flight.mapping[key]}`)
                        .join(' · ') || '—'}
                    </Row>
                  )}
                  <Row label="Denominator">
                    {flight.denominator === 'polygon' ? 'Polygon area · nodata corners excluded' : 'Full clip extent'}
                  </Row>
                  <Row label="Created" mono>
                    {flight.createdBy || '—'} · {new Date(flight.createdAt).toLocaleString()}
                  </Row>
                  {flight.files?.length > 0 && (
                    <Row label="Stored files">
                      <Stack sx={{ gap: 0.25 }}>
                        {flight.files.map((file) => (
                          <Link
                            key={file.key}
                            href={`/api/trials/${trialId}/flights/${flightId}/files/${file.role}/${encodeURIComponent(file.name)}`}
                            target="_blank"
                            rel="noreferrer"
                            variant="caption"
                            underline="hover"
                            sx={{ ...mono, wordBreak: 'break-all' }}
                          >
                            {file.role}/{file.name} · {formatBytes(file.bytes)}
                          </Link>
                        ))}
                      </Stack>
                    </Row>
                  )}
                  {flight.demo && (
                    <Row label="Inputs">
                      <Typography variant="caption" color="text.secondary">
                        Fixture flight — no files stored. Upload a flight to replace this set.
                      </Typography>
                    </Row>
                  )}
                </MainCard>
              </Grid>

              {/* ---- results ---- */}
              <Grid size={{ xs: 12, lg: 8 }}>
                {flight.status !== 'complete' ? (
                  <Stack sx={(theme) => ({ ...NESTED_PANEL_FRAMED(theme), alignItems: 'center', gap: 1.5, py: 8, px: 3 })}>
                    <Box sx={{ fontSize: '2rem', color: 'text.disabled', display: 'flex' }}>
                      <LoadingOutlined spin={flight.status === 'running'} />
                    </Box>
                    <Typography variant="subtitle1">
                      {flight.status === 'running' && `Clipping and segmenting · ${flight.progress}%`}
                      {flight.status === 'failed' && 'This run failed'}
                      {['uploaded', 'queued'].includes(flight.status) && 'Waiting for the processing worker'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" align="center" sx={{ maxWidth: 460 }}>
                      {flight.status === 'failed'
                        ? flight.error || 'No error detail recorded.'
                        : 'Per-plot masks, fractional cover and canopy area land here when inference finishes. Nothing to do until then.'}
                    </Typography>
                    {flight.status === 'running' && (
                      <LinearProgress variant="determinate" value={flight.progress} sx={{ width: 240, height: 4, mt: 1 }} />
                    )}
                  </Stack>
                ) : (
                  <Stack sx={{ gap: 2 }}>
                    <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap' }}>
                      <StatTile label="Plots" value={summary.plots} hint={`${flight.plots} in shapefile`} />
                      <StatTile label="Mean cover" value={`${summary.meanCover.toFixed(1)}%`} hint="QC-accepted" />
                      <StatTile
                        label="Needs review"
                        value={summary.pending}
                        hint={`${summary.flaggedTotal} flagged in total`}
                        color={summary.pending ? 'warning.main' : 'success.main'}
                      />
                      <StatTile label="Corrected" value={summary.edited} hint={`${summary.rejected} rejected`} />
                    </Stack>

                    <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                      <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={filter}
                        onChange={(event, value) => value && setFilter(value)}
                        sx={{
                          '& .MuiToggleButton-root.Mui-selected': {
                            color: 'primary.main',
                            bgcolor: 'primary.lighter',
                            borderColor: 'primary.light'
                          }
                        }}
                      >
                        {FILTERS.map((option) => (
                          <ToggleButton key={option.key} value={option.key}>
                            {option.label}
                          </ToggleButton>
                        ))}
                      </ToggleButtonGroup>
                      <Box sx={{ flex: 1 }} />
                      <OutlinedInput
                        size="small"
                        placeholder="Plot, genotype, r5c8"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        startAdornment={
                          <InputAdornment position="start">
                            <SearchOutlined />
                          </InputAdornment>
                        }
                        sx={{ width: 220 }}
                      />
                    </Stack>

                    <TableContainer
                      sx={(theme) => ({
                        ...NESTED_PANEL_FRAMED(theme),
                        maxHeight: 560,
                        '& tbody tr:last-of-type td': { borderBottom: 0 }
                      })}
                    >
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Plot</TableCell>
                            <TableCell>Genotype</TableCell>
                            <TableCell align="right">Rep</TableCell>
                            <TableCell align="right">Cover</TableCell>
                            <TableCell align="right">Canopy</TableCell>
                            <TableCell align="right">Confidence</TableCell>
                            <TableCell>QC</TableCell>
                            <TableCell>Flag</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {rows.map((plot) => (
                            <TableRow key={plot.plotId} hover onClick={() => openReviewer(plot.plotId)} sx={{ cursor: 'pointer' }}>
                              <TableCell sx={{ ...cell, fontWeight: 600 }}>
                                {plot.plotId}
                                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                  r{plot.row} c{plot.col}
                                </Typography>
                              </TableCell>
                              <TableCell sx={mono}>G{plot.genotype}</TableCell>
                              <TableCell sx={mono} align="right">
                                {plot.rep}
                              </TableCell>
                              <TableCell sx={cell} align="right">
                                {plot.cover.toFixed(1)}%
                                {plot.decision?.edited && (
                                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                                    was {plot.modelCover.toFixed(1)}
                                  </Typography>
                                )}
                              </TableCell>
                              <TableCell sx={cell} align="right">
                                {Math.round(plot.areaCm2).toLocaleString('en-US')} cm²
                              </TableCell>
                              <TableCell sx={mono} align="right">
                                <Box component="span" sx={{ color: plot.confidence < 0.6 ? 'warning.main' : 'text.primary' }}>
                                  {plot.confidence.toFixed(2)}
                                </Box>
                              </TableCell>
                              <TableCell>
                                <QcChip qc={plot.qc} edited={plot.decision?.edited} audit={plot.audit} />
                              </TableCell>
                              <TableCell>
                                <Typography variant="caption" color={plot.flag ? 'warning.main' : 'text.disabled'}>
                                  {plot.flagLabel || '—'}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          ))}
                          {rows.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={8}>
                                <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
                                  No plots match.
                                </Typography>
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    <Typography variant="caption" color="text.secondary" align="right">
                      {rows.length} of {plots.length} plots · click a row to open it in the Reviewer
                    </Typography>
                  </Stack>
                )}
              </Grid>
            </Grid>
          )}
        </TrialTabs>
      </Grid>
    </Grid>
  );
}
