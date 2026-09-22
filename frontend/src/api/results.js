import { useEffect, useMemo, useState } from 'react';

import { useDemoBundle } from './demo';
import { useLabelStore } from './labels';
import { useFlights, useTrial } from './trials';
import { between, gaussian, unit } from 'utils/seeded';

// ==============================|| API - RESULTS (demo synthesis) ||============================== //

/**
 * Per-plot results for every flight of a trial — what the processing worker
 * will eventually write onto the flight record. Until it exists, this module
 * stands in for it, and it does so *on top of the real flights* rather than
 * beside them:
 *
 *   - Flights come from `GET /api/trials/{id}/flights`. A flight the API still
 *     calls `uploaded` is shown as `running` for ten minutes after its upload,
 *     then `complete` — the same transition the worker will make, so the
 *     Flights, Review and Traits tabs agree with each other today and keep
 *     agreeing once the worker is real.
 *   - A trial with no flights at all borrows four fixture flights so its tabs
 *     are not empty. They vanish the moment a real flight is uploaded.
 *   - The most recent complete flight is the *anchor*: its per-plot results are
 *     the U-Net's real output on the Roujol A clips (see api/demo.js), and its
 *     flags are the plots the model was genuinely unsure about. Every other
 *     date is a logistic growth curve drawn through that real point, so the
 *     growth dynamics in Traits are consistent with the pictures in Review.
 *
 * Everything is deterministic — see utils/seeded.js — so a plot flagged today
 * is flagged after a reload. Reviewer decisions overlay the synthesis through
 * the label store (api/labels.js).
 *
 * Replacing this with the API: `useTrialResults` keeps its return shape; the
 * body becomes a fetch of `GET /api/trials/{id}/flights/{fid}/results`.
 */

export const PROCESSING_SECONDS = 600;
const DAY = 86400000;
const GRID_COLS = 12;

export const FLAG_LABELS = {
  'low-confidence': 'Low model confidence',
  'near-zero': 'Near-zero cover — failed plot?',
  saturated: 'Cover at ceiling — alley in the clip?',
  'cover-jump': 'Cover dropped since previous date',
  'edge-artefact': 'Mask touches the plot boundary'
};

// ---------------------------------------------------------------------------
// fixture flights
// ---------------------------------------------------------------------------

function noon(daysAgo) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  return new Date(date.getTime() - daysAgo * DAY);
}

const isoDate = (date) => date.toISOString().slice(0, 10);

/** Four flights spanning the last six weeks; the newest is still processing. */
export function demoFlights(trialId) {
  const make = (daysAgo, status, progress) => {
    const at = noon(daysAgo);
    const date = isoDate(at);
    return {
      id: `demo-${date}`,
      trialId,
      flightDate: date,
      source: 'ortho',
      capture: '12-ms',
      captureLabel: '12 m · multispectral',
      plots: 142,
      model: 'canopy-seg · MS-12m · v2.1',
      modelId: 'canopy-seg-ms12-v2.1',
      denominator: 'polygon',
      status,
      progress,
      flagged: null,
      meanCover: null,
      error: null,
      createdBy: 'J. Stanton',
      createdAt: at.toISOString(),
      offset: { dxCm: 3.4, dyCm: -1.1, rotDeg: 0 },
      insetCm: 10,
      mapping: { identity: 'single', plot_id: 'PLOT_NO', genotype: 'GENO', rep: 'REP' },
      ortho: {
        name: `ortho_${date.replace(/-/g, '')}.tif`,
        bytes: 4509715660,
        width: 18240,
        height: 12160,
        bandCount: 5,
        colourBandCount: 5,
        epsg: 32620,
        crs: 'EPSG:32620',
        gsdCm: 2.3
      },
      shapefile: {
        name: `plots_${date.replace(/-/g, '')}.zip`,
        bytes: 184320,
        members: ['.shp', '.shx', '.dbf', '.prj'],
        featureCount: 142,
        fields: ['PLOT_NO', 'GENO', 'REP', 'BLOCK', 'ROW', 'RANGE'],
        epsg: 32620,
        crs: 'EPSG:32620'
      },
      files: [],
      demo: true
    };
  };
  return [make(2, 'running', 62), make(17, 'complete', 100), make(31, 'complete', 100), make(45, 'complete', 100)];
}

