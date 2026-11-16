import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputAdornment from '@mui/material/InputAdornment';
import InputLabel from '@mui/material/InputLabel';
import OutlinedInput from '@mui/material/OutlinedInput';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

// project imports
import PageHeader from 'components/PageHeader';
import StatTile from 'components/StatTile';
import TrialTabs from 'sections/trials/TrialTabs';
import PlotReviewTable from 'sections/trials/review/PlotReviewTable';
import { NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';
import { useTrialResults } from 'api/results';
import { trialSubtitle } from 'api/trials';

// assets
import PlayCircleOutlined from '@ant-design/icons/PlayCircleOutlined';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import SearchOutlined from '@ant-design/icons/SearchOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };
const NONE = [];

const FILTERS = [
  { key: 'queue', label: 'Needs review' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'audit', label: 'Audit sample' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'all', label: 'All plots' }
];

function matches(plot, filter) {
  switch (filter) {
    case 'queue':
      return plot.qc === 'pending';
    case 'flagged':
      return Boolean(plot.flag);
    case 'audit':
      return plot.audit;
    case 'reviewed':
      return plot.qc === 'accepted' || plot.qc === 'rejected';
    default:
      return true;
  }
}

// ==============================|| TRIALS - REVIEW ||============================== //

/**
 * The triage list. Only plots the model was unsure about — plus a small
 * random audit sample of the ones it was sure about — need a human; everything
 * else is already in the trait series. The table exists to decide *which*
 * plots get the Reviewer's full-screen attention: why each was flagged and the
 * number behind it, how its cover moved since the previous date, sortable on
 * every column. A row opens that plot in the Reviewer.
 */
export default function TrialReview() {
  const { trialId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { trial, flights, anchorId, isLoading, error, trialError } = useTrialResults(trialId);

  const [filter, setFilter] = useState('queue');
  const [search, setSearch] = useState('');

  // Only flights whose results have arrived. Coming from the Flights table, the
  // flights are already cached but their plots are still on the way; a flight
  // without them has no summary to show yet (isLoading covers the wait).
  const complete = flights.filter((flight) => flight.status === 'complete' && flight.results);
  const requested = params.get('flight');
  const flightId = complete.some((flight) => flight.id === requested) ? requested : anchorId;
  const flight = complete.find((candidate) => candidate.id === flightId) || null;
  const processing = flights.find((candidate) => candidate.status === 'running');

  const plots = flight?.results?.plots || NONE;
  const summary = flight?.results?.summary;

  // The date before this one with results, to show how each plot's cover moved.
  const earlier = flight ? complete.filter((candidate) => candidate.flightDate < flight.flightDate) : NONE;
  const previousFlight = earlier.reduce((best, candidate) => (!best || candidate.flightDate > best.flightDate ? candidate : best), null);
  const previous = useMemo(
    () => (previousFlight ? new Map(previousFlight.results.plots.map((plot) => [plot.plotId, plot])) : null),
    [previousFlight]
  );
  // The field's median change between the two dates: a plot's change is judged against it.
  const typicalChange = useMemo(() => {
    if (!previous) return null;
    const changes = plots
      .filter((plot) => previous.has(plot.plotId))
      .map((plot) => plot.cover - previous.get(plot.plotId).cover)
      .sort((a, b) => a - b);
    if (!changes.length) return null;
    const mid = Math.floor(changes.length / 2);
    return changes.length % 2 ? changes[mid] : (changes[mid - 1] + changes[mid]) / 2;
  }, [plots, previous]);
  const hasRep = plots.some((plot) => plot.rep != null && plot.rep !== '');

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return plots.filter(
      (plot) =>
        matches(plot, filter) && (!needle || `${plot.plotId} g${plot.genotype} r${plot.row}c${plot.col}`.toLowerCase().includes(needle))
    );
  }, [plots, filter, search]);

  const crumbs = [
    { label: 'Croplytix', to: '/' },
    { label: 'Field Trials', to: '/trials' }
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

  const openReviewer = (plotId) => {
    const query = new URLSearchParams({ flight: flightId });
    if (plotId) query.set('plot', plotId);
    if (filter !== 'queue') query.set('queue', filter);
    navigate(`/trials/${trialId}/review/session?${query.toString()}`);
  };

  const selectFlight = (id) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('flight', id);
      return next;
    });
  };

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      <Grid size={12}>
        <PageHeader
          crumbs={[...crumbs, { label: trial?.name || trialId, to: `/trials/${trialId}` }, { label: 'Review' }]}
          title={trial?.name || 'Loading trial…'}
          subtitle={trialSubtitle(trial)}
          actions={
            summary && summary.pending > 0 ? (
              <Button variant="contained" startIcon={<PlayCircleOutlined />} onClick={() => openReviewer()}>
                Review {summary.pending} plot{summary.pending === 1 ? '' : 's'}
              </Button>
            ) : null
          }
        />
      </Grid>

      <Grid size={12}>
        <TrialTabs trialId={trialId} current="review" flagged={flights.reduce((sum, candidate) => sum + (candidate.flagged || 0), 0)}>
          {error && (
            <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
              Could not load results — {error.message}
            </Alert>
          )}
          {isLoading && <LinearProgress sx={{ height: 2, mb: 2 }} />}

          {!isLoading && !flight && (
            <Stack sx={(theme) => ({ ...NESTED_PANEL_FRAMED(theme), alignItems: 'center', gap: 1.5, py: 8, px: 3 })}>
              <Box sx={{ fontSize: '2rem', color: 'text.disabled', display: 'flex' }}>
                <LoadingOutlined spin={Boolean(processing)} />
              </Box>
              <Typography variant="subtitle1">{processing ? 'Inference is still running' : 'Nothing to review yet'}</Typography>
              <Typography variant="body2" color="text.secondary" align="center" sx={{ maxWidth: 460 }}>
                {processing
                  ? `Flight ${processing.flightDate} is at ${processing.progress}% — flagged plots appear here as soon as the batch finishes.`
                  : 'Upload a flight and run it; the plots the model is least sure about will queue up here.'}
              </Typography>
              {processing && <LinearProgress variant="determinate" value={processing.progress} sx={{ width: 240, height: 4, mt: 1 }} />}
            </Stack>
          )}

          {flight && (
            <Stack sx={{ gap: 2.5 }}>
              {/* ---- flight ---- */}
              <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 300 }}>
                  <InputLabel id="review-flight-label">Flight</InputLabel>
                  <Select
                    labelId="review-flight-label"
                    label="Flight"
                    value={flightId}
                    onChange={(event) => selectFlight(event.target.value)}
                  >
                    {complete.map((candidate) => (
                      <MenuItem key={candidate.id} value={candidate.id}>
                        <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                          <Box component="span" sx={mono}>
                            {candidate.flightDate}
                          </Box>
                          <Typography variant="caption" color="text.secondary">
                            {candidate.captureLabel || candidate.capture} · {candidate.model}
                          </Typography>
                        </Stack>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>

              {/* ---- summary ---- */}
              <Stack direction="row" sx={{ gap: 1.5, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <StatTile
                  label="Needs review"
                  value={summary.pending}
                  hint={`${summary.pendingFlags} flagged · ${summary.pending - summary.pendingFlags} audit`}
                  color={summary.pending ? 'warning.main' : 'success.main'}
                  onClick={() => setFilter('queue')}
                  active={filter === 'queue'}
                />
                <StatTile
                  label="Flagged"
                  value={summary.flaggedTotal}
                  hint="Model asked for a second look"
                  onClick={() => setFilter('flagged')}
                  active={filter === 'flagged'}
                />
                <StatTile
                  label="Audit sample"
                  value={summary.audit}
                  hint="Random auto-passed plots"
                  onClick={() => setFilter('audit')}
                  active={filter === 'audit'}
                />
                <StatTile
                  label="Reviewed"
                  value={summary.accepted + summary.rejected}
                  hint={`${summary.accepted} accepted · ${summary.rejected} rejected`}
                  onClick={() => setFilter('reviewed')}
                  active={filter === 'reviewed'}
                />
                <StatTile
                  label="Mean cover"
                  value={summary.meanCover == null ? '—' : `${summary.meanCover.toFixed(1)}%`}
                  hint="canopy inside each box"
                />
              </Stack>

              {/* ---- filters ---- */}
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
                      borderColor: 'primary.light',
                      '&:hover': { bgcolor: 'primary.lighter' }
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
                  inputProps={{ 'aria-label': 'Find a plot' }}
                  startAdornment={
                    <InputAdornment position="start">
                      <SearchOutlined />
                    </InputAdornment>
                  }
                  sx={{ width: 220 }}
                />
              </Stack>

              {/* ---- the plots ---- */}
              {filter === 'queue' && plots.every((plot) => !matches(plot, 'queue')) ? (
                <Stack sx={(theme) => ({ ...NESTED_PANEL_FRAMED(theme), alignItems: 'center', gap: 1, py: 6 })}>
                  <Typography variant="subtitle1">
                    {summary.flaggedTotal ? 'Every flagged plot is reviewed' : 'Nothing needs review'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {summary.flaggedTotal
                      ? 'Reviewed shows the decisions; All plots shows every plot.'
                      : 'No plot on this flight was flagged. All plots shows every one.'}
                  </Typography>
                </Stack>
              ) : (
                <Stack sx={{ gap: 1 }}>
                  <PlotReviewTable
                    plots={visible}
                    previous={previous}
                    previousDate={previousFlight?.flightDate || null}
                    typicalChange={typicalChange}
                    hasRep={hasRep}
                    onOpen={openReviewer}
                    emptyText="No plots match this filter."
                  />
                  <Typography variant="caption" color="text.secondary" align="right">
                    {visible.length} of {plots.length} plots
                  </Typography>
                </Stack>
              )}
            </Stack>
          )}
        </TrialTabs>
      </Grid>
    </Grid>
  );
}
