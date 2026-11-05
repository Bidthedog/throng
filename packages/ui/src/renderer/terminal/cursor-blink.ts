/**
 * A focused terminal's cursor blink, from a timer instead of xterm's CSS animation.
 *
 * xterm's DOM renderer blinks with `1s step-end infinite`. It changes twice a second but keeps the
 * renderer's main thread producing a frame for every frame the display offers. Measured on a 144 Hz
 * display with one idle focused terminal: 144 main-thread frames a second at 6.5% of a core animated, 4
 * at 0.9% from this timer. `terminal.css` turns the animation off and draws the off half from the
 * attribute written here, on the row container, because xterm rebuilds the cursor's own span.
 */

const HALF_CYCLE_MS = 500;
const OFF_ATTRIBUTE = 'data-cursor-off';

/** The part of xterm's `Terminal` this needs. */
export interface CursorBlinkTerminal {
  readonly element: HTMLElement | undefined;
  readonly textarea: HTMLTextAreaElement | undefined;
  readonly options: { readonly theme?: { readonly cursor?: string } | undefined };
  readonly buffer: { readonly active: { readonly cursorY: number } };
  onRender(listener: (range: { start: number; end: number }) => void): { dispose(): void };
}

/** Blink `term`'s cursor while it has focus, until the returned function is called. Call after `open`. */
export function attachCursorBlink(term: CursorBlinkTerminal): () => void {
  const rows = term.element?.querySelector<HTMLElement>('.xterm-rows');
  const textarea = term.textarea;
  if (!rows || !textarea) return () => {};

  let timer: ReturnType<typeof setInterval> | undefined;
  const showCursor = (): void => rows.removeAttribute(OFF_ATTRIBUTE);
  const stop = (): void => {
    clearInterval(timer);
    timer = undefined;
    showCursor();
  };
  const start = (): void => {
    stop();
    timer = setInterval(() => {
      if (rows.hasAttribute(OFF_ATTRIBUTE)) {
        showCursor();
        return;
      }
      // Read here rather than at focus: the theme can change while a terminal has focus.
      rows.style.setProperty('--throng-terminal-cursor', term.options.theme?.cursor ?? '');
      rows.setAttribute(OFF_ATTRIBUTE, '');
    }, HALF_CYCLE_MS);
  };

  textarea.addEventListener('focus', start);
  textarea.addEventListener('blur', stop);
  // A rebuilt cursor row restarted xterm's animation with the cursor showing, which is why a cursor stays
  // solid while typing. Same rule here.
  const render = term.onRender(({ start: first, end: last }) => {
    const row = term.buffer.active.cursorY;
    if (timer !== undefined && first <= row && row <= last) start();
  });
  if (textarea.ownerDocument.activeElement === textarea) start();

  return () => {
    stop();
    textarea.removeEventListener('focus', start);
    textarea.removeEventListener('blur', stop);
    render.dispose();
  };
}
