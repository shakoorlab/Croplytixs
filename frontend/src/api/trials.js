import useSWR from 'swr';

import { apiFetch, apiUpload, fetcher } from './client';

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

export function useTrials() {
  return useSWR(trialsKey(), fetcher, opts);
}

export function useTrial(trialId) {
  return useSWR(trialKey(trialId), fetcher, opts);
}

export function useFlights(trialId) {
  return useSWR(flightsKey(trialId), fetcher, opts);
}

/** POST /api/trials — body is the dialog's form; the API mints the id. */
export function createTrial(form) {
  return apiFetch(trialsKey(), { method: 'POST', json: form });
}

/**
 * POST /api/trials/{id}/flights — multipart: a JSON `meta` field plus the files
 * under the part names the backend expects (`ortho`, `shapefile` ×N, `clipped` ×N).
 */
export function createFlight(trialId, { meta, ortho = null, shapefile = [], clipped = [] }, { onProgress } = {}) {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  if (ortho) form.append('ortho', ortho, ortho.name);
  shapefile.forEach((file) => form.append('shapefile', file, file.name));
  clipped.forEach((file) => form.append('clipped', file, file.name));
  return apiUpload(flightsKey(trialId), form, { onProgress });
}
