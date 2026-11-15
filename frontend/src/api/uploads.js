import { useSyncExternalStore } from 'react';
import { mutate } from 'swr';

import { apiFetch } from './client';
import { flightsKey, trialKey } from './trials';
import { cancelSession, probeSession, safeFilename, sendToSession, UploadError, xhrTransport } from './uploadSession';

// ==============================|| API - FLIGHT UPLOADS ||============================== //

/**
 * Uploading a flight, from "Upload" to `uploaded`:
 *
 *   1. POST /api/trials/{id}/flights with the flight's facts and its files'
 *      names and sizes. The API records the flight (`awaiting_upload`) and
 *      answers with one upload URL per file.
 *   2. Each file goes straight to the bucket through its URL, in 8 MiB chunks
 *      (api/uploadSession.js). Nothing passes through the API.
 *   3. POST …/flights/{fid}/complete. The API checks every file arrived whole,
 *      marks the flight `uploaded` and starts ingest.
 *
 * The upload runs here, outside any component, so it carries on while the user
 * moves around the app; pages show its progress with `useFlightUpload`. Leaving
 * the page asks for confirmation while an upload runs.
 *
 * If the page is reloaded mid-upload, the files are no longer in memory, but the
 * URLs are kept in this browser's localStorage. On the flight's page the user
 * picks the same files again and the upload carries on from the bytes storage
 * already holds. A URL is a credential for its one file, so it lives only there,
 * and is deleted when the upload completes or is cancelled. From another browser
 * (no saved URLs), the API opens new sessions for the files that haven't arrived.
 */

const STORAGE_KEY = 'croplytix.uploads.v1'; // { [flightId]: { trialId, files: { [name]: { url, size, lastModified } } } }
const PROGRESS_INTERVAL_MS = 250;

// ---- the job list pages subscribe to ----------------------------------------------
// state: 'uploading' | 'completing' | 'paused' (the connection kept dropping) | 'failed'
let jobs = {};
const listeners = new Set();
const runtime = new Map(); // flightId → { trialId, entries, controller } — the parts that aren't plain data

function emit() {
  listeners.forEach((listener) => listener());
  guardUnload();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setJob(flightId, patch) {
  jobs = { ...jobs, [flightId]: { ...jobs[flightId], ...patch } };
  emit();
}

function dropJob(flightId) {
  const rest = { ...jobs };
  delete rest[flightId];
  jobs = rest;
  emit();
}

/** This flight's upload in this tab, or undefined: { state, loaded, total, current, error }. */
export function useFlightUpload(flightId) {
  return useSyncExternalStore(subscribe, () => (flightId ? jobs[flightId] : undefined));
}

// ---- leaving the page mid-upload --------------------------------------------------
function confirmLeaving(event) {
  event.preventDefault();
  event.returnValue = ''; // older browsers need it set to show the prompt
}

let guarding = false;
function guardUnload() {
  const active = Object.values(jobs).some((job) => job.state === 'uploading' || job.state === 'completing');
  if (active === guarding || typeof window === 'undefined') return;
  guarding = active;
  if (active) window.addEventListener('beforeunload', confirmLeaving);
  else window.removeEventListener('beforeunload', confirmLeaving);
}

// ---- saved upload URLs, for resuming after a reload --------------------------------
function readSaved() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeSaved(all) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // private window or storage full: a reload then reopens sessions instead of resuming them
  }
}

function saveEntries(flightId, trialId, entries) {
  const all = readSaved();
  all[flightId] = {
    trialId,
    files: Object.fromEntries(
      entries
        .filter((entry) => entry.url)
        .map((entry) => [entry.name, { url: entry.url, size: entry.size, lastModified: entry.file?.lastModified ?? null }])
    )
  };
  writeSaved(all);
}

function forget(flightId) {
  const all = readSaved();
  delete all[flightId];
  writeSaved(all);
}

// ---- running one flight's upload ---------------------------------------------------
const flightPath = (trialId, flightId, action = '') => `${flightsKey(trialId)}/${flightId}${action ? `/${action}` : ''}`;

/** Refetches the flights list and the trial's counts. A failed refetch only means stale numbers: never an upload error. */
async function refreshFlights(trialId) {
  await Promise.all([mutate(flightsKey(trialId)), mutate(trialKey(trialId))]).catch(() => {});
}

/** New sessions from the API for every entry that isn't done and has no usable URL. */
async function reopenSessions(trialId, flightId, entries) {
  const { uploads } = await apiFetch(flightPath(trialId, flightId, 'uploads'), { method: 'POST' });
  const urls = new Map(uploads.map((upload) => [upload.name, upload.url]));
  entries.forEach((entry) => {
    if (entry.done) return;
    if (urls.has(entry.name)) entry.url = urls.get(entry.name);
    else entry.done = true; // the API has it already
  });
}

