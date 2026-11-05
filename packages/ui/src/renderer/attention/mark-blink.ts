/**
 * The one clock every attention mark blinks to (057 FR-093, FR-093a).
 *
 * A stepped toggle rather than a CSS animation. An infinite animation makes Chromium produce a frame for
 * every frame the display offers, for as long as a mark stands, and on X11 each of those frames presents
 * the whole window. Measured on a 144 Hz display with one 14 px mark: 143 full-window presents a second
 * animated, 3 stepped, and 56 W against 38.5 W at the GPU.
 *
 * One timer for the window, however many holders show a mark, and none when no mark is showing. The
 * attribute is written straight to the element so a blink never re-renders React.
 */

/** Half of FR-093's 2 s cycle. */
const HALF_CYCLE_MS = 1000;

const marks = new Set<HTMLElement>();
let dim = false;
let timer: ReturnType<typeof setInterval> | undefined;

function reducedMotion(): boolean {
  return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function show(el: HTMLElement): void {
  el.toggleAttribute('data-blink-dim', dim && !reducedMotion());
}

function tick(): void {
  dim = !dim;
  for (const el of marks) show(el);
}

/** Blink `el` in step with every other mark until the returned function is called. */
export function blinkMark(el: HTMLElement): () => void {
  marks.add(el);
  show(el);
  timer ??= setInterval(tick, HALF_CYCLE_MS);
  return () => {
    marks.delete(el);
    if (marks.size > 0) return;
    clearInterval(timer);
    timer = undefined;
    dim = false;
  };
}
