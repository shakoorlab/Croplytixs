import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';

// material-ui
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';

// project imports
import MainCard from 'components/MainCard';
import { NESTED_PANEL } from 'sections/trials/surfaces';
import { BAND_COMBOS } from './geo/readOrtho';
import { insetRing, offsetTransform, ringCentroid, ringToPoints } from './utils';
import { PLACEHOLDER_CANOPY_OFFSET } from './mockData';

// assets
import ArrowUpOutlined from '@ant-design/icons/ArrowUpOutlined';
import ArrowDownOutlined from '@ant-design/icons/ArrowDownOutlined';
import ArrowLeftOutlined from '@ant-design/icons/ArrowLeftOutlined';
import ArrowRightOutlined from '@ant-design/icons/ArrowRightOutlined';
import UndoOutlined from '@ant-design/icons/UndoOutlined';
import AimOutlined from '@ant-design/icons/AimOutlined';

const INSET_OPTIONS = [0, 5, 10, 15, 20, 30];
const ROTATION_STEP = 0.1;

// deterministic pseudo-random in [0,1) so renders stay stable across re-mounts
const hash01 = (n) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// ==============================|| FLIGHT SETUP - ORTHO OVERVIEW ||============================== //

/**
 * Lightweight ortho preview. Renders the backend's downsampled overview with the
 * shapefile polygons on top, and lets the operator nudge the whole grid in
 * centimetres until it sits on the plots.
 *
 * Nudge is expressed and stored in cm (ground units) and only converted to
 * pixels for display, so the value handed back to the API is resolution-independent.
 */
