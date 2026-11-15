import { useMemo } from 'react';

import { useFlights, useTrial } from './trials';

// ==============================|| API - RESULTS ||============================== //

/**
 * Per-plot results for every flight of a trial — what Review, the Reviewer and
 * Traits are built on. The processing worker that writes them doesn't exist
 * yet, so the API serves none, and every flight comes back with
 * `results: null`. The pages show their empty states ("Nothing to review
 * yet", "No processed flights yet") instead of made-up numbers.
 *
 * The flights themselves are real: `GET /api/trials/{id}/flights`, with each
 * flight's status as the record has it.
 *
 * When the worker lands: keep the return shape and fill `results`
 * ({ plots, summary }) from `GET /api/trials/{id}/flights/{fid}/results` for
 * the flights that are `complete`; `anchorId` is the newest of those.
 */

export const FLAG_LABELS = {
  'low-confidence': 'Low model confidence',
  'near-zero': 'Near-zero cover — failed plot?',
  saturated: 'Cover at ceiling — alley in the clip?',
  'cover-jump': 'Cover dropped since previous date',
  'edge-artefact': 'Mask touches the plot boundary'
};

/** Returns { trial, flights, anchorId, planting, isLoading, error, trialError, mutate }. Flights are newest first. */
export function useTrialResults(trialId) {
  const trialQuery = useTrial(trialId);
  const flightsQuery = useFlights(trialId);

  const flights = useMemo(() => (flightsQuery.data || []).map((flight) => ({ ...flight, results: null })), [flightsQuery.data]);

  return {
    trial: trialQuery.data,
    flights,
    anchorId: null,
    planting: null,
    isLoading: trialQuery.isLoading || flightsQuery.isLoading,
    trialError: trialQuery.error,
    error: flightsQuery.error,
    mutate: flightsQuery.mutate
  };
}
