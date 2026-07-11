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
    const onBlur = (): void => setFocused(false);
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
