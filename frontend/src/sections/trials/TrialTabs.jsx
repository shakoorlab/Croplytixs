import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Chip from '@mui/material/Chip';

// project imports
import MainCard from 'components/MainCard';

const TABS = [
  { key: 'flights', label: 'Flights', path: '' },
  { key: 'review', label: 'Review', path: '/review' },
  { key: 'traits', label: 'Traits', path: '/traits' }
];

// ==============================|| TRIALS - WORKSPACE TABS ||============================== //

/**
 * The trial workspace shell, modelled on crop-studio in traitharvest: a single
 * bordered MainCard holds both the tab strip and the panel below it, so the tabs
 * read as belonging to the content rather than floating above it.
 *
 * The card supplies the border (MainCard draws 1px of grey.A800); the strip adds
 * only its own bottom divider.
 */
export default function TrialTabs({ trialId, current = 'flights', flagged = 0, disableGutters = false, children }) {
  const navigate = useNavigate();
  const index = Math.max(
    TABS.findIndex((tab) => tab.key === current),
    0
  );

  return (
    <MainCard content={false}>
      <Tabs
        value={index}
        onChange={(event, next) => navigate(`/trials/${trialId}${TABS[next].path}`)}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="Trial workspace"
        sx={{
          mt: 2,
          px: 3,
          borderBottom: 1,
          borderColor: 'divider',
          // Accent stays on primary.main. traitharvest uses primary.light there,
          // but its blue ramp puts `light` above `main` in brightness — the Forest
          // Dark leaf ramp runs the other way (light #6cc236 is dimmer than main
          // #8cf542), so borrowing the token would darken the indicator against
          // the dark ground instead of softening it.
          '& .MuiTabs-indicator': {
            backgroundColor: 'primary.main',
            height: 3,
            borderRadius: '3px 3px 0 0'
          }
        }}
      >
        {TABS.map((tab) => (
          <Tab
            key={tab.key}
            id={`trial-tab-${tab.key}`}
            aria-controls={`trial-tabpanel-${tab.key}`}
            sx={{
              fontWeight: 600,
              letterSpacing: '0.01em',
              '&.Mui-selected': { color: 'primary.main' },
              '&:hover': { color: 'primary.main' }
            }}
            label={
              tab.key === 'review' && flagged > 0 ? (
                <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
                  {tab.label}
                  <Chip
                    size="small"
                    label={flagged}
                    sx={{ height: 18, fontSize: '0.7rem', bgcolor: 'warning.lighter', color: 'warning.main' }}
                  />
                </Stack>
              ) : (
                tab.label
              )
            }
          />
        ))}
      </Tabs>

      <Box
        role="tabpanel"
        id={`trial-tabpanel-${TABS[index].key}`}
        aria-labelledby={`trial-tab-${TABS[index].key}`}
        sx={disableGutters ? { py: 0 } : { p: 3 }}
      >
        {children}
      </Box>
    </MainCard>
  );
}

TrialTabs.propTypes = {
  trialId: PropTypes.string.isRequired,
  current: PropTypes.oneOf(['flights', 'review', 'traits']),
  flagged: PropTypes.number,
  disableGutters: PropTypes.bool,
  children: PropTypes.node
};
