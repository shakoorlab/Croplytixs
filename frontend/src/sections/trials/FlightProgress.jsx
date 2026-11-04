import PropTypes from 'prop-types';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';

// project imports
import { NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';
import formatRelative from 'utils/formatRelative';

// Each stage is done, active (working on it), waiting (its turn, not started) or failed.
const MAP_COPIES = {
  queued: { state: 'waiting', detail: 'Queued' },
  running: { state: 'active', detail: 'Building…' },
  complete: { state: 'done', detail: 'Ready' },
  failed: { state: 'error', detail: 'Failed · retry above' }
};

const PROCESSING = {
  uploaded: { state: 'waiting', detail: 'Waiting for the processing worker' },
  queued: { state: 'waiting', detail: 'Queued' },
  complete: { state: 'done', detail: 'Complete' },
  failed: { state: 'error', detail: 'Failed' }
};

/**
 * The flight's stages, each read straight off the record: the upload itself,
 * ingest's map copies (ortho flights only), processing, then results. Nothing
 * here is estimated — a stage that hasn't started says so.
 */
export function flightStages(flight) {
  const stages = [{ key: 'upload', label: 'Uploaded', state: 'done', detail: formatRelative(flight.createdAt) }];
  if (flight.source === 'ortho') {
    stages.push({ key: 'copies', label: 'Map copies', ...(MAP_COPIES[flight.ingest?.state] || { state: 'waiting', detail: 'Not built' }) });
  }
  stages.push({
    key: 'processing',
    label: 'Processing',
    ...(flight.status === 'running'
      ? { state: 'active', detail: `${flight.progress || 0}% done` }
      : PROCESSING[flight.status] || { state: 'waiting', detail: flight.status })
  });
  stages.push({
    key: 'results',
    label: 'Results',
    state: flight.status === 'complete' ? 'done' : 'waiting',
    detail: flight.status === 'complete' ? 'Ready to review' : 'After processing'
  });
  return stages;
}

const DETAIL_COLOR = { done: 'success.main', active: 'primary.main', waiting: 'text.secondary', error: 'error.main' };

// ==============================|| TRIALS - FLIGHT PROGRESS ||============================== //

/**
 * Where a flight is on its way to results, shown while it has none to list.
 * The bar fills by completed stages and, while processing runs, by the
 * progress the worker reports — so it moves only when something really has.
 */
export default function FlightProgress({ flight }) {
  const stages = flightStages(flight);
  const done = stages.filter((stage) => stage.state === 'done').length;
  const withinProcessing = flight.status === 'running' ? (flight.progress || 0) / 100 : 0;
  const percent = Math.round(((done + withinProcessing) / stages.length) * 100);
  const currentIndex = stages.findIndex((stage) => stage.state !== 'done');
  const current = currentIndex === -1 ? null : stages[currentIndex];
  const failed = stages.some((stage) => stage.state === 'error');

  let explanation =
    'Per-plot masks, fractional cover and canopy area appear here when processing finishes. There’s nothing to do until then.';
  if (flight.status === 'failed') explanation = flight.error || 'Processing failed. No error detail was recorded.';
  else if (flight.ingest?.state === 'failed') explanation = 'The map copies couldn’t be built. Use Retry in the Progress box above.';
  else if (flight.status === 'complete')
    explanation = 'Processing is complete. Per-plot results will be listed here once the API serves them.';

  return (
    <Box sx={(theme) => ({ ...NESTED_PANEL_FRAMED(theme), px: { xs: 2, md: 3 }, py: { xs: 2.5, md: 3 } })}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1">
          {current ? `Step ${currentIndex + 1} of ${stages.length}: ${current.label}` : 'All steps complete'}
          {current && (
            <Typography component="span" variant="body2" sx={{ ml: 1, color: DETAIL_COLOR[current.state] }}>
              {current.detail}
            </Typography>
          )}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {percent}% complete
        </Typography>
      </Stack>

      <LinearProgress
        variant="determinate"
        value={percent}
        color={failed ? 'error' : 'primary'}
        aria-label={`Flight progress, ${percent}% complete`}
        sx={{ height: 8, borderRadius: 4, mt: 1.5, mb: 3 }}
      />

      <Stepper alternativeLabel activeStep={currentIndex === -1 ? stages.length : currentIndex}>
        {stages.map((stage) => (
          <Step key={stage.key} completed={stage.state === 'done'}>
            <StepLabel
              error={stage.state === 'error'}
              optional={
                <Typography variant="caption" component="div" sx={{ color: DETAIL_COLOR[stage.state] }}>
                  {stage.detail}
                </Typography>
              }
            >
              {stage.label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>

      <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 3, maxWidth: 560, mx: 'auto' }}>
        {explanation}
      </Typography>
    </Box>
  );
}

FlightProgress.propTypes = { flight: PropTypes.object.isRequired };
