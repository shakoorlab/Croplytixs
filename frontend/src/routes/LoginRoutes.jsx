import { lazy } from 'react';

// project imports
import Loadable from 'components/Loadable';
import { GuestOnly } from './guards';

const LoginPage = Loadable(lazy(() => import('pages/auth/Login')));

// ==============================|| AUTH ROUTING ||============================== //

/**
 * Sign-in is the only public page. There is deliberately no /register: accounts are
 * invite-only, granted by a project admin (canopy-cover-app-ux-framing.md).
 */
const LoginRoutes = {
  path: '/login',
  element: (
    <GuestOnly>
      <LoginPage />
    </GuestOnly>
  )
};

export default LoginRoutes;
