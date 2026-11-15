import PropTypes from 'prop-types';

// material-ui
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';

// project imports
import { FLIGHT_STATUSES } from 'api/trials';
import capitalize from 'utils/capitalize';

const COLORS = {
  awaiting_upload: 'warning',
  uploaded: 'secondary',
  queued: 'secondary',
  running: 'primary',
  complete: 'success',
  failed: 'error'
};

// Statuses whose stored value doesn't read as a word.
const LABELS = { awaiting_upload: 'Uploading' };

// ==============================|| TRIALS - FLIGHT STATUS CHIP ||============================== //

/**
 * The flight record's own status. A status this build does not know yet shows
 * under its own name rather than passing for one it does.
 */
export default function FlightStatusChip({ status, size = 'small', sx }) {
  const color = COLORS[status] || 'secondary';
  return (
    <Tooltip title={FLIGHT_STATUSES[status] || ''}>
      <Chip
        size={size}
        label={LABELS[status] || (status ? capitalize(status) : 'Unknown')}
        sx={{ bgcolor: `${color}.lighter`, color: `${color}.main`, ...sx }}
      />
    </Tooltip>
  );
}

FlightStatusChip.propTypes = {
  status: PropTypes.string,
  size: PropTypes.string,
  sx: PropTypes.object
};
