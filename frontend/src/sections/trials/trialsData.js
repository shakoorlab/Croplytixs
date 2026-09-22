// ==============================|| TRIALS - MOCK FIXTURES ||============================== //

/**
 * Stand-in for the trials/runs API. Shapes mirror the expected responses so the
 * pages can swap `getTrial` / `getRuns` for fetches without changing render code.
 */

export const TRIALS = [
  {
    id: 'guadeloupe-yam-2026',
    name: 'Guadeloupe Yam Panel 2026',
    crop: 'Yam',
    site: 'INRAE Duclos',
    season: '2026',
    plots: 144,
    flightDates: 4,
    processed: 576,
    expected: 576,
    flagged: 23,
    lastActivity: '2 h ago'
  },
  {
    id: 'guadeloupe-yam-2025',
    name: 'Guadeloupe Yam Panel 2025',
    crop: 'Yam',
    site: 'INRAE Duclos',
    season: '2025',
    plots: 120,
    flightDates: 9,
    processed: 1080,
    expected: 1080,
    flagged: 0,
    lastActivity: 'Mar 4'
  },
  {
    id: 'cassava-altitude-pilot',
    name: 'Cassava pilot — altitude test',
    crop: 'Cassava',
    site: 'Roujol',
    season: '2026',
    plots: 36,
    flightDates: 0,
    processed: 0,
    expected: 0,
    flagged: 0,
    lastActivity: 'Feb 19'
  }
];

/**
 * Runs are keyed by trial. `cassava-altitude-pilot` is intentionally empty so the
 * table's empty state is reachable without clearing fixtures.
 */
export const RUNS = {
  'guadeloupe-yam-2026': [
    {
      id: 'run-2026-04-08',
      flightDate: '2026-04-08',
      capture: '12 m · MS',
      source: 'ortho',
      plots: 144,
      model: 'v2.1',
      status: 'running',
      progress: 62,
      flagged: null,
      meanCover: null,
      createdBy: 'J. Stanton'
    },
    {
      id: 'run-2026-03-25',
      flightDate: '2026-03-25',
      capture: '12 m · MS',
      source: 'ortho',
      plots: 144,
      model: 'v2.1',
      status: 'complete',
      progress: 100,
      flagged: 23,
      meanCover: 68.4,
      createdBy: 'J. Stanton'
    },
    {
      id: 'run-2026-03-11',
      flightDate: '2026-03-11',
      capture: '12 m · MS',
      source: 'ortho',
      plots: 144,
      model: 'v2.1',
      status: 'complete',
      progress: 100,
      flagged: 0,
      meanCover: 51.2,
      createdBy: 'J. Stanton'
    },
    {
      id: 'run-2026-03-04',
      flightDate: '2026-03-04',
      capture: '25 m · RGB',
      source: 'clipped',
      plots: 144,
      model: 'rgb-25m-v1.2',
      status: 'failed',
      progress: 0,
      flagged: null,
      meanCover: null,
      error: 'Shapefile CRS did not match the ortho (EPSG:4326 vs EPSG:32620).',
      createdBy: 'A. Mercier'
    }
  ],
  'guadeloupe-yam-2025': [],
  'cassava-altitude-pilot': []
};

export function getTrial(trialId) {
  return TRIALS.find((trial) => trial.id === trialId) || null;
}

export function getRuns(trialId) {
  return RUNS[trialId] || [];
}

export const DEFAULT_TRIAL_ID = TRIALS[0].id;

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Builds a trial record from the form values.
 *
 * Only identity is entered — name, crop, site, season, and optionally the plot
 * roster. Everything else on the row (flight dates, processed, flagged, last
 * activity) is derived from runs, so a new trial starts at a genuine zero
 * rather than a "pending" placeholder: it has no flights because none exist yet,
 * which is a fact, not an unknown.
 */
export function createTrial({ name, crop, site, season, plots = 0, rosterFile = null }, existing = TRIALS) {
  const base = slugify(`${name}-${season}`) || 'trial';
  let id = base;
  let n = 2;
  while (existing.some((trial) => trial.id === id)) {
    id = `${base}-${n}`;
    n += 1;
  }

  return {
    id,
    name,
    crop,
    site,
    season,
    plots,
    rosterFile,
    flightDates: 0,
    processed: 0,
    expected: 0,
    flagged: 0,
    lastActivity: 'just now'
  };
}

/**
 * Fixture-only: registers a new trial so `getTrial` / `getRuns` can resolve it
 * on the runs route. Without this the lobby would hold the trial in local state
 * while the route it navigates to still read the static list — and a freshly
 * created trial would 404. Replace with a POST followed by a refetch.
 */
export function addTrial(trial) {
  TRIALS.unshift(trial);
  RUNS[trial.id] = [];
  return trial;
}
