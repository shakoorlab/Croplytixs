import PropTypes from 'prop-types';
import { useCallback, useEffect, useRef } from 'react';

// material-ui
import Box from '@mui/material/Box';

// project imports
import { renderPlot } from 'api/demo';
import { CANOPY_TINT } from 'sections/trials/PlotThumb';
import { paintDisc, paintStroke } from './maskTools';

// ==============================|| REVIEWER - MASK CANVAS ||============================== //

/**
 * The plot at an integer zoom with the mask tinted over it, plus a brush.
 *
 * Painting mutates `mask` in place (it is the parent's working copy) and
 * reports back through `onStrokeStart` (so the parent can push an undo step)
 * and `onPaint` (so the cover readout can follow the brush). Rendering is
 * pixel-crisp on purpose: the brush edits raster cells of the GeoTIFF, and a
 * smoothed view would hide what is actually being changed.
 */
export default function MaskCanvas({
  bundle,
  plot,
  layers,
  mask,
  version,
  showMask = true,
  opacity = 0.55,
  tool = 'brush',
  brushSize = 4,
  maxWidth = 760,
  maxHeight = 520,
  onStrokeStart,
  onPaint
}) {
  const canvasRef = useRef(null);
  const cursorRef = useRef(null); // { x, y } in native pixels, null when the pointer is outside
  const paintingRef = useRef(false);
  const lastRef = useRef(null);

  const scale = Math.max(1, Math.floor(Math.min(maxWidth / plot.w, maxHeight / plot.h)));
  const width = plot.w * scale;
  const height = plot.h * scale;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const native = renderPlot(bundle, plot, { mask: showMask ? mask : null, valid: layers.valid, tint: CANOPY_TINT, opacity });
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(native, 0, 0, canvas.width, canvas.height);

    const cursor = cursorRef.current;
    if (cursor) {
      ctx.beginPath();
      ctx.arc(cursor.x * scale, cursor.y * scale, brushSize * scale, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = tool === 'erase' ? 'rgba(255,107,107,0.95)' : 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cursor.x * scale, cursor.y * scale, brushSize * scale + 1.5, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }
  }, [bundle, plot, layers, mask, showMask, opacity, tool, brushSize, scale]);

  // redraw whenever the inputs change; `version` bumps after undo, which
  // replaces the mask's contents without changing its identity
  useEffect(() => {
    draw();
  }, [draw, version]);

  const toNative = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * plot.w,
      y: ((event.clientY - rect.top) / rect.height) * plot.h
    };
  };

  const value = tool === 'erase' ? 0 : 1;

  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    canvasRef.current.setPointerCapture(event.pointerId);
    paintingRef.current = true;
    onStrokeStart?.();
    const point = toNative(event);
    cursorRef.current = point;
    lastRef.current = point;
    if (paintDisc(mask, layers.valid, plot.w, plot.h, point.x, point.y, brushSize, value)) onPaint?.();
    draw();
  };

  const handlePointerMove = (event) => {
    const point = toNative(event);
    cursorRef.current = point;
    if (paintingRef.current && lastRef.current) {
      if (paintStroke(mask, layers.valid, plot.w, plot.h, lastRef.current, point, brushSize, value)) onPaint?.();
      lastRef.current = point;
    }
    draw();
  };

  const endStroke = (event) => {
    if (paintingRef.current) {
      paintingRef.current = false;
      lastRef.current = null;
      try {
        canvasRef.current.releasePointerCapture(event.pointerId);
      } catch {
        // capture already released
      }
    }
  };

  const handlePointerLeave = (event) => {
    endStroke(event);
    cursorRef.current = null;
    draw();
  };

  return (
    <Box
      component="canvas"
      ref={canvasRef}
      width={width}
      height={height}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onPointerLeave={handlePointerLeave}
      onContextMenu={(event) => event.preventDefault()}
      sx={{
        display: 'block',
        width,
        height,
        maxWidth: '100%',
        borderRadius: 1,
        bgcolor: '#0b110c',
        cursor: 'none',
        touchAction: 'none',
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)'
      }}
    />
  );
}

MaskCanvas.propTypes = {
  bundle: PropTypes.object.isRequired,
  plot: PropTypes.object.isRequired,
  layers: PropTypes.object.isRequired,
  mask: PropTypes.instanceOf(Uint8Array).isRequired,
  version: PropTypes.number,
  showMask: PropTypes.bool,
  opacity: PropTypes.number,
  tool: PropTypes.oneOf(['brush', 'erase']),
  brushSize: PropTypes.number,
  maxWidth: PropTypes.number,
  maxHeight: PropTypes.number,
  onStrokeStart: PropTypes.func,
  onPaint: PropTypes.func
};
