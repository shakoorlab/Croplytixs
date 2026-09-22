import { createBrowserRouter, Navigate } from 'react-router-dom';

// project imports
import MainRoutes from './MainRoutes';
import LoginRoutes from './LoginRoutes';
import ReviewerRoutes from './ReviewerRoutes';

// ==============================|| ROUTING RENDER ||============================== //

// An unknown address (a typo, or a bookmark to a page that no longer exists) goes back
// through '/', which resolves to the landing page or, signed out, to the login.
const NotFound = { path: '*', element: <Navigate to="/" replace /> };

const router = createBrowserRouter([ReviewerRoutes, MainRoutes, LoginRoutes, NotFound], {
  basename: import.meta.env.VITE_APP_BASE_NAME
});

export default router;
