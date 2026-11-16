import PropTypes from 'prop-types';
import { useEffect, useRef, useState } from 'react';

// material-ui
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// project imports
import { COLOURS, drawPlotPicture, loadPlotPicture } from './plotPicture';

const rgb = (colour) => `rgb(${colour.join(',')})`;

function Swatch({ colour, outline = false, dashed = false, children }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
      <Box
        sx={{
          width: 14,
          height: 10,
          borderRadius: 0.5,
          ...(outline ? { border: `2px ${dashed ? 'dashed' : 'solid'} ${colour}` } : { bgcolor: colour })
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {children}
      </Typography>
    </Stack>
  );
}

Swatch.propTypes = { colour: PropTypes.string, outline: PropTypes.bool, dashed: PropTypes.bool, children: PropTypes.node };

// ==============================|| REVIEWER - PLOT VIEW ||============================== //

/**
 * The plot under review, drawn from the map files in the bucket: the photo
 * around its box, this plot's canopy, the canopy its neighbours were given, and
 * the boxes. Reads the next plot in the queue as soon as this one is drawn, so
 * stepping through the queue doesn't wait on the network.
 */
export default function PlotView({ links, plot, nextPlot = null, plots, showMask, opacity }) {
  const canvasRef = useRef(null);
  const [picture, setPicture] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const viewUrl = links.view.url;
  const assignmentUrl = links.result.assignment.url;
  const noPlotValue = links.result.noPlotValue;

  useEffect(() => {
    let alive = true;
    setPicture(null);
    setError(null);
    loadPlotPicture(viewUrl, assignmentUrl, plot)
      .then((loaded) => {
        if (!alive) return;
        setPicture(loaded);
        if (nextPlot?.box) loadPlotPicture(viewUrl, assignmentUrl, nextPlot).catch(() => {}); // warm the next one
      })
      .catch((err) => alive && setError(err));
    return () => {
      alive = false;
    };
    // the plot object changes identity on every results refetch; its id and box don't
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewUrl, assignmentUrl, plot.plotId, attempt]);

  useEffect(() => {
    if (picture && canvasRef.current) drawPlotPicture(canvasRef.current, picture, { plot, plots, showMask, opacity, noPlotValue });
  }, [picture, plot, plots, showMask, opacity, noPlotValue]);

  if (error) {
    return (
      <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1.5, maxWidth: 520, textAlign: 'center' }}>
        <Alert severity="error" variant="outlined" sx={{ textAlign: 'left' }}>
          Couldn’t read this plot’s picture from storage — {error.message || String(error)}
        </Alert>
        <Button variant="outlined" color="secondary" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </Button>
      </Stack>
    );
  }

  return (
    <Stack sx={{ flex: 1, minHeight: 0, width: '100%', alignItems: 'center', gap: 1.25 }}>
      <Box
        sx={{
          position: 'relative',
          flex: 1,
          minHeight: 240,
          width: '100%',
          maxWidth: 900,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {!picture && (
          <Stack sx={{ position: 'absolute', alignItems: 'center', gap: 1 }}>
            <LinearProgress sx={{ width: 200, height: 2 }} />
            <Typography variant="caption" color="text.secondary">
              Reading plot {plot.plotId}…
            </Typography>
          </Stack>
        )}
        <Box
          component="canvas"
          ref={canvasRef}
          role="img"
          aria-label={`Plot ${plot.plotId}: the photo around its box${showMask ? ', with its canopy in magenta and its box in red' : ''}`}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            visibility: picture ? 'visible' : 'hidden',
            borderRadius: 1
          }}
        />
      </Box>
      <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap', justifyContent: 'center', opacity: showMask ? 1 : 0.4 }}>
        <Swatch colour={rgb(COLOURS.plot)}>This plot’s canopy</Swatch>
        <Swatch colour={rgb(COLOURS.neighbour)}>Given to a neighbour</Swatch>
        {noPlotValue != null && <Swatch colour={rgb(COLOURS.noPlot)}>Reached no plot</Swatch>}
        <Swatch colour={COLOURS.box} outline>
          Its box
        </Swatch>
        <Swatch colour="rgba(255,255,255,0.7)" outline dashed>
          Other boxes
        </Swatch>
      </Stack>
      {picture && (
        <Typography variant="caption" color="text.secondary" align="center">
          1 px = {picture.cmPerPixel.toFixed(1)} cm of ground · hold Space to see the photo alone
        </Typography>
      )}
    </Stack>
  );
}

PlotView.propTypes = {
  links: PropTypes.shape({
    view: PropTypes.shape({ url: PropTypes.string.isRequired }).isRequired,
    result: PropTypes.shape({
      assignment: PropTypes.shape({ url: PropTypes.string.isRequired }).isRequired,
      noPlotValue: PropTypes.number
    }).isRequired
  }).isRequired,
  plot: PropTypes.object.isRequired,
  nextPlot: PropTypes.object,
  plots: PropTypes.array,
  showMask: PropTypes.bool,
  opacity: PropTypes.number
};
