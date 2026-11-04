import PropTypes from 'prop-types';

// material-ui
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';

// project imports
import { LIFECYCLE } from 'api/models';
import capitalize from 'utils/capitalize';

const COLORS = {
  draft: 'secondary',
  trained: 'secondary',
  evaluated: 'info',
  candidate: 'warning',
  production: 'success',
  archived: 'secondary'
};

// ==============================|| MODELS - LIFECYCLE CHIP ||============================== //

/** draft → trained → evaluated → candidate → production → archived, always in that order. */
export default function LifecycleChip({ status, size = 'small', sx }) {
  const color = COLORS[status] || 'secondary';
  const index = LIFECYCLE.indexOf(status);
  return (
    <Tooltip title={index >= 0 ? `Lifecycle: ${LIFECYCLE.map((step, i) => (i === index ? `[${step}]` : step)).join(' → ')}` : ''}>
      <Chip
        size={size}
        label={capitalize(status)}
        sx={{
          bgcolor: `${color}.lighter`,
          color: `${color}.main`,
          ...(status === 'archived' && { color: 'text.disabled' }),
          ...(status === 'production' && { fontWeight: 600 }),
          ...sx
        }}
      />
    </Tooltip>
  );
}

LifecycleChip.propTypes = {
  status: PropTypes.string.isRequired,
  size: PropTypes.string,
  sx: PropTypes.object
};
