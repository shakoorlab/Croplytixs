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

export const MODEL_TABS = [
  { key: 'registry', label: 'Registry', path: '' },
  { key: 'labels', label: 'Label pool', path: '/labels' },
  { key: 'runs', label: 'Training runs', path: '/runs' },
  { key: 'benchmark', label: 'Benchmark', path: '/benchmark' }
];

// ==============================|| MODELS - WORKSPACE TABS ||============================== //

/**
 * The back-of-house workspace shell. Same tabbed-card pattern as TrialTabs so
 * the ML engineer's area needs nothing new to learn — but it is its own area,
 * not a tab inside a trial: training data is cross-trial by nature, and a
 * "retrain" button next to a breeder's export button invites accidents.
 */
export default function ModelsTabs({ current = 'registry', counts = {}, disableGutters = false, children }) {
  const navigate = useNavigate();
  const index = Math.max(
    MODEL_TABS.findIndex((tab) => tab.key === current),
    0
  );

  return (
    <MainCard content={false}>
      <Tabs
        value={index}
        onChange={(event, next) => navigate(`/models${MODEL_TABS[next].path}`)}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="Models workspace"
        sx={{
          mt: 2,
          px: 3,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTabs-indicator': { backgroundColor: 'primary.main', height: 3, borderRadius: '3px 3px 0 0' }
        }}
      >
        {MODEL_TABS.map((tab) => (
          <Tab
            key={tab.key}
            id={`models-tab-${tab.key}`}
            aria-controls={`models-tabpanel-${tab.key}`}
            sx={{
              fontWeight: 600,
              letterSpacing: '0.01em',
              '&.Mui-selected': { color: 'primary.main' },
              '&:hover': { color: 'primary.main' }
            }}
            label={
              counts[tab.key] ? (
                <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
                  {tab.label}
                  <Chip
                    size="small"
                    label={counts[tab.key]}
                    sx={{ height: 18, fontSize: '0.7rem', bgcolor: 'primary.lighter', color: 'primary.main' }}
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
        id={`models-tabpanel-${MODEL_TABS[index].key}`}
        aria-labelledby={`models-tab-${MODEL_TABS[index].key}`}
        sx={disableGutters ? { py: 0 } : { p: 3 }}
      >
        {children}
      </Box>
    </MainCard>
  );
}

ModelsTabs.propTypes = {
  current: PropTypes.oneOf(['registry', 'labels', 'runs', 'benchmark']),
  counts: PropTypes.object,
  disableGutters: PropTypes.bool,
  children: PropTypes.node
};
