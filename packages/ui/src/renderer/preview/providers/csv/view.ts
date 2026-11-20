/**
 * The CSV provider's renderer half (073 FR-030): the CSV Preview Editor's grid.
 *
 * `load` is a dynamic import (R21, 073 FR-009): the body, the grid and the virtualiser arrive with the
 * first CSV Preview Editor, never with the app. `textSelection` is false: the grid draws its own cell
 * menu (Copy, Copy as Rich Text, Copy as Plain Text, Select All among its rows), so the chrome's text menu
 * would be a second one for the same actions.
 *
 * The id is the core descriptor's (`packages/core/src/preview/providers/csv.ts`).
 */
import type { PreviewProviderView } from '../../provider-view.js';

export const csvView: PreviewProviderView = {
  id: 'csv',
  textSelection: false,
  load: () => import('./csv-body.js').then((m) => m.CsvBody),
  // 075 FR-075b — the grid as a table, every row.
  printable: (body, { title }) => import('../../../grid/grid-print.js').then((m) => m.gridPrintable(body, title)),
};
