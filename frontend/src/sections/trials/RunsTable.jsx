import PropTypes from 'prop-types';

// material-ui
import Box from '@mui/material/Box';
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
import LinearProgress from '@mui/material/LinearProgress';

// project imports
import FlightStatusChip from 'sections/trials/FlightStatusChip';
import { FlightUploadStatus } from 'sections/trials/FlightUpload';

// assets
import CloudUploadOutlined from '@ant-design/icons/CloudUploadOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import WarningOutlined from '@ant-design/icons/WarningOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };

// The table frames itself so the empty state and the populated state share one
// outline, rather than the border living in whichever page happens to render it.
//
// It is not wrapped in a MainCard, so it has to carry the same `card` elevation
// by hand — otherwise this is the one full-width surface on the page still lying
// flat while everything around it lifts. A callback, because the shadow resolves
// per colour scheme.
const frame = (theme) => ({
  border: '1px solid',
  borderColor: 'grey.A800',
  borderRadius: 1,
  overflow: 'hidden',
  boxShadow: theme.vars.customShadows.card,
  // the frame supplies the closing line; the last row shouldn't draw its own
  '& tbody tr:last-of-type td': { borderBottom: 0 }
});

/** What a flight was made from, as the table shows it. Older flights may be pre-clipped images. */
export function sourceLabel(flight) {
  if (flight.source !== 'ortho') return 'Pre-clipped';
  return flight.files?.some((file) => file.role === 'shapefile') || flight.shapefile ? 'Ortho + .shp' : 'Ortho';
}

// ==============================|| TRIALS - RUNS TABLE ||============================== //

/**
 * One row per flight. The column that earns its place is "Needs review":
 * a breeder coming back on Monday wants to know how many plots owe them
 * attention, not what percentage of the batch has finished processing.
 */
export default function RunsTable({ runs = [], highlightId = null, onOpenRun, onReviewRun, onNewRun }) {
  if (!runs.length) {
    return (
      <Stack sx={(theme) => ({ ...frame(theme), alignItems: 'center', gap: 1.5, py: 8, px: 3 })}>
        <Box sx={{ fontSize: '2rem', color: 'text.disabled', display: 'flex' }}>
          <CloudUploadOutlined />
        </Box>
        <Typography variant="subtitle1">No flights yet</Typography>
        <Typography variant="body2" color="text.secondary" align="center" sx={{ maxWidth: 420 }}>
          A flight is one capture date: an orthophoto and its plot shapefile, clipped and segmented. Upload the first one to start building
          this trial&apos;s growth curves.
        </Typography>
        <Button variant="contained" startIcon={<PlusOutlined />} onClick={onNewRun} sx={{ mt: 1 }}>
          Upload imagery
        </Button>
      </Stack>
    );
  }

  return (
    <TableContainer sx={frame}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell align="center">Flight</TableCell>
            <TableCell align="center">Capture</TableCell>
            <TableCell align="center">Source</TableCell>
            <TableCell align="center">Plots</TableCell>
            <TableCell align="center">Model</TableCell>
            <TableCell align="center">Status</TableCell>
            <TableCell align="center">Needs review</TableCell>
            <TableCell align="center">Mean cover</TableCell>
            <TableCell align="right" />
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((run) => {
            return (
              <TableRow
                key={run.id}
                hover
                selected={run.id === highlightId}
                onClick={() => onOpenRun?.(run)}
                sx={{ cursor: onOpenRun ? 'pointer' : 'default' }}
              >
                <TableCell align="center" sx={{ ...mono, fontWeight: 600 }}>
                  {run.flightDate}
                </TableCell>
                <TableCell align="center" sx={mono}>
                  {run.captureLabel || run.capture}
                </TableCell>
                <TableCell align="center">
                  <Typography variant="caption" color="text.secondary">
                    {sourceLabel(run)}
                  </Typography>
                </TableCell>
                <TableCell sx={mono} align="center">
                  {run.plots}
                </TableCell>
                <TableCell sx={mono} align="center">
                  {run.model || (
                    <Typography variant="caption" color="text.disabled">
                      Not chosen
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="center">
                  <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', justifyContent: 'center' }}>
                    {run.status === 'awaiting_upload' ? <FlightUploadStatus flightId={run.id} /> : <FlightStatusChip status={run.status} />}
                    {run.status === 'failed' && run.error && (
                      <Tooltip title={run.error}>
                        <Box sx={{ display: 'flex', color: 'error.main', fontSize: '0.8rem' }}>
                          <WarningOutlined />
                        </Box>
                      </Tooltip>
                    )}
                  </Stack>
                  {run.status === 'running' && (
                    <LinearProgress variant="determinate" value={run.progress} sx={{ mt: 0.75, mx: 'auto', width: 84, height: 3 }} />
                  )}
                </TableCell>
                <TableCell align="center">
                  {run.flagged == null ? (
                    <Typography variant="caption" color="text.disabled">
                      —
                    </Typography>
                  ) : run.flagged > 0 ? (
                    <Chip size="small" label={`${run.flagged} flagged`} sx={{ bgcolor: 'warning.lighter', color: 'warning.main' }} />
                  ) : (
                    <Typography variant="caption" color="success.main">
                      Clear
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={mono} align="center">
                  {run.meanCover == null ? '—' : `${run.meanCover.toFixed(1)}%`}
                </TableCell>
                <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                  {run.status === 'complete' && (
                    <Button size="small" color={run.flagged > 0 ? 'primary' : 'secondary'} onClick={() => onReviewRun?.(run)}>
                      {run.flagged > 0 ? 'Review' : 'View'}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

RunsTable.propTypes = {
  runs: PropTypes.array,
  highlightId: PropTypes.string,
  onOpenRun: PropTypes.func,
  onReviewRun: PropTypes.func,
  onNewRun: PropTypes.func
};
