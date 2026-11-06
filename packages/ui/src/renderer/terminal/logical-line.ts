import { KNOWN_FILE_EXTENSIONS, type Span } from '@throng/core';

/**
 * A terminal's LOGICAL lines — the rows a soft wrap split, joined back into the one line the program
 * printed (045 FR-130 – FR-132, #326; data-model §14.1), and since FR-188b (#526) the rows a program
 * broke itself at the right edge (`continuation`). Offsets map to cells through `columns`/`widths`
 * (FR-188a), never by assuming one text unit per cell.
 *
 * Shared by the two readers of terminal text for links: the provider (`file-link-provider.ts`), which
 * reads the line under the pointer, and the view pass (`link-view-marks.ts`), which reads every line in
 * view. One reading, so a link cannot span different cells for the hover and for the mark at rest.
 */

/** The slice of an xterm buffer cell this reads. */
export interface LogicalLineSourceCell {
  getChars(): string;
  /** 2 for a wide character, 0 for the second cell of one, 1 otherwise. */
  getWidth(): number;
}

/** The slice of an xterm buffer line this reads. */
export interface LogicalLineSourceRow {
  translateToString(trimRight?: boolean): string;
  /** True on a row that CONTINUES the one above it — a soft wrap, never a real newline (FR-132). */
  readonly isWrapped?: boolean;
  /**
   * The row's width in cells, and its cells (#526). A real xterm row has both; a row without them is
   * read by `translateToString` alone, one text unit per cell.
   */
  readonly length?: number;
  getCell?(x: number): LogicalLineSourceCell | undefined;
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
  /**
   * #526: the 0-based column each offset of `text` is drawn at, and how many cells it covers. A wide
   * character is one unit and two cells; an emoji outside the BMP is two units and one cell — so an
   * offset is not a column, and every range is read through these. Absent for a source without cells,
   * where an offset into a row IS its column.
   */
  readonly columns?: readonly number[];
  readonly widths?: readonly number[];
}

/** One row's text, and the column and width of each of its text units. */
interface RowText {
  readonly text: string;
  readonly columns: number[];
  readonly widths: number[];
}

/**
 * A row read cell by cell, exactly as `translateToString` reads it — the second cell of a wide
 * character contributes nothing, an empty cell a space — but remembering where each unit is drawn.
 */
