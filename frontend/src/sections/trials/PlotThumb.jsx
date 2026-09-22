import PropTypes from 'prop-types';
import { useEffect, useMemo, useRef } from 'react';

// material-ui
import Box from '@mui/material/Box';

// project imports
import { plotLayers, predictedMask, renderPlot } from 'api/demo';

export const CANOPY_TINT = [140, 245, 66];
export const EDIT_TINT = [46, 224, 138];

// ==============================|| TRIALS - PLOT THUMBNAIL ||============================== //

/**
 * One plot clip with its mask tinted over it, drawn from the demo atlas.
 *
 * The canvas is sized in *native* pixels times an integer scale and then laid
 * out at the CSS width asked for, so a thumbnail never resamples twice: once
 * here, once by the browser. `mask` may be the string 'predicted' (the model's
 * own decision), a Uint8Array (an edited mask), or null for the bare photo.
 */
export default function PlotThumb({
  bundle,
  plot,
  mask = 'predicted',
  width = 160,
  opacity = 0.5,
  tint = CANOPY_TINT,
  dim = 0.35,
  sx,
  ...others
}) {
  const ref = useRef(null);
  const layers = useMemo(() => plotLayers(bundle, plot), [bundle, plot]);
  const resolved = useMemo(() => (mask === 'predicted' ? predictedMask(layers) : mask), [mask, layers]);

  const scale = Math.max(1, Math.ceil(width / plot.w));
  const height = Math.round((plot.h / plot.w) * width);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const native = renderPlot(bundle, plot, { mask: resolved, valid: layers.valid, tint, opacity, dim });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(native, 0, 0, canvas.width, canvas.height);
  }, [bundle, plot, resolved, layers, tint, opacity, dim, scale]);

  return (
    <Box
      component="canvas"
      ref={ref}
      width={plot.w * scale}
      height={plot.h * scale}
      sx={{ display: 'block', width, height, borderRadius: 0.75, bgcolor: '#0b110c', ...sx }}
      {...others}
    />
  );
}

PlotThumb.propTypes = {
  bundle: PropTypes.object.isRequired,
  plot: PropTypes.object.isRequired,
  mask: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Uint8Array)]),
  width: PropTypes.number,
  opacity: PropTypes.number,
  tint: PropTypes.array,
  dim: PropTypes.number,
  sx: PropTypes.object
};
