import type { Span } from '@throng/core';

/**
 * A terminal's LOGICAL lines — the rows a soft wrap split, joined back into the one line the program
 * printed (045 FR-130 – FR-132, #326; data-model §14.1).
 *
 * Shared by the two readers of terminal text for links: the provider (`file-link-provider.ts`), which
 * reads the line under the pointer, and the view pass (`link-view-marks.ts`), which reads every line in
 * view. One reading, so a link cannot span different cells for the hover and for the mark at rest.
 */

/** The slice of an xterm buffer line this reads. */
export interface LogicalLineSourceRow {
  translateToString(trimRight?: boolean): string;
  /** True on a row that CONTINUES the one above it — a soft wrap, never a real newline (FR-132). */
  readonly isWrapped?: boolean;
}

/** The slice of an xterm buffer this reads. */
export interface LogicalLineSource {
  getLine(index: number): LogicalLineSourceRow | undefined;
}

/** One logical line: its text, and where each of its rows starts in that text. */
export interface LogicalLine {
  readonly text: string;
  /** 1-based buffer line of the first row. */
  readonly firstY: number;
  /** Offset into `text` at which each row starts. */
  readonly rowStarts: readonly number[];
}

/** xterm's 1-based inclusive range. */
export interface CellRange {
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
}

/**
 * How far the logical line is followed from the row asked about, each way.
 *
 * A bound, because a single logical line can be enormous — a minified bundle printed in one write
 * wraps into thousands of rows — and a hover must not scan all of it. Two hundred rows is several
 * screens of one line and far past any path or url a person would follow.
 */
export const MAX_WRAPPED_ROWS = 200;

/**
 * The logical line holding 1-based buffer line `y`, or `null` for a row the buffer does not hold or
 * one with nothing on it.
 *
 * Every row but the last is read UNTRIMMED: a wrapped row is full-width by definition, and trimming a
 * trailing space off it would shift every offset after it by one. The last is trimmed, as a single
 * row always was.
 */
export function logicalLineAt(buffer: LogicalLineSource, y: number): LogicalLine | null {
  const index = y - 1; // xterm counts buffer lines from 1; the buffer API indexes from 0
  const asked = buffer.getLine(index);
  if (asked === undefined) return null;

  let first = index;
  while (first > 0 && index - first < MAX_WRAPPED_ROWS && buffer.getLine(first)?.isWrapped === true) {
    first -= 1;
  }
  let last = index;
  while (last - index < MAX_WRAPPED_ROWS && buffer.getLine(last + 1)?.isWrapped === true) last += 1;

  const rowStarts: number[] = [];
  let text = '';
  for (let row = first; row <= last; row += 1) {
    rowStarts.push(text.length);
    text += buffer.getLine(row)?.translateToString(row === last) ?? '';
  }
  if (text.trim().length === 0) return null;
  return { text, firstY: first + 1, rowStarts };
}

/**
 * Every logical line with a row in `top..bottom` (1-based, inclusive), each once and in order. A line
 * wrapped across the viewport's edge is read whole, so a link half in view is still one link.
 */
export function logicalLinesBetween(buffer: LogicalLineSource, top: number, bottom: number): LogicalLine[] {
  const lines: LogicalLine[] = [];
  let y = Math.max(1, top);
  while (y <= bottom) {
    const line = logicalLineAt(buffer, y);
    if (line === null) {
      y += 1;
      continue;
    }
    lines.push(line);
    // Past the line's last row — never back to a row already read, whatever the wrap bound did.
    y = Math.max(y + 1, line.firstY + line.rowStarts.length);
  }
  return lines;
}

/** xterm's 1-based cell for a 0-based offset into a logical line. */
export function cellAt(line: LogicalLine, offset: number): { x: number; y: number } {
  let row = 0;
  while (row + 1 < line.rowStarts.length && (line.rowStarts[row + 1] as number) <= offset) row += 1;
  return { x: offset - (line.rowStarts[row] as number) + 1, y: line.firstY + row };
}

/** xterm's range is 1-based and INCLUSIVE at both ends; a span is 0-based and half-open. */
export function rangeOf(line: LogicalLine, span: Span): CellRange {
  return { start: cellAt(line, span.start), end: cellAt(line, span.end - 1) };
}
