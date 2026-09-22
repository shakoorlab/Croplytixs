import { useSyncExternalStore } from 'react';

// project imports
import { getSnapshot, signIn, signOut, subscribe } from 'api/auth';

// ==============================|| AUTH - HOOK ||============================== //

/**
 * `{ status, user, reason, signIn, signOut }` for the current session.
 *
 * A hook over a module-level store rather than a context provider — the same shape as
 * `api/labels.js` — so there is nothing to mount in App.jsx, and the store stays usable
 * outside React (api/client.js reads the token from it).
 *
 * `status` is 'loading' | 'signed-in' | 'signed-out'. The preview store is never
 * 'loading'; a real provider is until its first auth-state callback.
 */
export default function useAuth() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...session, signIn, signOut };
}
