// third-party
import { presetPalettes } from '@ant-design/colors';

// project imports
import ThemeOption from './theme';
import DarkThemeOption from './theme/dark';
import { extendPaletteWithChannels } from 'utils/colorUtils';

const greyAscent = ['#fafafa', '#bfbfbf', '#434343', '#1f1f1f'];

// ==============================|| GREY COLORS BUILDER ||============================== //

function buildGrey() {
  let greyPrimary = [
    '#ffffff',
    '#fafafa',
    '#f5f5f5',
    '#f0f0f0',
    '#d9d9d9',
    '#bfbfbf',
    '#8c8c8c',
    '#595959',
    '#262626',
    '#141414',
    '#000000'
  ];
  let greyConstant = ['#fafafb', '#e6ebf1'];

  return [...greyPrimary, ...greyAscent, ...greyConstant];
}

// ==============================|| CROPLYTIX FOREST DARK - COLOR RAMPS ||============================== //

// Green-tinted neutral ramp. Order matches buildGrey():
// 0-10 surfaces -> text, 11-14 = A100/A200/A400/A700, 15 = A50, 16 = A800.
const forestGrey = [
  '#18231c', // 0   card / panel surface  (background.paper)
  '#131c16', // 50  nested panel
  '#1e2b22', // 100 raised surface
  '#3c4c40', // 200 border
  '#4a5c4f', // 300 strong border / action.disabled
  '#71877a', // 400 muted steel-green     (text.disabled)
  '#afafaf', // 500 secondary text
  '#bccfc0', // 600 green-silver tint
  '#e8e8e8', // 700 primary text
  '#f2f5f2', // 800
  '#ffffff', // 900
  '#1e2921', // A100
  '#3a4a3e', // A200 scrollbars
  '#71877a', // A400
  '#bccfc0', // A700
  '#18211b', // A50  app base            (background.default)
  '#3c4c40' //  A800 card border
];

const forestColors = {
  // signature neon leaf green
  leaf: ['#2a3d20', '#33491f', '#3e5c22', '#6cc236', '#7ade3c', '#8cf542', '#a3f76b', '#b8f98f', '#cdfbb3', '#e3fdd8'],
  // emerald — dark[6] is the #5ceba3 "text on dark" variant
  emerald: ['#163126', '#1a3d2e', '#205138', '#29b877', '#2bcc81', '#2ee08a', '#5ceba3', '#85f1bc', '#aef6d3', '#d6fbe9'],
  orange: ['#33200f', '#40280f', '#573414', '#e0763a', '#f08142', '#ff8c49', '#ffa571', '#ffbd99', '#ffd6c0', '#ffeae0'],
  violet: ['#241f38', '#2c2545', '#3a2f5c', '#8b6df0', '#9a7cf5', '#a78bfa', '#bda6fb', '#cfbdfc', '#e0d4fe', '#f0eaff'],
  red: ['#35191b', '#421f21', '#5a2a2c', '#e05555', '#f26060', '#ff6b6b', '#ff8f8f', '#ffb0b0', '#ffcdcd', '#ffe7e7'],
  grey: forestGrey
};

// ==============================|| DEFAULT THEME - PALETTE ||============================== //

export function buildPalette(presetColor) {
  const lightColors = { ...presetPalettes, grey: buildGrey() };
  const lightPaletteColor = ThemeOption(lightColors, presetColor);
  const darkPaletteColor = DarkThemeOption(forestColors);

  const commonColor = { common: { black: '#000', white: '#fff' } };

  const extendedLight = extendPaletteWithChannels(lightPaletteColor);
  const extendedDark = extendPaletteWithChannels(darkPaletteColor);
  const extendedCommon = extendPaletteWithChannels(commonColor);

  return {
    light: {
      mode: 'light',
      ...extendedCommon,
      ...extendedLight,
      text: {
        primary: extendedLight.grey[700],
        secondary: extendedLight.grey[500],
        disabled: extendedLight.grey[400]
      },
      action: { disabled: extendedLight.grey[300] },
      divider: extendedLight.grey[200],
      background: {
        paper: extendedLight.grey[0],
        default: extendedLight.grey.A50
      }
    },
    dark: {
      mode: 'dark',
      ...extendedCommon,
      ...extendedDark,
      text: {
        primary: extendedDark.grey[700],
        secondary: extendedDark.grey[500],
        disabled: extendedDark.grey[400]
      },
      action: {
        disabled: extendedDark.grey[300],
        hover: 'rgba(255, 255, 255, 0.06)',
        selected: 'rgba(255, 255, 255, 0.09)',
        focus: 'rgba(140, 245, 66, 0.14)'
      },
      // #3c4c40 @ ~70%
      divider: 'rgba(60, 76, 64, 0.7)',
      background: {
        paper: extendedDark.grey[0],
        default: extendedDark.grey.A50
      }
    }
  };
}
