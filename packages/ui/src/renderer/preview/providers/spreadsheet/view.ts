/**
 * The Spreadsheet provider's renderer half (073 FR-050 – FR-059): every sheet of a workbook as a
 * read-only grid.
 *
 * `load` is a dynamic import (073 FR-009); SheetJS itself is loaded only inside the spreadsheet worker,
 * so not even this body's chunk carries it. The grid draws its own menu, so `textSelection` is false.
 *
 * The id is the core descriptor's (`packages/core/src/preview/providers/spreadsheet.ts`).
 */
import type { PreviewProviderView } from '../../provider-view.js';

export const spreadsheetView: PreviewProviderView = {
  id: 'spreadsheet',
  textSelection: false,
  load: () => import('./spreadsheet-body.js').then((m) => m.SpreadsheetBody),
  // 075 FR-075b — the grid as a table, every row.
  printable: (body, { title }) => import('../../../grid/grid-print.js').then((m) => m.gridPrintable(body, title)),
};
