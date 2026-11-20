import { useEffect, useState } from 'react';

/**
 * Whether this renderer's OS window is currently the foreground window (012,
 * FR-002 / data-model §7). Drives the active-panel indicator's two-state
 * treatment: the foreground token when `true`, the dimmed inactive token when
 * `false`. Renderer-only (a DOM `window` focus/blur concern, no OS seam — the
 * active-panel context stays per-window, distinct from the OS focus/raise group).
 */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.hasFocus() : true,
  );

  useEffect(() => {
    const onFocus = (): void => setFocused(true);
    /*
     * 074 FR-083a (2026-11-19) — focus moving INTO a frame in this window (a click in an HTML preview's page) blurs the
     * window too, yet the window is still the foreground one: `hasFocus()` stays true while a nested frame holds focus.
     * Read once the blur has landed, so only a window that really lost the foreground dims its active panel.
     */
    const onBlur = (): void => {
      if (!(document.activeElement instanceof HTMLIFrameElement)) {
        setFocused(false);
        return;
      }
      setTimeout(() => setFocused(document.hasFocus()), 0);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    // Re-sync once: focus may have changed between the initial render and the
    // effect firing, so the first paint never shows a stale state.
    setFocused(document.hasFocus());
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return focused;
}
