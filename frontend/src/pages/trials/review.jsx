import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

// project imports
import PageHeader from 'components/PageHeader';
import StatTile from 'components/StatTile';
import TrialTabs from 'sections/trials/TrialTabs';
import PlotThumb from 'sections/trials/PlotThumb';
import QcChip from 'sections/trials/QcChip';
import { NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';
import { useDemoBundle } from 'api/demo';
import { FLAG_LABELS, useTrialResults } from 'api/results';

// assets
import PlayCircleOutlined from '@ant-design/icons/PlayCircleOutlined';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';

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
 * The triage gallery. Only plots the model was unsure about — plus a small
 * random audit sample of the ones it was sure about — need a human; everything
 * else is already in the trait series. The gallery exists to decide *which*
 * plots get the Reviewer's full-screen attention, not to review them here.
 */
export default function TrialReview() {
  const { trialId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { trial, flights, anchorId, isLoading, error, trialError } = useTrialResults(trialId);
  const { data: bundle } = useDemoBundle();

  const [filter, setFilter] = useState('queue');
  const [reason, setReason] = useState(null);

  const complete = flights.filter((flight) => flight.status === 'complete');
  const requested = params.get('flight');
  const flightId = complete.some((flight) => flight.id === requested) ? requested : anchorId;
  const flight = complete.find((candidate) => candidate.id === flightId) || null;
  const processing = flights.find((candidate) => candidate.status === 'running');

  const plots = flight?.results.plots || NONE;
  const summary = flight?.results.summary;

  const reasons = useMemo(() => {
    const counts = {};
    plots.forEach((plot) => {
      if (plot.flag) counts[plot.flag] = (counts[plot.flag] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [plots]);

  const visible = useMemo(
    () => plots.filter((plot) => matches(plot, filter) && (!reason || plot.flag === reason)),
    [plots, filter, reason]
  );

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
          subtitle={trial ? `${trial.crop} · ${trial.site} · ${trial.plots} plots` : undefined}
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
                <Typography variant="caption" color="text.secondary">
                  {plots.length} plots · {flight.model} · {flight.dap} DAP
                </Typography>
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
                  hint="model asked for a second look"
                  onClick={() => setFilter('flagged')}
                  active={filter === 'flagged'}
                />
                <StatTile
                  label="Audit sample"
                  value={summary.audit}
                  hint="random auto-passed plots"
                  onClick={() => setFilter('audit')}
                  active={filter === 'audit'}
                />
                <StatTile
                  label="Reviewed"
                  value={summary.accepted + summary.rejected}
                  hint={`${summary.edited} corrected · ${summary.rejected} rejected`}
                  onClick={() => setFilter('reviewed')}
                  active={filter === 'reviewed'}
                />
                <StatTile
                  label="Mean cover"
                  value={summary.meanCover == null ? '—' : `${summary.meanCover.toFixed(1)}%`}
                  hint="QC-accepted plots"
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

                {reasons.map(([key, count]) => (
                  <Chip
                    key={key}
                    size="small"
                    clickable
                    label={`${FLAG_LABELS[key]} · ${count}`}
                    onClick={() => setReason(reason === key ? null : key)}
                    sx={{
                      bgcolor: reason === key ? 'warning.lighter' : 'grey.100',
                      color: reason === key ? 'warning.main' : 'text.secondary',
                      borderColor: reason === key ? 'warning.light' : undefined
                    }}
                  />
                ))}

                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {visible.length} of {plots.length} plots · {flight.model}
                </Typography>
              </Stack>

              {/* ---- gallery ---- */}
              {visible.length === 0 ? (
                <Stack sx={(theme) => ({ ...NESTED_PANEL_FRAMED(theme), alignItems: 'center', gap: 1, py: 6 })}>
                  <Typography variant="subtitle1">Nothing here</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {filter === 'queue' ? 'Every flagged plot on this flight has been reviewed.' : 'No plots match this filter.'}
                  </Typography>
                </Stack>
              ) : (
                <Grid container spacing={1.5}>
                  {visible.map((plot) => (
                    <Grid key={plot.plotId} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
                      <Stack
                        onClick={() => openReviewer(plot.plotId)}
                        sx={(theme) => ({
                          ...NESTED_PANEL_FRAMED(theme),
                          p: 1,
                          gap: 0.75,
                          cursor: 'pointer',
                          transition: 'border-color 120ms',
                          '&:hover': { borderColor: 'primary.main' }
                        })}
                      >
                        {bundle && <PlotThumb bundle={bundle} plot={plot.demo} width={176} sx={{ width: '100%', height: 'auto' }} />}
                        <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
                          <Typography variant="subtitle2" sx={mono}>
                            {plot.plotId}
                          </Typography>
                          <Box sx={{ flex: 1 }} />
                          <Typography variant="subtitle2" sx={mono}>
                            {plot.cover.toFixed(1)}%
                          </Typography>
                        </Stack>
                        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
                            G{plot.genotype} · r{plot.row} c{plot.col}
                          </Typography>
                          {!(plot.qc === 'pending' && plot.flag) && (
                            <QcChip
                              qc={plot.qc}
                              edited={plot.decision?.edited}
                              audit={plot.audit}
                              sx={{ height: 18, fontSize: '0.65rem' }}
                            />
                          )}
                        </Stack>
                        <Typography variant="caption" noWrap sx={{ color: plot.flag ? 'warning.main' : 'text.secondary' }}>
                          {plot.flag ? FLAG_LABELS[plot.flag] : `confidence ${plot.confidence.toFixed(2)}`}
                        </Typography>
                      </Stack>
                    </Grid>
                  ))}
                </Grid>
              )}
            </Stack>
          )}
        </TrialTabs>
      </Grid>
    </Grid>
  );
}
