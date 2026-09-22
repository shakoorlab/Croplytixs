// ==============================|| AUTH - SESSION SERVICE ||============================== //

/**
 * The one place that knows how a user signs in.
 *
 * Today this is a preview: any well-formed email with a non-empty password gets a
 * session, because the backend has no identity provider yet (backend-architecture.md,
 * "Deliberately not built yet" #1). Everything the rest of the app touches is modelled
 * on Firebase Auth / Identity Platform — the snapshot's `status`, `signIn`, `signOut`,
 * `getIdToken`, and the error codes — so swapping the provider in changes this file and
 * nothing else:
 *
 *   signIn       → setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence),
 *                  then signInWithEmailAndPassword(auth, email, password)
 *   signOut      → signOut(auth)
 *   subscribe    → onAuthStateChanged(auth, …); the snapshot starts as `loading` until the
 *                  first callback, which the route guards already handle
 *   getIdToken   → auth.currentUser?.getIdToken() — api/client.js sends it as `Authorization: Bearer`
 *   AUTH_MODE    → 'firebase', which retires the preview hint on the login screen
 *
 * The error codes below are Firebase's, so the login form's messages keep working after
 * the swap.
 */

/** 'preview' until a real identity provider is wired in; the login screen says so while it is. */
export const AUTH_MODE = 'preview';

const STORAGE_KEY = 'croplytix.auth.v1';
const PREVIEW_LATENCY_MS = 450; // long enough that the button's pending state is real, not a flicker

const SIGNED_OUT = Object.freeze({ status: 'signed-out', user: null, reason: null });

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

// ---- persistence ------------------------------------------------------------------
// "Keep me signed in" → localStorage (survives the browser closing); otherwise
// sessionStorage (this tab only). Accessing either can throw in locked-down browsers,
// in which case the session simply lives in memory for this tab.

function storage(kind) {
  try {
    return window[kind] ?? null;
  } catch {
    return null;
  }
}

function readStored() {
  for (const kind of ['sessionStorage', 'localStorage']) {
    try {
      const raw = storage(kind)?.getItem(STORAGE_KEY);
      const user = raw ? JSON.parse(raw)?.user : null;
      if (user?.email) return { status: 'signed-in', user, reason: null };
    } catch {
      // unreadable or corrupt entry — fall through and treat as signed out
    }
  }
  return SIGNED_OUT;
}

function clearStored() {
  for (const kind of ['sessionStorage', 'localStorage']) {
    try {
      storage(kind)?.removeItem(STORAGE_KEY);
    } catch {
      // nothing to clear
    }
  }
}

// ---- store (read with useSyncExternalStore, see hooks/useAuth) ----------------------

let snapshot = readStored();
const listeners = new Set();

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

// A remembered session is shared by every tab, so signing out in one signs out the rest.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) emit(readStored());
  });
}

// ---- identity ---------------------------------------------------------------------

/** "a.mercier@lab.org" → { displayName: "A Mercier", initials: "AM" }. A real provider supplies these. */
function userFromEmail(email) {
  const normalized = email.trim().toLowerCase();
  const local = normalized.split('@')[0];
  const words = local.split(/[._+-]+/).filter(Boolean);
  const displayName = words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ') || normalized;
  const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : local.slice(0, 2)).toUpperCase();
  return { uid: `preview:${normalized}`, email: normalized, displayName, initials };
}

// ---- actions ----------------------------------------------------------------------

export async function signIn({ email, password, remember = false }) {
  await new Promise((resolve) => setTimeout(resolve, PREVIEW_LATENCY_MS));

  if (!EMAIL_PATTERN.test((email ?? '').trim()) || !password) {
    throw new AuthError('auth/invalid-credential', 'Email or password is incorrect.');
  }

  const user = userFromEmail(email);
  clearStored();
  try {
    storage(remember ? 'localStorage' : 'sessionStorage')?.setItem(
      STORAGE_KEY,
      JSON.stringify({ user, signedInAt: new Date().toISOString() })
    );
  } catch {
    // storage unavailable — the session still holds for this tab
  }
  emit({ status: 'signed-in', user, reason: null });
  return user;
}

export function signOut() {
  clearStored();
  emit(SIGNED_OUT);
  return Promise.resolve();
}

/**
 * The API answered 401: the token is gone or no longer accepted. Drop the session and
 * say why, so the login screen can explain the interruption instead of looking like a
 * spontaneous logout. The route guard sends the user back to where they were afterwards.
 */
export function expireSession() {
  clearStored();
  emit({ status: 'signed-out', user: null, reason: 'expired' });
}

/** Bearer token for API calls. The preview has none, so no header is sent. */
export async function getIdToken() {
  return null;
}
