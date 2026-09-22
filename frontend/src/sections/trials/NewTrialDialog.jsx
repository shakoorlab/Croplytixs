import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Divider from '@mui/material/Divider';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';

// project imports
import FormField from 'components/FormField';
import FileDropCard from 'sections/trials/flight-setup/FileDropCard';
import { formatBytes } from 'sections/trials/flight-setup/utils';

// assets
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import TableOutlined from '@ant-design/icons/TableOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';

const CURRENT_SEASON = String(new Date().getFullYear());

const EMPTY = { name: '', crop: '', site: '', season: CURRENT_SEASON };

/** Rough client-side row count so the user sees the roster landed. The real parse is server-side. */
function countRosterRows(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return 0;
  // assume a header row when the first line has no digits in its first cell
  const firstCell = lines[0].split(/[,;\t]/)[0] || '';
  const hasHeader = !/\d/.test(firstCell);
  return Math.max(lines.length - (hasHeader ? 1 : 0), 0);
}

// ==============================|| TRIALS - NEW TRIAL DIALOG ||============================== //

export default function NewTrialDialog({ open, onClose, onCreate, trials = [], busy = false, error = null }) {
  const [values, setValues] = useState(EMPTY);
  const [roster, setRoster] = useState(null);
  const [rosterError, setRosterError] = useState(null);

  // reset whenever the dialog is reopened so it never shows a stale draft
  useEffect(() => {
    if (open) {
      setValues(EMPTY);
      setRoster(null);
      setRosterError(null);
    }
  }, [open]);

  const crops = useMemo(() => [...new Set(trials.map((t) => t.crop))].sort(), [trials]);
  const sites = useMemo(() => [...new Set(trials.map((t) => t.site))].sort(), [trials]);

  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const setValue = (key) => (event, value) => setValues((current) => ({ ...current, [key]: value ?? '' }));

  const trimmed = {
    name: values.name.trim(),
    crop: values.crop.trim(),
    site: values.site.trim(),
    season: values.season.trim() || CURRENT_SEASON
  };

  // The API enforces uniqueness too (409); this just saves a round trip for trials already loaded.
  const duplicate = trials.some((t) => t.name.toLowerCase() === trimmed.name.toLowerCase());
  const canSubmit = Boolean(trimmed.name && trimmed.crop && trimmed.site) && !duplicate && !busy;

  const handleRosterSelect = (fileList) => {
    const file = fileList[0];
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setRosterError('Plot roster must be a .csv or .tsv file.');
      setRoster(null);
      return;
    }
    setRosterError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const plots = countRosterRows(String(reader.result || ''));
      setRoster({ name: file.name, bytes: file.size, plots });
    };
    reader.onerror = () => setRosterError('Could not read that file.');
    reader.readAsText(file);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onCreate({ ...trimmed, plots: roster?.plots || 0, rosterFile: roster?.name || null });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="new-trial-title"
      slotProps={{
        paper: {
          sx: {
            border: '1px solid',
            borderColor: 'grey.A800',
            borderRadius: 1,
            backgroundImage: 'none'
          }
        }
      }}
    >
      <DialogTitle id="new-trial-title" sx={{ pr: 7, py: 2 }}>
        <Stack sx={{ gap: 0.25 }}>
          <Typography variant="h4">New trial</Typography>
          <Typography variant="caption" color="text.secondary">
            A trial owns its plot roster and collects flights across a season
          </Typography>
        </Stack>
        <IconButton aria-label="Close" color="secondary" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 14 }}>
          <CloseOutlined />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 2.5 }}>
        <Stack sx={{ gap: 2.5 }}>
          {error && (
            <Alert severity="error" variant="outlined">
              {error}
            </Alert>
          )}
          <FormField
            id="trial-name"
            label="Trial name"
            required
            error={Boolean(trimmed.name) && duplicate}
            helperText={trimmed.name && duplicate ? 'A trial with this name already exists.' : undefined}
          >
            <TextField
              id="trial-name"
              autoFocus
              fullWidth
              size="small"
              placeholder="e.g. Guadeloupe Yam Panel 2026"
              value={values.name}
              onChange={set('name')}
              error={Boolean(trimmed.name) && duplicate}
            />
          </FormField>

          <Stack direction="row" sx={{ gap: 2 }}>
            <FormField id="trial-crop" label="Crop" required helperText="Free text — new crops are allowed" sx={{ flex: 1 }}>
              <Autocomplete
                id="trial-crop"
                freeSolo
                fullWidth
                size="small"
                options={crops}
                value={values.crop}
                onChange={setValue('crop')}
                onInputChange={(event, value) => setValues((current) => ({ ...current, crop: value }))}
                renderInput={(params) => <TextField {...params} placeholder="e.g. Yam" />}
              />
            </FormField>
            <FormField id="trial-site" label="Site" required helperText="Station, farm or field name" sx={{ flex: 1 }}>
              <Autocomplete
                id="trial-site"
                freeSolo
                fullWidth
                size="small"
                options={sites}
                value={values.site}
                onChange={setValue('site')}
                onInputChange={(event, value) => setValues((current) => ({ ...current, site: value }))}
                renderInput={(params) => <TextField {...params} placeholder="e.g. INRAE Duclos" />}
              />
            </FormField>
          </Stack>

          <FormField id="trial-season" label="Season" helperText="Used to group trials" sx={{ maxWidth: 180 }}>
            <TextField id="trial-season" size="small" fullWidth value={values.season} onChange={set('season')} />
          </FormField>

          <Divider />

          {/* ---- plot roster ---- */}
          <Stack sx={{ gap: 1 }}>
            <Stack direction="row" sx={{ gap: 1, alignItems: 'baseline' }}>
              <Typography variant="subtitle1">Plot roster</Typography>
              <Chip size="small" label="optional" sx={{ height: 18, fontSize: '0.7rem', bgcolor: 'grey.100', color: 'text.secondary' }} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              A CSV of <code>plot_id, genotype, rep</code> — your field book or plot map. This is what each flight&apos;s shapefile gets
              checked against, so a mis-exported shapefile is caught before it produces numbers. You can add it later from trial settings.
            </Typography>
            <FileDropCard
              label="Drop plot roster"
              hint=".csv / .tsv — one row per plot"
              accept=".csv,.tsv,.txt"
              icon={<TableOutlined />}
              error={rosterError}
              staged={roster && { name: roster.name, meta: [formatBytes(roster.bytes), `${roster.plots} plots`] }}
              onSelect={handleRosterSelect}
              onClear={() => {
                setRoster(null);
                setRosterError(null);
              }}
            />
          </Stack>

          {/* ---- what is derived ---- */}
          <Stack direction="row" sx={{ gap: 1, alignItems: 'flex-start' }}>
            <Box sx={{ color: 'text.disabled', fontSize: '0.85rem', display: 'flex', mt: 0.2 }}>
              <InfoCircleOutlined />
            </Box>
            <Typography variant="caption" color="text.secondary">
              Flights, processed counts, review status and last activity are derived as imagery comes in — there is nothing to enter for
              them, and they stay at zero until the first flight is uploaded.
            </Typography>
          </Stack>
        </Stack>
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button
          color="secondary"
          onClick={onClose}
          // Destructive-on-hover: neutral at rest so it doesn't compete with the
          // primary action, red on approach so the outcome is unambiguous.
          sx={{
            '&:hover': { color: 'error.main', bgcolor: 'error.lighter' },
            '&:focus-visible': { color: 'error.main', bgcolor: 'error.lighter' }
          }}
        >
          Cancel
        </Button>
        <Button variant="contained" disabled={!canSubmit} onClick={handleSubmit}>
          {busy ? 'Creating…' : 'Create trial'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

NewTrialDialog.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  onCreate: PropTypes.func.isRequired,
  trials: PropTypes.array,
  busy: PropTypes.bool,
  error: PropTypes.string
};