async function run(trialId, flightId, entries, { reopened = false } = {}) {
  const controller = new AbortController();
  runtime.set(flightId, { trialId, entries, controller });
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  let doneBytes = entries.filter((entry) => entry.done).reduce((sum, entry) => sum + entry.size, 0);
  setJob(flightId, { flightId, trialId, state: 'uploading', loaded: doneBytes, total, current: null, error: null });

  try {
    // Smallest first: the shapefile is through in a moment, and only the ortho is left to wait for.
    for (const entry of [...entries].sort((a, b) => a.size - b.size)) {
      if (entry.done) continue;
      if (!entry.url) throw new UploadError('expired', `There is no upload link for ${entry.name}.`);
      setJob(flightId, { current: entry.name });
      let last = 0;
      await sendToSession(entry.url, entry.file, {
        transport: xhrTransport,
        signal: controller.signal,
        onProgress: (bytes) => {
          const now = Date.now();
          if (now - last < PROGRESS_INTERVAL_MS && bytes < entry.size) return;
          last = now;
          setJob(flightId, { loaded: doneBytes + bytes });
        }
      });
      entry.done = true;
      doneBytes += entry.size;
      setJob(flightId, { loaded: doneBytes });
    }

    setJob(flightId, { state: 'completing', current: null });
    await apiFetch(flightPath(trialId, flightId, 'complete'), { method: 'POST' });
    forget(flightId);
    runtime.delete(flightId);
    await refreshFlights(trialId); // the table shows `uploaded` before the progress row goes
    dropJob(flightId);
  } catch (error) {
    if (error instanceof UploadError && error.kind === 'cancelled') return; // cancelFlightUpload cleans up
    let failure = error;
    if (error instanceof UploadError && error.kind === 'expired' && !reopened) {
      // A week-old session, or one cancelled elsewhere: ask the API for new ones, once.
      try {
        await reopenSessions(trialId, flightId, entries);
        saveEntries(flightId, trialId, entries);
        await run(trialId, flightId, entries, { reopened: true });
        return;
      } catch (reopenError) {
        failure = reopenError;
      }
    }
    setJob(flightId, {
      state: failure instanceof UploadError && failure.kind === 'offline' ? 'paused' : 'failed',
      current: null,
      error: failure.message || 'The upload stopped.'
    });
  }
}

// ---- what pages call ------------------------------------------------------------------

/**
 * Creates the flight and starts sending its files. Resolves with the flight as
 * soon as it exists (status `awaiting_upload`); the bytes keep going in the
 * background. Rejects only if the API refuses the flight (the page shows why).
 *
 * @param files [{ role: 'ortho' | 'shapefile', file: File }]
 */
export async function startFlightUpload(trialId, meta, files) {
  const declared = files.map(({ role, file }) => ({ role, name: file.name, size: file.size }));
  const { flight, uploads } = await apiFetch(flightsKey(trialId), { method: 'POST', json: { meta, files: declared } });
  const urls = new Map(uploads.map((upload) => [upload.name, upload.url]));
  // The API keeps the order it was sent, and may have made a name safe to store.
  const entries = flight.files.map((stored, index) => ({
    name: stored.name,
    size: stored.bytes,
    file: files[index].file,
    url: urls.get(stored.name),
    done: false
  }));
  saveEntries(flight.id, trialId, entries);
  run(trialId, flight.id, entries);
  await refreshFlights(trialId);
  return flight;
}

/** Tries again after a pause or a failure, with the files still in memory (no reload since). */
export function canRetryInPlace(flightId) {
  return runtime.has(flightId);
}

export function retryFlightUpload(flightId) {
  const current = runtime.get(flightId);
  if (current) run(current.trialId, flightId, current.entries);
}

/**
 * Carries on an upload this tab no longer holds the files for — after a reload,
 * or in another browser. `picked` are the files the user chose again; each is
 * matched to the flight's record of it by name and size. Throws with what to
 * pick when a file that hasn't arrived is missing or isn't the same file.
 */
export async function resumeFlightUpload(trialId, flight, picked) {
  const saved = readSaved()[flight.id]?.files || {};
  const entries = flight.files.map((stored) => ({
    name: stored.name,
    size: stored.bytes,
    url: saved[stored.name]?.url || null,
    done: false
  }));

  // Ask storage where each saved session stands; an expired one needs a new session.
  let needSessions = false;
  for (const entry of entries) {
    if (entry.url) {
      try {
        const state = await probeSession(entry.url, entry.size, { transport: xhrTransport });
        entry.done = state.done;
      } catch (error) {
        if (!(error instanceof UploadError && error.kind === 'expired')) throw error;
        entry.url = null;
      }
    }
    if (!entry.done && !entry.url) needSessions = true;
  }
  if (needSessions) await reopenSessions(trialId, flight.id, entries);

  const missing = [];
  entries.forEach((entry) => {
    if (entry.done) return;
    const file = Array.from(picked).find((candidate) => safeFilename(candidate.name) === entry.name && candidate.size === entry.size);
    const lastModified = saved[entry.name]?.lastModified;
    if (!file) missing.push(entry.name);
    else if (lastModified && file.lastModified !== lastModified) {
      throw new Error(`${file.name} has changed since the upload started. Pick the original, or cancel this upload and start again.`);
    } else entry.file = file;
  });
  if (missing.length) throw new Error(`Choose ${missing.join(', ')} to finish this upload.`);

  saveEntries(flight.id, trialId, entries);
  run(trialId, flight.id, entries);
}

/**
 * Abandons the upload: stops it, tells storage to drop what it kept, and has
 * the API delete the flight. Throws if the API refuses (the upload finished first).
 */
export async function cancelFlightUpload(trialId, flightId) {
  const current = runtime.get(flightId);
  current?.controller.abort();
  const urls = current
    ? current.entries.filter((entry) => !entry.done && entry.url).map((entry) => entry.url)
    : Object.values(readSaved()[flightId]?.files || {}).map((file) => file.url);
  await Promise.all(urls.map((url) => cancelSession(url, { transport: xhrTransport })));
  try {
    await apiFetch(flightPath(trialId, flightId), { method: 'DELETE' });
    forget(flightId);
  } finally {
    runtime.delete(flightId);
    dropJob(flightId);
    await refreshFlights(trialId);
  }
}

/** Whether this browser kept the upload URLs for a flight (so a resume picks up mid-file). */
export function hasSavedUpload(flightId) {
  return Boolean(readSaved()[flightId]);
}
