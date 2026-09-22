import { useMemo } from 'react';

import { flattenLabels, useLabelStore } from './labels';

// ==============================|| API - MODELS, LABEL POOL, TRAINING, BENCHMARK ||============================== //

/**
 * Fixtures for the back-of-house area until `/api/models` exists. Shapes are
 * what the registry, training-run and benchmark screens render, so each hook
 * below becomes a `useSWR('/api/models/...')` without touching the pages.
 *
 * The numbers are the ones from the UX framing's wireframes, with one real
 * entry added: the RGB pilot U-Net that produced the demo imagery's masks,
 * carrying its actual out-of-fold cross-validation scores.
 */

export const LIFECYCLE = ['draft', 'trained', 'evaluated', 'candidate', 'production', 'archived'];

export const COVER_BINS = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];

export const MODELS = [
  {
    id: 'canopy-seg-ms12-v2.3rc1',
    label: 'canopy-seg · MS-12m · v2.3-rc1',
    version: 'v2.3-rc1',
    family: 'canopy-seg',
    bands: 5,
    altitude: 12,
    target: 'MS · 12 m',
    status: 'candidate',
    iou: 0.931,
    coverMae: 1.8,
    bias: 0.3,
    trainedOn: 2814,
    usedBy: [],
    trainingRunId: 'run-14',
    benchmarkId: 'bench-2026a',
    base: 'v2.1',
    createdAt: '2026-09-02T14:10:00Z'
  },
  {
    id: 'canopy-seg-ms12-v2.1',
    label: 'canopy-seg · MS-12m · v2.1',
    version: 'v2.1',
    family: 'canopy-seg',
    bands: 5,
    altitude: 12,
    target: 'MS · 12 m',
    status: 'production',
    iou: 0.908,
    coverMae: 2.6,
    bias: 1.4,
    trainedOn: 2400,
    usedBy: ['Guadeloupe Yam Panel 2026', 'Cassava pilot'],
    trainingRunId: 'run-11',
    benchmarkId: 'bench-2026a',
    base: 'v2.0',
    createdAt: '2026-03-02T09:30:00Z',
    promotedAt: '2026-03-04T16:00:00Z',
    promotedBy: 'S. Velchuri'
  },
  {
    id: 'canopy-seg-ms12-v2.0',
    label: 'canopy-seg · MS-12m · v2.0',
    version: 'v2.0',
    family: 'canopy-seg',
    bands: 5,
    altitude: 12,
    target: 'MS · 12 m',
    status: 'archived',
    iou: 0.884,
    coverMae: 3.4,
    bias: 2.1,
    trainedOn: 2400,
    usedBy: ['Yam 2025'],
    trainingRunId: 'run-07',
    benchmarkId: 'bench-2025',
    base: null,
    createdAt: '2025-06-12T11:00:00Z'
  },
  {
    id: 'canopy-seg-rgb25-v1.2',
    label: 'canopy-seg · RGB-25m · v1.2',
    version: 'rgb-25m-v1.2',
    family: 'canopy-seg',
    bands: 3,
    altitude: 25,
    target: 'RGB · 25 m',
    status: 'production',
    iou: 0.871,
    coverMae: 3.9,
    bias: -0.8,
    trainedOn: 960,
    usedBy: ['Cassava pilot'],
    trainingRunId: 'run-09',
    benchmarkId: 'bench-2026a',
    base: 'unet-v1',
    createdAt: '2026-01-20T10:00:00Z',
    promotedAt: '2026-01-22T09:00:00Z',
    promotedBy: 'S. Velchuri'
  },
  {
    id: 'unet-v1-rgb-pilot',
    label: 'unet-v1 · RGB pilot · Roujol A',
    version: 'unet-v1',
    family: 'unet',
    bands: 3,
    altitude: 25,
    target: 'RGB · 25 m',
    status: 'evaluated',
    iou: 0.668,
    coverMae: 5.4,
    bias: 1.2,
    trainedOn: 75,
    usedBy: [],
    trainingRunId: 'run-cv75',
    benchmarkId: null,
    base: null,
    createdAt: '2025-01-15T15:00:00Z',
    note: '5-fold cross-validation on 75 hand-labelled plots, 12-12-24 flight. Out-of-fold estimate, not a frozen benchmark.'
  }
];

