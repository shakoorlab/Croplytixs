import useSWR from 'swr';

import { apiFetch, fetcher } from './client';

// ==============================|| API - TRIALS & FLIGHTS ||============================== //

/**
 * Read hooks are SWR: cached by path, shared between components, revalidated
 * when we say so (`mutate`). Focus-revalidation is off on purpose — every
 * revalidation is a Firestore read, and the free tier is 50k reads/day.
 *
 * The one exception is a trial's flight list while one of its flights is being
 * worked on (map copies building, or processing queued or running): then it
 * refreshes every 10 s, so progress moves on its own, and stops as soon as
 * nothing is under way. A status feed that pushes would be cheaper still.
 */
const opts = { revalidateOnFocus: false };
const WORKING_POLL_MS = 10000;

/** Whether a job is working on the flight right now. */
export function isWorking(flight) {
  return ['queued', 'running'].includes(flight?.status) || ['queued', 'running'].includes(flight?.ingest?.state);
}

export const trialsKey = () => '/api/trials';
export const trialKey = (trialId) => (trialId ? `/api/trials/${trialId}` : null);
export const flightsKey = (trialId) => (trialId ? `/api/trials/${trialId}/flights` : null);

/**
 * Every status the API can put on a flight — the `Flight.status` Literal in
 * backend/app/schemas.py — and what it means to whoever is looking at it.
 * Today the API writes `awaiting_upload` and `uploaded`; the processing worker
 * will move a flight through the rest. Pages show the record's status as it is.
 */
export const FLIGHT_STATUSES = {
  awaiting_upload: 'The files are on their way to storage. An interrupted upload can be resumed from the flight’s page.',
  uploaded: 'Files stored. Processing starts once the map copies are built, if the flight has a plot grid.',
  queued: 'In line for processing.',
  running: 'Finding canopy and assigning it to plots.',
  complete: 'Canopy measured for every plot.',
  failed: 'Processing stopped with an error. The flight’s page says why.'
};

export function useTrials() {
  return useSWR(trialsKey(), fetcher, opts);
}

export function useTrial(trialId) {
  return useSWR(trialKey(trialId), fetcher, opts);
}

export function useFlights(trialId) {
  return useSWR(flightsKey(trialId), fetcher, {
    ...opts,
    refreshInterval: (flights) => (Array.isArray(flights) && flights.some(isWorking) ? WORKING_POLL_MS : 0)
  });
}

/**
 * One flight, read out of the trial's flight list rather than its own
 * `GET …/flights/{fid}`: the Flights tab has nearly always fetched the list
 * already, so opening a row renders from cache at once, and the flight page
 * needs the whole list for its tab badge anyway. `flight` is undefined while
 * loading, null when the trial has no flight with that id.
 */
export function useFlight(trialId, flightId) {
  const { data, error, isLoading, mutate } = useFlights(trialId);
  const flight = data ? data.find((candidate) => candidate.id === flightId) || null : undefined;
  return { flight, flights: data, error, isLoading, mutate };
}

/** POST /api/trials — body is the dialog's form; the API mints the id. */
export function createTrial(form) {
  return apiFetch(trialsKey(), { method: 'POST', json: form });
}

/**
 * POST /api/trials/{id}/flights/{fid}/ingest — builds the flight's map copies
 * (lossless + viewing COG) again, after a failure or for a flight uploaded
 * before ingest existed. Answers 202 with the flight, its ingest `queued`.
 */
export function rerunIngest(trialId, flightId) {
  return apiFetch(`${flightsKey(trialId)}/${flightId}/ingest`, { method: 'POST' });
}

/**
 * POST /api/trials/{id}/flights/{fid}/process — measures canopy per plot as a
 * new result version. Ingest starts it by itself for a flight with a plot grid;
 * this is the retry, and the rerun. Answers 202 with the flight, its run `queued`.
 */
export function processFlight(trialId, flightId, { force = false } = {}) {
  return apiFetch(`${flightsKey(trialId)}/${flightId}/process${force ? '?force=true' : ''}`, { method: 'POST' });
}

/** Where a flight's results live. A version's results never change, so they cache for good. */
export const resultsPath = (trialId, flightId, version) =>
  `${flightsKey(trialId)}/${flightId}/results${version ? `?version=${version}` : ''}`;

/**
 * One result version of a flight — its current one unless `version` says
 * otherwise: { version, model, summary, warnings, plots: [...], versions: [...] }.
 * Nothing is fetched until the flight has a result.
 */
export function useFlightResults(trialId, flight, version) {
  const wanted = version || flight?.result?.version;
  return useSWR(wanted ? resultsPath(trialId, flight.id, wanted) : null, fetcher, { ...opts, revalidateIfStale: false });
}
