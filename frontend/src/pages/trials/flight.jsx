import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
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
import PageHeader from 'components/PageHeader';
import StatTile from 'components/StatTile';
import TrialTabs from 'sections/trials/TrialTabs';
import QcChip from 'sections/trials/QcChip';
import FlightSummary from 'sections/trials/FlightSummary';
import FlightProgress from 'sections/trials/FlightProgress';
import { NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';
import { useFlight, useTrial } from 'api/trials';
import formatRelative from 'utils/formatRelative';

// assets
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import PlayCircleOutlined from '@ant-design/icons/PlayCircleOutlined';
import ArrowLeftOutlined from '@ant-design/icons/ArrowLeftOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };
const cell = { ...mono, whiteSpace: 'nowrap' };
const NONE = [];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'edited', label: 'Corrected' },
  { key: 'rejected', label: 'Rejected' }
];

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
  const { data: trial, error: trialError } = useTrial(trialId);
  const { flight, flights = NONE, isLoading, error, mutate } = useFlight(trialId, flightId);

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  // The flights API carries no per-plot results yet; `results` arrives with
  // `GET …/flights/{fid}/results`. Until then the panel shows the status instead.
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

  // Straight to the trial's Flights table, not history.back(): a flight opened from a
  // shared link has no table behind it. The Flights tab can't do this — it is already
  // the selected tab here, and a tab only navigates when you switch to another one.
  const backToFlights = (
    <Button size="small" color="secondary" startIcon={<ArrowLeftOutlined />} onClick={() => navigate(`/trials/${trialId}`)}>
      Back to Flights
    </Button>
  );

  if (trialError) {
    return (
      <Grid container rowSpacing={2.5}>
        <Grid size={12}>
          <PageHeader crumbs={crumbs} title="Could not load trial" actions={backToFlights} />
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
          <PageHeader crumbs={crumbs} title="Flight not found" actions={backToFlights} />
        </Grid>
        <Grid size={12}>
          <Alert severity="warning" variant="outlined">
            No flight <code>{flightId}</code> in this trial. It may have been removed, or the link is stale.
          </Alert>
        </Grid>
      </Grid>
    );
  }

  const openReviewer = (plotId) =>
    navigate(`/trials/${trialId}/review/session?flight=${flightId}&queue=all${plotId ? `&plot=${plotId}` : ''}`);

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      <Grid size={12}>
        <PageHeader
          crumbs={[...crumbs, { label: flight ? `Flight ${flight.flightDate}` : 'Flight' }]}
          title={flight ? `Flight ${flight.flightDate}` : error ? 'Could not load flight' : 'Loading flight…'}
          subtitle={
            flight
              ? `${flight.captureLabel || flight.capture} · ${flight.source === 'ortho' ? 'Ortho + .shp' : 'Pre-clipped'} · ${flight.plots} plots · ${flight.createdBy || 'Unknown'} · ${formatRelative(flight.createdAt)}`
              : undefined
          }
          actions={
            <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
              {backToFlights}
              {flight?.status === 'complete' && (
                <Button
                  variant="contained"
                  startIcon={<PlayCircleOutlined />}
                  onClick={() => navigate(`/trials/${trialId}/review?flight=${flightId}`)}
                  color={flight.flagged ? 'primary' : 'secondary'}
                >
                  {flight.flagged ? `Review ${flight.flagged} flagged` : 'Open in Review'}
                </Button>
              )}
            </Stack>
          }
        />
      </Grid>

      <Grid size={12}>
        <TrialTabs trialId={trialId} current="flights" flagged={flights.reduce((sum, candidate) => sum + (candidate.flagged || 0), 0)}>
          {error && (
            <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
              Could not load flight — {error.message}
            </Alert>
          )}
          {isLoading && <LinearProgress sx={{ height: 2, mb: 2 }} />}

          {flight && (
            <Grid container rowSpacing={2.5} columnSpacing={2.75}>
              {/* ---- what this flight is: on top, full width ---- */}
              <Grid size={12}>
                <FlightSummary trialId={trialId} flight={flight} onChanged={mutate} />
              </Grid>

              {/* ---- results, or how far the flight is from having them ---- */}
              <Grid size={12}>
                {!summary ? (
                  <FlightProgress flight={flight} />
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
