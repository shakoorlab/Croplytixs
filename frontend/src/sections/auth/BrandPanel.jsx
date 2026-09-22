// material-ui
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// project imports
import Logo from 'components/logo';
import PlotField from './PlotField';
import { CHROME_GRADIENT } from 'themes/gradients';

// assets
import CloudUploadOutlined from '@ant-design/icons/CloudUploadOutlined';
import FlagOutlined from '@ant-design/icons/FlagOutlined';
import LineChartOutlined from '@ant-design/icons/LineChartOutlined';

// ==============================|| AUTH - BRAND PANEL ||============================== //

// The field is scenery; the words are the point. Darken toward the bottom-left, where
// the copy sits, keep the middle of the field bright, and dim the top behind the logo.
const VEIL = [
  'linear-gradient(180deg, rgba(15, 21, 18, 0.50) 0%, rgba(15, 21, 18, 0.12) 26%, rgba(15, 21, 18, 0.72) 60%, rgba(15, 21, 18, 0.97) 100%)',
  'linear-gradient(90deg, rgba(15, 21, 18, 0.55) 0%, rgba(15, 21, 18, 0) 55%)',
  // and soften the edge that meets the form, so the eye is not pulled across the divider
  'linear-gradient(270deg, rgba(15, 21, 18, 0.55) 0%, rgba(15, 21, 18, 0) 32%)'
].join(', ');

// The same three stages the app is built around (ingest → triage → traits).
const STAGES = [
  { label: 'Ingest orthos', icon: <CloudUploadOutlined /> },
  { label: 'Triage flagged plots', icon: <FlagOutlined /> },
  { label: 'Export growth traits', icon: <LineChartOutlined /> }
];

export default function BrandPanel() {
  return (
    <Box
      component="aside"
      aria-label="About Croplytix"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '100svh',
        p: { md: 5, lg: 6 },
        backgroundImage: CHROME_GRADIENT,
        borderRight: '1px solid',
        borderColor: 'divider'
      }}
    >
      <PlotField sx={{ position: 'absolute', inset: 0 }} />
      <Box aria-hidden="true" sx={{ position: 'absolute', inset: 0, backgroundImage: VEIL }} />

      <Box sx={{ position: 'relative' }}>
        <Logo withIcon size={38} link={false} />
      </Box>

      <Stack sx={{ position: 'relative', gap: 2.5, maxWidth: 540 }}>
        <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase' }}>
          UAV canopy analytics
        </Typography>
        <Typography
          component="p"
          variant="h1"
          sx={{ fontSize: { md: '2.625rem', lg: '3.125rem' }, lineHeight: 1.08, letterSpacing: '-0.02em', color: 'text.primary' }}
        >
          Canopy cover,
          <br />
          plot by plot.
        </Typography>
        <Typography sx={{ color: 'grey.600', fontSize: '1rem', lineHeight: 1.6, maxWidth: 460 }}>
          Upload a flight, review only the plots the model flags, and export growth traits for every genotype in the trial.
        </Typography>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
          {STAGES.map((stage) => (
            <Chip
              key={stage.label}
              icon={stage.icon}
              label={stage.label}
              size="small"
              sx={{ color: 'grey.600', '& .MuiChip-icon': { color: 'primary.main', fontSize: '0.8rem', ml: 1 } }}
            />
          ))}
        </Stack>
        <Typography variant="caption" sx={{ color: 'text.disabled', mt: { md: 3, lg: 5 } }}>
          &copy; {new Date().getFullYear()} Croplytix
        </Typography>
      </Stack>
    </Box>
  );
}
