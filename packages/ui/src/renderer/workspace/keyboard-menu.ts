/**
 * Was the context menu now opening asked for by the KEYBOARD? (024 US6, FR-018c follow-up.)
 *
 * Shift+F10 opens a menu by re-dispatching a synthetic `contextmenu` at the focused element, so
 * every surface's existing mouse handler serves the keyboard too — one path instead of a
 * hand-written keyboard menu per surface. The catch is that a mouse handler is entitled to assume a
 * POINTER, and one of them did: the editor moves the caret to the click when the click lands outside
 * the current selection (FR-012a, which is right for a mouse). A synthetic event carries the focused
 * element's corner as its coordinates, which is nowhere near the user's selection — so selecting a
 * word and pressing Shift+F10 collapsed that selection, and Cut then took the whole line.
 *
 * The event cannot answer the question itself: a keyboard-originated `contextmenu` is a MouseEvent
 * like any other, with no flag distinguishing it. So the dispatcher states the fact here, around a
 * dispatch that is synchronous — the handler runs inside `dispatchEvent`, before the flag is cleared.
 */
let keyboardMenu = false;

/** Run `dispatch` with the keyboard-origin fact visible to whatever handles the event. */
export function asKeyboardMenu(dispatch: () => void): void {
  keyboardMenu = true;
  try {
    dispatch();
  } finally {
    keyboardMenu = false;
  }
}

/** True only while a keyboard-originated `contextmenu` is being dispatched. */
export function isKeyboardMenu(): boolean {
  return keyboardMenu;
}
