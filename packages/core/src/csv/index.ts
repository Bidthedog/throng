/**
 * `@throng/core/csv` — 073 FR-009 (convergence T081): the CSV parser, its minimal-change writer and the grid
 * operations built on them, as a subpath of their own.
 *
 * The renderer reaches these only from the grid previews, which load behind a dynamic import. Imported through the
 * `@throng/core` barrel instead, the bundler routes them through the `core` chunk every window loads at startup, so the
 * renderer imports them from here. The barrel still exports them for main and the daemon, which have no startup chunk.
 * The cell-text helpers and the clipboard formats stay in the barrel: the preview chrome reads them eagerly.
 */
export {
  cellValue,
  detectDelimiter,
  parseCsv,
  recordFieldCount,
  type CsvDelimiter,
  type CsvLineEnding,
  type CsvModel,
} from './csv-model.js';
export { applyCsvChanges, encodeCsvField, type CsvCellEdit, type CsvTextChange } from './csv-edit.js';
export {
  GRID_MAX_CELLS,
  GRID_MAX_ROW_COUNT,
  resolveGridOperation,
  validateGridOperation,
  type CsvGridOperation,
  type GridOperationResolution,
} from './grid-operation.js';
export { recordAtLine, recordStartLines } from './record-lines.js';
