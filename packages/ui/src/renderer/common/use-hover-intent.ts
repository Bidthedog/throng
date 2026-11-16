import { useCallback, useEffect, useRef } from 'react';

export interface HoverIntent {
  /** Run `reveal` once the pointer has stayed on `key` for the delay. Arming the key already pending changes nothing. */
  arm(key: string, reveal: () => void): void;
  /** Drop a pending reveal: for `key` only, or whichever is pending when no key is given. */
  cancel(key?: string): void;
}

/**
 * Hover intent for notices (069 FR-052): a Notifications panel entry expands in place (068 FR-085), and a cut-off
 * toast's whole-text popover opens (068 FR-079), only once the pointer has stayed for `delayMs`
 * (`notifications.hoverDelayMs`), so a pointer sweeping across them changes nothing.
 *
 * One pending reveal at a time: the pointer is in one place, so arming a second key replaces the first. Keyboard focus
 * does not go through here — a focus move is deliberate, and reveals at once. A delay of 0 reveals at once too.
 */
export function useHoverIntent(delayMs: number): HoverIntent {
  const pending = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const cancel = useCallback((key?: string): void => {
    const cur = pending.current;
    if (!cur || (key !== undefined && cur.key !== key)) return;
    clearTimeout(cur.timer);
    pending.current = null;
  }, []);

  const arm = useCallback(
    (key: string, reveal: () => void): void => {
      if (pending.current?.key === key) return;
      cancel();
      if (delayMs <= 0) {
        reveal();
        return;
      }
      const timer = setTimeout(() => {
        pending.current = null;
        reveal();
      }, delayMs);
      pending.current = { key, timer };
    },
    [cancel, delayMs],
  );

  useEffect(() => () => cancel(), [cancel]);
  return { arm, cancel };
}
