/**
 * The shared Go to dialog's one rule (073 FR-043b): what its field may hold.
 *
 * One dialog serves the PDF preview's Go to Page, the grids' Go to Row and the editor's Go to Line. Its field
 * takes only a whole number from 1 to the count, and refuses any keystroke that would leave anything else — so
 * the typed text is always either empty (a number is on its way) or a position that exists. Nothing is clamped:
 * a value that is out of range cannot be typed, which is what supersedes Go to Line's clamping (033 FR-022, FR-023)
 * for typed input.
 *
 * Pure: no DOM.
 */

/** A whole number with no sign, no leading zero and no separator: digits, the first of them 1–9. */
const POSITIVE_WHOLE = /^[1-9][0-9]*$/;

/** The most positions there are: a fractional count is read as the whole positions it contains. */
const wholeCount = (count: number): number => (Number.isFinite(count) ? Math.floor(count) : 0);

/**
 * Whether `text` may stand in the field of a dialog for `count` positions: empty, or a whole number from 1 to
 * `count`. The dialog refuses an edit for which this is false.
 */
export function isGotoInput(text: string, count: number): boolean {
  if (text === '') return true;
  if (!POSITIVE_WHOLE.test(text)) return false;
  return Number(text) <= wholeCount(count);
}

/** The position `text` names, or `null` for the empty field (nothing to go to) or text the field would refuse. */
export function resolveGotoNumber(text: string, count: number): number | null {
  if (text === '' || !isGotoInput(text, count)) return null;
  return Number(text);
}
