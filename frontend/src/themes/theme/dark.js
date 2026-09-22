// ==============================|| PRESET THEME - CROPLYTIX FOREST DARK ||============================== //

/**
 * Dark counterpart of ./index.js (Default). Same palette shape, inverted ramps:
 * index 0-2 are deep tints meant to sit *behind* content (chip fills, nav pills),
 * index 5 is the brand colour, 6-9 get brighter for hover / focus on a dark ground.
 */
export default function Dark(colors) {
  const { leaf, red, orange, violet, emerald, grey } = colors;

  const greyColors = {
    0: grey[0],
    50: grey[1],
    100: grey[2],
    200: grey[3],
    300: grey[4],
    400: grey[5],
    500: grey[6],
    600: grey[7],
    700: grey[8],
    800: grey[9],
    900: grey[10],
    A50: grey[15],
    A100: grey[11],
    A200: grey[12],
    A400: grey[13],
    A700: grey[14],
    A800: grey[16]
  };

  // near-black forest ink — every accent here is bright, so filled surfaces need dark text
  const contrastText = '#0f1710';

  const ramp = (c) => ({
    lighter: c[0],
    100: c[1],
    200: c[2],
    light: c[3],
    400: c[4],
    main: c[5],
    dark: c[6],
    700: c[7],
    darker: c[8],
    900: c[9],
    contrastText
  });

  return {
    primary: ramp(leaf),
    secondary: {
      lighter: greyColors[100],
      100: greyColors[100],
      200: greyColors[200],
      light: greyColors[300],
      400: greyColors[400],
      main: greyColors[500],
      600: greyColors[600],
      dark: greyColors[700],
      800: greyColors[800],
      darker: greyColors[900],
      A100: greyColors[0],
      A200: greyColors.A400,
      A300: greyColors.A700,
      contrastText: greyColors[0]
    },
    error: ramp(red),
    warning: ramp(orange),
    info: ramp(violet),
    success: ramp(emerald),
    grey: greyColors
  };
}
