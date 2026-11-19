/**
 * A grid operation (073 data-model §2, contracts/preview-ipc-073.md `throng:preview:gridEdit`).
 *
 * What the CSV Preview Editor asks main to do. The renderer never computes text offsets: main parses
 * the document's CURRENT text and resolves the operation against it (research R1), so an edit can never
 * land at a position computed from a text the authority has since moved past.
 *
 * `validateGridOperation` is the IPC boundary's guard — the payload is untrusted shape until it passes —
 * and the caps are abuse limits, not preferences (plan, Complexity Tracking).
 *
 * Pure: no OS, no DOM.
 */
import { parseCsv } from './csv-model.js';
import {
  csvDeleteRows,
  csvInsertColumn,
  csvInsertRows,
  csvSetCells,
  type CsvCellEdit,
  type CsvTextChange,
} from './csv-edit.js';

export type CsvGridOperation =
  | { kind: 'setCells'; cells: CsvCellEdit[] }
  /** `values` (FR-038a, Insert Copied Rows): one array per inserted record, so its length is `count`. */
  | { kind: 'insertRows'; at: number; count: number; values?: string[][] }
  /** `count` empty columns (default 1); with `columns` (FR-038a) the copied ones: `columns[k][row]`, `count` of them. */
  | { kind: 'insertColumn'; at: number; count?: number; columns?: string[][] }
  | { kind: 'deleteRows'; from: number; count: number };

/** The most rows one insert or delete may name. */
export const GRID_MAX_ROW_COUNT = 10_000;
/** The most cells one paste may set. */
export const GRID_MAX_CELLS = 1_000_000;

const index = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const count = (v: unknown): v is number => index(v) && v >= 1 && v <= GRID_MAX_ROW_COUNT;

/** `raw` as exactly `n` arrays of strings, at most the paste cap of cells in all; `null` when it is not. */
function stringRows(raw: unknown, n: number): string[][] | null {
  if (!Array.isArray(raw) || raw.length !== n) return null;
  const out: string[][] = [];
  let cells = 0;
  for (const row of raw as unknown[]) {
    if (!Array.isArray(row)) return null;
    cells += row.length;
    if (cells > GRID_MAX_CELLS) return null;
    if (!row.every((v) => typeof v === 'string')) return null;
    out.push([...(row as string[])]);
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The operation, when `raw` is a well-formed one; `null` otherwise. Never throws. */
export function validateGridOperation(raw: unknown): CsvGridOperation | null {
  if (!isRecord(raw)) return null;
  switch (raw.kind) {
    case 'setCells': {
      if (!Array.isArray(raw.cells) || raw.cells.length > GRID_MAX_CELLS) return null;
      const cells: CsvCellEdit[] = [];
      for (const c of raw.cells as unknown[]) {
        if (!isRecord(c) || !index(c.row) || !index(c.col) || typeof c.value !== 'string') return null;
        cells.push({ row: c.row, col: c.col, value: c.value });
      }
      return { kind: 'setCells', cells };
    }
    case 'insertRows': {
      if (!index(raw.at) || !count(raw.count)) return null;
      if (raw.values === undefined) return { kind: 'insertRows', at: raw.at, count: raw.count };
      const values = stringRows(raw.values, raw.count);
      return values === null ? null : { kind: 'insertRows', at: raw.at, count: raw.count, values };
    }
    case 'insertColumn': {
      if (!index(raw.at)) return null;
      if (raw.count === undefined) return raw.columns === undefined ? { kind: 'insertColumn', at: raw.at } : null;
      if (!count(raw.count)) return null;
      if (raw.columns === undefined) return { kind: 'insertColumn', at: raw.at, count: raw.count };
      const columns = stringRows(raw.columns, raw.count);
      return columns === null ? null : { kind: 'insertColumn', at: raw.at, count: raw.count, columns };
    }
    case 'deleteRows':
      return index(raw.from) && count(raw.count) ? { kind: 'deleteRows', from: raw.from, count: raw.count } : null;
    default:
      return null;
  }
}

export type GridOperationResolution = { changes: CsvTextChange[] } | { refuse: 'malformed'; line: number };

/** `op` against `text`: the minimal changes, or a refusal for a document the grid cannot read (FR-046). */
export function resolveGridOperation(text: string, op: CsvGridOperation): GridOperationResolution {
  const model = parseCsv(text);
  if (model.fault !== null) return { refuse: 'malformed', line: model.fault.line };
  switch (op.kind) {
    case 'setCells':
      return { changes: csvSetCells(model, text, op.cells) };
    case 'insertRows':
      return { changes: csvInsertRows(model, Math.min(op.at, model.records), op.count, op.values) };
    case 'insertColumn':
      return { changes: csvInsertColumn(model, op.at, op.count ?? 1, op.columns) };
    case 'deleteRows':
      return { changes: csvDeleteRows(model, op.from, op.count) };
  }
}
