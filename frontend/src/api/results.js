import { useMemo } from 'react';
import useSWR from 'swr';

import { fetcher } from './client';
import { resultsPath, useFlights, useTrial } from './trials';

// ==============================|| API - RESULTS ||============================== //

/**
 * Per-plot results for every flight of a trial — what Review, the Reviewer and
 * Traits are built on. Each processed flight carries a summary of its current
 * result (`flight.result`); the plots themselves come from
 * `GET /api/trials/{id}/flights/{fid}/results?version=n`, fetched together for
 * every flight that has one. A version never changes once written, so those
 * stay cached.
 *
 * Each plot is what the processing job wrote (backend/app/pipeline/report.py):
 * `areaCm2`/`areaM2` are the watershed's canopy area (including canopy past
 * the plot's box), `cover` is canopy inside the box as % of the box,
 * `confidence` is the model's certainty over the box (0–1) and `flag` is the
 * most serious QC flag, if any. Review decisions aren't stored yet, so every
 * flagged plot is `pending` and the rest `passed` (QcChip: "Auto-passed");
 * `accepted` and `rejected` are left for a reviewer.
 */

export const FLAG_LABELS = {
  'near-zero': 'Near-zero cover — failed plot?',
  'low-confidence': 'Low model confidence',
  'cut-by-reach': 'Canopy cut at the reach limit — may be undercounted',
  'lost-to-neighbour': 'A neighbour took canopy inside this box',
  saturated: 'Cover at ceiling — alley or weeds in the box?',
  'cover-jump': 'Cover dropped since previous date',
  'edge-artefact': 'Mask touches the plot boundary'
};

const NONE = [];
const DAY_MS = 86400000;
// The rule the Traits page states, until a trial records its planting date.
const PLANTING_BEFORE_FIRST_FLIGHT_DAYS = 21;

function plantingFor(flights) {
  const first = flights
    .map((flight) => flight.flightDate)
    .filter(Boolean)
    .sort()[0];
  if (!first) return null;
  return new Date(Date.parse(`${first}T00:00:00Z`) - PLANTING_BEFORE_FIRST_FLIGHT_DAYS * DAY_MS).toISOString().slice(0, 10);
}

async function fetchAll(paths) {
  return Promise.all(paths.map((path) => fetcher(path)));
}

/** Returns { trial, flights, anchorId, planting, isLoading, error, trialError, mutate }. Flights are newest first. */
export function useTrialResults(trialId) {
  const trialQuery = useTrial(trialId);
  const flightsQuery = useFlights(trialId);
  const flights = flightsQuery.data || NONE;

  const withResults = flights.filter((flight) => flight.result);
  const paths = withResults.map((flight) => resultsPath(trialId, flight.id, flight.result.version));
  const resultsQuery = useSWR(paths.length ? ['trial-results', ...paths] : null, ([, ...keys]) => fetchAll(keys), {
    revalidateOnFocus: false,
    revalidateIfStale: false
  });

  const planting = useMemo(() => plantingFor(flights), [flights]);
  const enriched = useMemo(() => {
    const byId = new Map();
    (resultsQuery.data || []).forEach((result) => byId.set(result.flightId, result));
    return flights.map((flight) => {
      const result = byId.get(flight.id);
      const dap =
        planting && flight.flightDate
          ? Math.round((Date.parse(`${flight.flightDate}T00:00:00Z`) - Date.parse(`${planting}T00:00:00Z`)) / DAY_MS)
          : null;
      return {
        ...flight,
        dap,
        results: result ? { plots: result.plots, summary: result.summary, version: result.version, model: result.model } : null
      };
    });
  }, [flights, resultsQuery.data, planting]);

  // The newest flight with results: the one Review and the Reviewer open on.
  const anchorId = enriched.find((flight) => flight.results)?.id || null;

  return {
    trial: trialQuery.data,
    flights: enriched,
    anchorId,
    planting,
    isLoading: trialQuery.isLoading || flightsQuery.isLoading || (paths.length > 0 && resultsQuery.isLoading),
    trialError: trialQuery.error,
    error: flightsQuery.error || resultsQuery.error,
    mutate: flightsQuery.mutate
  };
}
