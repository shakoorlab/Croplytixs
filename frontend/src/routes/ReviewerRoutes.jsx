import { lazy } from 'react';

// project imports
import Loadable from 'components/Loadable';
import { RequireAuth } from './guards';

const Reviewer = Loadable(lazy(() => import('pages/trials/reviewer')));

// ==============================|| REVIEWER ROUTING ||============================== //

/**
 * The Reviewer is the one immersive mode: full-screen, keyboard-first, no
 * drawer or header. It is a sibling of the dashboard routes rather than a
 * child, so the layout chrome never mounts around it. Being one segment
 * deeper than `/trials/:trialId/review` keeps the gallery's URL stable and
 * makes Esc a plain navigation back up.
 */
const ReviewerRoutes = {
  path: '/trials/:trialId/review/session',
  element: (
    <RequireAuth>
      <Reviewer />
    </RequireAuth>
  )
};

export default ReviewerRoutes;
