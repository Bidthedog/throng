/**
 * A preview's scrolling body while its panel is dragged to a new size (075 SC-006, 2026-11-20; amended the same day).
 *
 * ══ LIVE BY DEFAULT ══
 *
 * The maintainer: "Can we make previews resize dynamically / on the fly again, but just reduce the amount of redraws
 * … Alternatively, apply the resize debounce on previews over a certain size instead." Both, by measured cost rather
 * than by size: a short file can hold 500 typeset equations. During a drag the body follows the panel LIVE — pinned
 * to an explicit width that moves to the panel's latest one at most once per animation frame, however many changes
 * the frame brought. Each width applied is charged with what the frame that drew it took beyond an ordinary frame
 * ({@link frameCost}).
 *
 * ══ HELD WHERE THE LAYOUT IS DEAR ══
 *
 * A scroller that changes size has everything inside it laid out, pre-painted and painted again, and a document of
 * 500 typeset equations made that the whole cost of the drag (measured over one splitter drag: 3.5 s of paint and
 * 1 s of pre-paint, against 0.2 s and 0.05 s for the same text untypeset). So once two applies in a row each cost
 * more than {@link RESIZE_FRAME_BUDGET_MS}, the rest of that drag is HELD: the body keeps the width it was last laid
 * out at, and the panel, which clips its overflow, shows as much of it as fits. Nothing inside it changes size, so
 * nothing in it is drawn again. Once the width has been still for {@link RESIZE_SETTLE_MS} the body takes the new
 * width and is laid out once. One dear frame alone (a collection, a stray task) does not hold.
 *
 * A drag that ended held measures the frame its release is drawn in: dear, and the next drag starts held at once;
 * cheap — the document got shorter, its maths went — and the next drag is live again.
 *
 * ══ UNCHANGED ══
 *
 * A single width change — a notice, a maximise — reflows at once, as it always did: everything that keeps the
 * reader's place on such a change runs against the new layout.
 *
 * Never pinned while a dialog is open inside the body (a `.modal-overlay`: the CSV cell dialog, Go to Row, Go to
 * Page). The hold contains the body, which would confine the dialog's window-wide overlay to the panel; a splitter
 * drag cannot start under such an overlay, but a window-edge resize or an animated maximise still changes the width
 * in bursts.
 *
 * Provider-agnostic: it sizes an element, whatever is inside it.
 */

/** How close together two width changes must come to count as a drag, and how long one must be still to end. */
export const RESIZE_SETTLE_MS = 150;

/**
 * The most a width change may add to its frame before a drag is held: one 60 Hz frame of work (16.7 ms, rounded
 * down). Under it the drag drops at most one frame per width — what any live resize costs; over it, every width
 * costs at least one more frame than the drag has, and the drag visibly trails the pointer.
 */
export const RESIZE_FRAME_BUDGET_MS = 16;

/** On the held element while a resize is held. */
export const RESIZING_CLASS = 'preview-panel__body--resizing';

/** A dialog's overlay (`theme.css`): fixed over the whole window, so never inside a held body. */
const DIALOG_OVERLAY_SELECTOR = '.modal-overlay';

/** How many dear applies in a row hold a live drag. */
const DEAR_IN_A_ROW = 2;

/** The frame clock, injectable: `requestAnimationFrame` and its cancel. */
export interface ResizeFrames {
  request(cb: FrameRequestCallback): number;
  cancel(id: number): void;
}

export interface HoldWidthOptions {
  frames?: ResizeFrames;
  /** What the body's last layout is known to have cost; absent, unknown — the first drag is live. */
  initialCostMs?: number;
}

/** What a width change cost: how much longer the frame it was drawn in took than an ordinary frame. Never negative. */
export function frameCost(frameMs: number, ordinaryFrameMs: number): number {
  return Math.max(0, frameMs - ordinaryFrameMs);
}

