import { useEffect, type ReactElement } from 'react';

/**
 * US10 / FR-035 — kill the STRANDED HOVER.
 *
 * Native CSS `:hover` sticks to whatever the pointer is over until the pointer MOVES. When an overlay
 * closes over an element and focus leaves for another window without any pointer movement — the exact
 * shape of the bug: the cog menu's "Themes" item sits over the Files & Folders root, clicking it opens
 * the Preferences window (which takes focus and blurs the main window), the menu closes, and the root
 * is left painted with its hover background even though the pointer is nowhere near "actively hovering"
 * — the hover just hangs there.
 *
 * The fix is a single flag the stylesheets already respect: `data-window-blurred` on `<body>`.
 * Hover-background rules are scoped `:where(body:not([data-window-blurred]))`, so they simply stop
 * painting while the flag is set. This hook owns the flag:
 *
 * - SET on window `blur` (the main window loses focus when a child window/menu takes it).
 * - CLEAR only on window `focus` FOLLOWED BY a genuine `pointermove` — never on focus alone, because
 *   the pointer may still be stranded over the element; hover must return only when the user actually
 *   moves onto something.
 *
 * It is deliberately NOT seeded from `document.hasFocus()` at mount: a window that starts unfocused
 * (common in CI/headless) would otherwise begin suppressed and hide every genuine hover. The flag
 * engages only on a real `blur`, so a normally-focused window behaves exactly as before.
 */
export function useHoverSuppression(): void {
  useEffect(() => {
    const body = document.body;
    let awaitingMove = false;

    const setBlurred = (): void => {
      body.setAttribute('data-window-blurred', '');
      awaitingMove = false;
    };
    const requestClear = (): void => {
      // Do not clear yet — wait for the first real pointer movement in the now-focused window.
      if (body.hasAttribute('data-window-blurred')) awaitingMove = true;
    };
    const onBlur = (): void => setBlurred();
    const onFocus = (): void => requestClear();
    const onPointerMove = (): void => {
      // `awaitingMove` is set only by the focus EVENT, so this is exactly "focus THEN first
      // pointermove". It is not gated on document.hasFocus(): a headless window may report no OS
      // focus even after a focus event, and the requirement's signal is the event + the move.
      if (awaitingMove) {
        body.removeAttribute('data-window-blurred');
        awaitingMove = false;
      }
    };

    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pointermove', onPointerMove, true);

    // The app-modal preferences window is a CHILD WINDOW whose opening blurs this one — and the OS
    // `blur` event is not delivered reliably to the disabled window, so the main process also tells us
    // directly (data-model §8: "on window blur / child-window open"). Open → blurred; close → clear on
    // the next genuine pointermove, exactly like a focus return.
    const offBlurred = window.throng?.onWindowBlurred?.((blurred) =>
      blurred ? setBlurred() : requestClear(),
    );

    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pointermove', onPointerMove, true);
      offBlurred?.();
    };
  }, []);
}

/** Null-rendering mount point for {@link useHoverSuppression}, dropped into each window's app root. */
export function HoverSuppression(): ReactElement | null {
  useHoverSuppression();
  return null;
}
