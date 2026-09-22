import { useEffect } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

// project imports
import Logo from 'components/logo';
import BrandPanel from 'sections/auth/BrandPanel';
import LoginForm from 'sections/auth/LoginForm';

// ==============================|| LOGIN ||============================== //

/**
 * The first screen anyone sees. Split in two from `md` up — the field and what the
 * product does on the left, the form on the right — and just the form below that, where
 * the illustration would only push the fields off-screen.
 */
export default function Login() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Sign in · Croplytix';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <Box
      sx={{
        minHeight: '100svh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.12fr) minmax(440px, 1fr)' }
      }}
    >
      <BrandPanel />

      <Box
        component="main"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100svh',
          px: { xs: 3, sm: 6 },
          py: { xs: 3, sm: 5 },
          // a soft light spill from above, echoing the app's backdrop, centred on the form
          backgroundImage: 'radial-gradient(90% 55% at 50% -8%, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0) 70%)'
        }}
      >
        <Box sx={{ display: { xs: 'block', md: 'none' } }}>
          <Logo withIcon size={32} link={false} />
        </Box>

        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', py: { xs: 5, md: 0 } }}>
          <LoginForm />
        </Box>

        <Typography variant="caption" sx={{ display: { xs: 'block', md: 'none' }, color: 'text.disabled' }}>
          &copy; {new Date().getFullYear()} Croplytix
        </Typography>
      </Box>
    </Box>
  );
}
