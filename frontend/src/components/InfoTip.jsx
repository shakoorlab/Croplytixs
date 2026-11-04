import PropTypes from 'prop-types';

// material-ui
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

// assets
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';

// ==============================|| INFO TIP ||============================== //

/**
 * An (i) that explains the thing beside it. The bubble is the card surface —
 * paper, the A800 card border, the z1 float shadow — rather than MUI's grey
 * default, so it reads as part of the page in both schemes.
 *
 * The trigger is a real button: keyboard focus opens it like hover does, and
 * `enterTouchDelay={0}` makes a tap open it on a phone instead of a long press.
 * `describeChild` keeps the button's own label and attaches the bubble as its
 * description, which is what a screen reader should announce.
 */
export default function InfoTip({ title, label = 'More information', placement = 'top', maxWidth = 300 }) {
  return (
    <Tooltip
      title={title}
      placement={placement}
      arrow
      describeChild
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
    >
      <Box
        component="button"
        type="button"
        aria-label={label}
        sx={(theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 0.375,
          border: 0,
          borderRadius: '50%',
          bgcolor: 'transparent',
          color: 'text.secondary',
          fontSize: '0.875rem',
          cursor: 'help',
          '&:hover': { color: 'primary.main' },
          '&:focus-visible': { outline: 'none', color: 'primary.main', boxShadow: theme.vars.customShadows.primary }
        })}
      >
        <InfoCircleOutlined />
      </Box>
    </Tooltip>
  );
}

InfoTip.propTypes = {
  title: PropTypes.node.isRequired,
  label: PropTypes.string,
  placement: PropTypes.string,
  maxWidth: PropTypes.number
};
