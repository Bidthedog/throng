import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from 'react';

/**
 * Keep the keyboard inside a modal dialog (018 / US6 follow-up).
 *
 * `aria-modal="true"` is a PROMISE to assistive technology, not an implementation: the browser still
 * happily tabs out of the dialog and into the application behind it. So a user answering "delete this
 * file?" could Tab straight onto the file tree, the tab strip, a terminal — every control of an
 * application the dialog is supposed to have blocked — and press Enter on one of them while a
 * destructive question sat unanswered on screen. The dialog looked modal and behaved like a panel.
 *
 * Two mechanisms, because Tab is not the only way focus moves:
 *
 *  - **Tab / Shift+Tab wrap** at the ends of the dialog's own focusable set, so the keyboard cycles
 *    within it rather than leaving.
 *  - **A `focusin` guard**, which catches every OTHER route: a terminal attaching in the background
 *    and calling `focus()`, an editor mounting, a programmatic `select()`. Focus is returned to where
 *    it was inside the dialog, so a background component cannot steal the caret mid-decision.
 *
 * The focusable set is recomputed per keystroke rather than cached: a dialog's `details` region can
 * render buttons of its own (the app-close prompt's terminal list), and a cached set goes stale the
 * moment one appears or a button becomes disabled.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface FocusTrap<T extends HTMLElement> {
  /** Attach to the dialog element. It needs `tabIndex={-1}` so it can hold focus as a last resort. */
  ref: MutableRefObject<T | null>;
  /** Compose into the dialog's `onKeyDown`; handles Tab only, and leaves every other key alone. */
  onKeyDown: (event: ReactKeyboardEvent) => void;
}

export function useFocusTrap<T extends HTMLElement = HTMLElement>(active: boolean): FocusTrap<T> {
  const ref = useRef<T | null>(null);
  // Where focus was last seen INSIDE the dialog, so a steal is undone rather than merely corrected
  // to some arbitrary button — landing the user back on the choice they were considering.
  const lastInside = useRef<HTMLElement | null>(null);

  const focusables = useCallback((): HTMLElement[] => {
    const root = ref.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) =>
        // A NEGATIVE tabindex means "focusable, but not a TAB STOP" — which the selector cannot
        // express for elements that are natively focusable. A roving-tabindex listbox (the language
        // picker) is exactly this: every option is a <button>, and all but the active one carry
        // tabindex="-1" precisely so Tab skips them. Counting them made the trap believe the last
        // option was somewhere in the middle, so Tab at the true end was not recognised as the end,
        // the browser moved focus out of the region, and the focusin guard hauled it back — leaving
        // Tab looking like it did nothing at all.
        el.tabIndex >= 0 &&
        // `offsetParent === null` means display:none or a hidden ancestor. The currently-focused
        // element is kept regardless: a focused element is by definition reachable.
        (el.offsetParent !== null || el === document.activeElement),
    );
  }, []);

  useEffect(() => {
    if (!active) return;
    lastInside.current = null;
    // Take the keyboard on open. A dialog whose caret is still out in the application behind it has
    // not opened modally at all — the first Tab would move within THAT, never reaching the guard on
    // the dialog. Dialogs that autofocus a specific button (the confirmation's primary choice) have
    // already done so by now, so this only acts when nothing else has.
    const opened = ref.current;
    if (opened && !opened.contains(document.activeElement)) {
      (focusables()[0] ?? opened).focus();
    }
    const onFocusIn = (event: FocusEvent): void => {
      const root = ref.current;
      if (!root) return; // the dialog has already gone — nothing to hold focus for
      const target = event.target as HTMLElement | null;
      if (target && root.contains(target)) {
        lastInside.current = target;
        return;
      }
      const items = focusables();
      (lastInside.current ?? items[items.length - 1] ?? root).focus();
    };
    // Capture, so a handler that stops propagation on the way up cannot get past the guard.
    document.addEventListener('focusin', onFocusIn, true);
    return () => document.removeEventListener('focusin', onFocusIn, true);
  }, [active, focusables]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const root = ref.current;
      if (!root) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault(); // nothing to move to — Tab must still not leave
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const inside = current !== null && root.contains(current);
      const atEnd = event.shiftKey ? current === first : current === last;
      if (!inside || atEnd) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    },
    [focusables],
  );

  return { ref, onKeyDown };
}
