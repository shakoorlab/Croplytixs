import PropTypes from 'prop-types';

// material-ui
import Chip from '@mui/material/Chip';

const STYLES = {
  pending: { label: 'Needs review', color: 'warning' },
  accepted: { label: 'Accepted', color: 'success' },
  rejected: { label: 'Rejected', color: 'error' },
  passed: { label: 'Auto-passed', color: 'secondary' }
};

// ==============================|| TRIALS - QC STATUS CHIP ||============================== //

export default function QcChip({ qc, edited = false, audit = false, size = 'small', sx }) {
  const style = STYLES[qc] || STYLES.passed;
  let label = style.label;
  if (qc === 'accepted' && edited) label = 'Corrected';
  if (qc === 'pending' && audit) label = 'Audit sample';
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
