import { useCallback } from 'react';
import { useSWRConfig } from 'swr';

// project imports
import { apiFetch } from './client';
import { flightsKey, resultsPath, trialsKey } from './trials';

// ==============================|| API - REVIEW DECISIONS ||============================== //

/**
 * Accept or reject a plot's measurement, or take the decision back.
 *
 * `PUT …/results/{version}/decisions/{plotId}` {decision} and `DELETE` the same
 * path, on the flight's current result only (backend/app/review.py). The
 * server merges decisions into every read of the result — a plot's `qc`
 * becomes `accepted` or `rejected`, and the summary's counts follow — and
 * keeps the flight's pending count, so the Flights table and the trials list
 * agree without being told.
 *
 * Here the change shows at once: the cached results are patched before the
 * request, then with the server's answer, or put back if it fails. The caller
 * gets the error to show.
 */

export const decisionPath = (trialId, flightId, version, plotId) =>
  `${flightsKey(trialId)}/${flightId}/results/${version}/decisions/${encodeURIComponent(plotId)}`;

/** What a plot is without a person's decision: the model's call. */
const modelQc = (plot) => (plot.flags?.length || plot.flag ? 'pending' : 'passed');

function patchResult(result, plotId, plot, summary) {
  return {
    ...result,
    plots: result.plots.map((candidate) => (candidate.plotId === plotId ? plot : candidate)),
    ...(summary && { summary })
  };
}

/** Returns `decide(flight, plot, decision)`: decision is 'accepted', 'rejected' or null to clear. Resolves with the server's plot. */
export function useDecide(trialId) {
  const { mutate } = useSWRConfig();

  return useCallback(
    async (flight, plot, decision) => {
      const version = flight.results?.version ?? flight.result?.version;
      const path = resultsPath(trialId, flight.id, version);
      // Review and Traits read every flight's results under one array key; the
      // flight page reads this version under its own.
      const isTrialResults = (key) => Array.isArray(key) && key[0] === 'trial-results' && key.includes(path);
      const apply = (next, summary) => {
        mutate(
          isTrialResults,
          (data) =>
            data?.map((result) =>
              result.flightId === flight.id && result.version === version ? patchResult(result, plot.plotId, next, summary) : result
            ),
          { revalidate: false }
        );
        mutate(path, (data) => (data ? patchResult(data, plot.plotId, next, summary) : data), { revalidate: false });
      };

      apply({
        ...plot,
        qc: decision || modelQc(plot),
        decision: decision ? { decision, version, by: null, at: new Date().toISOString(), stale: false, saving: true } : null
      });
      try {
        const outcome = await apiFetch(decisionPath(trialId, flight.id, version, plot.plotId), {
          method: decision ? 'PUT' : 'DELETE',
          ...(decision && { json: { decision } })
        });
        apply(outcome.plot, outcome.summary);
        mutate(flightsKey(trialId));
        mutate(trialsKey());
        return outcome.plot;
      } catch (err) {
        apply(plot);
        throw err;
      }
    },
    [trialId, mutate]
  );
}