/**
 * What the flight-setup run panel offers: production versions first (the
 * default pin), candidates after them for explicit test runs only.
 */
export const MOCK_MODELS = MODELS.filter((model) => ['production', 'candidate'].includes(model.status))
  .sort((a, b) => Number(b.status === 'production') - Number(a.status === 'production'))
  .map((model) => ({
    id: model.id,
    label: model.label,
    bands: model.bands,
    altitude: model.altitude,
    status: model.status
  }));

// ---------------------------------------------------------------------------
// label pool
// ---------------------------------------------------------------------------

export const LABEL_POOL = {
  // provenance buckets — the wireframe's composition panel
  imported: { count: 2400, label: 'Imported (Label Studio)', trials: ['Yam 2025', 'Cassava pilot', 'Roujol A pilot'] },
  trainingGrade: { count: 218, label: 'QC corrections · training-grade' },
  rough: { count: 100, label: 'QC corrections · rough' },
  audit: { count: 196, label: 'Random audit sample' },
  benchmark: { count: 200, label: 'Frozen benchmark (held out)' },
  // per cover bin: baseline (imported) vs new (corrections + audit) — the stage-imbalance view
  byBin: {
    baseline: [510, 560, 520, 470, 340],
    corrections: [96, 118, 122, 128, 50]
  },
  // recent labels the pool would list before any decisions are made in this browser
  recent: [
    {
      at: '2026-09-08T15:42:00Z',
      author: 'A. Mercier',
      trial: 'Guadeloupe Yam Panel 2026',
      plotId: 'P061',
      grade: 'training-grade',
      source: 'qc-correction',
      cover: 48.2
    },
    {
      at: '2026-09-08T15:39:00Z',
      author: 'A. Mercier',
      trial: 'Guadeloupe Yam Panel 2026',
      plotId: 'P044',
      grade: 'rough',
      source: 'qc-correction',
      cover: 51.2
    },
    {
      at: '2026-09-08T15:31:00Z',
      author: 'A. Mercier',
      trial: 'Guadeloupe Yam Panel 2026',
      plotId: 'P117',
      grade: 'training-grade',
      source: 'qc-correction',
      cover: 62.9
    },
    {
      at: '2026-09-05T10:04:00Z',
      author: 'audit stream',
      trial: 'Guadeloupe Yam Panel 2026',
      plotId: 'P132',
      grade: 'training-grade',
      source: 'audit',
      cover: 71.4
    },
    {
      at: '2026-09-04T09:12:00Z',
      author: 'S. Velchuri',
      trial: 'Roujol A pilot',
      plotId: 'r4_c6',
      grade: 'training-grade',
      source: 'imported',
      cover: 45.9
    }
  ]
};

// ---------------------------------------------------------------------------
// training runs
// ---------------------------------------------------------------------------

