// ==============================|| TRIALS - SURFACE TOKENS ||============================== //

/**
 * A card nested inside the workspace card sits `background.paper` on
 * `background.paper` — the hairline border is doing all the work and the panel
 * reads as flat against its parent.
 *
 * The Forest Dark grey ramp already names the way out: index 100 is documented
 * as the "raised surface" (#1e2b22), a step lighter than paper. Lifting nested
 * panels onto it separates them by value as well as by edge, which is what makes
 * them read as objects rather than as regions of the card behind them.
 *
 * The `nested` shadow finishes the job in the third dimension. It is deliberately
 * lighter than the `card` shadow MainCard applies by default — a child panel is
 * one step above its parent, not one step above the page — so this overrides
 * MainCard's own elevation rather than stacking on top of it.
 *
 * A theme callback rather than a plain object, because the shadow has to come
 * from the active colour scheme. Pass it straight to `sx`; MainCard and every
 * MUI system component accept the callback form.
 */
export const NESTED_PANEL = (theme) => ({
  bgcolor: 'grey.100',
  boxShadow: theme.vars.customShadows.nested
});

/** Same lift, for surfaces that draw their own border rather than using MainCard. */
export const NESTED_PANEL_FRAMED = (theme) => ({
  ...NESTED_PANEL(theme),
  border: '1px solid',
  borderColor: 'grey.A800',
  borderRadius: 1
});
