import { useNavigate, useParams } from 'react-router-dom';

// material-ui
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';

// project imports
import PageHeader from 'components/PageHeader';
import TrialTabs from 'sections/trials/TrialTabs';
import RunsTable from 'sections/trials/RunsTable';
import { useTrial } from 'api/trials';
import { useTrialResults } from 'api/results';

// assets
import PlusOutlined from '@ant-design/icons/PlusOutlined';

// ==============================|| TRIALS - RUNS ||============================== //

export default function TrialRuns() {
  const { trialId } = useParams();
  const navigate = useNavigate();

  const { data: trial, error: trialError, isLoading: trialLoading } = useTrial(trialId);
  // Flights come from the API; their processing state, flag counts and mean
  // cover come from api/results until the worker writes them onto the record.
  const { flights: runs, error: runsError, isLoading: runsLoading, mutate } = useTrialResults(trialId);
  const flagged = runs.reduce((sum, run) => sum + (run.flagged || 0), 0);

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
          subtitle={`${trial.crop} · ${trial.site} · ${trial.plots} plots`}
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
          {runsLoading && <LinearProgress sx={{ height: 2, mb: 2 }} />}

          <RunsTable
            runs={runs}
            onNewRun={goToUpload}
            onOpenRun={(run) => navigate(`/trials/${trial.id}/flights/${run.id}`)}
            onReviewRun={(run) => navigate(`/trials/${trial.id}/review?flight=${run.id}`)}
          />

          {runs.length > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                {runs.length} flight{runs.length === 1 ? '' : 's'} · newest first
                {runs[0]?.demo ? ' · fixture set until the first upload' : ''}
              </Typography>
            </Box>
          )}
        </TrialTabs>
      </Grid>
    </Grid>
  );
}
