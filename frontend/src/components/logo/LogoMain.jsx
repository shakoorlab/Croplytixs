import PropTypes from 'prop-types';

// project imports
import logo from 'assets/images/logo.png';

// ==============================|| LOGO - MAIN ||============================== //

export default function LogoMain({ size = 28 }) {
  return <img src={logo} alt="Croplytix" style={{ height: size, width: 'auto', display: 'block' }} />;
}

LogoMain.propTypes = { size: PropTypes.number };
