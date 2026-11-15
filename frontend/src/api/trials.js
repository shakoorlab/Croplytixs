import useSWR from 'swr';

import { apiFetch, fetcher } from './client';

// ==============================|| API - TRIALS & FLIGHTS ||============================== //

/**
 * Read hooks are SWR: cached by path, shared between components, revalidated
 * when we say so (`mutate`). Focus-revalidation is off on purpose — every
 * revalidation is a Firestore read, and the free tier is 50k reads/day. Nothing
 * polls yet either; that arrives with the processing worker, and even then a
 * status feed should push rather than have every open tab poll.
 */
const opts = { revalidateOnFocus: false };

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
  uploaded: 'Files stored; waiting for the processing worker.',
  queued: 'In line for the processing worker.',
  running: 'Clipping plots and segmenting canopy.',
  complete: 'Processing finished.',
  failed: 'Processing stopped with an error.'
};

export function useTrials() {
  return useSWR(trialsKey(), fetcher, opts);
}

export function useTrial(trialId) {
  return useSWR(trialKey(trialId), fetcher, opts);
}

export function useFlights(trialId) {
  return useSWR(flightsKey(trialId), fetcher, opts);
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
