// project imports
import { withAlpha } from 'utils/colorUtils';

// ==============================|| DEFAULT THEME - CUSTOM SHADOWS ||============================== //

export default function CustomShadows(palette, mode = 'light') {
  const isDark = mode === 'dark';

  // on the forest ground, elevation reads as deep black diffusion rather than a soft grey haze
  const z1 = isDark ? `0px 8px 24px rgba(0, 0, 0, 0.45)` : `0px 1px 4px ${withAlpha(palette.grey[900], 0.08)}`;

  // Ambient elevation for the surfaces that hold content — cards, framed tables,
  // nested panels. Two layers on purpose: a tight contact shadow that grounds the
  // edge against the background, and a wider diffuse one that does the separating.
  // A single mid-radius shadow ends up reading as a grey smudge instead of depth.
  //
  // Forest Dark stacks card (#18231c) on app base (#18211b) — barely a value step,
  // so on dark the shadow carries nearly all of the separation and needs several
  // times the alpha its light-mode counterpart does.
  const card = isDark
    ? `0px 1px 2px rgba(0, 0, 0, 0.30), 0px 6px 16px rgba(0, 0, 0, 0.34)`
    : `0px 1px 2px ${withAlpha(palette.grey[900], 0.06)}, 0px 4px 12px ${withAlpha(palette.grey[900], 0.05)}`;

  // A panel nested inside a card is only one step above its parent, not above the
  // page. Reusing `card` here would make the child compete with the card holding
  // it, so the contact layer stays and the diffuse layer pulls in tight.
  const nested = isDark
    ? `0px 1px 2px rgba(0, 0, 0, 0.24), 0px 3px 8px rgba(0, 0, 0, 0.22)`
    : `0px 1px 2px ${withAlpha(palette.grey[900], 0.05)}, 0px 2px 6px ${withAlpha(palette.grey[900], 0.04)}`;

  // focus rings stay 2px; on dark they carry a touch more alpha so the neon reads as a glow
  const ringAlpha = isDark ? 0.32 : 0.2;
  const glowAlpha = isDark ? 0.3 : 0.2;
  const glow = (color) => (isDark ? `0 10px 24px ${withAlpha(color, glowAlpha)}` : `0 14px 12px ${withAlpha(color, glowAlpha)}`);

  return {
    button: isDark ? `0 2px 4px rgba(0, 0, 0, 0.4)` : `0 2px #0000000b`,
    text: isDark ? `0 -1px 0 rgb(0 0 0 / 35%)` : `0 -1px 0 rgb(0 0 0 / 12%)`,
    z1,
    card,
    nested,
    primary: `0 0 0 2px ${withAlpha(palette.primary.main, ringAlpha)}`,
    secondary: `0 0 0 2px ${withAlpha(palette.secondary.main, ringAlpha)}`,
    error: `0 0 0 2px ${withAlpha(palette.error.main, ringAlpha)}`,
    warning: `0 0 0 2px ${withAlpha(palette.warning.main, ringAlpha)}`,
    info: `0 0 0 2px ${withAlpha(palette.info.main, ringAlpha)}`,
    success: `0 0 0 2px ${withAlpha(palette.success.main, ringAlpha)}`,
    grey: `0 0 0 2px ${withAlpha(palette.grey[500], ringAlpha)}`,
    primaryButton: glow(palette.primary.main),
    secondaryButton: glow(palette.secondary.main),
    errorButton: glow(palette.error.main),
    warningButton: glow(palette.warning.main),
    infoButton: glow(palette.info.main),
    successButton: glow(palette.success.main),
    greyButton: glow(palette.grey[500])
  };
}