// ---------------------------------------------------------------------------
// status: what the worker would have done by now
// ---------------------------------------------------------------------------

function derivedStatus(flight, now) {
  if (flight.status !== 'uploaded') return { status: flight.status, progress: flight.progress ?? 0 };
  const age = (now - new Date(flight.createdAt).getTime()) / 1000;
  if (age < PROCESSING_SECONDS)
    return { status: 'running', progress: Math.min(99, Math.max(1, Math.round((age / PROCESSING_SECONDS) * 100))) };
  return { status: 'complete', progress: 100 };
}

// ---------------------------------------------------------------------------
// plots: roster + growth model
// ---------------------------------------------------------------------------

export const plotIdOf = (plot) => `P${String((plot.row - 1) * GRID_COLS + plot.col).padStart(3, '0')}`;

/** Rep numbers fall out of genotype repeats in field order. */
function rosterOf(bundle) {
  const seen = {};
  return bundle.plots.map((plot) => {
    seen[plot.genotype] = (seen[plot.genotype] || 0) + 1;
    return { ...plot, plotId: plotIdOf(plot), rep: seen[plot.genotype], plotAreaCm2: plot.inPlotPx * plot.gsdCm * plot.gsdCm };
  });
}

const dapOf = (date, planting) => Math.round((new Date(date).getTime() - planting.getTime()) / DAY);

function curveParams(trialId, stem) {
  return { r: between(0.07, 0.13, trialId, stem, 'r'), t50: between(28, 58, trialId, stem, 't50') };
}

/**
 * Logistic cover curve forced through the anchor date's real value, so the
 * synthetic dates and the real one describe one plant.
 */