const browserFrames = (): ResizeFrames =>
  typeof requestAnimationFrame === 'function'
    ? { request: (cb) => requestAnimationFrame(cb), cancel: (id) => cancelAnimationFrame(id) }
    : { request: (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number, cancel: (id) => clearTimeout(id) };

/**
 * Size `held` while `watched` — the element whose width it follows, and which clips it — keeps changing width.
 * `held` fills `watched`'s width at rest. Returns the release.
 */
export function holdWidthWhileResizing(watched: HTMLElement, held: HTMLElement, opts: HoldWidthOptions = {}): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const frames = opts.frames ?? browserFrames();
  /** The panel's width, as last observed. */
  let width: number | null = null;
  /** Set from a change until it has been still for the settle time; while set, the next change is a drag. */
  let recent: ReturnType<typeof setTimeout> | null = null;
  /** The width pinned on `held` during a drag, or null when it fills the panel. */
  let pinned: number | null = null;
  let holding = false;
  /** Whether the next drag starts held: the last measurement found the body's layout dear. */
  let dear = opts.initialCostMs !== undefined && opts.initialCostMs > RESIZE_FRAME_BUDGET_MS;
  /** The shortest frame seen: an ordinary frame, as near as can be told. */
  let ordinaryFrame = 1000 / 60;
  let dearInARow = 0;
  /** The frame callback pending, and the start of the frame the last live width was applied in. */
  let frame: number | null = null;
  let appliedAt: number | null = null;
  let measuring: number[] = [];

  const sample = (frameMs: number): number => {
    if (frameMs >= 4) ordinaryFrame = Math.min(ordinaryFrame, frameMs);
    return frameCost(frameMs, ordinaryFrame);
  };
  const pin = (px: number): void => {
    pinned = px;
    held.style.boxSizing = 'border-box';
    held.style.width = `${px}px`;
  };
  const unpin = (): void => {
    pinned = null;
    held.style.removeProperty('width');
    held.style.removeProperty('box-sizing');
    held.classList.remove(RESIZING_CLASS);
  };
  const hold = (): void => {
    holding = true;
    held.classList.add(RESIZING_CLASS);
  };
  const stopFrames = (): void => {
    if (frame !== null) frames.cancel(frame);
    frame = null;
    appliedAt = null;
  };
  /** One frame of a live drag: charge the last width applied, then apply the latest, if it moved. */
  const onFrame = (now: number): void => {
    frame = null;
    if (appliedAt !== null) {
      dearInARow = sample(now - appliedAt) > RESIZE_FRAME_BUDGET_MS ? dearInARow + 1 : 0;
      appliedAt = null;
      if (dearInARow >= DEAR_IN_A_ROW) {
        // Dear twice running: hold the rest of this drag where it is, and start the next one held.
        dear = true;
        hold();
        return;
      }
    }
    if (holding || width === null || pinned === null || width === pinned) return;
    pin(width);
    appliedAt = now;
    frame = frames.request(onFrame); // the next frame charges this one
  };
  /** Charge the frame a release is drawn in: it decides how the next drag starts. */
  const measureRelease = (): void => {
    const first = frames.request((start) => {
      const second = frames.request((end) => {
        measuring = measuring.filter((id) => id !== second);
        dear = sample(end - start) > RESIZE_FRAME_BUDGET_MS;
      });
      measuring = [...measuring.filter((id) => id !== first), second];
    });
    measuring.push(first);
  };
  const settle = (): void => {
    if (recent !== null) clearTimeout(recent);
    recent = null;
    stopFrames();
    dearInARow = 0;
    const wasHeld = holding;
    holding = false;
    if (pinned !== null) unpin();
    if (wasHeld) measureRelease();
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
      if (pinned === null && held.querySelector(DIALOG_OVERLAY_SELECTOR) === null) {
        if (dear) {
          // Known dear: hold at the width just laid out for — taken from the observer, not read back: a layout read
          // here would force the very layout this exists to avoid.
          pin(previous);
          hold();
        } else {
          // Live: pinned at the width the panel has just been laid out for, which costs no layout; from here the
          // body moves on frames.
          pin(next);
        }
      } else if (pinned !== null && !holding && frame === null) {
        frame = frames.request(onFrame);
      }
    }
    recent = setTimeout(settle, RESIZE_SETTLE_MS);
  });
  observer.observe(watched);
  return () => {
    observer.disconnect();
    for (const id of measuring) frames.cancel(id);
    measuring = [];
    settle();
    // A release measured after disposal decides nothing.
    for (const id of measuring) frames.cancel(id);
    measuring = [];
  };
}
