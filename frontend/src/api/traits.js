// ==============================|| API - TRAITS (derived from results) ||============================== //

/**
 * Turns per-plot, per-date results into the breeder's deliverable: one cover
 * curve per genotype and the season traits derived from it. Pure functions —
 * the page hands in the enriched flights from `useTrialResults` and gets rows
 * back, so the same code runs unchanged when the results come from the API.
 *
 * Only QC-accepted plots feed a curve: rejected plots are dropped, and a plot
 * whose mask was corrected contributes the corrected cover. That is the
 * "measurements must not move under your feet" rule from the UX framing —
 * the model version is pinned per flight, and a human decision is the only
 * thing that changes a number after the run.
 */

const round1 = (value) => (value == null ? null : Math.round(value * 10) / 10);

/** Linear interpolation of `points` ([{ t, v }], ascending t) at t. Null outside the range. */
export function valueAt(points, t) {
  if (!points.length) return null;
  if (t < points[0].t || t > points[points.length - 1].t) return null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (t >= a.t && t <= b.t) {
      if (b.t === a.t) return a.v;
      return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    }
  }
  return points[points.length - 1].v;
}

/** First upward crossing of `level`, interpolated between dates. Null if the curve never gets there. */
export function crossingAt(points, level) {
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].v >= level) {
      if (i === 0) return points[0].t;
      const a = points[i - 1];
      const b = points[i];
      if (b.v === a.v) return b.t;
      return a.t + ((level - a.v) * (b.t - a.t)) / (b.v - a.v);
    }
  }
  return null;
}

/** Area under the curve, trapezoid rule — cover-days. */
export function areaUnder(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += ((points[i - 1].v + points[i].v) / 2) * (points[i].t - points[i - 1].t);
  }
  return total;
}

/** Steepest rise between two consecutive dates, in cover points per day. */
export function steepestRise(points) {
  let best = null;
  for (let i = 1; i < points.length; i += 1) {
    const dt = points[i].t - points[i - 1].t;
    if (dt <= 0) continue;
    const rate = (points[i].v - points[i - 1].v) / dt;
    if (!best || rate > best.rate) best = { rate, from: points[i - 1].t, to: points[i].t };
  }
  return best;
}

/**
 * Builds the per-genotype series.
 *
 * @param flights  enriched flights (only `complete` ones with `results` are used)
 * @param options  coverAtDap — the "cover at N DAP" trait's N
 * @returns { dates, genotypes, defaultDap }
 */
export function buildTraitSeries(flights, { coverAtDap = null } = {}) {
  const dated = flights
    .filter((flight) => flight.status === 'complete' && flight.results)
    .sort((a, b) => (a.flightDate < b.flightDate ? -1 : 1));

  const dates = dated.map((flight) => ({ flightId: flight.id, flightDate: flight.flightDate, dap: flight.dap, model: flight.model }));
  const defaultDap = dates.length ? Math.round(dates[Math.floor((dates.length - 1) / 2)].dap / 5) * 5 : null;
  const targetDap = coverAtDap ?? defaultDap;

  // genotype → date index → accepted covers
  const byGenotype = new Map();
  dated.forEach((flight, dateIndex) => {
    flight.results.plots.forEach((plot) => {
      if (!byGenotype.has(plot.genotype)) {
        byGenotype.set(plot.genotype, { genotype: plot.genotype, plotIds: new Set(), covers: dates.map(() => []), edited: 0, rejected: 0 });
      }
      const entry = byGenotype.get(plot.genotype);
      entry.plotIds.add(plot.plotId);
      if (plot.qc === 'rejected') {
        entry.rejected += 1;
        return;
      }
      if (plot.decision?.edited) entry.edited += 1;
      entry.covers[dateIndex].push(plot.cover);
    });
  });

  const genotypes = [...byGenotype.values()].map((entry) => {
    const series = entry.covers.map((covers) => (covers.length ? covers.reduce((sum, v) => sum + v, 0) / covers.length : null));
    const points = dates.map((date, i) => ({ t: date.dap, v: series[i] })).filter((point) => point.v != null);
    const rise = steepestRise(points);
    const last = points[points.length - 1] || null;
    return {
      genotype: entry.genotype,
      plotIds: [...entry.plotIds].sort(),
      reps: entry.plotIds.size,
      edited: entry.edited,
      rejected: entry.rejected,
      series,
      points,
      traits: {
        daysTo50: round1(crossingAt(points, 50)),
        // already past 50 % on the first flight: the true value is earlier than anything measured
        daysTo50Censored: points.length > 0 && points[0].v >= 50,
        auc: Math.round(areaUnder(points)),
        maxRate: rise ? round1(rise.rate) : null,
        maxRateWindow: rise ? `${rise.from}–${rise.to} DAP` : null,
        coverAt: round1(valueAt(points, targetDap)),
        coverAtDap: targetDap,
        finalCover: last ? round1(last.v) : null,
        finalDap: last ? last.t : null
      }
    };
  });

  genotypes.sort((a, b) => (b.traits.finalCover ?? -1) - (a.traits.finalCover ?? -1));
  genotypes.forEach((row, index) => {
    row.rank = index + 1;
  });

  return { dates, genotypes, defaultDap, targetDap };
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

const csvCell = (value) => {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Long-form CSV: one row per genotype × date, traits repeated on every row of the genotype. */
export function traitsToCsv({ dates, genotypes }, { trialName = '', modelVersion = '' } = {}) {
  const header = [
    'trial',
    'genotype',
    'plots',
    'flight_date',
    'dap',
    'model_version',
    'fractional_cover_pct',
    'days_to_50_cover',
    'days_to_50_is_upper_bound',
    'cover_auc_cover_days',
    'max_growth_rate_pct_per_day',
    `cover_at_dap`,
    'cover_at_dap_value',
    'final_cover_pct',
    'final_cover_dap'
  ];
  const rows = [header.join(',')];
  genotypes.forEach((row) => {
    dates.forEach((date, i) => {
      rows.push(
        [
          trialName,
          row.genotype,
          row.reps,
          date.flightDate,
          date.dap,
          modelVersion || date.model,
          round1(row.series[i]),
          row.traits.daysTo50,
          row.traits.daysTo50Censored ? 'true' : 'false',
          row.traits.auc,
          row.traits.maxRate,
          row.traits.coverAtDap,
          row.traits.coverAt,
          row.traits.finalCover,
          row.traits.finalDap
        ]
          .map(csvCell)
          .join(',')
      );
    });
  });
  return `${rows.join('\n')}\n`;
}

export function downloadText(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
