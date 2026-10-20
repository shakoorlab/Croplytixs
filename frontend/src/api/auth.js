// ==============================|| AUTH - SESSION SERVICE ||============================== //

/**
 * The one place that knows how a user signs in: Identity Platform, through the Firebase
 * Auth SDK. The rest of the app only sees this module's exports — the snapshot
 * (`status`, `user`, `reason`), `signIn`, `signOut`, `getIdToken`, `expireSession` —
 * which is why swapping the preview out changed this file and nothing else.
 *
 *   signIn       → setPersistence(remember ? local : session), then signInWithEmailAndPassword
 *   signOut      → signOut(auth)
 *   subscribe    → onAuthStateChanged; the snapshot is `loading` until its first callback,
 *                  which the route guards render as a loader
 *   getIdToken   → auth.currentUser.getIdToken(); the SDK refreshes it before it expires,
 *                  and api/client.js sends it as `Authorization: Bearer`
 *
 * Accounts are invite-only: sign-up is disabled in Identity Platform and an admin adds
 * users, so there is deliberately no createUser call here.
 *
 * The web config below is not a secret — it ships in the JS bundle and only identifies
 * the project. It comes from frontend/.env at build time (VITE_FIREBASE_*), copied from
 * Identity Platform → Providers → Application setup details.
 */

import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut
} from 'firebase/auth';

/** Which provider is wired in; the login screen shows its preview hint only for 'preview'. */
export const AUTH_MODE = 'firebase';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
};

// A build without the config can't sign anyone in. Fail at sign-in with a clear
// message rather than at import, so the login page still renders and says why.
const auth = config.apiKey && config.authDomain ? getAuth(initializeApp(config)) : null;
if (!auth) console.error('Sign-in is not configured: set VITE_FIREBASE_API_KEY and VITE_FIREBASE_AUTH_DOMAIN in frontend/.env.');

// The preview kept its fake session under this key; nothing reads it any more.
try {
  window.localStorage.removeItem('croplytix.auth.v1');
  window.sessionStorage.removeItem('croplytix.auth.v1');
} catch {
  // storage unavailable — nothing to clean up
}

// ---- store (read with useSyncExternalStore, see hooks/useAuth) ----------------------

const SIGNED_OUT = Object.freeze({ status: 'signed-out', user: null, reason: null });

let snapshot = auth ? { status: 'loading', user: null, reason: null } : SIGNED_OUT;
const listeners = new Set();

// Why the next sign-out happened, for the login screen. Set just before we sign out
// on the user's behalf (the API refused the token); cleared once it has been shown.
let pendingReason = null;

function emit(next) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return snapshot;
}

// ---- identity ---------------------------------------------------------------------

/** Accounts added in the console have no display name, so derive one from the email. */
function toUser(firebaseUser) {
  const email = (firebaseUser.email || '').toLowerCase();
  const local = email.split('@')[0];
  const words = local.split(/[._+-]+/).filter(Boolean);
  const derived = words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
  const displayName = firebaseUser.displayName || derived || email || 'Signed in';
  const parts = displayName.split(/\s+/).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : displayName.slice(0, 2)).toUpperCase();
  return { uid: firebaseUser.uid, email, displayName, initials };
}

// Fires once on load (restored session or none), then on every sign-in and sign-out —
// including ones made in another tab, since local persistence is shared between tabs.
if (auth) {
  onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      emit({ status: 'signed-in', user: toUser(firebaseUser), reason: null });
    } else {
      emit({ status: 'signed-out', user: null, reason: pendingReason });
      pendingReason = null;
    }
  });
}

// ---- actions ----------------------------------------------------------------------

export async function signIn({ email, password, remember = false }) {
  if (!auth) throw new AuthError('auth/not-configured', 'Sign-in is not configured for this build.');
  // "Keep me signed in" → survives the browser closing; otherwise this tab only.
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return toUser(credential.user);
}

export function signOut() {
  pendingReason = null;
  return auth ? firebaseSignOut(auth) : Promise.resolve();
}

/**
 * The API refused our token even after a fresh one (api/client.js retries once). End the
 * session and say why, so the login screen can explain the interruption instead of
 * looking like a spontaneous logout. The route guard sends the user back afterwards.
 */
export function expireSession() {
  if (!auth?.currentUser) return;
  pendingReason = 'expired';
  firebaseSignOut(auth).catch(() => {});
}

/**
 * Bearer token for API calls, or null when signed out. The SDK caches the token and
 * refreshes it shortly before it expires; `forceRefresh` fetches a new one regardless.
 */
export async function getIdToken(forceRefresh = false) {
  const user = auth?.currentUser;
  return user ? user.getIdToken(forceRefresh) : null;
}
