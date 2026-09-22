// project imports
import { APP_BACKDROP } from '../gradients';

// ==============================|| OVERRIDES - CSS BASELINE ||============================== //

export default function CssBaseline(theme) {
  return {
    MuiCssBaseline: {
      styleOverrides: {
        /**
         * Global type scale.
         *
         * Everything sized in the app — this theme's typography variants, the
         * component overrides, MUI's own internal `pxToRem` defaults, and any
         * literal rem in a component — resolves against the root font size, so
         * one value here lifts all of them together at every breakpoint.
         *
         * Expressed as a percentage rather than px so a user who has raised
         * their browser's default text size still gets it.
         *
         * 106.25% = 17px at a 16px default. `htmlFontSize` in typography.js
         * stays at 16 on purpose: that is what makes MUI's pxToRem values scale
         * along with everything else instead of cancelling this out.
         *
         * Tune the whole app's text size by changing this one number.
         */
        html: {
          fontSize: '106.25%'
        },
        '*': {
          WebkitTapHighlightColor: 'transparent'
        },
        body: {
          scrollbarColor: `${theme.vars.palette.grey.A200} transparent`,
          scrollbarWidth: 'thin',
          '&::-webkit-scrollbar, & *::-webkit-scrollbar': { width: 10, height: 10 },
          '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
            borderRadius: 8,
            backgroundColor: theme.vars.palette.grey.A200,
            border: '2px solid transparent',
            backgroundClip: 'content-box'
          },
          '&::-webkit-scrollbar-thumb:hover, & *::-webkit-scrollbar-thumb:hover': {
            backgroundColor: theme.vars.palette.grey[300]
          },
          ...theme.applyStyles('dark', {
            backgroundColor: '#18211b',
            backgroundImage: APP_BACKDROP,
            backgroundRepeat: 'no-repeat',
            backgroundAttachment: 'fixed'
          })
        }
      }
    }
  };
}
