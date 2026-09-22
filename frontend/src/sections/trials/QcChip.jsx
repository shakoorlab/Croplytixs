import PropTypes from 'prop-types';

// material-ui
import Chip from '@mui/material/Chip';

const STYLES = {
  pending: { label: 'needs review', color: 'warning' },
  accepted: { label: 'accepted', color: 'success' },
  rejected: { label: 'rejected', color: 'error' },
  passed: { label: 'auto-passed', color: 'secondary' }
};

// ==============================|| TRIALS - QC STATUS CHIP ||============================== //

export default function QcChip({ qc, edited = false, audit = false, size = 'small', sx }) {
  const style = STYLES[qc] || STYLES.passed;
  let label = style.label;
  if (qc === 'accepted' && edited) label = 'corrected';
  if (qc === 'pending' && audit) label = 'audit sample';
  return (
    <Chip
      size={size}
      label={label}
      sx={{ bgcolor: `${style.color}.lighter`, color: `${style.color}.main`, ...(qc === 'passed' && { color: 'text.secondary' }), ...sx }}
    />
  );
}

QcChip.propTypes = {
  qc: PropTypes.oneOf(['pending', 'accepted', 'rejected', 'passed']),
  edited: PropTypes.bool,
  audit: PropTypes.bool,
  size: PropTypes.string,
  sx: PropTypes.object
};
