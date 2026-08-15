/**
 * Go To Line's pure half (033 US2 — FR-021 to FR-023,
 * contracts/navigation-modals.md §5, G3–G5).
 *
 * The modal asks for a line number; this decides what that text means. Two
 * answers only, and they are deliberately different things:
 *
 *  - a number, already clamped into `[1, lineCount]`, which the caller goes to;
 *  - `null` — "do nothing", for input that is not a line number at all.
 *
 * Clamping is never an error: `0`, a negative and a number past the end of the
 * document all resolve to a real line and raise no notice (FR-022). Only
 * empty, whitespace and non-numeric input return `null`, leaving the caret, the
 * selection and the scroll position exactly as they were (FR-023).
 *
 * Pure. No DOM, no CodeMirror — the caller owns `doc.lines` and `doc.line(n)`.
 */

/** An optional sign and digits, and nothing else. A line is a whole line. */
const WHOLE_NUMBER = /^[+-]?\d+$/;

/**
 * Resolves the modal's raw text against a document of `lineCount` lines.
 * Returns the 1-based line to go to, or `null` when the input names no line.
 *
 * An empty document still has one line, so `lineCount` is floored at 1 and
 * every number resolves to line 1.
 */
export function resolveGotoLine(raw: string, lineCount: number): number | null {
  const trimmed = raw.trim();
  if (!WHOLE_NUMBER.test(trimmed)) return null;

  const asked = Number(trimmed);
  if (!Number.isFinite(asked)) return null;

  const lastLine = Math.max(1, Math.floor(lineCount));
  return Math.min(lastLine, Math.max(1, asked));
}
