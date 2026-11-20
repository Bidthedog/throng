/**
 * Hold a preview's scrolling body at its width while its panel is dragged to a new size (075 SC-006, 2026-11-20).
 *
 * A drag changes the panel's width every frame. A scroller that changes size has everything inside it laid out,
 * pre-painted and painted again, and a document of 500 typeset equations made that the whole cost of the drag
 * (measured over one splitter drag: 3.5 s of paint and 1 s of pre-paint, against 0.2 s and 0.05 s for the same text
 * untypeset). So once the panel's width changes again within {@link RESIZE_SETTLE_MS} of the last change — a drag,
 * not a one-off — the scroller keeps the width it was last laid out at, and the panel, which clips its overflow,
 * shows as much of it as fits. Nothing inside it changes size, so nothing in it is drawn again. Once the width has
 * been still for {@link RESIZE_SETTLE_MS} the scroller takes the new width, and the document is laid out once.
 *
 * A single width change — a notice, a maximise — reflows at once, as it always did: everything that keeps the
 * reader's place on such a change runs against the new layout.
 *
 * Never held while a dialog is open inside the body (a `.modal-overlay`: the CSV cell dialog, Go to Row, Go to Page).
 * The hold contains the body, which would confine the dialog's window-wide overlay to the panel; a splitter drag cannot
 * start under such an overlay, but a window-edge resize or an animated maximise still changes the width in bursts.
 *
 * Provider-agnostic: it holds an element's width, whatever is inside it.
 */

/** How close together two width changes must come to count as a drag, and how long one must be still to end. */
export const RESIZE_SETTLE_MS = 150;

/** On the held element while a resize is held. */
export const RESIZING_CLASS = 'preview-panel__body--resizing';

/** A dialog's overlay (`theme.css`): fixed over the whole window, so never inside a held body. */
const DIALOG_OVERLAY_SELECTOR = '.modal-overlay';

/**
 * Hold `held`'s width while `watched` — the element whose width it follows, and which clips it — keeps changing
 * width. `held` fills `watched`'s width, so the width it is held at is `watched`'s last. Returns the release.
 */
export function holdWidthWhileResizing(watched: HTMLElement, held: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  let width: number | null = null;
  /** Set from a change until it has been still for the settle time; while set, the next change is a drag. */
  let recent: ReturnType<typeof setTimeout> | null = null;
  let holding = false;
  const release = (): void => {
    if (recent !== null) clearTimeout(recent);
    recent = null;
    if (!holding) return;
    holding = false;
    held.style.removeProperty('width');
    held.style.removeProperty('box-sizing');
    held.classList.remove(RESIZING_CLASS);
  };
  const observer = new ResizeObserver((entries) => {
    const next = entries?.[entries.length - 1]?.contentRect?.width;
    if (typeof next !== 'number') return;
    const previous = width;
    width = next;
    if (previous === null || previous === next) return;
    if (recent !== null) {
      clearTimeout(recent);
      // A selector match, not a layout read.
      if (!holding && held.querySelector(DIALOG_OVERLAY_SELECTOR) === null) {
        // A second change hard on the first: hold at the width just laid out for. Taken from the observer, not
        // read back: a layout read here would force the very layout this exists to avoid.
        holding = true;
        held.style.boxSizing = 'border-box';
        held.style.width = `${previous}px`;
        held.classList.add(RESIZING_CLASS);
      }
    }
    recent = setTimeout(release, RESIZE_SETTLE_MS);
  });
  observer.observe(watched);
  return () => {
    observer.disconnect();
    release();
  };
}