export const TRAINING_RUNS = [
  {
    id: 'run-14',
    number: 14,
    version: 'v2.3-rc1',
    modelId: 'canopy-seg-ms12-v2.3rc1',
    base: 'v2.1',
    mode: 'fine-tune',
    status: 'complete',
    startedBy: 'S. Velchuri',
    startedAt: '2026-09-02T13:20:00Z',
    durationMin: 42,
    hardware: '1×A100',
    seed: 1337,
    augmentation: 'flip, rot, jitter',
    epochs: 150,
    dataset: {
      baseline: 2400,
      trainingGrade: 218,
      roughExcluded: 100,
      audit: 196,
      benchmarkHeldOut: 200
    },
    coverage: {
      baseline: [510, 560, 520, 470, 340],
      corrections: [96, 118, 122, 128, 50]
    },
    comparison: {
      incumbent: 'v2.1',
      candidate: 'v2.3-rc1',
      rows: [
        { metric: 'IoU', incumbent: 0.908, candidate: 0.931, delta: 0.023, betterWhen: 'higher', format: 'ratio' },
        { metric: 'Cover MAE (pts)', incumbent: 2.6, candidate: 1.8, delta: -0.8, betterWhen: 'lower', format: 'pts' },
        { metric: 'Cover bias (pts)', incumbent: 1.4, candidate: 0.3, delta: -1.1, betterWhen: 'zero', format: 'signed' },
        { metric: 'MAE · 0–20% cover', incumbent: 3.9, candidate: 2.1, delta: -1.8, betterWhen: 'lower', format: 'pts' },
        { metric: 'MAE · 20–40% cover', incumbent: 2.8, candidate: 1.9, delta: -0.9, betterWhen: 'lower', format: 'pts' },
        { metric: 'MAE · 40–60% cover', incumbent: 2.3, candidate: 1.6, delta: -0.7, betterWhen: 'lower', format: 'pts' },
        { metric: 'MAE · 60–80% cover', incumbent: 2.1, candidate: 1.5, delta: -0.6, betterWhen: 'lower', format: 'pts' },
        { metric: 'MAE · 80–100% cover', incumbent: 1.7, candidate: 2.4, delta: 0.7, betterWhen: 'lower', format: 'pts', regression: true }
      ]
    },
    gate: [
      { key: 'mae', label: 'Beats incumbent on cover MAE', ok: true },
      { key: 'benchmark', label: 'Benchmark untouched by training', ok: true },
      { key: 'bins', label: '1 per-bin regression unresolved (80–100% cover)', ok: false }
    ],
    warnings: ['80–100% cover is thin — late-season plots are under-represented in the new labels'],
    logs: [
      '13:20:04  dataset assembled · 2 814 train · 200 benchmark · 0 overlap',
      '13:20:05  base weights canopy-seg-ms12-v2.1 loaded',
      '13:21:12  epoch 10/150  loss 0.212  val IoU 0.901',
      '13:34:40  epoch 75/150  loss 0.141  val IoU 0.924',
      '14:01:58  epoch 150/150 loss 0.118  val IoU 0.931',
      '14:02:10  benchmark bench-2026a · MAE 1.8 · bias +0.3',
      '14:02:11  lifecycle: trained → evaluated → candidate'
    ]
  },
  {
    id: 'run-13',
    number: 13,
    version: 'v2.2-rc1',
    modelId: null,
    base: 'v2.1',
    mode: 'fine-tune',
    status: 'rejected',
    startedBy: 'S. Velchuri',
    startedAt: '2026-08-19T09:00:00Z',
    durationMin: 39,
    hardware: '1×A100',
    seed: 1337,
    augmentation: 'flip, rot',
    epochs: 150,
    dataset: { baseline: 2400, trainingGrade: 141, roughExcluded: 62, audit: 88, benchmarkHeldOut: 200 },
    coverage: { baseline: [510, 560, 520, 470, 340], corrections: [21, 64, 91, 44, 9] },
    comparison: {
      incumbent: 'v2.1',
      candidate: 'v2.2-rc1',
      rows: [
        { metric: 'IoU', incumbent: 0.908, candidate: 0.914, delta: 0.006, betterWhen: 'higher', format: 'ratio' },
        { metric: 'Cover MAE (pts)', incumbent: 2.6, candidate: 2.7, delta: 0.1, betterWhen: 'lower', format: 'pts', regression: true },
        { metric: 'Cover bias (pts)', incumbent: 1.4, candidate: 2.2, delta: 0.8, betterWhen: 'zero', format: 'signed', regression: true }
      ]
    },
    gate: [
      { key: 'mae', label: 'Beats incumbent on cover MAE', ok: false },
      { key: 'benchmark', label: 'Benchmark untouched by training', ok: true },
      { key: 'bins', label: 'No per-bin regressions', ok: false }
    ],
    warnings: ['IoU improved while cover bias worsened — the exact failure the framing warns about'],
    logs: []
  },
  {
    id: 'run-12',
    number: 12,
    version: '—',
    modelId: null,
    base: 'v2.1',
    mode: 'fine-tune',
    status: 'failed',
    startedBy: 'J. Stanton',
    startedAt: '2026-08-12T16:45:00Z',
    durationMin: 4,
    hardware: '1×T4',
    seed: 42,
    augmentation: 'flip, rot, jitter',
    epochs: 150,
    error: 'CUDA out of memory at batch 16 — 5-band input at 512 px exceeds T4 memory',
    dataset: { baseline: 2400, trainingGrade: 141, roughExcluded: 62, audit: 88, benchmarkHeldOut: 200 },
    coverage: { baseline: [510, 560, 520, 470, 340], corrections: [21, 64, 91, 44, 9] },
    comparison: null,
    gate: [],
    warnings: [],
    logs: []
  },
  {
    id: 'run-11',
    number: 11,
    version: 'v2.1',
    modelId: 'canopy-seg-ms12-v2.1',
    base: 'v2.0',
    mode: 'fine-tune',
    status: 'promoted',
    startedBy: 'S. Velchuri',
    startedAt: '2026-03-02T08:40:00Z',
    durationMin: 51,
    hardware: '1×A100',
    seed: 1337,
    augmentation: 'flip, rot, jitter',
    epochs: 150,
    dataset: { baseline: 2400, trainingGrade: 0, roughExcluded: 0, audit: 0, benchmarkHeldOut: 200 },
    coverage: { baseline: [510, 560, 520, 470, 340], corrections: [0, 0, 0, 0, 0] },
    comparison: {
      incumbent: 'v2.0',
      candidate: 'v2.1',
      rows: [
        { metric: 'IoU', incumbent: 0.884, candidate: 0.908, delta: 0.024, betterWhen: 'higher', format: 'ratio' },
        { metric: 'Cover MAE (pts)', incumbent: 3.4, candidate: 2.6, delta: -0.8, betterWhen: 'lower', format: 'pts' },
        { metric: 'Cover bias (pts)', incumbent: 2.1, candidate: 1.4, delta: -0.7, betterWhen: 'zero', format: 'signed' }
      ]
    },
    gate: [
      { key: 'mae', label: 'Beats incumbent on cover MAE', ok: true },
      { key: 'benchmark', label: 'Benchmark untouched by training', ok: true },
      { key: 'bins', label: 'No per-bin regressions', ok: true }
    ],
    warnings: [],
    logs: [],
    promotedAt: '2026-03-04T16:00:00Z',
    promotedBy: 'S. Velchuri'
  },
  {
    id: 'run-cv75',
    number: 10,
    version: 'unet-v1',
    modelId: 'unet-v1-rgb-pilot',
    base: null,
    mode: '5-fold CV · from scratch',
    status: 'complete',
    startedBy: 'S. Velchuri',
    startedAt: '2025-01-15T12:00:00Z',
    durationMin: 118,
    hardware: 'M2 Max (MPS)',
    seed: 42,
    augmentation: 'flip, rot',
    epochs: 150,
    dataset: { baseline: 75, trainingGrade: 0, roughExcluded: 0, audit: 0, benchmarkHeldOut: 0 },
    coverage: { baseline: [22, 18, 16, 12, 7], corrections: [0, 0, 0, 0, 0] },
    comparison: null,
    gate: [],
    warnings: ['Out-of-fold estimate over 75 plots from a single flight; no frozen benchmark existed yet'],
    logs: [],
    cv: { iou: 0.668, iouSd: 0.19, dice: 0.784, mae: 5.43, rmse: 7.24, bias: 1.16, r2: 0.931 }
  }
];

