import PropTypes from 'prop-types';

// material-ui
import Tooltip from '@mui/material/Tooltip';

// ==============================|| THEMED TOOLTIP ||============================== //

/**
 * MUI's Tooltip drawn as the app's card surface — paper, the A800 card border,
 * the z1 float shadow — rather than its grey default, so it reads as part of the
 * page in both schemes. `enterTouchDelay={0}` opens it on a tap instead of a long
 * press. Anything MUI's Tooltip takes passes through.
 */
export default function ThemedTooltip({ children, maxWidth = 300, ...props }) {
  return (
    <Tooltip
      arrow
      enterTouchDelay={0}
      leaveTouchDelay={8000}
      slotProps={{
        tooltip: {
          sx: (theme) => ({
            bgcolor: 'background.paper',
            color: 'text.primary',
            border: '1px solid',
            borderColor: 'grey.A800',
            borderRadius: 1.5,
            boxShadow: theme.vars.customShadows.z1,
            p: 1.5,
            maxWidth,
            fontSize: '0.75rem',
            fontWeight: 400
          })
        },
        arrow: {
          sx: {
            color: 'background.paper',
            '&::before': { border: '1px solid', borderColor: 'grey.A800' }
          }
        }
      }}
      {...props}
    >
      {children}
    </Tooltip>
  );
}

ThemedTooltip.propTypes = {
  children: PropTypes.element.isRequired,
  title: PropTypes.node.isRequired,
  maxWidth: PropTypes.number
};
