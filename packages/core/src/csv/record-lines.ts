/**
 * The mapping a CSV preview and its text editor scroll by (073 FR-033c): the source line each record starts on, and the
 * record a source line falls in.
 *
 * The grid's rows are the file's records, but a record is not always a line: a quoted field may hold line breaks, so a
 * record can span several. A record maps to its FIRST line, and every line inside it maps back to that record — so the
 * two views agree on a place whichever way they were moved. Lines are 0-based, the numbering the preview's scroll sync
 * already uses (`syncLine`, `onTopLineChange`). A line break is a line feed, a carriage return, or a CRLF pair, as the
 * editor numbers them.
 *
 * Pure: arithmetic over a parsed model and its text.
 */
import type { CsvModel } from './csv-model.js';

/** Per record, the 0-based line its first character is on. */
export function recordStartLines(model: CsvModel, text: string): Int32Array {
  const out = new Int32Array(model.records);
  let line = 0;
  let at = 0;
  for (let r = 0; r < model.records; r++) {
    const start = model.recordStart[r] ?? 0;
    // Count the line breaks between the last offset looked at and this record's first character.
    for (; at < start && at < text.length; at++) {
      const ch = text.charCodeAt(at);
      if (ch === 10) line++;
      else if (ch === 13) {
        if (text.charCodeAt(at + 1) === 10) at++;
        line++;
      }
    }
    out[r] = line;
  }
  return out;
}

/**
 * The record that `line` falls in: the last one whose first line is at or before it, so a line inside a multi-line
 * record is that record. Clamped to the first and last record; 0 for a file with none.
 */
export function recordAtLine(starts: Int32Array, line: number): number {
  if (starts.length === 0) return 0;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= line) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
