import PropTypes from 'prop-types';
import { useMemo } from 'react';

// material-ui
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { LineChart } from '@mui/x-charts/LineChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

// ==============================|| TRAITS - GROWTH CURVES ||============================== //

/**
 * Fractional cover against days after planting, one line per genotype.
 *
 * A panel of 140 genotypes is unreadable as 140 equal lines, so the chart
 * shows the trial mean, the top genotypes by final cover, and whatever the
 * table has selected; everything else is drawn faint for context. The 50%
 * reference line is the "days to 50% cover" trait made visible.
 */
export default function GrowthCurves({ series, selected = [], topN = 8, showAll = true, height = 360 }) {
  const theme = useTheme();
  const { dates, genotypes } = series;

  const palette = useMemo(() => {
    const p = theme.vars.palette;
    return [
      p.primary.main,
      p.success.main,
      p.info.main,
      p.warning.main,
      p.error.main,
      p.primary.light,
      p.success.dark,
      p.info.light,
      p.warning.dark,
      p.error.light
    ];
  }, [theme]);

  const { lines, legend } = useMemo(() => {
    const x = dates.map((date) => date.dap);
    const selectedSet = new Set(selected);
    const top = genotypes.slice(0, topN).map((row) => row.genotype);
    const featured = [...new Set([...selected, ...top])];
    const colorOf = {};
    featured.forEach((genotype, i) => {
      colorOf[genotype] = palette[i % palette.length];
    });

    const meanSeries = dates.map((date, i) => {
      const values = genotypes.map((row) => row.series[i]).filter((value) => value != null);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    });

    const faint = showAll
      ? genotypes
          .filter((row) => !colorOf[row.genotype])
          .map((row) => ({
            id: `g-${row.genotype}`,
            type: 'line',
            data: row.series,
            label: `G${row.genotype}`,
            color: 'rgba(140, 160, 145, 0.22)',
            showMark: false,
            curve: 'monotoneX',
            connectNulls: true
          }))
      : [];

    const strong = featured
      .map((genotype) => genotypes.find((row) => row.genotype === genotype))
      .filter(Boolean)
      .map((row) => ({
        id: `g-${row.genotype}`,
        type: 'line',
        data: row.series,
        label: `G${row.genotype}`,
        color: colorOf[row.genotype],
        showMark: true,
        curve: 'monotoneX',
        connectNulls: true
      }));

    const mean = {
      id: 'mean',
      type: 'line',
      data: meanSeries,
      label: 'Trial mean',
      color: theme.vars.palette.text.primary,
      showMark: false,
      curve: 'monotoneX',
      connectNulls: true
    };

    return {
      lines: { x, series: [...faint, ...strong, mean] },
      legend: [
        ...featured.map((genotype) => ({ label: `G${genotype}`, color: colorOf[genotype], selected: selectedSet.has(genotype) })),
        { label: 'Trial mean', color: theme.vars.palette.text.primary, dashed: true }
      ]
    };
  }, [dates, genotypes, selected, topN, showAll, palette, theme]);

  if (!dates.length) return null;

  return (
    <Stack sx={{ gap: 1 }}>
      <LineChart
        hideLegend
        height={height}
        grid={{ horizontal: true, vertical: false }}
        xAxis={[
          {
            data: lines.x,
            scaleType: 'linear',
            label: 'days after planting',
            min: Math.max(0, lines.x[0] - 3),
            max: lines.x[lines.x.length - 1] + 3,
            valueFormatter: (value) => `${Math.round(value)}`,
            tickSize: 6,
            disableLine: true
          }
        ]}
        yAxis={[{ min: 0, max: 100, label: 'fractional cover (%)', valueFormatter: (value) => `${value}`, tickSize: 6, disableLine: true }]}
        series={lines.series.map((line) => ({ ...line, valueFormatter: (value) => (value == null ? '—' : `${value.toFixed(1)}%`) }))}
        margin={{ top: 16, right: 24, bottom: 8, left: 8 }}
        slotProps={{ tooltip: { trigger: 'item' } }}
        sx={{
          '& .MuiChartsGrid-line': { strokeDasharray: '4 4', stroke: theme.vars.palette.divider },
          '& .MuiLineElement-series-mean': { strokeDasharray: '6 4', strokeWidth: 2.5 },
          '& .MuiLineElement-root': { strokeWidth: 1.75 },
          '& [class*="MuiLineElement-series-g-"]': { strokeWidth: 1.25 },
          '& .MuiChartsAxis-tick': { stroke: 'transparent' }
        }}
      >
        <ChartsReferenceLine
          y={50}
          label="50 % cover"
          labelAlign="end"
          lineStyle={{ stroke: theme.vars.palette.warning.main, strokeDasharray: '2 6', strokeWidth: 1 }}
          labelStyle={{ fontSize: 11, fill: theme.vars.palette.warning.main }}
        />
      </LineChart>

      <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap', px: 1 }}>
        {legend.map((item) => (
          <Stack key={item.label} direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
            <Box
              sx={{
                width: 14,
                height: 0,
                borderTop: '2px',
                borderTopStyle: item.dashed ? 'dashed' : 'solid',
                borderColor: item.color
              }}
            />
            <Typography variant="caption" sx={{ ...mono, color: item.selected ? 'primary.main' : 'text.secondary' }}>
              {item.label}
            </Typography>
          </Stack>
        ))}
        {showAll && (
          <Typography variant="caption" color="text.disabled">
            · faint lines: every other genotype
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

GrowthCurves.propTypes = {
  series: PropTypes.object.isRequired,
  selected: PropTypes.array,
  topN: PropTypes.number,
  showAll: PropTypes.bool,
  height: PropTypes.number
};
