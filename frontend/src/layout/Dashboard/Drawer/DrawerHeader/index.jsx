import PropTypes from 'prop-types';

// project imports
import DrawerHeaderStyled from './DrawerHeaderStyled';
import Logo from 'components/logo';

// ==============================|| DRAWER HEADER ||============================== //

export default function DrawerHeader({ open }) {
  return (
    <DrawerHeaderStyled
      open={open}
      sx={{
        // taller than the 60px toolbar so the lockup can fill its plate; the drawer sits
        // beside the AppBar rather than under it, so nothing has to line up across the seam
        minHeight: '68px',
        width: 'initial',
        paddingTop: '6px',
        paddingBottom: '6px',
        ...(open ? { paddingLeft: '16px', paddingRight: '16px' } : { paddingLeft: 0 })
      }}
    >
      {/* open: plate spans the drawer, artwork sized to fill it. mini: it shrinks around the icon. */}
      <Logo
        isIcon={!open}
        withIcon
        size={open ? 40 : 30}
        sx={open ? { width: '100%', justifyContent: 'flex-start' } : undefined}
      />
    </DrawerHeaderStyled>
  );
}

DrawerHeader.propTypes = { open: PropTypes.bool };
