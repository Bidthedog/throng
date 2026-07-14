import type { LineIndex } from './cut-line.js';

/**
 * Rectangular (column) selection and paste (016, US6 · FR-025/FR-025e/FR-025g/FR-025h).
 *
 * A block is not a kind of selection CodeMirror records — an Alt+drag simply produces one cursor per
 * row, and nothing marks them as a block afterwards. So the SHAPE is recognised from the cursors
 * themselves, and that recognition is what lets a copied block be pasted back as a block, in another
 * file, in another window (FR-016b).
 */

/** One row of a candidate block: which line, and which columns it spans. */
export interface RowSpan {
  line: number;
  fromCol: number;
  toCol: number;
}

/**
 * Do these cursors form a rectangle?
 *
 * The test is exactly what the name says: consecutive lines, and the SAME columns on each. An
 * Alt+drag produces precisely that. A multi-cursor set the user built by clicking around does not,
 * and must not be mistaken for one — pasting it column-wise would scatter its rows into places the
 * user never pointed at.
 *
 * A single row is not a block: it is indistinguishable from an ordinary selection, and treating it
 * as a block would make an ordinary copy paste column-wise (FR-025i).
 */
export function isRectangular(rows: readonly RowSpan[]): boolean {
  if (rows.length < 2) return false;

  const [first] = rows;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.line !== first.line + i) return false; // …not consecutive
    if (row.fromCol !== first.fromCol || row.toCol !== first.toCol) return false; // …not aligned
  }
  return true;
}

/** One edit of a column-wise paste: where it lands, and what it inserts. */
export interface RectPasteChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * The VISUAL column a character offset sits at, expanding tabs to the next tab stop.
 *
 * A column block is a visual rectangle — that is what the user drew — so every column in this module
 * is a screen column, never a character offset. On a line indented with tabs the two are different
 * numbers, and using the offset would make the block a parallelogram.
 */
export function columnAt(text: string, offset: number, tabWidth: number): number {
  let col = 0;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    col = text[i] === '\t' ? col + tabWidth - (col % tabWidth) : col + 1;
  }
  return col;
}

/**
 * The character offset of a visual column — clamped to the line's end, and reporting the column it
 * actually reached, which is short of the target on a line too short to contain it.
 *
 * ## When the target column falls INSIDE a tab
 *
 * There is no character position there — a tab is one character occupying several columns — so the
 * paste cannot land exactly on the column, and something has to give. The choice here is to land at
 * the tab's far edge (the next character boundary), never inside it.
 *
 * The alternative is to split the tab into spaces to make room, and that is forbidden: FR-025c1 says
 * padding "MUST NOT rewrite existing content", and converting a tab the user did not touch into
 * spaces is exactly that — a whitespace change in a line the paste was never supposed to reshape.
 * So a block pasted into a column that bisects a tab lands slightly right on that row. It is
 * visible, it is honest, and it destroys nothing.
 */
export function offsetAt(
  text: string,
  column: number,
  tabWidth: number,
): { offset: number; column: number } {
  let col = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (col >= column) return { offset: i, column: col };
    col = text[i] === '\t' ? col + tabWidth - (col % tabWidth) : col + 1;
  }
  return { offset: text.length, column: col };
}

/**
 * The whitespace that carries a line from one column to another (FR-025c1).
 *
 * NOT unconditionally spaces. A tab-indented file that gets spaces poured into it is a file whose
 * whitespace style this paste silently changed — the same damage FR-018d exists to prevent, and it
 * shows up in the diff of every line the block touched.
 *
 * So where the document indents with tabs, the padding is **tabs up to the last whole tab stop at or
 * before the target column, then spaces for the remainder**. The tabs get us most of the way in the
 * document's own currency; the spaces land us EXACTLY on the column, which a tab could never do — it
 * would jump to the next tab stop and put the text somewhere the user did not point at.
 */
export function padding(from: number, to: number, indent: PadStyle): string {
  if (to <= from) return '';
  if (indent.style !== 'tabs') return ' '.repeat(to - from);

  const width = indent.tabWidth;
  // The first tab stop strictly after `from`, then every stop up to the last one at or before `to`.
  let col = from;
  let out = '';
  for (;;) {
    const next = col + width - (col % width);
    if (next > to) break;
    out += '\t';
    col = next;
  }
  return out + ' '.repeat(to - col);
}

/** What padding is made of: the document's effective indentation (FR-018c/FR-018a). */
export interface PadStyle {
  style: 'tabs' | 'spaces';
  /** The tab stop — by definition how many columns a `\t` occupies in THIS document (FR-018e). */
  tabWidth: number;
}

/**
 * Paste a block COLUMN-WISE: row *n* lands at the caret's column on the *n*-th successive line
 * (FR-025c/FR-025h).
 *
 * Two things make this harder than it looks, and both are requirements:
 *
 *   • **The block can extend past the last line.** A three-row block pasted on the final line has
 *     nowhere to put rows two and three, so the lines are CREATED. Refusing to paste, or silently
 *     dropping the rows, both lose the user's text.
 *   • **A short line must be PADDED to reach the caret's column** — in the document's own
 *     indentation character, landing exactly on the column (see {@link padding}).
 */
export function rectPaste(
  rows: readonly string[],
  caret: { line: number; col: number },
  doc: LineIndex & { lines: number; line(n: number): { from: number; to: number; text: string } },
  lineEnding: string,
  indent: PadStyle = { style: 'spaces', tabWidth: 4 },
): RectPasteChange[] {
  const changes: RectPasteChange[] = [];
  /** Text appended past the end of the document, as whole new lines. */
  let appended = '';

  for (let i = 0; i < rows.length; i += 1) {
    const lineNumber = caret.line + i;

    if (lineNumber > doc.lines) {
      // Past the end of the document: the line does not exist, so it is created.
      appended += lineEnding + padding(0, caret.col, indent) + rows[i];
      continue;
    }

    const line = doc.line(lineNumber);
    const { offset, column } = offsetAt(line.text, caret.col, indent.tabWidth);
    const pos = line.from + offset;

    changes.push({ from: pos, to: pos, insert: padding(column, caret.col, indent) + rows[i] });
  }

  if (appended.length > 0) {
    const end = doc.line(doc.lines);
    changes.push({ from: end.to, to: end.to, insert: appended });
  }

  return changes;
}

/** Split clipboard text into the rows of a block, whatever line ending it carries. */
export function rowsOf(text: string): string[] {
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  // A trailing newline terminates the last row rather than adding an empty one.
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}
