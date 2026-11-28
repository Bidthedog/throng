/**
 * Menu rows the CSV grid and the spreadsheet preview build alike (maintainer's v1 review, 2026-11-27).
 *
 * - **Copy as ▸** is the app's one builder (`common/copy-as-menu.ts`), in the grid's clipboard group (T15).
 * - **Clear Cells** shows **Del**, the key that clears the selection in the grid. The grid reads Delete itself,
 *   so it is not a command in Key Bindings and the label is fixed (T12).
 * - **Wrap**, **Lock First Row** and **Lock First Column** are checked toggles on every grid menu (cell, row, column,
 *   corner), moved from the panel's title menu by the v1 review (#732, amending 073 FR-013 and FR-039a): they change
 *   how the body shows its cells.
 */
import type { PreviewCopyFormat } from '@throng/core';
import { copyAsSubmenu } from '../common/copy-as-menu.js';
import type { MenuAction } from '../workspace/context-menu.js';
import type { GridViewToggles } from '../preview/provider-view.js';

/** What the grid shows beside Clear Cells: the Delete key, which the grid handles itself. */
export const CLEAR_CELLS_SHORTCUT = 'Del';

/** The grid's Copy as ▸, after Copy in the clipboard group. */
export function gridCopyAs(copy: (format: PreviewCopyFormat) => void): MenuAction {
  return copyAsSubmenu({ section: 'content', group: 'clipboard', copy });
}

/**
 * The grid's view toggles, in View & state, in the order the status bar draws them. A toggle the provider does not
 * have is absent from `toggles`, and draws no row. No chord: none of the three is a command in Key Bindings.
 */
export function gridViewToggleRows(toggles: GridViewToggles | undefined): MenuAction[] {
  const rows: MenuAction[] = [];
  const row = (label: string, icon: MenuAction['icon'], t: GridViewToggles['wrap']): void => {
    if (t === undefined) return;
    rows.push({ label, checked: t.on, testId: `menu-item-${label}`, icon, section: 'viewState', group: 'gridView', onClick: () => t.onToggle() });
  };
  row('Wrap', 'wrapCells', toggles?.wrap);
  row('Lock First Row', 'lockFirstRow', toggles?.lockFirstRow);
  row('Lock First Column', 'lockFirstColumn', toggles?.lockFirstColumn);
  return rows;
}
