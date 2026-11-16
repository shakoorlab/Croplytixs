import { openRaster, readWindow } from 'api/map';

// ==============================|| REVIEWER - PLOT PICTURE ||============================== //

/**
 * One plot's picture: the photo around its box from the viewing COG, and, for
 * every pixel of it, which plot the watershed gave that pixel's canopy to (from
 * the result's assignment raster, resampled onto the photo's pixels).
 *
 * The frame is the box plus a margin on every side, so the neighbours a plot
 * grows into, or loses canopy to, are in view.
 */

const MARGIN_SHARE = 0.35; // of the box's longer side
const MIN_MARGIN = 0.5; // map units (metres)
const MAX_SIDE = 1400; // photo pixels across the longer side; coarser levels past this

export const COLOURS = {
  plot: [255, 79, 216], // this plot's canopy: magenta stands out against green leaves
  neighbour: [79, 179, 255], // canopy another plot was given
  noPlot: [190, 190, 190], // canopy no plot reached
  box: '#ff3b30', // this plot's box, red as in the field picture
  otherBox: 'rgba(255, 255, 255, 0.55)'
};

export function ringBounds(ring) {
  const xs = ring.map((point) => point[0]);
  const ys = ring.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function frameFor(ring) {
  const [minX, minY, maxX, maxY] = ringBounds(ring);
  const margin = Math.max(MIN_MARGIN, MARGIN_SHARE * Math.max(maxX - minX, maxY - minY));
  return [minX - margin, minY - margin, maxX + margin, maxY + margin];
}

const pictures = new Map();
const MAX_PICTURES = 12;

async function build(viewUrl, assignmentUrl, ring) {
  const frame = frameFor(ring);
  const [view, assignment] = await Promise.all([openRaster(viewUrl), openRaster(assignmentUrl)]);
  const photo = await readWindow(view, frame, { maxSide: MAX_SIDE, samples: [0, 1, 2], interleave: true });
  const owners = await readWindow(assignment, frame, { maxSide: 1e6, samples: [0] });
  const source = owners.data[0];

  // Nearest owner for each photo pixel: the two grids rarely share a pixel size
  // (the field is read at about the model's 2.3 cm) or an origin.
  const { width, height } = photo;
  const columns = new Int32Array(width);
  for (let i = 0; i < width; i += 1) {
    const x = photo.originX + (i + 0.5) * photo.resX;
    columns[i] = Math.floor((x - owners.originX) / owners.resX);
  }
  const labels = new Uint16Array(width * height);
  for (let j = 0; j < height; j += 1) {
    const y = photo.originY + (j + 0.5) * photo.resY;
    const row = Math.floor((y - owners.originY) / owners.resY);
    if (row < 0 || row >= owners.height) continue;
    const base = row * owners.width;
    for (let i = 0; i < width; i += 1) {
      const column = columns[i];
      if (column >= 0 && column < owners.width) labels[j * width + i] = source[base + column];
    }
  }

  return {
    width,
    height,
    rgb: photo.data,
    labels,
    cmPerPixel: Math.abs(photo.resX) * 100,
    // map coordinates → picture pixels
    toPixel: ([x, y]) => [(x - photo.originX) / photo.resX, (y - photo.originY) / photo.resY],
    frame
  };
}

/** The plot's picture, read once per link and plot and kept for a few plots, so stepping back is instant. */
export function loadPlotPicture(viewUrl, assignmentUrl, plot) {
  const key = `${viewUrl}|${assignmentUrl}|${plot.plotId}`;
  if (!pictures.has(key)) {
    const loading = build(viewUrl, assignmentUrl, plot.box);
    loading.catch(() => pictures.delete(key));
    pictures.set(key, loading);
    while (pictures.size > MAX_PICTURES) pictures.delete(pictures.keys().next().value);
  }
  return pictures.get(key);
}

function blend(pixels, offset, colour, alpha) {
  pixels[offset] = pixels[offset] * (1 - alpha) + colour[0] * alpha;
  pixels[offset + 1] = pixels[offset + 1] * (1 - alpha) + colour[1] * alpha;
  pixels[offset + 2] = pixels[offset + 2] * (1 - alpha) + colour[2] * alpha;
}

/**
 * Draws the picture: the photo, and over it (unless `showMask` is off) this
 * plot's canopy with a solid edge, the canopy other plots were given, canopy no
 * plot reached, and the boxes. `opacity` scales the canopy tints.
 */
export function drawPlotPicture(canvas, picture, { plot, plots = [], showMask = true, opacity = 0.6, noPlotValue = null }) {
  const { width, height, rgb, labels } = picture;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const pixels = image.data;
  for (let i = 0, p = 0; i < width * height; i += 1, p += 4) {
    pixels[p] = rgb[i * 3];
    pixels[p + 1] = rgb[i * 3 + 1];
    pixels[p + 2] = rgb[i * 3 + 2];
    pixels[p + 3] = 255;
  }

  if (showMask) {
    const own = plot.label;
    const fill = 0.6 * opacity;
    const other = 0.45 * opacity;
    for (let j = 0; j < height; j += 1) {
      for (let i = 0; i < width; i += 1) {
        const k = j * width + i;
        const label = labels[k];
        if (!label) continue;
        if (label === own) {
          // Solid on the edge, so the outline reads at any opacity.
          const edge =
            i === 0 ||
            j === 0 ||
            i === width - 1 ||
            j === height - 1 ||
            labels[k - 1] !== own ||
            labels[k + 1] !== own ||
            labels[k - width] !== own ||
            labels[k + width] !== own;
          blend(pixels, k * 4, COLOURS.plot, edge ? Math.max(0.9, fill) : fill);
        } else if (noPlotValue != null && label === noPlotValue) {
          blend(pixels, k * 4, COLOURS.noPlot, other);
        } else {
          blend(pixels, k * 4, COLOURS.neighbour, other);
        }
      }
    }
  }
  context.putImageData(image, 0, 0);

  if (!showMask) return;
  const line = Math.max(1.5, Math.max(width, height) / 360);
  const [fx0, fy0, fx1, fy1] = picture.frame;
  const path = (ring) => {
    context.beginPath();
    ring.forEach((point, index) => {
      const [x, y] = picture.toPixel(point);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
  };
  context.setLineDash([line * 3, line * 2]);
  context.lineWidth = line;
  context.strokeStyle = COLOURS.otherBox;
  plots.forEach((other) => {
    if (other.plotId === plot.plotId || !other.box) return;
    const [x0, y0, x1, y1] = ringBounds(other.box);
    if (x1 < fx0 || x0 > fx1 || y1 < fy0 || y0 > fy1) return;
    path(other.box);
    context.stroke();
  });
  context.setLineDash([]);
  context.lineWidth = line * 1.4;
  context.strokeStyle = COLOURS.box;
  path(plot.box);
  context.stroke();
}