// ---------------------------------------------------------------------------
// benchmark sets
// ---------------------------------------------------------------------------

export const BENCHMARKS = [
  {
    id: 'bench-2026a',
    name: 'bench-2026a',
    plots: 200,
    createdAt: '2026-02-20T10:00:00Z',
    createdBy: 'S. Velchuri',
    frozen: true,
    strata: {
      dates: ['2025-03-04', '2025-03-25', '2025-04-15', '2025-05-06'],
      altitudes: ['12 m', '25 m'],
      bins: [40, 40, 40, 40, 40],
      genotypes: 96
    },
    scores: [
      { modelId: 'canopy-seg-ms12-v2.3rc1', iou: 0.931, coverMae: 1.8, bias: 0.3, byBin: [2.1, 1.9, 1.6, 1.5, 2.4] },
      { modelId: 'canopy-seg-ms12-v2.1', iou: 0.908, coverMae: 2.6, bias: 1.4, byBin: [3.9, 2.8, 2.3, 2.1, 1.7] },
      { modelId: 'canopy-seg-rgb25-v1.2', iou: 0.871, coverMae: 3.9, bias: -0.8, byBin: [5.2, 4.4, 3.6, 3.1, 3.2] }
    ]
  },
  {
    id: 'bench-2025',
    name: 'bench-2025',
    plots: 120,
    createdAt: '2025-06-01T10:00:00Z',
    createdBy: 'S. Velchuri',
    frozen: true,
    superseded: true,
    strata: { dates: ['2025-03-04', '2025-04-15'], altitudes: ['12 m'], bins: [24, 24, 24, 24, 24], genotypes: 60 },
    scores: [
      { modelId: 'canopy-seg-ms12-v2.0', iou: 0.884, coverMae: 3.4, bias: 2.1, byBin: [4.8, 3.6, 3.1, 2.9, 2.6] },
      { modelId: 'canopy-seg-ms12-v2.1', iou: 0.902, coverMae: 2.9, bias: 1.6, byBin: [4.1, 3.0, 2.6, 2.4, 2.2] }
    ]
  }
];

