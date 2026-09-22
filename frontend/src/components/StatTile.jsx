import PropTypes from 'prop-types';

// material-ui
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// project imports
import { NESTED_PANEL_FRAMED } from 'sections/trials/surfaces';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

// ==============================|| STAT TILE ||============================== //

/**
 * A number with its name and, optionally, the one sentence that makes it
 * honest ("pending" vs "total", "QC-accepted only"). Nested-panel surface so a
 * row of these reads as objects on the workspace card rather than as text.
 */
export default function StatTile({ label, value, hint, color = 'text.primary', onClick, active = false, sx }) {
  return (
    <Stack
      onClick={onClick}
      sx={(theme) => ({
        ...NESTED_PANEL_FRAMED(theme),
        px: 2,
        py: 1.5,
        gap: 0.25,
        minWidth: 120,
        flex: 1,
        ...(onClick && { cursor: 'pointer', '&:hover': { borderColor: 'primary.light' } }),
        ...(active && { borderColor: 'primary.main' }),
        ...(typeof sx === 'function' ? sx(theme) : sx)
      })}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.65rem' }}
      >
        {label}
      </Typography>
      <Typography variant="h4" sx={{ ...mono, color, lineHeight: 1.2 }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Stack>
  );
}

StatTile.propTypes = {
  label: PropTypes.node,
  value: PropTypes.node,
  hint: PropTypes.node,
  color: PropTypes.string,
  onClick: PropTypes.func,
  active: PropTypes.bool,
  sx: PropTypes.oneOfType([PropTypes.object, PropTypes.func])
};
