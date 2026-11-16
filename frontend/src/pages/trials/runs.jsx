import { useLocation, useNavigate, useParams } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';

// project imports
import PageHeader from 'components/PageHeader';
import TrialTabs from 'sections/trials/TrialTabs';
import RunsTable from 'sections/trials/RunsTable';
import { trialSubtitle, useFlights, useTrial } from 'api/trials';

// assets
import PlusOutlined from '@ant-design/icons/PlusOutlined';

// ==============================|| TRIALS - RUNS ||============================== //

export default function TrialRuns() {
  const { trialId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Set by the upload page when it sends the user back here. Held in history
  // state, so a reload of this entry still shows it until it is dismissed.
  const uploaded = location.state?.uploaded;
  const dismissUploaded = () => navigate(location.pathname, { replace: true, state: null });

  const { data: trial, error: trialError, isLoading: trialLoading } = useTrial(trialId);
  // Status, flag count and mean cover are the flight record's own; until the
  // worker fills them a flight reads `uploaded` with dashes, which is the truth.
  const { data: runs, error: runsError, isLoading: runsLoading, mutate } = useFlights(trialId);
  const flagged = (runs || []).reduce((sum, run) => sum + (run.flagged || 0), 0);
  const uploadedRun = uploaded && runs?.find((run) => run.id === uploaded.id);

  const crumbs = [
    { label: 'Croplytix', to: '/' },
    { label: 'Field Trials', to: '/trials' }
  ];

  if (trialLoading) {
    return (
      <Grid container rowSpacing={2.5}>
        <Grid size={12}>
          <PageHeader crumbs={crumbs} title="Loading trial…" />
        </Grid>
        <Grid size={12}>
          <LinearProgress sx={{ height: 2 }} />
        </Grid>
      </Grid>
    );
  }

  if (trialError || !trial) {
    const notFound = trialError?.status === 404;
    return (
      <Grid container rowSpacing={2.5}>
        <Grid size={12}>
          <PageHeader crumbs={crumbs} title={notFound ? 'Trial not found' : 'Could not load trial'} />
        </Grid>
        <Grid size={12}>
          <Alert severity={notFound ? 'warning' : 'error'} variant="outlined">
            {notFound ? (
              <>
                No trial with id <code>{trialId}</code>. It may have been removed, or the link is stale.
              </>
            ) : (
              trialError?.message || 'Unknown error'
            )}
          </Alert>
        </Grid>
      </Grid>
    );
  }

  const goToUpload = () => navigate(`/trials/${trial.id}/flights/new`);

  return (
    <Grid container rowSpacing={2.5} columnSpacing={2.75}>
      <Grid size={12}>
        <PageHeader
          crumbs={[...crumbs, { label: trial.name }]}
          title={trial.name}
          subtitle={trialSubtitle(trial)}
          actions={
            <Button variant="contained" startIcon={<PlusOutlined />} onClick={goToUpload}>
              Upload imagery
            </Button>
          }
        />
      </Grid>

      <Grid size={12}>
        <TrialTabs trialId={trial.id} current="flights" flagged={flagged}>
          {runsError && (
            <Alert
              severity="error"
              variant="outlined"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" onClick={() => mutate()}>
                  Retry
                </Button>
              }
            >
              Could not load flights — {runsError.message}
            </Alert>
          )}
          {uploaded && (
            <Alert
              severity="success"
              variant="outlined"
              sx={{ mb: 2 }}
              action={
                <Stack direction="row" sx={{ gap: 0.5 }}>
                  <Button color="inherit" size="small" onClick={() => navigate(`/trials/${trial.id}/flights/${uploaded.id}`)}>
                    Open
                  </Button>
                  <Button color="inherit" size="small" onClick={dismissUploaded}>
                    Dismiss
                  </Button>
                </Stack>
              }
            >
              {uploadedRun?.status === 'awaiting_upload'
                ? `Flight ${uploaded.flightDate} is uploading. Keep this tab open until it finishes; its map copies are built after that.`
                : `Flight ${uploaded.flightDate} uploaded. Its map copies are being built; open it to follow along.`}
            </Alert>
          )}
          {runsLoading && <LinearProgress sx={{ height: 2, mb: 2 }} />}

          {/* only once the list has arrived — "No flights yet" is a claim, not a placeholder */}
          {runs && (
            <RunsTable
              runs={runs}
              highlightId={uploaded?.id}
              onNewRun={goToUpload}
              onOpenRun={(run) => navigate(`/trials/${trial.id}/flights/${run.id}`)}
              onReviewRun={(run) => navigate(`/trials/${trial.id}/review?flight=${run.id}`)}
            />
          )}

          {runs?.length > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {runs.length} flight{runs.length === 1 ? '' : 's'} · newest first
              </Typography>
            </Box>
          )}
        </TrialTabs>
      </Grid>
    </Grid>
  );
}
