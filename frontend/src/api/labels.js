import { useSyncExternalStore } from 'react';

// ==============================|| API - LABELS & QC DECISIONS ||============================== //

/**
 * Every Reviewer decision lands here. This is the seam the UX framing insists
 * on building first: a QC correction and a training label are the same
 * artifact, so the store records both the decision (accept / reject) and the
 * label provenance (rough vs training-grade, use-for-training, author, time).
 *
 * Until `POST /api/labels` exists the store lives in the browser — kept in
 * localStorage so a demo survives a reload, keyed by trial and flight so two
 * trials never see each other's decisions. Swapping it for the API means
 * replacing `persist()` with a request and `load()` with a fetch; the hook
 * signatures below do not change.
 *
 * Shape: { [trialId]: { [flightId]: { [plotId]: Decision } } }
 * Decision: { decision: 'accepted' | 'rejected', edited, coverBefore, coverAfter,
 *             useForTraining, grade: 'rough' | 'training-grade', author, at }
 */

const STORAGE_KEY = 'croplytix.demo.labels.v1';
const EMPTY = Object.freeze({});

function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persist(next) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // private mode, quota, or no storage at all — the session still works in memory
  }
}

let state = load();
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

export function useLabelStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Decisions for one flight, keyed by plotId. Stable empty object when there are none. */
export function useDecisions(trialId, flightId) {
  const store = useLabelStore();
  return store[trialId]?.[flightId] || EMPTY;
}

export function recordDecision(trialId, flightId, plotId, decision) {
  const trial = state[trialId] || {};
  const flight = trial[flightId] || {};
  state = {
    ...state,
    [trialId]: {
      ...trial,
      [flightId]: {
        ...flight,
        [plotId]: { author: 'you', ...decision, at: new Date().toISOString() }
      }
    }
  };
  persist(state);
  emit();
}

export function clearDecisions(trialId, flightId) {
  if (!state[trialId]?.[flightId]) return;
  const rest = { ...state[trialId] };
  delete rest[flightId];
  state = { ...state, [trialId]: rest };
  persist(state);
  emit();
}

/** Every decision in the store as a flat list — what the label pool reads. */
export function flattenLabels(store) {
  const rows = [];
  Object.entries(store).forEach(([trialId, flights]) => {
    Object.entries(flights).forEach(([flightId, plots]) => {
      Object.entries(plots).forEach(([plotId, decision]) => {
        rows.push({ trialId, flightId, plotId, ...decision });
      });
    });
  });
  return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
}
