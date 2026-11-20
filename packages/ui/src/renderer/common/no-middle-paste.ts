/**
 * 073 FR-008g — the middle mouse button never pastes, anywhere in throng (maintainer, 2026-11-20: "Middle mouse should
 * not paste in throng at all").
 *
 * On Linux, Chromium pastes the primary selection (or, where there is none, the clipboard) into the focused editor as
 * the DEFAULT of a middle-button release, delivered as a `paste` event. The guard, installed once per window at the
 * renderer entry (`main.tsx`) and once in an HTML Preview's page (`frame-input.ts`):
 * - cancels the default of every middle press, release and `auxclick` (no paste, no autoscroll), with a modifier or not;
 * - drops a `paste` that arrives within {@link MIDDLE_PASTE_WINDOW_MS} of one, before any editor, input or terminal
 *   sees it. A key press ends that window, so a Ctrl+V straight after is the reader's own.
 *
 * What it leaves alone: `pointerdown` (the previews' middle-drag pan reads `defaultPrevented` there, and cancelling it
 * would drop the compatibility `mousedown` the zoom reset is bound to), and every listener — cancelling a default
 * stops nothing from hearing the event, so the grid's and the diagrams' pans and Ctrl+middle-click's zoom reset
 * (`mouse-zoom.ts`) run as before.
 *
 * The terminal needs no case of its own: its container already swallows every native paste (#142), and this drops the
 * middle-click's before it gets there.
 */
/** A paste this soon after a middle press or release is that click's, not the reader's. */
export const MIDDLE_PASTE_WINDOW_MS = 500;

interface MouseLike {
  readonly button: number;
  preventDefault(): void;
}
interface PasteLike {
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

export interface MiddlePasteGuard {
  /** A `mousedown`, `mouseup` or `auxclick`. */
  mouse(e: MouseLike): void;
  /** A `keydown`: the reader's own paste may follow. */
  key(): void;
  paste(e: PasteLike): void;
}

/** The guard's decisions, with the clock injected. */
export function createMiddlePasteGuard(now: () => number = Date.now): MiddlePasteGuard {
  let lastMiddle = Number.NEGATIVE_INFINITY;
  return {
    mouse(e) {
      if (e.button !== 1) return;
      e.preventDefault();
      lastMiddle = now();
    },
    key() {
      lastMiddle = Number.NEGATIVE_INFINITY;
    },
    paste(e) {
      if (now() - lastMiddle >= MIDDLE_PASTE_WINDOW_MS) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
  };
}

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * Install the guard on `target` (a window, or a frame's document) in the capture phase, so it runs before anything
 * inside. The answer removes it.
 */
export function installNoMiddlePaste(target: Listenable, now?: () => number): () => void {
  const guard = createMiddlePasteGuard(now);
  const mouse = (e: Event): void => guard.mouse(e as MouseEvent);
  const key = (): void => guard.key();
  const paste = (e: Event): void => guard.paste(e);
  const listeners: [string, (e: Event) => void][] = [
    ['mousedown', mouse],
    ['mouseup', mouse],
    ['auxclick', mouse],
    ['keydown', key],
    ['paste', paste],
  ];
  for (const [type, fn] of listeners) target.addEventListener(type, fn, true);
  return () => {
    for (const [type, fn] of listeners) target.removeEventListener(type, fn, true);
  };
}
