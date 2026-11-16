import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// project imports
import { apiBlob, apiDownload } from 'api/client';
import { flightsKey, processFlight } from 'api/trials';
import { NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';
import formatRelative from 'utils/formatRelative';

// assets
import DownloadOutlined from '@ant-design/icons/DownloadOutlined';
import PlayCircleOutlined from '@ant-design/icons/PlayCircleOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';

const resultsBase = (trialId, flightId) => `${flightsKey(trialId)}/${flightId}/results`;

// ==============================|| TRIALS - FLIGHT PROCESSING ||============================== //

/**
 * Where processing stands for one flight, and the one thing to do about it:
 * process it, try again, or run it again as a new version. Shows the result
 * being viewed (version, model, when) and lets an older version be picked.
 *
 * Ingest starts processing by itself for a flight with a plot grid, so most
 * flights never need the button; it is for a failure, a rerun, and flights
 * uploaded before processing existed.
 */
export default function FlightProcessing({ trialId, flight, results, versions = [], onVersionChange, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const processing = flight.processing;
  const state = processing?.state;
  const hasGrid = (flight.files || []).some((file) => file.role === 'shapefile');
  const ingestReady = flight.ingest?.state === 'complete';
  const working = state === 'queued' || state === 'running';

  const run = async (force = false) => {
    setBusy(true);
    setError(null);
    try {
      await processFlight(trialId, flight.id, { force });
      onVersionChange?.(null); // follow the new version when it lands
      await onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = async () => {
    setError(null);
    try {
      await apiDownload(
        `${resultsBase(trialId, flight.id)}/csv?version=${results.version}`,
        `${trialId}_${flight.flightDate}_canopy_v${results.version}.csv`
      );
    } catch (err) {
      setError(`Couldn’t download the CSV: ${err.message}`);
    }
  };

  let status = null;
  let action = null;
  if (working) {
    const percent = state === 'running' ? flight.progress || 0 : 0;
    status = (
      <Stack sx={{ gap: 0.75, flex: 1, minWidth: 240 }}>
        <Typography variant="body2">
          {state === 'queued'
            ? `Processing version ${processing.version} is queued.`
            : `Processing version ${processing.version}: ${processing.stage || 'working'}… ${percent}%`}
        </Typography>
        <LinearProgress
          variant={state === 'running' ? 'determinate' : 'indeterminate'}
          value={percent}
          aria-label="Processing progress"
          sx={{ height: 4, borderRadius: 2 }}
        />
      </Stack>
    );
  } else if (!hasGrid) {
    status = (
      <Typography variant="body2" color="text.secondary">
        This flight has no plot grid, so canopy can’t be measured per plot. Upload the date’s shapefile with the ortho to process it.
      </Typography>
    );
  } else if (!ingestReady) {
    status = (
      <Typography variant="body2" color="text.secondary">
        Processing starts by itself once the map copies are built.
      </Typography>
    );
  } else if (!flight.result) {
    status = (
      <Typography variant="body2" color={state === 'failed' ? 'error.main' : 'text.secondary'}>
        {state === 'failed' ? processing.error || flight.error || 'Processing failed.' : 'This flight hasn’t been processed yet.'}
      </Typography>
    );
    action = (
      <Button
        variant="contained"
        startIcon={state === 'failed' ? <ReloadOutlined /> : <PlayCircleOutlined />}
        disabled={busy}
        onClick={() => run()}
      >
        {state === 'failed' ? 'Try again' : 'Process flight'}
      </Button>
    );
  } else {
    action = (
      <Button color="secondary" startIcon={<ReloadOutlined />} disabled={busy} onClick={() => run()}>
        Run again
      </Button>
    );
  }

  const isCurrent = results?.version === flight.result?.version;
  return (
    <Box sx={(theme) => ({ ...NESTED_PANEL_FRAMED(theme), px: 2, py: 1.5 })}>
      <Stack direction="row" sx={{ gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        {results && (
          <Stack sx={{ gap: 0.25, mr: 'auto' }}>
            <Typography variant="subtitle2">
              Canopy per plot · version {results.version}
              {!isCurrent && ' (not the current version)'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {results.model?.label} · {formatRelative(results.createdAt)}
              {results.field?.factor > 1 && ` · read at ${results.field.gsdCm.toFixed(1)} cm`}
            </Typography>
          </Stack>
        )}
        {status && <Box sx={{ flex: 1, minWidth: 240, mr: results ? 0 : 'auto' }}>{status}</Box>}
        {versions.length > 1 && (
          <Select
            size="small"
            value={results.version}
            onChange={(event) => onVersionChange?.(event.target.value === flight.result?.version ? null : event.target.value)}
            SelectDisplayProps={{ 'aria-label': 'Result version' }}
            sx={{ minWidth: 150 }}
          >
            {versions.map((option) => (
              <MenuItem key={option.version} value={option.version}>
                Version {option.version}
                {option.current ? ' · current' : ''}
              </MenuItem>
            ))}
          </Select>
        )}
        {results && (
          <Button color="secondary" startIcon={<DownloadOutlined />} onClick={downloadCsv}>
            CSV
          </Button>
        )}
        {action}
      </Stack>
      {state === 'failed' && flight.result && (
        <Alert severity="error" variant="outlined" sx={{ mt: 1.5 }}>
          The latest run (version {processing.version}) failed: {processing.error || flight.error} Version {flight.result.version} is still
          the current result.
        </Alert>
      )}
      {results?.warnings?.length > 0 && (
        <Alert severity="info" variant="outlined" sx={{ mt: 1.5 }}>
          {results.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </Alert>
      )}
      {error && (
        <Typography variant="caption" color="error.main" role="alert" component="div" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}

FlightProcessing.propTypes = {
  trialId: PropTypes.string.isRequired,
  flight: PropTypes.object.isRequired,
  results: PropTypes.object,
  versions: PropTypes.array,
  onVersionChange: PropTypes.func,
  onChanged: PropTypes.func
};

// ==============================|| TRIALS - FIELD OVERLAY ||============================== //

/**
 * The result's picture of the field: each plot's canopy in its own colour,
 * canopy no plot reached in grey, plot boxes in red. Fetched with the token
 * (an <img> can't send it) and shown from a blob URL, released on unmount.
 */
export function FieldOverlay({ trialId, flightId, version }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    setUrl(null);
    setError(null);
    apiBlob(`${resultsBase(trialId, flightId)}/overlay?version=${version}`)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [trialId, flightId, version]);

  return (
    <Box sx={(theme) => ({ ...NESTED_PANEL_FRAMED(theme), p: 1.5 })}>
      {error ? (
        <Typography variant="body2" color="error.main" sx={{ p: 2 }}>
          Couldn’t load the field picture — {error}
        </Typography>
      ) : url ? (
        <Box
          component="a"
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Open full size"
          sx={{ display: 'block', lineHeight: 0, borderRadius: 1, overflow: 'hidden' }}
        >
          <Box
            component="img"
            src={url}
            alt={`Field overlay, version ${version}: each plot's canopy in its own colour, plot boxes in red`}
            sx={{ width: '100%', height: 'auto', maxHeight: 640, objectFit: 'contain', bgcolor: 'common.black' }}
          />
        </Box>
      ) : (
        <Skeleton variant="rectangular" height={360} sx={{ borderRadius: 1 }} />
      )}
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
        Each plot’s canopy is in its own colour, including what grew past its box. Grey canopy reached no plot (weeds, border grass, or past
        the reach limit). Plot boxes are red, blank boxes grey.
      </Typography>
    </Box>
  );
}

FieldOverlay.propTypes = {
  trialId: PropTypes.string.isRequired,
  flightId: PropTypes.string.isRequired,
  version: PropTypes.number.isRequired
};
