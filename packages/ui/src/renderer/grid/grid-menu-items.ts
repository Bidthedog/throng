/**
 * Menu rows the CSV grid and the spreadsheet preview build alike (maintainer's v1 review, 2026-11-27).
 *
 * - **Copy as ▸** is the app's one builder (`common/copy-as-menu.ts`), in the grid's clipboard group (T15).
 * - **Clear Cells** shows **Del**, the key that clears the selection in the grid. The grid reads Delete itself,
 *   so it is not a command in Key Bindings and the label is fixed (T12).
 */
import type { PreviewCopyFormat } from '@throng/core';
import { copyAsSubmenu } from '../common/copy-as-menu.js';
import type { MenuAction } from '../workspace/context-menu.js';

/** What the grid shows beside Clear Cells: the Delete key, which the grid handles itself. */
export const CLEAR_CELLS_SHORTCUT = 'Del';

/** The grid's Copy as ▸, after Copy in the clipboard group. */
export function gridCopyAs(copy: (format: PreviewCopyFormat) => void): MenuAction {
  return copyAsSubmenu({ section: 'content', group: 'clipboard', copy });
}
