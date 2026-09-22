import PropTypes from 'prop-types';
import { useState } from 'react';

// material-ui
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Divider from '@mui/material/Divider';
import Alert from '@mui/material/Alert';

// project imports
import { MODELS } from 'api/models';
import LifecycleChip from './LifecycleChip';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

function Line({ label, value, note, muted = false }) {
  return (
    <Stack direction="row" sx={{ gap: 2, alignItems: 'baseline' }}>
      <Typography variant="body2" sx={{ flex: 1, color: muted ? 'text.disabled' : 'text.primary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ ...mono, color: muted ? 'text.disabled' : 'text.primary' }}>
        {value.toLocaleString('en-US')}
      </Typography>
      {note && (
        <Typography variant="caption" color="text.secondary" sx={{ width: 84 }}>
          {note}
        </Typography>
      )}
    </Stack>
  );
}

// ==============================|| MODELS - NEW TRAINING RUN ||============================== //

/**
 * Anyone can start a run. The dialog's job is to show the dataset composition
 * *before* anything trains — what is in, what is excluded and why — so a run
 * is never a surprise. Starting one will POST to /api/models/runs; until the
 * job runner exists it reports what it would have queued.
 */
export default function NewTrainingRunDialog({ open, onClose, pool, onQueued }) {
  const bases = MODELS.filter((model) => ['production', 'candidate'].includes(model.status));
  const [baseId, setBaseId] = useState(bases[0]?.id || '');
  const [mode, setMode] = useState('fine-tune');
  const [seed, setSeed] = useState(1337);
  const [augmentation, setAugmentation] = useState('flip, rot, jitter');

  const base = bases.find((model) => model.id === baseId);
  const training = pool.totals.imported + pool.totals.trainingGrade + pool.totals.audit;

  const start = () => {
    onQueued?.({ base: base?.version, mode, seed, augmentation, training });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New training run</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2.5, pt: 1 }}>
          <Stack direction="row" sx={{ gap: 1.5 }}>
            <FormControl size="small" fullWidth>
              <InputLabel id="run-base-label">Base model</InputLabel>
              <Select labelId="run-base-label" label="Base model" value={baseId} onChange={(event) => setBaseId(event.target.value)}>
                {bases.map((model) => (
                  <MenuItem key={model.id} value={model.id}>
                    <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
                      <span style={mono}>{model.label}</span>
                      <LifecycleChip status={model.status} />
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode}
              onChange={(event, value) => value && setMode(value)}
              sx={{
                flexShrink: 0,
                '& .MuiToggleButton-root.Mui-selected': { color: 'primary.main', bgcolor: 'primary.lighter', borderColor: 'primary.light' }
              }}
            >
              <ToggleButton value="fine-tune">fine-tune</ToggleButton>
              <ToggleButton value="scratch">from scratch</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Stack direction="row" sx={{ gap: 1.5 }}>
            <TextField
              size="small"
              label="Seed"
              type="number"
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value))}
              sx={{ width: 140 }}
            />
            <TextField
              size="small"
              label="Augmentation"
              value={augmentation}
              onChange={(event) => setAugmentation(event.target.value)}
              fullWidth
            />
          </Stack>

          <Divider />

          <Stack sx={{ gap: 0.75 }}>
            <Typography variant="subtitle2">Dataset composition</Typography>
            <Line label="Original training set (Label Studio import)" value={pool.totals.imported} note="baseline" />
            <Line label="QC corrections — training-grade" value={pool.totals.trainingGrade} note="flagged plots" />
            <Line label="QC corrections — rough" value={pool.totals.rough} note="excluded" muted />
            <Line label="Random audit sample" value={pool.totals.audit} note="unbiased" />
            <Line label="Frozen benchmark" value={pool.totals.benchmark} note="held out" muted />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              {training.toLocaleString('en-US')} training · {pool.totals.benchmark} evaluation · no overlap. Rough corrections counted for
              the measurement but are not boundary labels; the benchmark never enters training.
            </Typography>
          </Stack>

          <Alert severity="info" variant="outlined">
            Training compute is not wired up yet. Starting a run records the request and its composition; the job runner (GPU queue, cost
            model) is an open question in the framing doc.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" onClick={start} disabled={!base}>
          Start run · {training.toLocaleString('en-US')} labels
        </Button>
      </DialogActions>
    </Dialog>
  );
}

NewTrainingRunDialog.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  pool: PropTypes.object.isRequired,
  onQueued: PropTypes.func
};
