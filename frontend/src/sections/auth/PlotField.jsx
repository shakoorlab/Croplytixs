import PropTypes from 'prop-types';
import { useMemo } from 'react';

// material-ui
import Box from '@mui/material/Box';

// project imports
import { gaussian, unit } from 'utils/seeded';

// ==============================|| AUTH - PLOT FIELD ILLUSTRATION ||============================== //

/**
 * A trial field seen from the drone: blocks of plots coloured by canopy cover, a few
 * QC flags, a lawnmower flight line, and one plot picked out with its reading. It is
 * what the product does, drawn — decorative, so it is hidden from assistive tech.
 *
 * Deterministic (utils/seeded), so the field is identical on every load rather than
 * reshuffling each visit. Plain SVG: ~880 rects, drawn once, no animation.
 *
 * Kept deliberately quiet: most plots sit in the mid greens and only the top few percent
 * reach the neon, so the field reads as texture behind the copy rather than competing
 * with the form.
 */

const ROWS = 34;
const COLS = 26;
const PLOT_W = 38;
const PLOT_H = 22;
const GAP_X = 9;
const GAP_Y = 11;
const BLOCK_COLS = 6; // a wider alley every six columns, like the ranges in a real layout
const ALLEY = 24;
const BLOCK_ROWS = 8;
const HEADLAND = 22;

const ROTATION = -14; // flight lines rarely run north-up; neither does this field
const OVERSCAN = 1.3; // after rotating, the corners must still be covered

// Canopy cover → colour, bare soil up to closed canopy, on the Forest Dark leaf ramp.
const COVER_STOPS = [
  [0.0, [38, 44, 33]], // soil
  [0.35, [46, 64, 35]],
  [0.6, [59, 90, 36]], // near leaf[2] #3e5c22
  [0.8, [79, 140, 43]], // #4f8c2b
  [0.93, [108, 194, 54]], // leaf light #6cc236
  [1.0, [140, 245, 66]] // leaf main #8cf542 — only the best few plots get here
];
const FLAG = '#ff8c49'; // warning.main — the QC flag colour everywhere else in the app
const NEON = '#8cf542'; // primary.main

function coverColor(cover) {
  const upper = COVER_STOPS.findIndex(([at]) => at >= cover);
  if (upper <= 0) return `rgb(${COVER_STOPS[0][1].join(' ')})`;
  const [a, from] = COVER_STOPS[upper - 1];
  const [b, to] = COVER_STOPS[upper];
  const t = (cover - a) / (b - a);
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * t)).join(' ')})`;
}

function offsets(count, size, gap, every, extra) {
  const out = [];
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    if (i > 0) at += gap + (i % every === 0 ? extra : 0);
    out.push(at);
    at += size;
  }
  return { out, span: at };
}

function buildField() {
  const { out: xs, span: width } = offsets(COLS, PLOT_W, GAP_X, BLOCK_COLS, ALLEY);
  const { out: ys, span: height } = offsets(ROWS, PLOT_H, GAP_Y, BLOCK_ROWS, HEADLAND);

  const plots = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const u = col / (COLS - 1);
      const v = row / (ROWS - 1);
      // a smooth fertility gradient across the field, a genotype effect shared by
      // neighbouring columns, and per-plot noise
      const field = 0.56 + 0.2 * Math.sin(u * 3.1 + 0.4) * Math.cos(v * 2.6 - 0.5);
      const genotype = 0.1 * gaussian('login-field', 'genotype', Math.floor(col / 2), Math.floor(row / 4));
      const noise = 0.07 * gaussian('login-field', 'plot', row, col);
      const cover = Math.min(0.99, Math.max(0.04, field + genotype + noise));
      const flagged = unit('login-field', 'flag', row, col) < 0.018;
      plots.push({ key: `${row}-${col}`, x: xs[col], y: ys[row], cover, flagged, id: row * COLS + col + 1 });
    }
  }

  // lawnmower flight line through every fourth row gap, stopping part-way: the drone is
  // mid-survey, which is where the dot sits
  const passes = [];
  for (let row = 3; row < ROWS - 1; row += 4) passes.push(ys[row] - GAP_Y / 2);
  const margin = 26;
  const points = [];
  passes.forEach((y, i) => {
    const [from, to] = i % 2 === 0 ? [-margin, width + margin] : [width + margin, -margin];
    points.push([from, y], [to, y]);
  });
  const shown = points.slice(0, 9);
  const [headX, headY] = shown[shown.length - 1];
  const head = [(headX + shown[shown.length - 2][0]) / 2, headY];
  shown[shown.length - 1] = head;

  const picked = plots.find((plot) => plot.key === '11-15');
  return { plots, width, height, flight: shown, head, picked };
}

/** Where a point in field space lands after the field is rotated and scaled about its centre. */
function project([x, y], cx, cy) {
  const rad = (ROTATION * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [cx + OVERSCAN * (dx * Math.cos(rad) - dy * Math.sin(rad)), cy + OVERSCAN * (dx * Math.sin(rad) + dy * Math.cos(rad))];
}

export default function PlotField({ sx }) {
  const { plots, width, height, flight, head, picked } = useMemo(buildField, []);

  const cx = width / 2;
  const cy = height / 2;
  const [calloutX, calloutY] = project([picked.x + PLOT_W / 2, picked.y + PLOT_H / 2], cx, cy);
  const label = `P${String(picked.id).padStart(3, '0')}`;
  const reading = `${(picked.cover * 100).toFixed(1)}% cover`;

  return (
    <Box
      component="svg"
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      sx={{ display: 'block', width: '100%', height: '100%', ...sx }}
    >
      <defs>
        <filter id="plotfield-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g transform={`rotate(${ROTATION} ${cx} ${cy}) translate(${cx} ${cy}) scale(${OVERSCAN}) translate(${-cx} ${-cy})`}>
        {plots.map((plot) => (
          <rect
            key={plot.key}
            x={plot.x}
            y={plot.y}
            width={PLOT_W}
            height={PLOT_H}
            rx="3"
            fill={coverColor(plot.cover)}
            stroke={plot.flagged ? FLAG : 'none'}
            strokeWidth={plot.flagged ? 2.5 : 0}
          />
        ))}

        <polyline
          points={flight.map((point) => point.join(',')).join(' ')}
          fill="none"
          stroke="rgba(255, 255, 255, 0.22)"
          strokeWidth="1.5"
          strokeDasharray="6 7"
          strokeLinejoin="round"
        />
        <circle cx={head[0]} cy={head[1]} r="6" fill={NEON} filter="url(#plotfield-glow)" />

        <rect
          x={picked.x - 3}
          y={picked.y - 3}
          width={PLOT_W + 6}
          height={PLOT_H + 6}
          rx="5"
          fill="none"
          stroke={NEON}
          strokeWidth="2"
          filter="url(#plotfield-glow)"
        />
      </g>

      {/* the reading stays level while the field is rotated */}
      <g transform={`translate(${calloutX + 44} ${calloutY - 62})`}>
        <line x1="-44" y1="62" x2="0" y2="21" stroke={NEON} strokeWidth="2" strokeOpacity="0.8" />
        <rect x="0" y="0" width="196" height="42" rx="21" fill="rgba(17, 24, 19, 0.85)" stroke="rgba(255, 255, 255, 0.14)" />
        <text x="18" y="27" fontSize="17" fontFamily="inherit" fontWeight="600" fill="#e8e8e8">
          {label}
          <tspan dx="10" fontWeight="500" fill={NEON}>
            {reading}
          </tspan>
        </text>
      </g>
    </Box>
  );
}

PlotField.propTypes = { sx: PropTypes.object };
