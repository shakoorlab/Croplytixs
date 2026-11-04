import PropTypes from 'prop-types';
import { useState } from 'react';
import dayjs from 'dayjs';

// material-ui
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import InputAdornment from '@mui/material/InputAdornment';
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

  // The page stores the flight date as 'YYYY-MM-DD'; the picker works in dayjs. The
  // picker's own value lives here so a half-typed date ('2024-12-__') survives the
  // page storing '' for it — feeding null back in would wipe what was typed.
  const [dateValue, setDateValue] = useState(() => (values.flightDate ? dayjs(values.flightDate) : null));
  const handleDateChange = (date) => {
    setDateValue(date);
    onChange({ ...values, flightDate: date?.isValid() ? date.format('YYYY-MM-DD') : '' });
  };

  const capture = ALTITUDES.find((a) => a.value === values.capture);
  const captureFit = checkCaptureFit(capture, actualBands);
  const areaAvailable = Number.isFinite(gsdCm) && gsdCm > 0;

  // The card spans the page, so the three fields sit side by side (stacking on
  // narrow screens) and the upload is a footer row rather than a full-width bar.
  return (
    <MainCard content={false} sx={NESTED_PANEL} title="Flight Details">
      <Box sx={{ px: 2, py: 2 }}>
        <Grid container spacing={2}>
          {/* flight date */}
          <Grid size={{ xs: 12, md: 4 }}>
            <FormField id="run-flight-date" label="Flight Date" required>
              <DatePicker
                value={dateValue}
                onChange={handleDateChange}
                format="YYYY-MM-DD"
                disabled={uploading}
                slotProps={{
                  textField: {
                    id: 'run-flight-date',
                    size: 'small',
                    fullWidth: true,
                    // The label is FormField's, outside the picker, so name the date's
                    // Year / Month / Day segments with it — MUI X only does this for its own label.
                    InputProps: { 'aria-labelledby': 'run-flight-date-label' }
                  }
                }}
              />
            </FormField>
          </Grid>

          {/* altitude / camera */}
          <Grid size={{ xs: 12, md: 4 }}>
            <FormField id="run-capture" label="Altitude / Camera">
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
          </Grid>

          {/* Only once a file has been read: before that there is nothing to compare.
              Its own row, spanning Flight date and Altitude so the message has room.
              Source order puts it under Altitude when the fields stack; `order` moves it
              after Ground sample distance on wide screens, so it wraps under the first two. */}
          {captureFit && (
            <Grid size={{ xs: 12, md: 8 }} sx={{ order: { md: 1 } }}>
              <Stack direction="row" sx={{ gap: 0.5, alignItems: 'center' }}>
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
            </Grid>
          )}

          {/* GSD */}
          <Grid size={{ xs: 12, md: 4 }}>
            {/* GSD is only *missing* once something has been staged. Before that it
                is simply not known yet, so it must not read as a validation error. */}
            <FormField
              id="run-gsd"
              label="Ground Sample Distance"
              error={inputsStaged && !areaAvailable}
              labelAdornment={
                <InfoTip
                  label="Where the ground sample distance comes from"
                  title={
                    areaAvailable
                      ? gsdSource
                      : inputsStaged
                        ? 'No georeferencing found in the file.'
                        : 'Read from the orthophoto once it’s added.'
                  }
                />
              }
            >
              <TextField
                id="run-gsd"
                size="small"
                fullWidth
                value={areaAvailable ? `${gsdCm} cm/px` : inputsStaged ? 'Unknown' : '—'}
                slotProps={{
                  input: {
                    readOnly: true,
                    sx: { fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem', pr: 0.5 },
                    endAdornment: onOverrideGsd && (
                      <InputAdornment position="end">
                        <Button size="small" onClick={onOverrideGsd} disabled={uploading} sx={{ minWidth: 0, px: 1 }}>
                          Override
                        </Button>
                      </InputAdornment>
                    )
                  }
                }}
                error={inputsStaged && !areaAvailable}
              />
            </FormField>

            {inputsStaged && !areaAvailable && (
              <Alert severity="warning" variant="outlined" sx={{ mt: 1, py: 0.25, '& .MuiAlert-message': { fontSize: '0.75rem' } }}>
                Without a ground sample distance, results will be % cover only, with no cm². Add one to get canopy area.
              </Alert>
            )}
          </Grid>
        </Grid>
      </Box>

      <Divider />

      {/* upload: what's left to do (or what will be sent) on the left, the button on the right */}
      <Box sx={{ px: 2, py: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, alignItems: { xs: 'stretch', sm: 'center' } }}>
          <Stack sx={{ flex: 1, minWidth: 0, gap: 0.5 }}>
            {blockers.map((blocker) => (
              <Typography key={blocker} variant="caption" color="error.main">
                • {blocker}
              </Typography>
            ))}
            {uploadSummary && !uploading && (
              <Typography variant="caption" color="text.secondary">
                {uploadSummary}
              </Typography>
            )}
          </Stack>

          <Button
            variant="contained"
            size="large"
            startIcon={<CloudUploadOutlined />}
            disabled={!canUpload || uploading}
            onClick={onUpload}
            sx={{ minWidth: 200 }}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </Stack>

        {uploading && (
          <Box sx={{ mt: 1.5 }}>
            <LinearProgress variant="determinate" value={progress} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              {Math.round(progress)}% · keep this tab open until it finishes
            </Typography>
          </Box>
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
