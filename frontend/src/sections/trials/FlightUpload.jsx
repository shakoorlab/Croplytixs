import PropTypes from 'prop-types';
import { useRef, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import LinearProgress from '@mui/material/LinearProgress';

// project imports
import { canRetryInPlace, cancelFlightUpload, hasSavedUpload, resumeFlightUpload, retryFlightUpload, useFlightUpload } from 'api/uploads';
import { formatBytes } from 'sections/trials/flight-setup/utils';

const ACCEPT = '.tif,.tiff,.zip,.shp,.shx,.dbf,.prj,.cpg';

const percentOf = (upload) => (upload?.total ? Math.min(100, Math.round((upload.loaded / upload.total) * 100)) : 0);

/** What an upload in this tab is doing, in a word or two — or where one stands that this tab isn't running. */
export function uploadLabel(upload) {
  if (!upload) return 'Upload incomplete';
  if (upload.state === 'completing') return 'Finishing upload';
  if (upload.state === 'paused') return 'Upload paused';
  if (upload.state === 'failed') return 'Upload failed';
  return `Uploading ${percentOf(upload)}%`;
}

// ==============================|| TRIALS - FLIGHT UPLOAD STATUS (table cell) ||============================== //

/** The Flights table's status cell for a flight whose files are still on their way. */
export function FlightUploadStatus({ flightId }) {
  const upload = useFlightUpload(flightId);
  const stuck = !upload || upload.state === 'paused' || upload.state === 'failed';
  const label = uploadLabel(upload);
  return (
    <Stack sx={{ alignItems: 'center', gap: 0.75 }}>
      <Tooltip title={stuck ? 'Open the flight to resume or cancel this upload.' : 'Keep this tab open until it finishes.'}>
        <Chip
          size="small"
          label={label}
          sx={{ bgcolor: stuck ? 'warning.lighter' : 'primary.lighter', color: stuck ? 'warning.main' : 'primary.main' }}
        />
      </Tooltip>
      {upload?.state === 'uploading' && (
        <LinearProgress variant="determinate" value={percentOf(upload)} aria-label={label} sx={{ width: 84, height: 3 }} />
      )}
      {upload?.state === 'completing' && <LinearProgress aria-label={label} sx={{ width: 84, height: 3 }} />}
    </Stack>
  );
}

FlightUploadStatus.propTypes = { flightId: PropTypes.string.isRequired };

// ==============================|| TRIALS - FLIGHT UPLOAD CONTROLS (flight page) ||============================== //

/**
 * The flight page's view of an unfinished upload: its progress while this tab
 * runs it; Resume after a dropped connection; after a reload, a file picker to
 * carry on from where storage stopped; and Cancel throughout.
 */
export default function FlightUploadControls({ trialId, flight, onCancelled }) {
  const upload = useFlightUpload(flight.id);
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const act = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resume = (fileList) => act(() => resumeFlightUpload(trialId, flight, Array.from(fileList)));
  const cancel = () =>
    act(async () => {
      await cancelFlightUpload(trialId, flight.id);
      onCancelled?.();
    });

  const cancelControl = confirming ? (
    <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
      <Typography variant="caption">Cancel it and delete what has arrived?</Typography>
      <Button size="small" color="error" variant="outlined" disabled={busy} onClick={cancel}>
        Yes, cancel upload
      </Button>
      <Button size="small" color="secondary" disabled={busy} onClick={() => setConfirming(false)}>
        Keep it
      </Button>
    </Stack>
  ) : (
    <Button size="small" color="secondary" disabled={busy} onClick={() => setConfirming(true)}>
      Cancel upload
    </Button>
  );

  let body;
  if (upload?.state === 'uploading' || upload?.state === 'completing') {
    const completing = upload.state === 'completing';
    body = (
      <>
        <LinearProgress
          variant={completing ? 'indeterminate' : 'determinate'}
          value={percentOf(upload)}
          aria-label={uploadLabel(upload)}
          sx={{ height: 4, borderRadius: 2 }}
        />
        <Typography variant="caption" color="text.secondary" component="div">
          {completing
            ? 'Checking every file arrived…'
            : `${formatBytes(upload.loaded)} of ${formatBytes(upload.total)}${upload.current ? ` · ${upload.current}` : ''}`}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          Keep this tab open until it finishes. If it closes, you can resume here.
        </Typography>
      </>
    );
  } else if (upload) {
    body = (
      <>
        <Typography variant="caption" color={upload.state === 'paused' ? 'warning.main' : 'error.main'} component="div">
          {upload.error}
        </Typography>
        {canRetryInPlace(flight.id) && (
          <Box>
            <Button size="small" variant="contained" disabled={busy} onClick={() => retryFlightUpload(flight.id)}>
              {upload.state === 'paused' ? 'Resume' : 'Try again'}
            </Button>
          </Box>
        )}
      </>
    );
  } else {
    body = (
      <>
        <Typography variant="body2">This upload didn’t finish.</Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          Choose the same files again to finish it
          {hasSavedUpload(flight.id) ? '; it carries on from what storage already has.' : '. Files that already arrived are skipped.'}
        </Typography>
        <Box>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(event) => {
              // Copy first: the FileList is live, and clearing the input (so the same
              // files can be picked again after an error) empties it.
              const files = Array.from(event.target.files);
              event.target.value = '';
              if (files.length) resume(files);
            }}
          />
          <Button size="small" variant="contained" disabled={busy} onClick={() => input.current?.click()}>
            Choose files…
          </Button>
        </Box>
      </>
    );
  }

  return (
    <Stack sx={{ gap: 0.75 }}>
      {body}
      {error && (
        <Typography variant="caption" color="error.main" role="alert" component="div">
          {error}
        </Typography>
      )}
      <Box>{cancelControl}</Box>
    </Stack>
  );
}

FlightUploadControls.propTypes = {
  trialId: PropTypes.string.isRequired,
  flight: PropTypes.object.isRequired,
  onCancelled: PropTypes.func
};
