// ==============================|| OVERRIDES - LINER PROGRESS ||============================== //

export default function LinearProgress(theme) {
  return {
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          height: 6,
          borderRadius: 100,
          ...theme.applyStyles('dark', { backgroundColor: 'rgba(255, 255, 255, 0.08)' })
        },
        bar: {
          borderRadius: 100,
          // the neon reads as emitted light, not paint
          ...theme.applyStyles('dark', { boxShadow: '0 0 12px rgba(140, 245, 66, 0.45)' })
        }
      }
    }
  };
}
