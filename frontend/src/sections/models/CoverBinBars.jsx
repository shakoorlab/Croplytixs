import PropTypes from 'prop-types';

// material-ui
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';

// project imports
import { COVER_BINS } from 'api/models';

// ==============================|| MODELS - COVERAGE BY COVER BIN ||============================== //

/**
 * Stacked bars, one per cover bin: the baseline (imported) labels underneath,
 * the new corrections on top. Stage imbalance is a first-class view, not a
 * footnote: flags cluster in particular growth stages, so the pool skews
 * without anyone deciding it should, and this is where that becomes visible
 * before it becomes a regression.
 */
export default function CoverBinBars({ baseline, corrections, height = 220, thinBelow = 0.12 }) {
  const theme = useTheme();
  const total = corrections.reduce((sum, value) => sum + value, 0);
  const thin = COVER_BINS.filter((bin, i) => total && corrections[i] / total < thinBelow);

  return (
    <Stack sx={{ gap: 0.5 }}>
      <BarChart
        height={height}
        hideLegend
        grid={{ horizontal: true }}
        xAxis={[{ scaleType: 'band', data: COVER_BINS, tickSize: 0, disableLine: true, categoryGapRatio: 0.45 }]}
        yAxis={[{ tickSize: 0, disableLine: true }]}
        series={[
          { id: 'baseline', data: baseline, label: 'baseline', stack: 'pool', color: theme.vars.palette.grey[300] },
          { id: 'new', data: corrections, label: 'new corrections', stack: 'pool', color: theme.vars.palette.primary.main }
        ]}
        margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
        sx={{
          '& .MuiChartsGrid-line': { strokeDasharray: '4 4', stroke: theme.vars.palette.divider },
          '& .MuiBarElement-root': { rx: 3 }
        }}
      />
      <Stack direction="row" sx={{ gap: 2, alignItems: 'center', flexWrap: 'wrap', px: 1 }}>
        <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: 'grey.300' }} />
          <Typography variant="caption" color="text.secondary">
            baseline
          </Typography>
        </Stack>
        <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: 'primary.main' }} />
          <Typography variant="caption" color="text.secondary">
            new corrections
          </Typography>
        </Stack>
        {thin.length > 0 && (
          <Typography variant="caption" sx={{ color: 'warning.main' }}>
            ⚑ {thin.join(', ')} cover is thin — {thin.includes('80–100%') ? 'late-season' : 'those'} plots are under-represented in the new
            labels
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

CoverBinBars.propTypes = {
  baseline: PropTypes.array.isRequired,
  corrections: PropTypes.array.isRequired,
  height: PropTypes.number,
  thinBelow: PropTypes.number
};
