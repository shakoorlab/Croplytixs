import PropTypes from 'prop-types';

// material-ui
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';

// project imports
import { FLIGHT_STATUSES } from 'api/trials';

const COLORS = {
  uploaded: 'secondary',
  queued: 'secondary',
  running: 'primary',
  complete: 'success',
  failed: 'error'
};

// ==============================|| TRIALS - FLIGHT STATUS CHIP ||============================== //

/**
 * The flight record's own status. A status this build does not know yet shows
 * under its own name rather than passing for one it does.
 */
export default function FlightStatusChip({ status, size = 'small', sx }) {
  const color = COLORS[status] || 'secondary';
  return (
    <Tooltip title={FLIGHT_STATUSES[status] || ''}>
      <Chip size={size} label={status || 'unknown'} sx={{ bgcolor: `${color}.lighter`, color: `${color}.main`, ...sx }} />
    </Tooltip>
  );
}

FlightStatusChip.propTypes = {
  status: PropTypes.string,
  size: PropTypes.string,
  sx: PropTypes.object
};
