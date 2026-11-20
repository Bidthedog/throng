/**
 * Grid edits as minimal text changes (073 FR-036 – FR-038, FR-047; data-model §2).
 *
 * Every function here answers the same question: which bytes of the document must change for this
 * grid edit, and to what? The answer is a list of `{ from, to, insert }` changes against the text the
 * model was parsed from — sorted, non-overlapping — which the grid hands to the document's authority
 * as ONE change (so one grid action is one undo step, FR-037d). Nothing else is rewritten: a record
 * the edit does not touch keeps its quoting, its spacing and its line ending byte for byte (Q3).
 *
 * An edited field is written bare, or quoted with its quotes doubled when its value holds the
 * delimiter, a quote, a carriage return or a line feed — the cases RFC 4180 requires quotes for.
 *
 * Pure: no OS, no DOM.
 */
import { cellValue, recordFieldCount, type CsvDelimiter, type CsvLineEnding, type CsvModel } from './csv-model.js';

export interface CsvTextChange {
  from: number;
  to: number;
  insert: string;
}

export interface CsvCellEdit {
  row: number;
  col: number;
  value: string;
}

/** The line ending a document with none of its own gets for an inserted record. */
const FALLBACK_LINE_ENDING: CsvLineEnding = '\n';

/** `value` as one field of a document delimited by `delimiter`: bare, or quoted where it must be. */
export function encodeCsvField(value: string, delimiter: CsvDelimiter): string {
  const needsQuotes =
    value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r');
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

function eol(model: CsvModel): CsvLineEnding {
  return model.lineEnding ?? FALLBACK_LINE_ENDING;
}

/** Apply `changes` (sorted, non-overlapping) to `text`. The grid's tests and the worker-free fallback use it. */
export function applyCsvChanges(text: string, changes: readonly CsvTextChange[]): string {
  let out = '';
  let at = 0;
  for (const c of changes) {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  }
  return out + text.slice(at);
}

function sortChanges(changes: CsvTextChange[]): CsvTextChange[] {
  return changes.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * Set cells' values (FR-036, FR-037b–c). A cell inside its record replaces that field's span; a cell
 * past the end of its record appends the delimiters needed to reach it, to that record only (spec
 * *Edge Cases*, ragged rows); a cell past the last record appends records. A value already there, and
 * an empty value for a field that does not exist, change nothing.
 */
export function csvSetCells(model: CsvModel, text: string, edits: readonly CsvCellEdit[]): CsvTextChange[] {
  const d = model.delimiter;
  const changes: CsvTextChange[] = [];
  const byRow = new Map<number, Map<number, string>>();
  for (const e of edits) {
    if (e.row < 0 || e.col < 0) continue;
    let row = byRow.get(e.row);
    if (row === undefined) byRow.set(e.row, (row = new Map()));
    row.set(e.col, e.value);
  }

  const newRows: { row: number; cols: Map<number, string> }[] = [];
  for (const [row, cols] of byRow) {
    if (row >= model.records) {
      newRows.push({ row, cols });
      continue;
    }
    const count = recordFieldCount(model, row);
    const base = model.recordFieldStart[row] ?? 0;
    let tailMax = -1;
    for (const [col, value] of cols) {
      if (col < count) {
        if (cellValue(model, text, row, col) === value) continue;
        changes.push({ from: model.fieldStart[base + col] ?? 0, to: model.fieldEnd[base + col] ?? 0, insert: encodeCsvField(value, d) });
      } else if (value !== '' && col > tailMax) {
        tailMax = col;
      }
    }
    if (tailMax >= 0) {
      let tail = '';
      for (let col = count; col <= tailMax; col++) tail += d + encodeCsvField(cols.get(col) ?? '', d);
      const end = model.recordEnd[row] ?? 0;
      changes.push({ from: end, to: end, insert: tail });
    }
  }

  if (newRows.length > 0) {
    newRows.sort((a, b) => a.row - b.row);
    const last = newRows[newRows.length - 1];
    const lastRow = last === undefined ? model.records : last.row;
    const rowsAfter = new Map(newRows.map((r) => [r.row, r.cols]));
    const lines: string[] = [];
    for (let row = model.records; row <= lastRow; row++) {
      const cols = rowsAfter.get(row);
      if (cols === undefined) {
        lines.push('');
        continue;
      }
      const maxCol = Math.max(...[...cols].filter(([, v]) => v !== '').map(([c]) => c), 0);
      const fields: string[] = [];
      for (let col = 0; col <= maxCol; col++) fields.push(encodeCsvField(cols.get(col) ?? '', d));
      lines.push(fields.join(d));
    }
    if (lines.some((l) => l !== '') || model.records > 0) {
      changes.push({ from: text.length, to: text.length, insert: appendRecords(model, text.length === 0, lines) });
    }
  }
  return sortChanges(changes);
}

/** The text that appends `lines` as records after the document's last one, in its line-ending style. */
function appendRecords(model: CsvModel, emptyText: boolean, lines: readonly string[]): string {
  const e = eol(model);
  if (emptyText) return lines.join(e);
  return model.trailingLineEnding ? lines.map((l) => l + e).join('') : lines.map((l) => e + l).join('');
}

/**
 * Insert `count` empty records before record `at` (FR-038 Insert Row Above / Below). Each has the
 * widest record's field count, so it shows as a full empty row in any other tool too. `at` equal to the
 * record count appends. With `values` (FR-038a, Insert Copied Rows) the records hold those values instead:
 * one text change, so one undo step.
 */
export function csvInsertRows(
  model: CsvModel,
  at: number,
  count: number,
  values?: readonly (readonly string[])[],
): CsvTextChange[] {
  if (count <= 0) return [];
  const d = model.delimiter;
  // FR-038a — copied rows carry their values, in the document's delimiter and quoting, padded to its width.
  const lines = Array.from({ length: count }, (_, i) => {
    const fields = (values?.[i] ?? []).map((v) => encodeCsvField(v, d));
    while (fields.length < model.width) fields.push('');
    return fields.join(d);
  });
  if (at < model.records) {
    const from = model.recordStart[Math.max(0, at)] ?? 0;
    return [{ from, to: from, insert: lines.map((l) => l + eol(model)).join('') }];
  }
  const end = model.recordEnd[model.records - 1] ?? 0;
  const textEnd = model.records === 0 ? 0 : end + (model.trailingLineEnding ? eol(model).length : 0);
  return [{ from: textEnd, to: textEnd, insert: appendRecords(model, model.records === 0, lines) }];
}

/**
 * Insert an empty column before column `at` (FR-038 Insert Column Left / Right). A record that reaches
 * it gains an empty field there; inserting right of the last column gives each record of the full
 * width a trailing empty field, so the table widens; a shorter record is left alone, since its missing
 * fields already read as empty.
 */
export function csvInsertColumn(
  model: CsvModel,
  at: number,
  count = 1,
  columns?: readonly (readonly string[])[],
): CsvTextChange[] {
  const d = model.delimiter;
  const changes: CsvTextChange[] = [];
  for (let row = 0; row < model.records; row++) {
    // FR-038a — `columns[k][row]` is the value copied column k puts in this record; none means empty.
    const fields = Array.from({ length: count }, (_, k) => columns?.[k]?.[row] ?? '');
    const encoded = fields.map((v) => encodeCsvField(v, d));
    const reach = recordFieldCount(model, row);
    if (at < reach) {
      const from = model.fieldStart[(model.recordFieldStart[row] ?? 0) + at] ?? 0;
      changes.push({ from, to: from, insert: encoded.join(d) + d });
    } else if (fields.some((v) => v !== '') || (at === reach && reach === model.width)) {
      // A record shorter than the point is padded up to it only when there is a value to place.
      const end = model.recordEnd[row] ?? 0;
      changes.push({ from: end, to: end, insert: d.repeat(at - reach) + encoded.map((f) => d + f).join('') });
    }
  }
  return changes;
}

/**
 * Remove `count` records from `from` (FR-037b, cutting whole rows), each with its line ending. Removing
 * the last records takes the line ending BEFORE them instead, so the document keeps its own trailing
 * style rather than gaining or losing a final line ending.
 */
export function csvDeleteRows(model: CsvModel, from: number, count: number): CsvTextChange[] {
  const first = Math.max(0, from);
  const last = Math.min(model.records, first + count) - 1;
  if (last < first) return [];
  if (last < model.records - 1) {
    return [{ from: model.recordStart[first] ?? 0, to: model.recordStart[last + 1] ?? 0, insert: '' }];
  }
  const tailEnd = (model.recordEnd[last] ?? 0) + (model.trailingLineEnding ? eol(model).length : 0);
  if (first === 0) return [{ from: 0, to: tailEnd, insert: '' }];
  const prevEnd = model.recordEnd[first - 1] ?? 0;
  return [{ from: model.trailingLineEnding ? model.recordStart[first] ?? 0 : prevEnd, to: tailEnd, insert: '' }];
}
