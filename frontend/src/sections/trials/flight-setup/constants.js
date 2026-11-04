// ==============================|| FLIGHT SETUP - SHARED CONSTANTS ||============================== //

export const ALTITUDES = [
  { value: '12-ms', label: '12 m · multispectral', bands: 5, altitude: 12 },
  { value: '25-ms', label: '25 m · multispectral', bands: 5, altitude: 25 },
  { value: '12-rgb', label: '12 m · RGB', bands: 3, altitude: 12 },
  { value: '25-rgb', label: '25 m · RGB', bands: 3, altitude: 25 }
];

export const DENOMINATORS = [
  {
    value: 'polygon',
    label: 'Polygon area',
    help: 'Usable plot area = the shapefile polygon. Nodata corners excluded from both numerator and denominator.',
    needsPolygons: true
  },
  {
    value: 'clip',
    label: 'Full clip extent',
    help: 'Bounding box of the clip. If the clips include alley or border, every f-cover is biased low.',
    needsPolygons: false
  }
];

/**
 * Single source of truth for model/capture compatibility.
 *
 * A model run on the wrong band count or altitude does not fail loudly — it
 * returns a plausible-looking mask with wrong numbers, which is far worse. So
 * this is a hard block on the run, not a warning, and the same derivation feeds
 * both the message in the panel and the page's `canRun`.
 *
 * The upload page no longer picks a model (nor a DENOMINATOR): both are chosen
 * when a flight is run, and that step is where this check belongs.
 */
export function checkModelFit(model, capture, actualBands = null) {
  if (!model || !capture) return { fits: true, reasons: [] };

  const reasons = [];

  // Once an ortho has been read, its real band count beats the dropdown's
  // assumption — the file is the fact, the capture setting is a claim.
  if (Number.isFinite(actualBands) && actualBands > 0) {
    if (model.bands !== actualBands) {
      reasons.push(`Model expects ${model.bands} bands, this orthophoto has ${actualBands}.`);
    }
  } else if (model.bands !== capture.bands) {
    reasons.push(`Model expects ${model.bands} bands, this capture is ${capture.bands}-band.`);
  }
  if (model.altitude !== capture.altitude) {
    reasons.push(`Model is trained for ${model.altitude} m, this flight is ${capture.altitude} m.`);
  }

  return { fits: reasons.length === 0, reasons };
}

/**
 * Does the orthophoto look like the capture the user picked? Only the band count
 * can be read from the file (an alpha band excluded); altitude can't, so that is
 * the setting's word. A mismatch warns instead of blocking: a 4-band R,G,B,NIR
 * sensor has no option in ALTITUDES yet, and its flights still have to upload.
 * Returns null until there is a file to compare.
 */
export function checkCaptureFit(capture, actualBands) {
  if (!capture || !Number.isFinite(actualBands) || actualBands <= 0) return null;
  return { fits: capture.bands === actualBands, expected: capture.bands, actual: actualBands };
}
