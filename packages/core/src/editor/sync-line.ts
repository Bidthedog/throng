/**
 * 081 FR-032 (#733) — the line a sync-scroll highlight names. A stop with a blank line under the centre of the
 * scrolled view highlights the next non-blank line instead, so every stop shows where the two views are in step; a
 * blank line with nothing but blank lines after it takes the previous non-blank line. Pure, and in core, because the
 * editor and the preview both apply it: the editor to its own document, the preview to the text it drew.
 *
 * Lines are 0-based, the numbering `data-source-line` and the editor scroll store use.
 */

/** A document's lines, read one at a time, so a caller holding a CodeMirror `Text` need not copy it into an array. */
export interface SyncLineText {
  readonly count: number;
  text(line: number): string;
}

const BLANK = /^\s*$/;

/** `line` if it holds text; else the next line that does; else the previous one; `null` when no line holds text. */
export function nonBlankSyncLine(lines: SyncLineText | readonly string[], line: number): number | null {
  const count = 'count' in lines ? lines.count : lines.length;
  const textAt = 'count' in lines ? (n: number) => lines.text(n) : (n: number) => lines[n] ?? '';
  if (count <= 0) return null;
  const start = Math.min(Math.max(0, Math.trunc(line)), count - 1);
  for (let n = start; n < count; n += 1) if (!BLANK.test(textAt(n))) return n;
  for (let n = start - 1; n >= 0; n -= 1) if (!BLANK.test(textAt(n))) return n;
  return null;
}
