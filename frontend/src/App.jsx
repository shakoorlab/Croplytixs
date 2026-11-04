import { RouterProvider } from 'react-router-dom';

// material-ui
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';

// project imports
import router from 'routes';
import ThemeCustomization from 'themes';

import ScrollTop from 'components/ScrollTop';

// ==============================|| APP - THEME, ROUTER, LOCAL ||============================== //

/**
 * LocalizationProvider sits at the root so any MUI X date picker works without a
 * wrapper of its own. dayjs is the date library behind them: the smallest of the
 * adapters MUI X supports.
 */
export default function App() {
  return (
    <ThemeCustomization>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <ScrollTop>
          <RouterProvider router={router} />
        </ScrollTop>
      </LocalizationProvider>
    </ThemeCustomization>
  );
}
