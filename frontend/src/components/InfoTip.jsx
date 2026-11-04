import PropTypes from 'prop-types';

// material-ui
import Box from '@mui/material/Box';

// project imports
import ThemedTooltip from 'components/ThemedTooltip';

// assets
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';

// ==============================|| INFO TIP ||============================== //

/**
 * An (i) that explains the thing beside it, in the app's themed tooltip.
 *
 * The trigger is a real button: keyboard focus opens it like hover does, and a
 * tap opens it on a phone. `describeChild` keeps the button's own label and
 * attaches the bubble as its description, which is what a screen reader should
 * announce.
 */
export default function InfoTip({ title, label = 'More information', placement = 'top', maxWidth = 300 }) {
  return (
    <ThemedTooltip title={title} placement={placement} maxWidth={maxWidth} describeChild>
      <Box
        component="button"
        type="button"
        aria-label={label}
        sx={(theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 0.25,
          border: 0,
          borderRadius: '50%',
          bgcolor: 'transparent',
          color: 'text.secondary',
          fontSize: '0.75rem',
          cursor: 'help',
          '&:hover': { color: 'primary.main' },
          '&:focus-visible': { outline: 'none', color: 'primary.main', boxShadow: theme.vars.customShadows.primary }
        })}
      >
        <InfoCircleOutlined />
      </Box>
    </ThemedTooltip>
  );
}

InfoTip.propTypes = {
  title: PropTypes.node.isRequired,
  label: PropTypes.string,
  placement: PropTypes.string,
  maxWidth: PropTypes.number
};