export default function OrthoOverview({
  ortho,
  plots = [],
  offset,
  onOffsetChange,
  insetCm,
  onInsetChange,
  onComboChange,
  busy = false,
  disabled = false
}) {
  const theme = useTheme();
  const [spotCheck, setSpotCheck] = useState(false);

  const { overviewWidth: w, overviewHeight: h, overviewCmPerPx: cmPerPx, overviewUrl } = ortho;

  const insetPx = insetCm / cmPerPx;

  const rings = useMemo(() => plots.map((p) => ({ ...p, ring: insetRing(p.ring, insetPx) })), [plots, insetPx]);

  const spotIds = useMemo(() => {
    if (!spotCheck || !plots.length) return [];
    return [0.17, 0.51, 0.83].map((f) => plots[Math.floor(f * plots.length)]?.plotId).filter(Boolean);
  }, [spotCheck, plots]);

  const transform = offsetTransform(offset, cmPerPx, w / 2, h / 2);

  // One click should move the grid by about one preview pixel. At 6.5 cm/px a 1 cm
  // step is invisible here, which makes the control feel broken even though the
  // value is changing. Ground units stay the unit of record; only the step adapts.
  const stepCm = Math.max(1, Math.round(cmPerPx));

  const nudge = (dx, dy) => onOffsetChange({ ...offset, dxCm: +(offset.dxCm + dx).toFixed(1), dyCm: +(offset.dyCm + dy).toFixed(1) });

  const rotate = (delta) => onOffsetChange({ ...offset, rotDeg: +(offset.rotDeg + delta).toFixed(2) });

  const reset = () => onOffsetChange({ dxCm: 0, dyCm: 0, rotDeg: 0 });

  const handleKeyDown = (event) => {
    if (disabled) return;
    const step = event.shiftKey ? stepCm * 10 : stepCm;
    const moves = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    nudge(move[0], move[1]);
  };

  const isNudged = offset.dxCm !== 0 || offset.dyCm !== 0 || offset.rotDeg !== 0;

  return (
    <MainCard
      content={false}
      sx={NESTED_PANEL}
      title="Overview · grid alignment"
      subheader={
        <Typography variant="caption" color="text.secondary">
          Downsampled preview — full resolution is inspected per plot in review
        </Typography>
      }
      secondary={
        <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
          {ortho.bandCount > 3 && onComboChange && (
            <TextField
              select
              size="small"
              aria-label="Band combination"
              value={ortho.combo || 'natural'}
              disabled={disabled || busy}
              onChange={(event) => onComboChange(event.target.value)}
              sx={{ width: 168 }}
            >
              {BAND_COMBOS.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Button
            size="small"
            color={spotCheck ? 'primary' : 'secondary'}
            startIcon={<AimOutlined />}
            onClick={() => setSpotCheck((v) => !v)}
          >
            Spot-check 3 plots
          </Button>
        </Stack>
      }
    >
      {/* ---- canvas ---- */}
      <Box
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        aria-label={`Plot grid alignment preview. Use arrow keys to nudge the grid by ${stepCm} centimetres; hold shift for ${stepCm * 10} centimetre steps.`}
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${w} / ${h}`,
          bgcolor: 'grey.50',
          borderBottom: '1px solid',
          borderColor: 'grey.A800',
          outline: 'none',
          '&:focus-visible': { boxShadow: `inset 0 0 0 2px ${theme.vars.palette.primary.main}` }
        }}
      >
        {overviewUrl ? (
          <Box
            component="img"
            src={overviewUrl}
            alt="Orthophoto overview"
            // 'fill', not 'cover': the SVG overlay stretches with
            // preserveAspectRatio="none", so any cropping here would slide the
            // plot grid off the imagery it is supposed to be measuring.
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
          />
        ) : (
          <PlaceholderField width={w} height={h} plots={plots} />
        )}

        {/* ---- plot polygons ---- */}
        <Box
          component="svg"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          <g transform={transform}>
            {/* Casing pass. A thin bright line vanishes over real imagery — the
                field is already green and red and busy. A dark stroke underneath
                the accent one keeps the grid legible over bright soil and dark
                canopy alike, which is the whole job of this overlay. */}
            {rings.map((plot) => (
              <polygon
                key={`casing-${plot.plotId}`}
                points={ringToPoints(plot.ring)}
                fill="none"
                stroke="rgba(0, 0, 0, 0.65)"
                strokeWidth={spotIds.includes(plot.plotId) ? 4.5 : 3}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {rings.map((plot) => {
              const highlighted = spotIds.includes(plot.plotId);
              return (
                <polygon
                  key={plot.plotId}
                  points={ringToPoints(plot.ring)}
                  fill={highlighted ? 'rgba(140, 245, 66, 0.22)' : 'none'}
                  stroke={highlighted ? '#ffffff' : theme.vars.palette.primary.main}
                  strokeWidth={highlighted ? 2.25 : 1.5}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {spotCheck &&
              rings
                .filter((p) => spotIds.includes(p.plotId))
                .map((plot) => {
                  const [cx, cy] = ringCentroid(plot.ring);
                  return (
                    <text
                      key={`label-${plot.plotId}`}
                      x={cx}
                      y={cy + 4}
                      textAnchor="middle"
                      fill="#ffffff"
                      stroke="rgba(0,0,0,0.75)"
                      strokeWidth="3"
                      paintOrder="stroke"
                      style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}
                    >
                      {plot.plotId}
                    </text>
                  );
                })}
          </g>
        </Box>

        {busy && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(0,0,0,0.45)'
            }}
          >
            <CircularProgress size={26} />
          </Box>
        )}

        {/* ---- corner readout ---- */}
        <Stack direction="row" sx={{ position: 'absolute', top: 10, left: 10, gap: 0.75 }}>
          <Chip
            size="small"
            label={`${plots.length} plots`}
            sx={{ bgcolor: 'background.paper', color: 'text.primary', fontFamily: 'ui-monospace, monospace' }}
          />
          {isNudged && (
            <Chip
              size="small"
              label="grid nudged"
              sx={{ bgcolor: 'primary.lighter', color: 'primary.main', borderColor: 'primary.light' }}
            />
          )}
        </Stack>
      </Box>

      {/* ---- alignment toolbar ---- */}
      <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', flexWrap: 'wrap', px: 2, py: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 66 }}>
          Nudge grid
        </Typography>

        <Stack direction="row" sx={{ gap: 0.25 }}>
          {/* y grows downward in raster space, so north is negative dy on a north-up ortho */}
          {[
            { key: 'left', icon: <ArrowLeftOutlined />, onClick: () => nudge(-stepCm, 0), title: `West ${stepCm} cm` },
            { key: 'right', icon: <ArrowRightOutlined />, onClick: () => nudge(stepCm, 0), title: `East ${stepCm} cm` },
            { key: 'up', icon: <ArrowUpOutlined />, onClick: () => nudge(0, -stepCm), title: `North ${stepCm} cm` },
            { key: 'down', icon: <ArrowDownOutlined />, onClick: () => nudge(0, stepCm), title: `South ${stepCm} cm` }
          ].map((btn) => (
            <Tooltip key={btn.key} title={btn.title}>
              <span>
                <IconButton
                  size="small"
                  color="secondary"
                  aria-label={btn.title}
                  disabled={disabled}
                  onClick={btn.onClick}
                  sx={{ border: '1px solid', borderColor: 'grey.A800' }}
                >
                  {btn.icon}
                </IconButton>
              </span>
            </Tooltip>
          ))}
        </Stack>

        <Typography
          variant="caption"
          sx={{ fontFamily: 'ui-monospace, monospace', color: isNudged ? 'primary.main' : 'text.secondary', minWidth: 148 }}
        >
          dx {offset.dxCm > 0 ? '+' : ''}
          {offset.dxCm.toFixed(1)} cm · dy {offset.dyCm > 0 ? '+' : ''}
          {offset.dyCm.toFixed(1)} cm
        </Typography>

        <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />

        <Stack direction="row" sx={{ gap: 0.5, alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            Rotation
          </Typography>
          <IconButton
            size="small"
            color="secondary"
            aria-label={`Rotate grid anticlockwise ${ROTATION_STEP} degrees`}
            disabled={disabled}
            onClick={() => rotate(-ROTATION_STEP)}
          >
            <ArrowLeftOutlined style={{ fontSize: '0.75rem' }} />
          </IconButton>
          <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace', minWidth: 46, textAlign: 'center' }}>
            {offset.rotDeg.toFixed(2)}°
          </Typography>
          <IconButton
            size="small"
            color="secondary"
            aria-label={`Rotate grid clockwise ${ROTATION_STEP} degrees`}
            disabled={disabled}
            onClick={() => rotate(ROTATION_STEP)}
          >
            <ArrowRightOutlined style={{ fontSize: '0.75rem' }} />
          </IconButton>
        </Stack>

        <Box sx={{ flex: 1 }} />

        <Typography variant="caption" color="text.secondary">
          Inset
        </Typography>
        <TextField
          select
          size="small"
          aria-label="Plot inset in centimetres"
          value={insetCm}
          disabled={disabled}
          onChange={(event) => onInsetChange(Number(event.target.value))}
          sx={{ width: 106 }}
        >
          {INSET_OPTIONS.map((cm) => (
            <MenuItem key={cm} value={cm}>
              {cm === 0 ? 'None' : `${cm} cm`}
            </MenuItem>
          ))}
        </TextField>

        <Button size="small" color="secondary" startIcon={<UndoOutlined />} disabled={disabled || !isNudged} onClick={reset}>
          Reset
        </Button>
      </Stack>

      <Box sx={{ px: 2, pb: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          Arrow keys nudge by {stepCm} cm while the preview is focused · hold Shift for {stepCm * 10} cm. The applied offset is written to
          the run manifest.
        </Typography>
      </Box>
    </MainCard>
  );
}

OrthoOverview.propTypes = {
  ortho: PropTypes.object.isRequired,
  plots: PropTypes.array,
  offset: PropTypes.shape({ dxCm: PropTypes.number, dyCm: PropTypes.number, rotDeg: PropTypes.number }).isRequired,
  onOffsetChange: PropTypes.func.isRequired,
  insetCm: PropTypes.number.isRequired,
  onInsetChange: PropTypes.func.isRequired,
  onComboChange: PropTypes.func,
  busy: PropTypes.bool,
  disabled: PropTypes.bool
};

// ==============================|| PLACEHOLDER FIELD ||============================== //

/**
 * Drawn only when the backend has not yet produced an overview render. Canopy is
 * offset from the polygon grid on purpose, so the nudge control is demonstrable
 * without a real ortho.
 */
function PlaceholderField({ width, height, plots }) {
  return (
    <Box
      component="svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    >
      <defs>
        <pattern id="cx-soil" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
          <rect width="14" height="7" fill="#2b2b24" />
          <rect y="7" width="14" height="7" fill="#26261f" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="#22221c" />
      <rect width={width} height={height} fill="url(#cx-soil)" opacity="0.9" />
      {plots.map((plot, i) => {
        const [cx, cy] = ringCentroid(plot.ring);
        const rx = (Math.abs(plot.ring[1][0] - plot.ring[0][0]) / 2) * (0.55 + hash01(i + 1) * 0.4);
        const ry = (Math.abs(plot.ring[2][1] - plot.ring[1][1]) / 2) * (0.5 + hash01(i + 7) * 0.42);
        return (
          <ellipse
            key={plot.plotId}
            cx={cx + PLACEHOLDER_CANOPY_OFFSET.x}
            cy={cy + PLACEHOLDER_CANOPY_OFFSET.y}
            rx={rx}
            ry={ry}
            fill="#4e7a35"
            opacity={0.72 + hash01(i + 13) * 0.2}
          />
        );
      })}
    </Box>
  );
}

PlaceholderField.propTypes = { width: PropTypes.number, height: PropTypes.number, plots: PropTypes.array };
