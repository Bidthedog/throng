/**
 * The CSV grid model (073 FR-022, FR-046, FR-047; data-model §1).
 *
 * A DERIVED view of a CSV document's text, never an authority (Principle XI): the text stays the
 * document's, and this records where every record and field sits in it. Spans, not values, because a
 * grid edit must change only the bytes of the fields it changes (FR-047) — so the writer needs to know
 * exactly which bytes those are, quotes included. A field's value is read from its span on demand.
 *
 * Parsing follows RFC 4180 quoting — a quoted field may hold the delimiter, a line break and doubled
 * quotes — and is tolerant elsewhere: a quote inside a bare field is literal, and text after a closing
 * quote belongs to the same field. The one thing it cannot read without loss is a quote that never
 * closes; that is reported as `fault` with its line, and the grid refuses to show the document.
 *
 * Typed arrays rather than objects per field: a document at the editor's size limit holds millions of
 * fields, and four integers each is what keeps the model small enough to rebuild on every edit.
 *
 * Pure: no OS, no DOM.
 */

export type CsvDelimiter = ',' | ';' | '\t';
export type CsvLineEnding = '\r\n' | '\n' | '\r';

export interface CsvModel {
  delimiter: CsvDelimiter;
  /** The first line ending in the text, or `null` for a text with none. */
  lineEnding: CsvLineEnding | null;
  /** Whether the last record is followed by a line ending. */
  trailingLineEnding: boolean;
  records: number;
  /** The widest record's field count; 0 for an empty text. */
  width: number;
  /** Per record: the offset of its first character, and the offset its line ending (or the text) starts at. */
  recordStart: Int32Array;
  recordEnd: Int32Array;
  /** Per record, the index of its first field in the field arrays; length `records + 1`. */
  recordFieldStart: Int32Array;
  /** Per field: its span in the text, quotes included. */
  fieldStart: Int32Array;
  fieldEnd: Int32Array;
  /** Per field: 1 when it opened with a quote. */
  fieldQuoted: Uint8Array;
  /** The first unterminated quote, by 1-based line; `null` when the whole text parsed. */
  fault: { line: number } | null;
}

const CANDIDATES: readonly CsvDelimiter[] = [',', ';', '\t'];
/** How many lines delimiter detection samples. A detection, not a parse: the start of the file decides. */
const SAMPLE_LINES = 20;

/**
 * The delimiter the text uses (FR-022): the candidate whose count outside quotes is the same, and
 * non-zero, on the most sampled lines — ties to the earlier candidate, so comma wins a draw. Comma when
 * no candidate appears at all.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts: number[][] = [];
  let line = [0, 0, 0];
  let inQuotes = false;
  for (let i = 0; i < text.length && counts.length < SAMPLE_LINES; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      counts.push(line);
      line = [0, 0, 0];
    } else if (!inQuotes) {
      const k = CANDIDATES.indexOf(ch as CsvDelimiter);
      if (k >= 0) line[k] = (line[k] ?? 0) + 1;
    }
  }
  if (counts.length < SAMPLE_LINES && line.some((n) => n > 0)) counts.push(line);

  let best: CsvDelimiter = ',';
  let bestScore = 0;
  CANDIDATES.forEach((candidate, k) => {
    const tally = new Map<number, number>();
    for (const c of counts) {
      const n = c[k] ?? 0;
      if (n > 0) tally.set(n, (tally.get(n) ?? 0) + 1);
    }
    const score = Math.max(0, ...tally.values());
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
}

/** A growable Int32Array, so a parse allocates in doublings rather than per field. */
class IntBuffer {
  data: Int32Array;
  length = 0;
  constructor(capacity: number) {
    this.data = new Int32Array(Math.max(16, capacity));
  }
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
  done(): Int32Array {
    return this.data.slice(0, this.length);
  }
}

