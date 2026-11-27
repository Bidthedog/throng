/**
 * Tab never takes focus out of a panel on its own (maintainer's v1 review, 2026-11-27, T11).
 *
 * The browser moves focus to the next tab stop in document order, which past a panel's last control is the next
 * panel, the tab strip or File Explorer. So a Tab or Shift+Tab with no tab stop left in its direction INSIDE the
 * panel is cancelled, and the focus stays where it is. One with a stop left is the browser's own move.
 *
 * Unlike `focus-trap.ts` this does not wrap: a panel is not a modal, and how the keyboard moves between panels is
 * its own piece of work. A key a surface already handled (the grid, CodeMirror, xterm) arrives default-prevented
 * and is left alone, and so is one from a portal (a dialog drawn at the document's top level): its keydown bubbles
 * through the React tree but its element is not inside the panel.
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const TAB_STOP_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

function tabStops(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TAB_STOP_SELECTOR)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length > 0,
  );
}

/** Whether a Tab (`back` false) or Shift+Tab from `from` has a tab stop left inside `root`. */
export function hasTabStopBeyond(root: HTMLElement, from: HTMLElement, back: boolean): boolean {
  return tabStops(root).some((el) => {
    if (el === from) return false;
    const pos = from.compareDocumentPosition(el);
    return (pos & (back ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING)) !== 0;
  });
}

/** Compose into a panel root's `onKeyDown`. */
export function keepTabInPanel(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
  const root = event.currentTarget;
  const from = event.target;
  if (!(from instanceof HTMLElement) || !root.contains(from)) return;
  if (!hasTabStopBeyond(root, from, event.shiftKey)) event.preventDefault();
}
