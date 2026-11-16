import PropTypes from 'prop-types';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';

// project imports
import MainCard from 'components/MainCard';
import PageHeader from 'components/PageHeader';
import NewTrialDialog from 'sections/trials/NewTrialDialog';
import { createTrial, trialPlots, useTrials } from 'api/trials';
import formatRelative from 'utils/formatRelative';

// assets
import PlusOutlined from '@ant-design/icons/PlusOutlined';

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8125rem' };

/**
 * The trial's plot count. Without a roster it comes from the newest flight's
 * plot grid, and the tooltip says so; before either, a dash says what fills it.
 */
function PlotCount({ trial }) {
  const plots = trialPlots(trial);
  if (!plots) {
    return (
      <Tooltip title="No plot roster or plot grid yet. It fills in when a flight with a plot grid is uploaded.">
        <Box component="span" sx={{ color: 'text.disabled' }}>
          —
        </Box>
      </Tooltip>
    );
  }
  if (plots.source === 'roster') return plots.count;
  return (
    <Tooltip title="From the newest flight’s plot grid. The trial has no plot roster.">
      <Box component="span">{plots.count}</Box>
    </Tooltip>
  );
}

PlotCount.propTypes = { trial: PropTypes.object.isRequired };

// ==============================|| TRIALS - LOBBY ||============================== //

/**
 * Deliberately thin. Most sessions should deep-link straight into a trial; this
 * exists so the breadcrumb root is a real place and so a second trial is
 * reachable without editing a constant.
 *
 * Data comes from `useTrials()` — the API is the source of truth. Creating a
 * trial is a POST followed by `mutate()`, which refetches the list so the new
 * row appears with the id the *server* minted, not one guessed here.
 */
export default function TrialsLobby() {
  const navigate = useNavigate();
  const { data: trials, error, isLoading, mutate } = useTrials();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const handleCreate = async (form) => {
    setCreating(true);
    setCreateError(null);
    try {
      const trial = await createTrial(form);
      await mutate();
      setDialogOpen(false);
      navigate(`/trials/${trial.id}`);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  // Every column is the API's own: processed, expected and flagged are derived
  // from the trial's flights on the server, so this list agrees with the trial.
  // Plots is the roster's count, or the newest flight's plot grid without one.
  const rows = trials || [];

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      <Grid size={12}>
        <PageHeader
          crumbs={[{ label: 'Croplytix', to: '/' }, { label: 'Field Trials' }]}
          title="Field Trials"
          subtitle="Each trial owns a plot roster and accumulates flights across a season"
          actions={
            <Button variant="contained" startIcon={<PlusOutlined />} onClick={() => setDialogOpen(true)}>
              New trial
            </Button>
          }
        />
      </Grid>

      {error && (
        <Grid size={12}>
          <Alert
            severity="error"
            variant="outlined"
            action={
              <Button color="inherit" size="small" onClick={() => mutate()}>
                Retry
              </Button>
            }
          >
            Could not load trials — {error.message}
          </Alert>
        </Grid>
      )}

      <Grid size={12}>
        <MainCard content={false}>
          {isLoading && <LinearProgress sx={{ height: 2 }} />}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell align="center">Trial</TableCell>
                  <TableCell align="center">Crop</TableCell>
                  <TableCell align="center">Site</TableCell>
                  <TableCell align="center">Plots</TableCell>
                  <TableCell align="center">Flights</TableCell>
                  <TableCell align="center">Processed</TableCell>
                  <TableCell align="center">Needs review</TableCell>
                  <TableCell align="center">Last activity</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!isLoading && !error && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Stack sx={{ alignItems: 'center', gap: 1, py: 6 }}>
                        <Typography variant="subtitle1">No trials yet</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Create the first one — it takes a name, a crop and a site.
                        </Typography>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((trial) => (
                  <TableRow key={trial.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/trials/${trial.id}`)}>
                    <TableCell align="center">
                      <Stack sx={{ gap: 0.25, alignItems: 'center' }}>
                        <Typography variant="subtitle2">{trial.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {trial.season} season
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="center">{trial.crop}</TableCell>
                    <TableCell align="center">
                      <Typography variant="caption" color="text.secondary">
                        {trial.site}
                      </Typography>
                    </TableCell>
                    <TableCell sx={mono} align="center">
                      <PlotCount trial={trial} />
                    </TableCell>
                    <TableCell sx={mono} align="center">
                      {trial.flightDates}
                    </TableCell>
                    <TableCell sx={mono} align="center">
                      {trial.expected ? `${trial.processed} / ${trial.expected}` : '—'}
                    </TableCell>
                    <TableCell align="center">
                      {trial.flagged > 0 ? (
                        <Chip size="small" label={`${trial.flagged} flagged`} sx={{ bgcolor: 'warning.lighter', color: 'warning.main' }} />
                      ) : trial.expected ? (
                        <Chip size="small" label="Clear" sx={{ bgcolor: 'success.lighter', color: 'success.main' }} />
                      ) : (
                        <Chip size="small" label="No flights" sx={{ bgcolor: 'grey.100', color: 'text.secondary' }} />
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="caption" color="text.secondary">
                        {formatRelative(trial.lastActivity)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </MainCard>
      </Grid>

      <NewTrialDialog
        open={dialogOpen}
        trials={rows}
        busy={creating}
        error={createError}
        onClose={() => {
          setDialogOpen(false);
          setCreateError(null);
        }}
        onCreate={handleCreate}
      />
    </Grid>
  );
}
