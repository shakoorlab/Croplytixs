// material-ui
import Typography from '@mui/material/Typography';

// ==============================|| DASHBOARD - FOOTER ||============================== //

export default function Footer() {
  return (
    <Typography variant="caption" component="footer" sx={{ color: 'text.disabled', p: '24px 16px 0px', mt: 'auto' }}>
      &copy; {new Date().getFullYear()} Croplytix
    </Typography>
  );
}