function coverAt(plot, params, t, anchorT) {
  const real = Math.max(plot.cover, 0.3);
  let ceiling = real * (1 + Math.exp(-params.r * (anchorT - params.t50)));
  let { t50 } = params;
  if (ceiling > 100) {
    ceiling = 100;
    t50 = anchorT + Math.log(100 / real - 1) / params.r;
  }
  return ceiling / (1 + Math.exp(-params.r * (t - t50)));
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------------------
// synthesis
// ---------------------------------------------------------------------------

/**
 * The anchor's flags are the model's own uncertainty on the real clips. The
 * threshold moves a little per trial (0.16–0.21) so two trials do not show
 * the identical queue; the plots at the top of the list are the same ones the
 * U-Net was least sure about either way.
 */
const anchorThreshold = (trialId) => 0.16 + unit(trialId, 'flag-threshold') * 0.05;

export function anchorFlags(plot, trialId) {
  if (plot.uncertain >= anchorThreshold(trialId)) return 'low-confidence';
  if (plot.cover < 2) return 'near-zero';
  if (plot.cover > 97) return 'saturated';
  return null;
}

function synthesizeFlight({ bundle, roster, trialId, flight, previous, planting, anchor, decisions }) {
  const isAnchor = flight.id === anchor.id;
  const anchorT = dapOf(anchor.flightDate, planting);
  const t = dapOf(flight.flightDate, planting);
  const reviewedEarlier = flight.flightDate < anchor.flightDate;

  const plots = roster.map((plot) => {
    const params = curveParams(trialId, plot.stem);
    let modelCover;
    let flag = null;
    let confidence;

    if (isAnchor) {
      modelCover = plot.cover;
      flag = anchorFlags(plot, trialId);
      confidence = clamp(1 - plot.uncertain * 2.2, 0.3, 0.99);
    } else {
      modelCover = clamp(coverAt(plot, params, t, anchorT) + gaussian(trialId, flight.id, plot.stem) * 1.2, 0, 100);
      if (unit(trialId, flight.id, plot.stem, 'flag') < 0.08) {
        const pick = unit(trialId, flight.id, plot.stem, 'reason');
        if (pick < 0.55) flag = 'low-confidence';
        else if (pick < 0.8 && previous) flag = 'cover-jump';
        else flag = 'edge-artefact';
      }
      if (flag === 'cover-jump') modelCover = clamp(modelCover - between(7, 14, trialId, flight.id, plot.stem, 'jump'), 0, 100);
      confidence =
        flag === 'low-confidence'
          ? between(0.35, 0.55, trialId, flight.id, plot.stem, 'conf')
          : clamp(0.7 + gaussian(trialId, flight.id, plot.stem, 'conf') * 0.1, 0.5, 0.98);
    }

    const audit = !flag && unit(trialId, flight.id, plot.stem, 'audit') < 0.035;
    const inQueue = Boolean(flag) || audit;

    // a decision made in this browser wins; older flights arrive already reviewed
    let decision = decisions[plot.plotId] || null;
    if (!decision && inQueue && reviewedEarlier) {
      const edited = unit(trialId, flight.id, plot.stem, 'edited') < 0.4;
      const shift = edited ? gaussian(trialId, flight.id, plot.stem, 'shift') * 4 : 0;
      decision = {
        decision: unit(trialId, flight.id, plot.stem, 'verdict') < 0.93 ? 'accepted' : 'rejected',
        edited,
        coverBefore: modelCover,
        coverAfter: clamp(modelCover + shift, 0, 100),
        useForTraining: true,
        grade: edited && unit(trialId, flight.id, plot.stem, 'grade') < 0.6 ? 'training-grade' : 'rough',
        author: 'A. Mercier',
        at: new Date(new Date(flight.createdAt).getTime() + DAY).toISOString()
      };
    }

    const cover = decision?.decision === 'accepted' && decision.edited ? decision.coverAfter : modelCover;
    let qc = 'passed';
    if (decision) qc = decision.decision;
    else if (inQueue) qc = 'pending';

    return {
      plotId: plot.plotId,
      stem: plot.stem,
      row: plot.row,
      col: plot.col,
      genotype: plot.genotype,
      rep: plot.rep,
      cover,
      modelCover,
      areaCm2: (cover / 100) * plot.plotAreaCm2,
      plotAreaCm2: plot.plotAreaCm2,
      confidence,
      flag,
      flagLabel: flag ? FLAG_LABELS[flag] : null,
      audit,
      qc,
      decision,
      demo: plot
    };
  });

  const usable = plots.filter((plot) => plot.qc !== 'rejected');
  const summary = {
    plots: plots.length,
    flaggedTotal: plots.filter((plot) => plot.flag).length,
    pending: plots.filter((plot) => plot.qc === 'pending').length,
    pendingFlags: plots.filter((plot) => plot.qc === 'pending' && plot.flag).length,
    audit: plots.filter((plot) => plot.audit).length,
    accepted: plots.filter((plot) => plot.qc === 'accepted').length,
    rejected: plots.filter((plot) => plot.qc === 'rejected').length,
    edited: plots.filter((plot) => plot.decision?.edited).length,
    meanCover: usable.length ? usable.reduce((sum, plot) => sum + plot.cover, 0) / usable.length : null,
    dap: t
  };

  return { plots, summary };
}

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

/** Ticks every few seconds only while something is still processing. */
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The trial's flights with results attached. Newest first, like the API.
 *
 * Returns { trial, flights, anchorId, planting, isLoading, error, mutate }.
 * Each flight carries `results` ({ plots, summary }) once complete, and the
 * derived `status`, `progress`, `flagged` (pending flags) and `meanCover`
 * columns the runs table renders.
 */
export function useTrialResults(trialId) {
  const trialQuery = useTrial(trialId);
  const flightsQuery = useFlights(trialId);
  const bundleQuery = useDemoBundle();
  const store = useLabelStore();

  const rawFlights = flightsQuery.data;
  const processing = Boolean(
    rawFlights?.some((flight) => flight.status === 'uploaded' && derivedStatus(flight, Date.now()).status === 'running')
  );
  const now = useNow(processing);

  const value = useMemo(() => {
    const bundle = bundleQuery.data;
    if (!rawFlights || !bundle) return null;

    const source = rawFlights.length ? rawFlights : demoFlights(trialId);
    const withStatus = source
      .map((flight) => ({ ...flight, ...derivedStatus(flight, now) }))
      .sort((a, b) => (a.flightDate < b.flightDate ? 1 : a.flightDate > b.flightDate ? -1 : 0));

    const complete = withStatus.filter((flight) => flight.status === 'complete');
    const earliest = withStatus.reduce((min, flight) => (flight.flightDate < min ? flight.flightDate : min), withStatus[0]?.flightDate);
    const planting = new Date(new Date(earliest).getTime() - 21 * DAY);
    const anchor = complete[0] || null;
    const roster = rosterOf(bundle);
    const decisionsFor = (flightId) => store[trialId]?.[flightId] || {};

    const ascending = [...complete].reverse();
    const flights = withStatus.map((flight) => {
      if (flight.status !== 'complete')
        return { ...flight, results: null, flagged: null, meanCover: null, dap: dapOf(flight.flightDate, planting) };
      const index = ascending.findIndex((candidate) => candidate.id === flight.id);
      const previous = index > 0 ? ascending[index - 1] : null;
      const results = synthesizeFlight({
        bundle,
        roster,
        trialId,
        flight,
        previous,
        planting,
        anchor,
        decisions: decisionsFor(flight.id)
      });
      return {
        ...flight,
        results,
        flagged: results.summary.pendingFlags,
        meanCover: results.summary.meanCover,
        dap: results.summary.dap
      };
    });

    return { flights, anchorId: anchor?.id || null, planting, roster };
  }, [rawFlights, bundleQuery.data, store, trialId, now]);

  return {
    trial: trialQuery.data,
    flights: value?.flights || [],
    anchorId: value?.anchorId || null,
    planting: value?.planting || null,
    roster: value?.roster || [],
    isLoading: trialQuery.isLoading || flightsQuery.isLoading || bundleQuery.isLoading,
    trialError: trialQuery.error,
    error: flightsQuery.error || bundleQuery.error,
    mutate: flightsQuery.mutate
  };
}

/** One flight out of the trial's enriched list. `flight` is undefined while loading, null when absent. */
export function useFlightResults(trialId, flightId) {
  const all = useTrialResults(trialId);
  const flight = all.isLoading ? undefined : all.flights.find((candidate) => candidate.id === flightId) || null;
  return { ...all, flight };
}

// ---------------------------------------------------------------------------
// lobby
// ---------------------------------------------------------------------------

/**
 * The lobby only has the trial row, not its flights, and fetching flights per
 * trial would cost a Firestore read each. So the row is adjusted with what the
 * synthesis above would show without the data: a trial with no flights shows
 * the fixture set, a trial with flights is processed once its newest upload
 * is older than the processing window, and the anchor flight's flag count is
 * the U-Net's own uncertain-plot count on the Roujol A clips, less any
 * decisions already recorded for that trial.
 */
export const ANCHOR_FLAG_COUNT = 22;

/** How many plots the anchor flight flags for a trial — from the bundle when it is loaded. */
export function anchorFlagCount(bundle, trialId) {
  if (!bundle) return ANCHOR_FLAG_COUNT;
  return bundle.plots.filter((plot) => anchorFlags(plot, trialId)).length;
}

export function enrichTrialRow(trial, store, bundle = null, now = Date.now()) {
  const decided = Object.values(store[trial.id] || {}).reduce((sum, flight) => sum + Object.keys(flight).length, 0);
  const flagged = Math.max(anchorFlagCount(bundle, trial.id) - decided, 0);
  if (!trial.flightDates) {
    return { ...trial, flightDates: 4, processed: 3 * 142, expected: 4 * 142, flagged, demo: true };
  }
  const age = (now - new Date(trial.lastActivity).getTime()) / 1000;
  const running = age < PROCESSING_SECONDS;
  const processed = running ? Math.max(trial.expected - Math.round(trial.expected / trial.flightDates), 0) : trial.expected;
  const anyComplete = !running || trial.flightDates > 1;
  return {
    ...trial,
    processed,
    flagged: anyComplete ? flagged : 0
  };
}
