import PropTypes from 'prop-types';
import { useState } from 'react';

// material-ui
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';

// project imports
import { rerunIngest } from 'api/trials';
import { formatBytes } from 'sections/trials/flight-setup/utils';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };

const LABEL = {
  queued: 'queued',
  running: 'building…',
  complete: 'ready',
  failed: 'failed'
};

// ==============================|| TRIALS - MAP COPIES (INGEST) ||============================== //

/**
 * What ingest has made of the flight's ortho: a lossless COG for the jobs and
 * a small viewing COG for the map (backend/app/ingest.py). The page does not
 * poll — every read is a Firestore read — so a build in progress offers a
 * Refresh instead; a failed or missing build offers to run it again.
 */
export default function MapCopies({ trialId, flight, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const ingest = flight.ingest;
  const inFlight = ingest && ['queued', 'running'].includes(ingest.state);

  const rebuild = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await rerunIngest(trialId, flight.id);
      await onChanged();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const action = (label, onClick) => (
    <Link component="button" type="button" variant="caption" underline="hover" onClick={onClick} disabled={busy} sx={{ ml: 1 }}>
      {busy ? 'starting…' : label}
    </Link>
  );

  const raster = ingest?.raster;
  return (
    <Stack sx={{ gap: 0.25 }}>
      <Typography variant="body2" component="div">
        {ingest ? LABEL[ingest.state] || ingest.state : 'not built'}
        {inFlight && action('Refresh', () => onChanged())}
        {(!ingest || ingest.state === 'failed') && action(ingest ? 'Retry' : 'Build', rebuild)}
      </Typography>
      {ingest?.state === 'complete' && (
        <>
          <Typography variant="caption" color="text.secondary" sx={mono}>
            view · {formatBytes(ingest.view.bytes)} {ingest.view.compression} · lossless · {formatBytes(ingest.cog.bytes)}
          </Typography>
          {raster && (
            <Typography variant="caption" color="text.secondary">
              {[
                `${raster.width} × ${raster.height} px`,
                `${raster.bandCount}-band ${raster.dtype}`,
                raster.crs,
                raster.gsdCm && `${raster.gsdCm} cm/px`
              ]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
          )}
        </>
      )}
      {ingest?.state === 'failed' && ingest.error && (
        <Typography variant="caption" color="error.main">
          {ingest.error}
        </Typography>
      )}
      {actionError && (
        <Typography variant="caption" color="error.main" role="alert">
          Couldn’t start the build: {actionError}
        </Typography>
      )}
    </Stack>
  );
}

MapCopies.propTypes = {
  trialId: PropTypes.string.isRequired,
  flight: PropTypes.object.isRequired,
  onChanged: PropTypes.func.isRequired
};
