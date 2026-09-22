import PropTypes from 'prop-types';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

// project imports
import MainCard from 'components/MainCard';
import FormField from 'components/FormField';
import { NESTED_PANEL } from 'sections/trials/surfaces';

// assets
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import WarningOutlined from '@ant-design/icons/WarningOutlined';
import QuestionCircleOutlined from '@ant-design/icons/QuestionCircleOutlined';

const SINGLE_TARGETS = [
  { key: 'plot_id', label: 'Plot ID', required: true, help: 'Joins this date’s geometry to the trial’s plot roster.' }
];

/**
 * Plenty of field-trial exports identify a plot by its position in the grid
 * rather than by a single id column — row and column, no plot number anywhere in
 * the .dbf. Forcing those users to invent an id upstream would be the wrong
 * trade, so the identity can be composed from two fields instead of one.
 */
const GRID_TARGETS = [
  { key: 'row', label: 'Row', required: true, help: 'Grid row. Combined with column to form the plot id.' },
  { key: 'col', label: 'Column', required: true, help: 'Grid column. Combined with row to form the plot id.' }
];

const SHARED_TARGETS = [
  { key: 'genotype', label: 'Genotype', required: false, help: 'Optional — falls back to the roster value when absent.' },
  { key: 'rep', label: 'Rep', required: false, help: 'Optional — falls back to the roster value when absent.' }
];

// ==============================|| FLIGHT SETUP - SHAPEFILE MAPPING ||============================== //

/**
 * Two jobs on one card:
 *  1. map unpredictable .dbf column names onto our fields
 *  2. reconcile this date's polygons against the trial's plot roster
 *
 * The second is the one that saves you: geometry is per-date, but plot identity
 * belongs to the trial, so a mis-exported shapefile is caught here rather than
 * after 144 numbers have been attached to the wrong genotypes.
 */
export default function ShapefileMapping({ fields = [], mapping, onMappingChange, roster, disabled = false }) {
  const set = (key) => (event) => onMappingChange({ ...mapping, [key]: event.target.value });
  const identity = mapping.identity === 'grid' ? 'grid' : 'single';
  const targets = [...(identity === 'grid' ? GRID_TARGETS : SINGLE_TARGETS), ...SHARED_TARGETS];

  const counts = [
    { key: 'matched', label: 'matched', value: roster.matched, color: 'success', icon: <CheckCircleOutlined /> },
    { key: 'missing', label: 'missing from this flight', value: roster.missing, color: 'warning', icon: <WarningOutlined /> },
    { key: 'unknown', label: 'not in roster', value: roster.unknown, color: 'error', icon: <QuestionCircleOutlined /> }
  ];

  return (
    <MainCard content={false} sx={NESTED_PANEL} title="Shapefile fields">
      <Stack direction="row" sx={{ gap: 1.5, px: 2, pt: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          Plot identity
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={identity}
          disabled={disabled}
          onChange={(event, value) => value && onMappingChange({ ...mapping, identity: value })}
          sx={{
            '& .MuiToggleButton-root.Mui-selected': {
              color: 'primary.main',
              bgcolor: 'primary.lighter',
              borderColor: 'primary.light',
              '&:hover': { bgcolor: 'primary.lighter' }
            }
          }}
        >
          <ToggleButton value="single">Single field</ToggleButton>
          <ToggleButton value="grid">Row + column</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Stack direction="row" sx={{ gap: 1.5, px: 2, py: 2, flexWrap: 'wrap' }}>
        {targets.map((target) => (
          <FormField
            key={target.key}
            id={`shp-${target.key}`}
            label={target.label}
            required={target.required}
            sx={{ minWidth: 176, flex: '1 1 176px' }}
          >
            <Tooltip title={target.help} placement="top">
              <TextField
                id={`shp-${target.key}`}
                select
                size="small"
                fullWidth
                value={mapping[target.key] ?? ''}
                onChange={set(target.key)}
                disabled={disabled}
                slotProps={{ select: { labelId: `shp-${target.key}-label` } }}
              >
                {!target.required && (
                  <MenuItem value="">
                    <Typography variant="body2" color="text.secondary">
                      Not mapped
                    </Typography>
                  </MenuItem>
                )}
                {fields.map((field) => (
                  <MenuItem key={field} value={field} sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }}>
                    {field}
                  </MenuItem>
                ))}
              </TextField>
            </Tooltip>
          </FormField>
        ))}
      </Stack>

      <Divider />

      <Stack direction="row" sx={{ gap: 1.5, px: 2, py: 1.75, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ mr: 0.5 }}>
          Against trial roster
        </Typography>

        {/* Before a shapefile exists there is nothing to reconcile. A green
            "0 matched" would read as a passed check rather than a blank slate. */}
        {roster.total === 0 && (
          <Typography variant="caption" color="text.disabled">
            Awaiting a shapefile
          </Typography>
        )}

        {roster.total > 0 &&
          counts.map((count) => (
            <Chip
              key={count.key}
              size="small"
              icon={<Box sx={{ display: 'flex', fontSize: '0.8rem' }}>{count.icon}</Box>}
              label={`${count.value} ${count.label}`}
              sx={{
                color: count.value === 0 && count.key !== 'matched' ? 'text.secondary' : `${count.color}.main`,
                bgcolor: count.value === 0 && count.key !== 'matched' ? 'transparent' : `${count.color}.lighter`,
                '& .MuiChip-icon': { color: 'inherit' }
              }}
            />
          ))}

        <Box sx={{ flex: 1 }} />

        <Typography variant="caption" color="text.secondary">
          Geometry is per flight · plot identity is per trial
        </Typography>
      </Stack>
    </MainCard>
  );
}

ShapefileMapping.propTypes = {
  fields: PropTypes.arrayOf(PropTypes.string),
  mapping: PropTypes.object.isRequired,
  onMappingChange: PropTypes.func.isRequired,
  roster: PropTypes.shape({
    matched: PropTypes.number,
    missing: PropTypes.number,
    unknown: PropTypes.number,
    total: PropTypes.number
  }).isRequired,
  disabled: PropTypes.bool
};
