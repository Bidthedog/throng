/**
 * 073 FR-024, FR-037a — Copy from a grid, shared by both grid bodies.
 *
 * Plain: tab-separated rows. Rich: the same text plus a text-only HTML table (044 FR-035a as 073 refines
 * it). The format is the caller's: Copy follows `editor.previews.copyFormat`, and the two named variants
 * name their own (the constitution's *a preference picks the default; the menu offers every variant*).
 */
import { gridToHtmlTable, gridToTsv, logCaught, type PreviewCopyFormat } from '@throng/core';
import { GRID_MAX_CELLS } from '@throng/core/csv';
import type { GridRange } from './grid-selection.js';

/** The cells of `range`, row by row — capped at the paste limit, so a Select All of a vast sheet stays bounded. */
export function cellsOf(range: GridRange, getCell: (row: number, col: number) => string): string[][] {
  const width = range.right - range.left + 1;
  const rows = Math.min(range.bottom - range.top + 1, Math.max(1, Math.floor(GRID_MAX_CELLS / Math.max(1, width))));
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = range.left; c <= range.right; c++) row.push(getCell(range.top + r, c));
    out.push(row);
  }
  return out;
}

/**
 * Put `range` on the clipboard in `format`. Resolves `false` when nothing could be written.
 *
 * FR-024 (T082) — a copy holds at most `GRID_MAX_CELLS` cells, what a paste can take back. A range past it is copied
 * up to the bound, whole rows only, and `onCapped` is told how many cells went of how many were selected, so the
 * caller can say so rather than leave the reader to find the clipboard short.
 */
export async function copyGridRange(
  range: GridRange,
  getCell: (row: number, col: number) => string,
  format: PreviewCopyFormat,
  onCapped?: (copied: number, selected: number) => void,
): Promise<boolean> {
  const clipboard = window.throng?.clipboard;
  if (clipboard === undefined) return false;
  const cells = cellsOf(range, getCell);
  const width = range.right - range.left + 1;
  const selected = (range.bottom - range.top + 1) * width;
  const copied = cells.length * width;
  if (copied < selected) onCapped?.(copied, selected);
  const text = gridToTsv(cells);
  try {
    if (format === 'rich') await clipboard.writeRich({ text, html: gridToHtmlTable(cells) });
    else await clipboard.write({ text, mode: 'verbatim' });
    return true;
  } catch (error) {
    logCaught('grid: copy cells', error);
    return false;
  }
}
