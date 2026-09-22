import { lazy } from 'react';
import { Navigate } from 'react-router-dom';

// project imports
import Loadable from 'components/Loadable';
import DashboardLayout from 'layout/Dashboard';
import { RequireAuth } from './guards';

// render - trials
const TrialsLobby = Loadable(lazy(() => import('pages/trials/index')));
const TrialRuns = Loadable(lazy(() => import('pages/trials/runs')));
const FlightDateSetup = Loadable(lazy(() => import('pages/trials/flight-date-setup')));
const FlightDetail = Loadable(lazy(() => import('pages/trials/flight')));
const TrialReview = Loadable(lazy(() => import('pages/trials/review')));
const TrialTraits = Loadable(lazy(() => import('pages/trials/traits')));

// render - models (back-of-house)
const ModelRegistry = Loadable(lazy(() => import('pages/models/registry')));
const LabelPool = Loadable(lazy(() => import('pages/models/label-pool')));
const TrainingRuns = Loadable(lazy(() => import('pages/models/training-runs')));
const TrainingRunDetail = Loadable(lazy(() => import('pages/models/training-run')));
const Benchmark = Loadable(lazy(() => import('pages/models/benchmark')));

// ==============================|| MAIN ROUTING ||============================== //

const MainRoutes = {
  path: '/',
  // Every page under the dashboard chrome needs a session; see routes/guards.
  element: (
    <RequireAuth>
      <DashboardLayout />
    </RequireAuth>
  ),
  children: [
    {
      // Field Trials is the app's landing page. A redirect rather than rendering the
      // lobby at '/' keeps one canonical URL, so the drawer's active-item highlight
      // and the 'Croplytix' breadcrumb both resolve to the same route.
      index: true,
      element: <Navigate to="/trials" replace />
    },
    {
      path: 'trials',
      children: [
        {
          index: true,
          element: <TrialsLobby />
        },
        {
          path: ':trialId',
          element: <TrialRuns />
        },
        {
          path: ':trialId/flights',
          element: <TrialRuns />
        },
        {
          path: ':trialId/flights/new',
          element: <FlightDateSetup />
        },
        {
          path: ':trialId/flights/:flightId',
          element: <FlightDetail />
        },
        {
          path: ':trialId/review',
          element: <TrialReview />
        },
        {
          path: ':trialId/traits',
          element: <TrialTraits />
        }
      ]
    },
    {
      // Models is its own area with the same tabbed-workspace shell as a trial.
      // The Reviewer (full-screen) lives outside this layout — see routes/index.
      path: 'models',
      children: [
        {
          index: true,
          element: <ModelRegistry />
        },
        {
          path: 'labels',
          element: <LabelPool />
        },
        {
          path: 'runs',
          element: <TrainingRuns />
        },
        {
          path: 'runs/:runId',
          element: <TrainingRunDetail />
        },
        {
          path: 'benchmark',
          element: <Benchmark />
        }
      ]
    }
  ]
};

export default MainRoutes;
