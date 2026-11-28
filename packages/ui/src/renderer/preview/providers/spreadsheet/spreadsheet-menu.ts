/**
 * The spreadsheet preview's grid menus: a cell's, a column header's and the select-all corner's. A builder of its own,
 * out of `spreadsheet-body.tsx`, so `menu-shortcuts.test.ts` can build every row.
 *
 * FR-037e — every menu carries Copy, header menus included. T18 (maintainer's v1 review, 2026-11-27, superseding
 * FR-050c) — and nothing that edits: a workbook stays read-only in throng, so no state of the application can enable
 * Cut, Paste, Clear Cells, a delete or an insert here, and a row that can never act is not drawn.
 *
 * Every row a key performs shows that key (#732): Copy and Select All the grid's own (`fixedShortcut`), Go to Row…
 * `preview.goToHeading` (FR-043a: the grid claims it). Print… is the panel title menu's (v1 review, #732); Wrap and the
 * two locks moved here from it, on every menu.
 */
import { firstBinding, type Keybindings, type PreviewCopyFormat } from '@throng/core';
import type { GridMenuTarget } from '../../../grid/data-grid.js';
import { gridCopyAs, gridViewToggleRows } from '../../../grid/grid-menu-items.js';
import type { GridViewToggles } from '../../provider-view.js';
import { fixedShortcut } from '../../../common/fixed-shortcut.js';
import type { MenuAction } from '../../../workspace/context-menu.js';

export interface SpreadsheetMenuArgs {
  target: GridMenuTarget;
  keybindings: Keybindings;
  /** The panel's Wrap and lock toggles; absent draws none. */
  toggles?: GridViewToggles;
  actions: {
    /** Copy the selection the right-click left, in `format` (the setting's when absent). */
    copy(format?: PreviewCopyFormat): void;
    selectAll(): void;
    goToRow(): void;
    /** Ask for column `col`'s width. */
    columnWidth(col: number): void;
    resetWidth(col: number): void;
  };
}

export function spreadsheetMenu(args: SpreadsheetMenuArgs): MenuAction[] {
  const { target, keybindings, actions: a } = args;
  const copies: MenuAction[] = [
    { label: 'Copy', icon: 'copy', section: 'content', group: 'clipboard', shortcut: fixedShortcut('copy'), onClick: () => a.copy() },
    gridCopyAs((format) => a.copy(format)),
  ];
  const goToRow: MenuAction = { label: 'Go to Row…', icon: 'goToRow', section: 'navigate', onClick: a.goToRow, shortcut: firstBinding(keybindings, 'preview.goToHeading') };
  const items: MenuAction[] =
    target.kind === 'column'
      ? [
          ...copies,
          { label: 'Column Width…', section: 'viewState', onClick: () => a.columnWidth(target.col) },
          { label: 'Reset Column Width', icon: 'resetColumnWidth', section: 'viewState', onClick: () => a.resetWidth(target.col) },
        ]
      : target.kind === 'corner'
        ? [...copies, goToRow]
        : [
            ...copies,
            { label: 'Select All', icon: 'selectAll', section: 'content', group: 'clipboard', shortcut: fixedShortcut('selectAll'), onClick: a.selectAll },
            goToRow,
          ];
  items.push(...gridViewToggleRows(args.toggles));
  return items;
}