function rowText(row: LogicalLineSourceRow, trimRight: boolean): RowText | null {
  if (row.getCell === undefined || row.length === undefined) return null;
  let text = '';
  const columns: number[] = [];
  const widths: number[] = [];
  for (let x = 0; x < row.length; x += 1) {
    const cell = row.getCell(x);
    if (cell === undefined) break;
    const width = cell.getWidth();
    if (width === 0) continue;
    const chars = cell.getChars() || ' ';
    for (let i = 0; i < chars.length; i += 1) {
      columns.push(x);
      widths.push(width);
    }
    text += chars;
  }
  if (trimRight) {
    let end = text.length;
    while (end > 0 && /\s/.test(text[end - 1] as string)) end -= 1;
    text = text.slice(0, end);
    columns.length = end;
    widths.length = end;
  }
  return { text, columns, widths };
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
export function logicalLineAt(
  buffer: LogicalLineSource,
  y: number,
  knownExtensions: ReadonlySet<string> = KNOWN_FILE_EXTENSIONS,
  widthsAt?: WidthsAt,
): LogicalLine | null {
  const index = y - 1; // xterm counts buffer lines from 1; the buffer API indexes from 0
  const asked = buffer.getLine(index);
  if (asked === undefined) return null;

  /** How row `r` continues the row above it, or `null` when it starts a line of its own. */
  const joinOf = (r: number): number | null =>
    r <= 0 ? null : continuation(buffer, r, knownExtensions, widthsAt);

  let first = index;
  while (first > 0 && index - first < MAX_WRAPPED_ROWS && joinOf(first) !== null) first -= 1;
  let last = index;
  while (last - index < MAX_WRAPPED_ROWS && joinOf(last + 1) !== null) last += 1;

  const rowStarts: number[] = [];
  let text = '';
  const columns: number[] = [];
  const widths: number[] = [];
  let mapped = true;
  for (let row = first; row <= last; row += 1) {
    rowStarts.push(text.length);
    const source = buffer.getLine(row);
    // A row a program's own break follows is trimmed too: after a wider resize it carries blank cells
    // it was never written with, and they would land in the middle of the joined text.
    const trimmed = row === last || (joinOf(row + 1) ?? 0) > 0;
    const read = source === undefined ? null : rowText(source, trimmed);
    if (read === null) {
      mapped = false;
      text += source?.translateToString(row === last) ?? '';
      continue;
    }
    // A program's own break (#526): the continuation's indent was never part of what it printed.
    const skip = row === first ? 0 : (joinOf(row) ?? 0);
    text += read.text.slice(skip);
    columns.push(...read.columns.slice(skip));
    widths.push(...read.widths.slice(skip));
  }
  if (text.trim().length === 0) return null;
  return mapped
    ? { text, firstY: first + 1, rowStarts, columns, widths }
    : { text, firstY: first + 1, rowStarts };
}

/**
 * Whether `row` continues `above`, and if so how many leading units of `row` to skip: `0` for a soft
 * wrap (FR-130), the indent for a program's own break (#526), `null` for a line of its own.
 *
 * A program's break is joined — superseding FR-132 in part — only on all of these:
 *
 *  - `above` is filled to its LAST column with something other than a space: a program that wraps its
 *    own text (Claude Code) only cuts a word there when the word does not fit. "Its last column" is
 *    the width the row was WRITTEN at (`widthsAt`), so a resize does not undo the join: xterm never
 *    reflows a program's break, and a narrower resize soft-wraps the written row into several, which
 *    are measured together;
 *  - `row` starts at the same indent as `above` (or at the column after `above`'s bullet glyph), that
 *    indent is at least one column, and a non-space follows it;
 *  - `above`'s last word does not already end in a KNOWN extension — that word is complete, and the
 *    next row starts a new one.
 *
 * Both rows must be read cell by cell; a source without cells only ever soft-wraps.
 */
function continuation(
  buffer: LogicalLineSource,
  r: number,
  knownExtensions: ReadonlySet<string>,
  widthsAt: WidthsAt | undefined,
): number | null {
  const row = buffer.getLine(r);
  const above = buffer.getLine(r - 1);
  if (above === undefined || row === undefined) return null;
  if (row.isWrapped === true) return 0;
  const next = rowText(row, false);
  if (next === null || above.length === undefined) return null;

  // The row as written: `r - 1` and every row above it xterm soft-wrapped it into.
  let groupStart = r - 1;
  while (groupStart > 0 && r - 1 - groupStart < MAX_WRAPPED_ROWS && buffer.getLine(groupStart)?.isWrapped === true) {
    groupStart -= 1;
  }
  let text = '';
  let written = 0;
  for (let g = groupStart; g < r; g += 1) {
    const source = buffer.getLine(g);
    // The last row is trimmed: after a wider resize it is padded with blank cells it was never written with.
    const read = source === undefined ? null : rowText(source, g === r - 1);
    if (read === null || source?.length === undefined) return null;
    text += read.text;
    if (g < r - 1) {
      written += source.length;
      continue;
    }
    const end = read.text.length - 1;
    if (end < 0) return null;
    written += (read.columns[end] as number) + (read.widths[end] as number);
  }
  const top = { text };

  const lastAt = top.text.length - 1;
  if (lastAt < 0 || /\s/.test(top.text[lastAt] as string)) return null;
  const widths = widthsAt?.(groupStart) ?? new Set([above.length]);
  if (!widths.has(written)) return null;

  const indent = /^ */.exec(next.text)![0].length;
  if (indent === 0 || indent >= next.text.length || /\s/.test(next.text[indent] as string)) return null;
  const topIndent = /^ */.exec(top.text)![0].length;
  const bullet = /^\S\s+/.exec(top.text)?.[0].length;
  if (indent !== topIndent && indent !== bullet) return null;

  const lastWord = top.text.slice(top.text.lastIndexOf(' ') + 1);
  const dot = lastWord.lastIndexOf('.');
  if (dot > 0 && knownExtensions.has(lastWord.slice(dot + 1).toLowerCase())) return null;
  return indent;
}

/** The widths (in cells) a 0-based buffer row may have been written at. */
export type WidthsAt = (row: number) => ReadonlySet<number>;

/** The slice of an xterm Terminal `trackWrittenWidths` reads. */
export interface WidthSource {
  readonly cols: number;
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void };
  registerMarker(cursorYOffset?: number): { readonly line: number; readonly isDisposed: boolean; dispose(): void } | undefined;
}

