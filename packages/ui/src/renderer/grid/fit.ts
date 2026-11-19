/**
 * The data grid's pure fit arithmetic (073 FR-011, FR-012).
 *
 * Both functions take an injected `measure(text) => px`, so they are unit-testable with no canvas; the grid
 * supplies a canvas `measureText` in its own computed font at runtime. Nothing here touches the DOM.
 */

/** A cell's horizontal padding (6 px each side) plus its right border, at zoom 1. */
export const CELL_PADDING_X = 13;
/** The narrowest and widest a fitted column may be, at zoom 1 (the same limits as a dragged width). */
export const FIT_MIN_WIDTH = 40;
export const FIT_MAX_WIDTH = 2000;
/** An expanded row is at most this many lines tall; a taller cell scrolls inside itself. */
export const EXPANDED_MAX_LINES = 20;

export type MeasureText = (text: string) => number;

export interface FitColumnOptions {
  /** Number of rows to consider (all of them). */
  count: number;
  /** The DISPLAY text of row `i` (what the cell draws). */
  textAt(i: number): string;
  /** The column header's label. */
  header: string;
  /** Pixel width of a text in the grid's font at the current zoom. */
  measure: MeasureText;
  /** Current zoom; the result is expressed at zoom 1. Default 1. */
  zoom?: number;
}

/** The width, at zoom 1 and clamped 40–2000, that shows the column's widest value and its header label. */
export function fitColumnWidth(opts: FitColumnOptions): number {
  const { count, textAt, header, measure } = opts;
  const zoom = opts.zoom !== undefined && opts.zoom > 0 ? opts.zoom : 1;
  let widest = header === '' ? 0 : measure(header);
  for (let i = 0; i < count; i++) {
    const text = textAt(i);
    if (text === '') continue;
    const w = measure(text);
    if (w > widest) widest = w;
  }
  const width = widest / zoom + CELL_PADDING_X;
  return Math.round(Math.min(FIT_MAX_WIDTH, Math.max(FIT_MIN_WIDTH, width)));
}

/**
 * How many lines `text` takes when wrapped to `maxWidth` px, line breaks honoured, never more than `cap`.
 * Greedy wrap at spaces; a word wider than the column is broken across lines.
 */
export function wrappedLineCount(
  text: string,
  maxWidth: number,
  measure: MeasureText,
  cap: number = EXPANDED_MAX_LINES,
): number {
  const width = Math.max(1, maxWidth);
  let lines = 0;
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    lines += paragraphLines(paragraph, width, measure, cap - lines);
    if (lines >= cap) return cap;
  }
  return Math.max(1, lines);
}

function paragraphLines(paragraph: string, width: number, measure: MeasureText, room: number): number {
  if (paragraph === '' || measure(paragraph) <= width) return 1;
  let lines = 1;
  let current = '';
  for (const word of paragraph.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measure(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current !== '') {
      lines++;
      if (lines >= room) return room;
    }
    // The word starts a fresh line; break it by character when it is wider than the column.
    current = '';
    for (const ch of word) {
      const next = current + ch;
      if (current !== '' && measure(next) > width) {
        lines++;
        if (lines >= room) return room;
        current = ch;
      } else {
        current = next;
      }
    }
  }
  return lines;
}
