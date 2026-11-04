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
import InfoTip from 'components/InfoTip';
import { NESTED_PANEL } from 'sections/trials/surfaces';
import { ALTITUDES, checkCaptureFit } from './constants';

// assets
import CloudUploadOutlined from '@ant-design/icons/CloudUploadOutlined';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import WarningOutlined from '@ant-design/icons/WarningOutlined';

/**
 * What the capture check compared, for its (i). The band count is read from the
 * file; altitude is not in a GeoTIFF, so it is always the setting's.
 */
function CaptureExplanation({ capture, fit }) {
  const rows = [
    ['Bands', fit.expected, fit.actual],
    ['Altitude', `${capture.altitude} m`, 'not in the file']
  ];

  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="subtitle2" component="p">
        How this is checked
      </Typography>
      <Typography variant="caption" component="p" color="text.secondary">
        The orthophoto’s colour bands are counted from the file, leaving out an alpha band, and compared with what a {capture.label} capture
        produces. A GeoTIFF doesn’t record flying height, so altitude is taken from this setting.
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'auto auto 1fr',
          columnGap: 1.5,
          rowGap: 0.5,
          fontVariantNumeric: 'tabular-nums',
          '& .head': { color: 'text.secondary', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em' }
        }}
      >
        <span className="head" />
        <span className="head">Setting</span>
        <span className="head">Orthophoto</span>
        {rows.map(([label, expected, actual]) => (
          <Box key={label} sx={{ display: 'contents' }}>
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Typography variant="caption">{expected}</Typography>
            <Typography
              variant="caption"
              sx={{ color: label === 'Bands' ? (fit.fits ? 'success.main' : 'warning.main') : 'text.secondary' }}
            >
              {actual}
            </Typography>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}

CaptureExplanation.propTypes = {
  capture: PropTypes.object.isRequired,
  fit: PropTypes.object.isRequired
};

// ==============================|| FLIGHT SETUP - FLIGHT DETAILS PANEL ||============================== //

/**
 * The facts about the flight that the files can't say for themselves — when it
 * was flown and with what — plus the upload. How to *process* the flight (model,
 * area denominator) is not asked here: it is chosen when the flight is run, from
 * its own page, once its files and map copies exist.
 */
export default function FlightDetailsPanel({
  values,
  onChange,
  gsdCm,
  gsdSource,
  uploading = false,
  progress = 0,
  canUpload = false,
  blockers = [],
  inputsStaged = true,
  actualBands = null,
  uploadSummary,
  onUpload,
  onOverrideGsd
}) {
  const set = (key) => (event) => onChange({ ...values, [key]: event.target.value });

  const capture = ALTITUDES.find((a) => a.value === values.capture);
  const captureFit = checkCaptureFit(capture, actualBands);
  const areaAvailable = Number.isFinite(gsdCm) && gsdCm > 0;

  return (
    // Fills the rail, so the card runs as long as the column of boxes beside it.
    <MainCard
      content={false}
      sx={(theme) => ({ ...NESTED_PANEL(theme), flex: 1, display: 'flex', flexDirection: 'column' })}
      title="Flight details"
    >
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
            disabled={uploading}
          />
        </FormField>

        {/* altitude / camera */}
        <Box>
          <FormField id="run-capture" label="Altitude / camera">
            <TextField
              id="run-capture"
              select
              size="small"
              fullWidth
              value={values.capture}
              onChange={set('capture')}
              disabled={uploading}
              slotProps={{ select: { labelId: 'run-capture-label' } }}
            >
              {ALTITUDES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </FormField>

          {/* only once a file has been read: before that there is nothing to compare */}
          {captureFit && (
            <Stack direction="row" sx={{ mt: 1, gap: 0.5, alignItems: 'center' }}>
              {captureFit.fits ? (
                <Chip
                  size="small"
                  icon={
                    <Box sx={{ display: 'flex', fontSize: '0.75rem' }}>
                      <CheckCircleOutlined />
                    </Box>
                  }
                  label={`orthophoto has ${captureFit.actual} bands, as expected`}
                  sx={{ bgcolor: 'success.lighter', color: 'success.main', '& .MuiChip-icon': { color: 'inherit' } }}
                />
              ) : (
                <Alert
                  severity="warning"
                  variant="outlined"
                  icon={<WarningOutlined />}
                  sx={{ py: 0.25, flex: 1, '& .MuiAlert-message': { fontSize: '0.75rem' } }}
                >
                  This orthophoto has {captureFit.actual} colour bands; a {capture.label} capture has {captureFit.expected}. Pick the
                  setting that matches, so the right model is offered when the flight is run.
                </Alert>
              )}
              <InfoTip label="How this check works" title={<CaptureExplanation capture={capture} fit={captureFit} />} />
            </Stack>
          )}
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
              Without a ground sample distance, results will be % cover only, with no cm². Add one to get canopy area.
            </Alert>
          )}
        </Box>
      </Stack>

      {/* auto margin: the upload sits at the card's foot, level with the end of the left column */}
      <Divider sx={{ mt: 'auto' }} />

      {/* upload */}
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

        <Button
          fullWidth
          variant="contained"
          size="large"
          startIcon={<CloudUploadOutlined />}
          disabled={!canUpload || uploading}
          onClick={onUpload}
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </Button>

        {uploading ? (
          <Box sx={{ mt: 1.5 }}>
            <LinearProgress variant="determinate" value={progress} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, textAlign: 'center' }}>
              {Math.round(progress)}% · keep this tab open until it finishes
            </Typography>
          </Box>
        ) : (
          uploadSummary && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'center' }}>
              {uploadSummary}
            </Typography>
          )
        )}
      </Box>
    </MainCard>
  );
}

FlightDetailsPanel.propTypes = {
  values: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  gsdCm: PropTypes.number,
  gsdSource: PropTypes.string,
  uploading: PropTypes.bool,
  progress: PropTypes.number,
  canUpload: PropTypes.bool,
  blockers: PropTypes.arrayOf(PropTypes.string),
  inputsStaged: PropTypes.bool,
  actualBands: PropTypes.number,
  uploadSummary: PropTypes.string,
  onUpload: PropTypes.func,
  onOverrideGsd: PropTypes.func
};
