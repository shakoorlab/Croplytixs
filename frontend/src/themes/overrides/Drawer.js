// project imports
import { CHROME_SURFACE } from '../gradients';

// ==============================|| OVERRIDES - DRAWER ||============================== //

export default function Drawer(theme) {
  return {
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none',
          ...theme.applyStyles('dark', CHROME_SURFACE)
        }
      }
    }
  };
}
