/**
 * The cell dialog's text rules (073 FR-036a, FR-060a).
 *
 * A long cell, or any cell on request, is edited in a dialog holding an editor that accepts line breaks.
 * A value that is a JSON object or array opens pretty-printed; saving flattens the text back to one line,
 * because a CSV field's line break is a hazard for every other tool that reads the file. Pure: no OS, no DOM.
 */
import { logExpected } from '../diagnostics/caught.js';

/** The shipped Long cell threshold (characters); the descriptor in `preview/providers/csv.ts` ships the same. */
const SHIPPED_THRESHOLD = 50;

/** Whether the WHOLE of `value` parses as a JSON object or array (a scalar, or text around JSON, is not). */
export function isJsonContainer(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '' || (trimmed[0] !== '{' && trimmed[0] !== '[')) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null;
  } catch (error) {
    logExpected('csv cell text: detect JSON', 'a cell that only looks like JSON is ordinary text, edited as such', error);
    return false;
  }
}

/** What the dialog opens with: a JSON object or array pretty-printed (two-space indent), anything else as it is. */
export function cellDialogText(value: string): string {
  return isJsonContainer(value) ? JSON.stringify(JSON.parse(value.trim()), null, 2) : value;
}

/**
 * What saving writes: one line. JSON — each line break together with the whitespace after it becomes one
 * space. Any other text — each line break (CRLF, CR or LF) becomes one space and everything else, indentation
 * included, is kept.
 */
export function flattenCellText(text: string): string {
  return isJsonContainer(text) ? text.replace(/(?:\r\n|\r|\n)\s*/g, ' ') : text.replace(/\r\n|\r|\n/g, ' ');
}

/**
 * Whether a panel offers the cell dialog (FR-036b): the panel's own choice when it has made one, else the
 * "Edit long cells in a dialog" setting, which ships on.
 */
export function cellDialogOn(panelChoice: unknown, setting: unknown): boolean {
  if (typeof panelChoice === 'boolean') return panelChoice;
  return typeof setting === 'boolean' ? setting : true;
}

/**
 * Whether a panel wraps its cells (FR-013): the panel's own choice when it has made one, else the "Wrap cells"
 * setting, which ships off.
 */
export function wrapCellsOn(panelChoice: unknown, setting: unknown): boolean {
  if (typeof panelChoice === 'boolean') return panelChoice;
  return typeof setting === 'boolean' ? setting : false;
}

/** The Long cell threshold as a reader of the setting uses it: a whole number of at least 1, else the shipped 50. */
export function longCellThresholdOf(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return SHIPPED_THRESHOLD;
  return Math.max(1, Math.round(raw));
}

/** A value is long when it has MORE characters than `threshold`. */
export function isLongCell(value: string, threshold: number): boolean {
  return value.length > threshold;
}

/** FR-060a — the shipped Long cell threshold, in characters. */
export const CSV_LONG_CELL_THRESHOLD = { shipped: 50, min: 1, max: 1000 } as const;