// ---------------------------------------------------------------------------
// hooks — same shape SWR returns, so the swap is mechanical
// ---------------------------------------------------------------------------

const ready = (data) => ({ data, error: null, isLoading: false });

export function useModels() {
  return ready(MODELS);
}

export function useModel(modelId) {
  return ready(MODELS.find((model) => model.id === modelId) || null);
}

export function useTrainingRuns() {
  return ready(TRAINING_RUNS);
}

export function useTrainingRun(runId) {
  return ready(TRAINING_RUNS.find((run) => run.id === runId) || null);
}

export function useBenchmarks() {
  return ready(BENCHMARKS);
}

/**
 * The pool is the fixture composition plus every decision recorded in this
 * browser — a correction made in the Reviewer shows up here within the same
 * session, which is the whole point of the return path.
 */
export function useLabelPool() {
  const store = useLabelStore();
  const data = useMemo(() => {
    const live = flattenLabels(store).filter((label) => label.useForTraining);
    const liveTrainingGrade = live.filter((label) => label.grade === 'training-grade').length;
    const liveRough = live.length - liveTrainingGrade;
    return {
      ...LABEL_POOL,
      live,
      totals: {
        imported: LABEL_POOL.imported.count,
        trainingGrade: LABEL_POOL.trainingGrade.count + liveTrainingGrade,
        rough: LABEL_POOL.rough.count + liveRough,
        audit: LABEL_POOL.audit.count,
        benchmark: LABEL_POOL.benchmark.count,
        corrections: LABEL_POOL.trainingGrade.count + LABEL_POOL.rough.count + live.length
      }
    };
  }, [store]);
  return ready(data);
}