/** Parse `text` into its grid model. `delimiter` overrides detection. Never throws. */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): CsvModel {
  const estimate = Math.ceil(text.length / 8);
  const recordStart = new IntBuffer(estimate / 4);
  const recordEnd = new IntBuffer(estimate / 4);
  const recordFieldStart = new IntBuffer(estimate / 4);
  const fieldStart = new IntBuffer(estimate);
  const fieldEnd = new IntBuffer(estimate);
  const quoted: number[] = [];
  let lineEnding: CsvLineEnding | null = null;
  let fault: { line: number } | null = null;
  let width = 0;
  let trailingLineEnding = false;

  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    // A record.
    recordStart.push(i);
    recordFieldStart.push(fieldStart.length);
    let fields = 0;
    let recordDone = false;
    while (!recordDone) {
      // A field.
      const start = i;
      let isQuoted = false;
      if (text[i] === '"') {
        isQuoted = true;
        const openLine = line;
        i++;
        let closed = false;
        while (i < n) {
          const ch = text[i];
          if (ch === '"') {
            if (text[i + 1] === '"') {
              i += 2;
              continue;
            }
            i++;
            closed = true;
            break;
          }
          if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++;
          i++;
        }
        if (!closed && fault === null) fault = { line: openLine };
      }
      // The rest of the field: bare text, or what follows a closing quote.
      while (i < n) {
        const ch = text[i];
        if (ch === delimiter || ch === '\n' || ch === '\r') break;
        i++;
      }
      fieldStart.push(start);
      fieldEnd.push(i);
      quoted.push(isQuoted ? 1 : 0);
      fields++;

      if (i >= n) {
        recordEnd.push(i);
        trailingLineEnding = false;
        recordDone = true;
      } else if (text[i] === delimiter) {
        i++;
        // A delimiter as the text's last character still opens one empty field.
        if (i >= n) {
          fieldStart.push(i);
          fieldEnd.push(i);
          quoted.push(0);
          fields++;
          recordEnd.push(i);
          recordDone = true;
        }
      } else {
        recordEnd.push(i);
        const ending: CsvLineEnding = text[i] === '\r' ? (text[i + 1] === '\n' ? '\r\n' : '\r') : '\n';
        lineEnding ??= ending;
        i += ending.length;
        line++;
        trailingLineEnding = i >= n;
        recordDone = true;
      }
    }
    if (fields > width) width = fields;
  }
  recordFieldStart.push(fieldStart.length);

  return {
    delimiter,
    lineEnding,
    trailingLineEnding,
    records: recordStart.length,
    width,
    recordStart: recordStart.done(),
    recordEnd: recordEnd.done(),
    recordFieldStart: recordFieldStart.done(),
    fieldStart: fieldStart.done(),
    fieldEnd: fieldEnd.done(),
    fieldQuoted: Uint8Array.from(quoted),
    fault,
  };
}

/** How many fields record `row` holds; 0 for a row past the last record. */
export function recordFieldCount(model: CsvModel, row: number): number {
  if (row < 0 || row >= model.records) return 0;
  return (model.recordFieldStart[row + 1] ?? 0) - (model.recordFieldStart[row] ?? 0);
}

/** The value of one field, unquoted; `''` for a field the record does not have. */
export function cellValue(model: CsvModel, text: string, row: number, col: number): string {
  if (col < 0 || col >= recordFieldCount(model, row)) return '';
  const index = (model.recordFieldStart[row] ?? 0) + col;
  const start = model.fieldStart[index] ?? 0;
  const end = model.fieldEnd[index] ?? 0;
  if (model.fieldQuoted[index] !== 1) return text.slice(start, end);
  // From the opening quote to its closing quote, doubled quotes undone, then anything after it.
  let out = '';
  let i = start + 1;
  while (i < end) {
    const ch = text[i];
    if (ch === '"') {
      if (text[i + 1] === '"' && i + 1 < end) {
        out += '"';
        i += 2;
        continue;
      }
      return out + text.slice(i + 1, end);
    }
    out += ch;
    i++;
  }
  return out;
}
