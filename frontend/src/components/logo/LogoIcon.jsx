import PropTypes from 'prop-types';

// project imports
import logoIcon from 'assets/images/logo_icon.png';

// ==============================|| LOGO - ICON ||============================== //

export default function LogoIcon({ alt = 'Croplytix', size = 28 }) {
  return <img src={logoIcon} alt={alt} style={{ height: size, width: size, display: 'block' }} />;
}

LogoIcon.propTypes = { alt: PropTypes.string, size: PropTypes.number };
