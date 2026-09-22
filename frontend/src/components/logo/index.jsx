import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';

// project imports
import Logo from './LogoMain';
import LogoIcon from './LogoIcon';
import { APP_DEFAULT_PATH } from 'config';

// ==============================|| MAIN LOGO ||============================== //

/**
 * The lockup sits on a white pill. The wordmark's "Crop" is a deep forest green that
 * would otherwise disappear against the dark theme's background, and a single backdrop
 * behind the whole lockup keeps one shape: it collapses to a circle when only the icon
 * renders (mini drawer). Padding is >= half the icon's diagonal minus its half-width, so
 * the icon's rounded-square corners stay inside the circle.
 *
 * `link={false}` renders the same plate without the link — for the login screen, where
 * the landing page is not somewhere a signed-out visitor can go yet.
 */
export default function LogoSection({ reverse, isIcon, withIcon, size = 32, sx, to, link = true }) {
  const plate = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 1,
    py: 0.5,
    px: 1,
    borderRadius: '14px',
    bgcolor: 'common.white',
    ...sx
  };
  const artwork = isIcon ? (
    <LogoIcon size={size} />
  ) : (
    <>
      {withIcon && <LogoIcon alt="" size={size} />}
      <Logo reverse={reverse} size={size} />
    </>
  );

  if (!link) return <Box sx={plate}>{artwork}</Box>;

  return (
    <ButtonBase disableRipple component={Link} to={to || APP_DEFAULT_PATH} aria-label="Croplytix home" sx={plate}>
      {artwork}
    </ButtonBase>
  );
}

LogoSection.propTypes = {
  reverse: PropTypes.bool,
  isIcon: PropTypes.bool,
  withIcon: PropTypes.bool,
  size: PropTypes.number,
  sx: PropTypes.any,
  to: PropTypes.any,
  link: PropTypes.bool
};
