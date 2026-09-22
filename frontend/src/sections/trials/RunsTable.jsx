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

const STATUS = {
  uploaded: { label: 'uploaded', color: 'secondary' },
  complete: { label: 'complete', color: 'success' },
  running: { label: 'running', color: 'primary' },
  queued: { label: 'queued', color: 'secondary' },
  failed: { label: 'failed', color: 'error' }
};

// ==============================|| TRIALS - RUNS TABLE ||============================== //

/**
 * One row per flight. The column that earns its place is "Needs review":
 * a breeder coming back on Monday wants to know how many plots owe them
 * attention, not what percentage of the batch has finished processing.
 */
export default function RunsTable({ runs = [], onOpenRun, onReviewRun, onNewRun }) {
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
            <TableCell>Flight</TableCell>
            <TableCell>Capture</TableCell>
            <TableCell>Source</TableCell>
            <TableCell align="right">Plots</TableCell>
            <TableCell>Model</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Needs review</TableCell>
            <TableCell align="right">Mean cover</TableCell>
            <TableCell align="right" />
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((run) => {
            const status = STATUS[run.status] || STATUS.queued;
            return (
              <TableRow key={run.id} hover onClick={() => onOpenRun?.(run)} sx={{ cursor: onOpenRun ? 'pointer' : 'default' }}>
                <TableCell sx={{ ...mono, fontWeight: 600 }}>{run.flightDate}</TableCell>
                <TableCell sx={mono}>{run.captureLabel || run.capture}</TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {run.source === 'ortho' ? 'ortho + .shp' : 'pre-clipped'}
                  </Typography>
                </TableCell>
                <TableCell sx={mono} align="right">
                  {run.plots}
                </TableCell>
                <TableCell sx={mono}>{run.model}</TableCell>
                <TableCell>
                  <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
                    <Chip size="small" label={status.label} sx={{ bgcolor: `${status.color}.lighter`, color: `${status.color}.main` }} />
                    {run.status === 'failed' && run.error && (
                      <Tooltip title={run.error}>
                        <Box sx={{ display: 'flex', color: 'error.main', fontSize: '0.8rem' }}>
                          <WarningOutlined />
                        </Box>
                      </Tooltip>
                    )}
                  </Stack>
                  {run.status === 'running' && (
                    <LinearProgress variant="determinate" value={run.progress} sx={{ mt: 0.75, width: 84, height: 3 }} />
                  )}
                </TableCell>
                <TableCell>
                  {run.flagged == null ? (
                    <Typography variant="caption" color="text.disabled">
                      —
                    </Typography>
                  ) : run.flagged > 0 ? (
                    <Chip size="small" label={`${run.flagged} flagged`} sx={{ bgcolor: 'warning.lighter', color: 'warning.main' }} />
                  ) : (
                    <Typography variant="caption" color="success.main">
                      clear
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={mono} align="right">
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
  onOpenRun: PropTypes.func,
  onReviewRun: PropTypes.func,
  onNewRun: PropTypes.func
};