/** How many resizes are remembered; older rows than that are judged by the widths still known. */
const MAX_REMEMBERED_RESIZES = 32;

/**
 * #526 — the width each row was WRITTEN at, so a program's own break is still recognised after a
 * resize (`continuation`). On every resize a marker is dropped at the cursor's row: every row at or
 * above it may have been written at the width before the resize. xterm moves markers with reflow and
 * scrollback trimming, so the boundary stays on the right row.
 *
 * A row's candidates are the current width and the width before every resize at or below it — a
 * program that redraws after a resize (Claude Code's live region) writes at the new width.
 */
export function trackWrittenWidths(term: WidthSource): { readonly widthsAt: WidthsAt; dispose(): void } {
  let cols = term.cols;
  const resizes: { readonly marker: NonNullable<ReturnType<WidthSource['registerMarker']>>; readonly cols: number }[] = [];
  const sub = term.onResize((size) => {
    const marker = term.registerMarker(0);
    if (marker !== undefined && size.cols !== cols) {
      resizes.push({ marker, cols });
      if (resizes.length > MAX_REMEMBERED_RESIZES) resizes.shift()?.marker.dispose();
    } else {
      marker?.dispose();
    }
    cols = size.cols;
  });
  return {
    widthsAt: (row) => {
      const out = new Set<number>([term.cols]);
      for (const r of resizes) if (!r.marker.isDisposed && r.marker.line >= row) out.add(r.cols);
      return out;
    },
    dispose: () => {
      sub.dispose();
      for (const r of resizes) r.marker.dispose();
      resizes.length = 0;
    },
  };
}

/**
 * Every logical line with a row in `top..bottom` (1-based, inclusive), each once and in order. A line
 * wrapped across the viewport's edge is read whole, so a link half in view is still one link.
 */
export function logicalLinesBetween(
  buffer: LogicalLineSource,
  top: number,
  bottom: number,
  knownExtensions: ReadonlySet<string> = KNOWN_FILE_EXTENSIONS,
  widthsAt?: WidthsAt,
): LogicalLine[] {
  const lines: LogicalLine[] = [];
  let y = Math.max(1, top);
  while (y <= bottom) {
    const line = logicalLineAt(buffer, y, knownExtensions, widthsAt);
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
  const column = line.columns?.[offset];
  const x = column === undefined ? offset - (line.rowStarts[row] as number) : column;
  return { x: x + 1, y: line.firstY + row };
}

/**
 * xterm's range is 1-based and INCLUSIVE at both ends; a span is 0-based and half-open. The end is the
 * LAST cell the span's last unit covers, so a wide character ending a span is covered whole.
 */
export function rangeOf(line: LogicalLine, span: Span): CellRange {
  const end = cellAt(line, span.end - 1);
  const width = line.widths?.[span.end - 1] ?? 1;
  return { start: cellAt(line, span.start), end: { x: end.x + width - 1, y: end.y } };
}
