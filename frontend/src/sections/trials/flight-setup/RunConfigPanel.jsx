import PropTypes from 'prop-types';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import LinearProgress from '@mui/material/LinearProgress';

// project imports
import MainCard from 'components/MainCard';
import FormField from 'components/FormField';
import { NESTED_PANEL } from 'sections/trials/surfaces';
import { ALTITUDES, DENOMINATORS, checkModelFit } from './constants';

// assets
import PlayCircleOutlined from '@ant-design/icons/PlayCircleOutlined';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import WarningOutlined from '@ant-design/icons/WarningOutlined';

// ==============================|| FLIGHT SETUP - RUN CONFIG PANEL ||============================== //

export default function RunConfigPanel({
  values,
  onChange,
  models,
  gsdCm,
  gsdSource,
  plotCount,
  estimate,
  running = false,
  progress = 0,
  canRun = false,
  blockers = [],
  allowPolygonArea = true,
  inputsStaged = true,
  actualBands = null,
  runLabel,
  onRun,
  onOverrideGsd
}) {
  const set = (key) => (event) => onChange({ ...values, [key]: event.target.value });

  const capture = ALTITUDES.find((a) => a.value === values.capture);
  const model = models.find((m) => m.id === values.modelId);

  const { fits: modelFits, reasons: fitReasons } = checkModelFit(model, capture, actualBands);

  const areaAvailable = Number.isFinite(gsdCm) && gsdCm > 0;
  const denominator = DENOMINATORS.find((d) => d.value === values.denominator);

  return (
    <MainCard content={false} sx={NESTED_PANEL} title="Run configuration">
      <Stack sx={{ px: 2, py: 2, gap: 2 }}>
        {/* flight date */}
        <FormField id="run-flight-date" label="Flight date" required>
          <TextField
            id="run-flight-date"
            size="small"
            fullWidth
            type="date"
            value={values.flightDate}
            onChange={set('flightDate')}
            disabled={running}
          />
        </FormField>

        {/* altitude / camera */}
        <FormField id="run-capture" label="Altitude / camera">
          <TextField
            id="run-capture"
            select
            size="small"
            fullWidth
            value={values.capture}
            onChange={set('capture')}
            disabled={running}
            slotProps={{ select: { labelId: 'run-capture-label' } }}
          >
            {ALTITUDES.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </FormField>

        {/* model */}
        <Box>
          <FormField id="run-model" label="Segmentation model">
            <TextField
              id="run-model"
              select
              size="small"
              fullWidth
              value={values.modelId}
              onChange={set('modelId')}
              disabled={running}
              slotProps={{ select: { labelId: 'run-model-label' } }}
            >
              {models.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  <Stack direction="row" sx={{ gap: 1, alignItems: 'center', width: '100%' }}>
                    <Box component="span" sx={{ flex: 1 }}>
                      {option.label}
                    </Box>
                    {option.status === 'candidate' && (
                      <Chip
                        size="small"
                        label="candidate"
                        sx={{ height: 18, fontSize: '0.7rem', bgcolor: 'info.lighter', color: 'info.main' }}
                      />
                    )}
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
          </FormField>

          <Box sx={{ mt: 1 }}>
            {modelFits ? (
              <Chip
                size="small"
                icon={
                  <Box sx={{ display: 'flex', fontSize: '0.75rem' }}>
                    <CheckCircleOutlined />
                  </Box>
                }
                label={`matches ${actualBands || capture?.bands}-band input`}
                sx={{ bgcolor: 'success.lighter', color: 'success.main', '& .MuiChip-icon': { color: 'inherit' } }}
              />
            ) : (
              <Alert
                severity="error"
                variant="outlined"
                icon={<WarningOutlined />}
                sx={{ py: 0.25, '& .MuiAlert-message': { fontSize: '0.75rem' } }}
              >
                {fitReasons.join(' ')} A mismatched model produces a plausible-looking but wrong mask, so this run is blocked.
              </Alert>
            )}
          </Box>
        </Box>

        <Divider />

        {/* GSD */}
        <Box>
          {/* GSD is only *missing* once something has been staged. Before that it
              is simply not known yet, so it must not read as a validation error. */}
          <FormField id="run-gsd" label="Ground sample distance" error={inputsStaged && !areaAvailable}>
            <TextField
              id="run-gsd"
              size="small"
              fullWidth
              value={areaAvailable ? `${gsdCm} cm/px` : inputsStaged ? 'Unknown' : '—'}
              slotProps={{
                input: {
                  readOnly: true,
                  sx: { fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }
                }
              }}
              error={inputsStaged && !areaAvailable}
            />
          </FormField>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {areaAvailable ? gsdSource : inputsStaged ? 'No georeferencing found' : 'Read from the file on upload'} ·{' '}
            <Link component="button" type="button" underline="hover" onClick={onOverrideGsd} sx={{ fontSize: 'inherit' }}>
              override
            </Link>
          </Typography>

          {inputsStaged && !areaAvailable && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 1, py: 0.25, '& .MuiAlert-message': { fontSize: '0.75rem' } }}>
              Area outputs are disabled — this run will produce % cover only. Add a GSD to unlock cm².
            </Alert>
          )}
        </Box>

        {/* denominator */}
        <Box>
          <FormField id="run-denominator" label="Plot area denominator">
            <TextField
              id="run-denominator"
              select
              size="small"
              fullWidth
              value={values.denominator}
              onChange={set('denominator')}
              disabled={running}
              slotProps={{ select: { labelId: 'run-denominator-label' } }}
            >
              {DENOMINATORS.map((option) => (
                <MenuItem key={option.value} value={option.value} disabled={option.needsPolygons && !allowPolygonArea}>
                  {option.label}
                  {option.needsPolygons && !allowPolygonArea && (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      — needs a shapefile
                    </Typography>
                  )}
                </MenuItem>
              ))}
            </TextField>
          </FormField>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {denominator?.help}
          </Typography>
        </Box>
      </Stack>

      <Divider />

      {/* run */}
      <Box sx={{ px: 2, py: 2 }}>
        {blockers.length > 0 && (
          <Stack sx={{ gap: 0.5, mb: 1.5 }}>
            {blockers.map((blocker) => (
              <Typography key={blocker} variant="caption" color="error.main">
                • {blocker}
              </Typography>
            ))}
          </Stack>
        )}

        <Button fullWidth variant="contained" size="large" startIcon={<PlayCircleOutlined />} disabled={!canRun || running} onClick={onRun}>
          {running ? 'Working…' : runLabel || `Run · ${plotCount} plots`}
        </Button>

        {running ? (
          <Box sx={{ mt: 1.5 }}>
            <LinearProgress variant="determinate" value={progress} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, textAlign: 'center' }}>
              {Math.round(progress)}% · runs in the background, you can close this tab
            </Typography>
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'center' }}>
            {estimate}
          </Typography>
        )}
      </Box>
    </MainCard>
  );
}

RunConfigPanel.propTypes = {
  values: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  models: PropTypes.array.isRequired,
  gsdCm: PropTypes.number,
  gsdSource: PropTypes.string,
  plotCount: PropTypes.number,
  estimate: PropTypes.string,
  running: PropTypes.bool,
  progress: PropTypes.number,
  canRun: PropTypes.bool,
  blockers: PropTypes.arrayOf(PropTypes.string),
  allowPolygonArea: PropTypes.bool,
  inputsStaged: PropTypes.bool,
  actualBands: PropTypes.number,
  runLabel: PropTypes.string,
  onRun: PropTypes.func,
  onOverrideGsd: PropTypes.func
};
