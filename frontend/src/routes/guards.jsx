import PropTypes from 'prop-types';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';

// project imports
import Loader from 'components/Loader';
import useAuth from 'hooks/useAuth';
import { APP_DEFAULT_PATH } from 'config';

// ==============================|| ROUTE GUARDS ||============================== //

/**
 * Where to send someone after they sign in. Only paths inside this app are honoured:
 * `/trials/x` yes; `//evil.example`, `/\evil.example`, `https://…` no. A login page that
 * redirects anywhere it is told is a ready-made phishing link.
 */
export function safeReturnPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return APP_DEFAULT_PATH;
  if (/[\u0000-\u001f]/.test(raw)) return APP_DEFAULT_PATH;
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login/')) return APP_DEFAULT_PATH;
  return raw;
}

/**
 * Wraps everything behind the login. A signed-out visitor is sent to `/login`, carrying
 * the page they asked for in `?next=` — a Reviewer deep link survives the detour. The
 * landing page itself is left off, so the common case is a clean `/login`.
 */
export function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Loader />;
  if (status !== 'signed-in') {
    const here = `${location.pathname}${location.search}${location.hash}`;
    const to = here === '/' || here === APP_DEFAULT_PATH ? '/login' : `/login?next=${encodeURIComponent(here)}`;
    return <Navigate to={to} replace />;
  }
  return children;
}

/**
 * Wraps the login screen. Once there is a session — because the form just succeeded,
 * or because a signed-in user opened `/login` — it moves on to `?next=` or the landing
 * page. This is the only place a successful sign-in navigates from.
 */
export function GuestOnly({ children }) {
  const { status } = useAuth();
  const [params] = useSearchParams();

  if (status === 'loading') return <Loader />;
  if (status === 'signed-in') return <Navigate to={safeReturnPath(params.get('next'))} replace />;
  return children;
}

RequireAuth.propTypes = { children: PropTypes.node };
GuestOnly.propTypes = { children: PropTypes.node };
