// ==============================|| CROPLYTIX FOREST DARK - GRADIENTS ||============================== //

// app base: deep forest falling to near-black, with a soft white glow bled in from the top
export const APP_BACKDROP = [
  'radial-gradient(115% 70% at 50% -12%, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 58%)',
  'linear-gradient(165deg, #243026 0%, #18211b 48%, #111813 100%)'
].join(', ');

// drawer + app bar. Painted with `background-attachment: fixed` on both so they sample the
// same viewport-height ramp: the bar shows its top slice, the drawer the full fall-off, and
// the two read as one continuous piece of chrome.
export const CHROME_GRADIENT = 'linear-gradient(180deg, #1f2c23 0%, #17211a 45%, #0f1512 100%)';

export const CHROME_SURFACE = {
  backgroundImage: CHROME_GRADIENT,
  backgroundAttachment: 'fixed',
  backgroundRepeat: 'no-repeat'
};
