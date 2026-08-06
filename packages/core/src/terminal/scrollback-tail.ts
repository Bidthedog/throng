/**
 * The bounded tail of session output a terminal replays into a view that (re)attaches (008
 * FR-014/FR-021), and the reason 028 exists.
 *
 * An inactive tab is not hidden — its panels are unmounted — so this replay is what a returning tab
 * is BUILT from. It runs on every tab switch, not only after a crash, which makes its correctness a
 * matter of everyday rendering rather than of recovery.
 *
 * The shipped version was `(tail + chunk).slice(-MAX)`: a cut at an arbitrary byte offset. That can
 * land inside a control sequence, and the remainder is then parsed as content — a CSI cut mid-way
 * prints its tail as literal text, and an OSC cut before its terminator swallows everything after it
 * as a string payload. Both present exactly as the reported garbling.
 *
 * So the cut is moved forward to just after a newline. A CSI/OSC/DCS sequence never contains one
 * (a control string is terminated by BEL or ST, and CSI by its final byte), so a tail that begins
 * after a newline cannot begin inside a sequence.
 */

/** Line feed — the only byte a control sequence is guaranteed not to contain. */
const LF = '\n';

/**
 * Append `chunk` to `tail`, keeping at most `max` bytes and never leaving the retained tail starting
 * inside a control sequence.
 *
 * When the result must be trimmed, the cut advances to the byte after the first newline in the
 * retained window. If that window holds no newline at all — one enormous unbroken line — the tail is
 * dropped to empty rather than replayed from an arbitrary offset: an incoherent replay is worse than
 * none, because it paints garbage the user must clear by hand, which is the very complaint 028 fixes.
 */
export function appendScrollback(tail: string, chunk: string, max: number): string {
  const joined = tail + chunk;
  if (joined.length <= max) return joined;
  const cut = joined.length - max;
  const window = joined.slice(cut);
  // The cut may already sit at a line start — the byte before it is a newline (or it is the very
  // beginning). Nothing to advance past, and advancing anyway would throw away a whole good line on
  // every append, which over a long session quietly shrinks the replay to nothing.
  if (cut === 0 || joined[cut - 1] === LF) return window;
  const boundary = window.indexOf(LF);
  if (boundary === -1) return '';
  return window.slice(boundary + 1);
}
