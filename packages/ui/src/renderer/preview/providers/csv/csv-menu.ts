/**
 * The CSV Preview Editor's four grid menus: a cell's, a row header's, a column header's and the select-all corner's
 * (contracts/grid-ui.md). Moved out of `csv-body.tsx` unchanged in shape so a unit test can build every row, which a
 * menu assembled inside a `useCallback` does not allow (`menu-shortcuts.test.ts` builds these).
 *
 * Every row a key performs shows that key (maintainer's v1 review, #732): a rebindable command's live binding
 * (`firstBinding`, nothing when unbound), or the grid's own fixed key — Cut, Copy, Paste, Select All, Undo and Redo
 * (`fixedShortcut`, the keys `grid/data-grid.tsx` handles), and Delete for Clear Cells.
 *
 * v1 review (#732): these menus hold what acts on the cells and how the grid shows them. Save, Save As…, Open in
 * Editor and Print… act on the panel's file, so the panel's title menu holds them; Wrap, Lock First Row and Lock First
 * Column moved here from it, on every menu.
 */
import { firstBinding, type ActionId, type Keybindings, type PreviewCopyFormat } from '@throng/core';
import { GRID_MAX_ROW_COUNT } from '@throng/core/csv';
import type { GridMenuTarget } from '../../../grid/data-grid.js';
import type { GridRange, GridSelection } from '../../../grid/grid-selection.js';
import type { CopiedBlock } from '../../../grid/copied-block.js';
import { CLEAR_CELLS_SHORTCUT, gridCopyAs, gridViewToggleRows } from '../../../grid/grid-menu-items.js';
import type { GridViewToggles } from '../../provider-view.js';
import { fixedShortcut } from '../../../common/fixed-shortcut.js';
import type { MenuAction } from '../../../workspace/context-menu.js';

/** 081 FR-083 — why an operation that needs a real row is drawn disabled on the entry row. */
const ENTRY_ROW_REASON = 'This row is not in the file yet. Type into it to add it.';

/** T8 — where a counted insert goes, and what it inserts. */
export type InsertManyKind = 'rowsAbove' | 'rowsBelow' | 'columnsLeft' | 'columnsRight';

/**
 * T4 — the Delete Row and Delete Column menu rows for a selection, named for how many they remove. Only the row and
 * column header menus carry them (T9, the maintainer's direction), so the selection is whole rows or whole columns;
 * the not-whole reasons guard any other caller. Each is drawn disabled, with the reason, where it cannot act
 * (Principle VI): the entry row alone, a blank file's empty column, and every column of the file at once — a CSV
 * with no column is no table, so emptying the file is Delete Row's job.
 */
function deleteMenuItems(
  sel: GridSelection,
  range: GridRange,
  rowCount: number,
  colCount: number,
  act: { rows(range: GridRange): void; columns(range: GridRange): void },
  shortcut: { rows: string | undefined; columns: string | undefined },
): { rows: MenuAction; columns: MenuAction } {
  const base = { icon: 'destroy', section: 'content', group: 'clipboard' } as const;
  const realRows = Math.min(range.bottom, rowCount - 1) - range.top + 1;
  const rowReason =
    sel.rows !== true ? 'Select whole rows by their numbers to delete them.' : realRows <= 0 ? ENTRY_ROW_REASON : null;
  const rows: MenuAction = {
    ...base,
    label: realRows > 1 && rowReason === null ? 'Delete Rows' : 'Delete Row',
    onClick: () => act.rows(range),
    shortcut: shortcut.rows,
    ...(rowReason === null ? {} : { disabled: true, title: rowReason }),
  };
  const wholeColumns = sel.rows !== true && range.top === 0 && range.bottom >= rowCount - 1;
  const lastCol = Math.min(range.right, colCount - 1);
  const realCols = lastCol - range.left + 1;
  const colReason = !wholeColumns
    ? 'Select whole columns by their letters to delete them.'
    : realCols <= 0
      ? 'This file has no columns to delete yet.'
      : range.left === 0 && lastCol >= colCount - 1
        ? 'These are all of the file’s columns. Delete its rows to empty it.'
        : null;
  const columns: MenuAction = {
    ...base,
    label: realCols > 1 && colReason === null ? 'Delete Columns' : 'Delete Column',
    onClick: () => act.columns(range),
    shortcut: shortcut.columns,
    ...(colReason === null ? {} : { disabled: true, title: colReason }),
  };
  return { rows, columns };
}

/** What each row runs. The body binds them to its grid and its document. */
export interface CsvGridMenuActions {
  insertRows(at: number, rows?: string[][]): void;
  insertColumn(at: number, columns?: string[][]): void;
  askInsertMany(kind: InsertManyKind, at: number): void;
  clearRange(range: GridRange): void;
  cut(sel: GridSelection, range: GridRange): void;
  copy(range: GridRange, format?: PreviewCopyFormat): void;
  paste(): void;
  selectAll(): void;
  history(step: 'undo' | 'redo'): void;
  goToRow(): void;
  deleteRows(range: GridRange): void;
  deleteColumns(range: GridRange): void;
  /** Ask for column `col`'s width. */
  columnWidth(col: number): void;
  resetWidth(col: number): void;
  openCellDialog(row: number, col: number): void;
}

export interface CsvGridMenuArgs {
  target: GridMenuTarget;
  /** The grid's selection as the right-click left it, and its range. */
  sel: GridSelection;
  range: GridRange;
  rowCount: number;
  colCount: number;
  /** FR-038a — whole rows or whole columns the clipboard still holds, for Insert Copied Rows / Columns. */
  copied: CopiedBlock | null;
  keybindings: Keybindings;
  cellDialogAvailable: boolean;
  /** The panel's Wrap and lock toggles; absent draws none. */
  toggles?: GridViewToggles;
  actions: CsvGridMenuActions;
}

export function csvGridMenu(args: CsvGridMenuArgs): MenuAction[] {
  const { target, sel, range, rowCount, colCount, copied, keybindings, cellDialogAvailable, actions: a } = args;
  const at = sel.active;
  const chord = (id: ActionId): string | undefined => firstBinding(keybindings, id) ?? undefined;
  const items: MenuAction[] = [];
  // T14 — the inserts sit in one Insert ▸ submenu: the single row or column, then the counted ones (T8), then the
  // copied ones (FR-038a) while the clipboard holds whole rows or columns.
  const insertOne: MenuAction[] = [
    { label: 'Row Above', icon: 'insertRowAbove', section: 'create', group: 'one', testId: 'menu-item-Insert Row Above', onClick: () => a.insertRows(at.row), shortcut: chord('grid.insertRowAbove') },
    { label: 'Row Below', icon: 'insertRowBelow', section: 'create', group: 'one', testId: 'menu-item-Insert Row Below', onClick: () => a.insertRows(at.row + 1), shortcut: chord('grid.insertRowBelow') },
    { label: 'Column Left', icon: 'insertColumnLeft', section: 'create', group: 'one', testId: 'menu-item-Insert Column Left', onClick: () => a.insertColumn(at.col), shortcut: chord('grid.insertColumnLeft') },
    { label: 'Column Right', icon: 'insertColumnRight', section: 'create', group: 'one', testId: 'menu-item-Insert Column Right', onClick: () => a.insertColumn(at.col + 1), shortcut: chord('grid.insertColumnRight') },
  ];
  const insertMany: MenuAction[] = [
    { label: 'Rows Above…', icon: 'insertRowAbove', section: 'create', group: 'many', testId: 'menu-item-Insert Rows Above…', onClick: () => a.askInsertMany('rowsAbove', at.row), shortcut: chord('grid.insertRowsAbove') },
    { label: 'Rows Below…', icon: 'insertRowBelow', section: 'create', group: 'many', testId: 'menu-item-Insert Rows Below…', onClick: () => a.askInsertMany('rowsBelow', at.row + 1), shortcut: chord('grid.insertRowsBelow') },
    { label: 'Columns Left…', icon: 'insertColumnLeft', section: 'create', group: 'many', testId: 'menu-item-Insert Columns Left…', onClick: () => a.askInsertMany('columnsLeft', at.col), shortcut: chord('grid.insertColumnsLeft') },
    { label: 'Columns Right…', icon: 'insertColumnRight', section: 'create', group: 'many', testId: 'menu-item-Insert Columns Right…', onClick: () => a.askInsertMany('columnsRight', at.col + 1), shortcut: chord('grid.insertColumnsRight') },
  ];
  const insertCopied: MenuAction[] = [];
  if (copied !== null && copied.kind === 'rows' && copied.values.length <= GRID_MAX_ROW_COUNT) {
    const rows = copied.values;
    insertCopied.push(
      { label: 'Copied Rows Above', icon: 'insertRowAbove', section: 'create', group: 'copied', testId: 'menu-item-Insert Copied Rows Above', onClick: () => a.insertRows(at.row, rows) },
      { label: 'Copied Rows Below', icon: 'insertRowBelow', section: 'create', group: 'copied', testId: 'menu-item-Insert Copied Rows Below', onClick: () => a.insertRows(at.row + 1, rows) },
    );
  } else if (copied !== null && copied.kind === 'columns' && copied.values.length <= GRID_MAX_ROW_COUNT) {
    const columns = copied.values;
    insertCopied.push(
      { label: 'Copied Columns Left', icon: 'insertColumnLeft', section: 'create', group: 'copied', testId: 'menu-item-Insert Copied Columns Left', onClick: () => a.insertColumn(at.col, columns) },
      { label: 'Copied Columns Right', icon: 'insertColumnRight', section: 'create', group: 'copied', testId: 'menu-item-Insert Copied Columns Right', onClick: () => a.insertColumn(at.col + 1, columns) },
    );
  }
  const insertSubmenu = (rows: MenuAction[]): MenuAction => ({ label: 'Insert', icon: 'insertRowBelow', section: 'create', submenu: rows });
  const clearCells: MenuAction = { label: 'Clear Cells', icon: 'destroy', section: 'content', group: 'clipboard', shortcut: CLEAR_CELLS_SHORTCUT, onClick: () => a.clearRange(range) };
  const width = (col: number): MenuAction => ({
    label: 'Column Width…',
    section: 'viewState',
    // FR-006 (T086) — the column right-clicked, or a cell's own column.
    onClick: () => a.columnWidth(col),
  });
  // FR-037e — every menu offers the clipboard for the selection the right-click leaves; T15 — the copy variants in
  // Copy as ▸ after Copy. T16 — Undo and Redo, in a group of their own straight below it, on every menu.
  const cutItem = (rows: boolean): MenuAction => ({ label: 'Cut', icon: 'cut', section: 'content', group: 'clipboard', shortcut: fixedShortcut('cut'), onClick: () => a.cut(rows ? { ...sel, rows: true } : sel, range) });
  const copyItems: MenuAction[] = [
    { label: 'Copy', icon: 'copy', section: 'content', group: 'clipboard', shortcut: fixedShortcut('copy'), onClick: () => a.copy(range) },
    gridCopyAs((format) => a.copy(range, format)),
  ];
  const pasteItem: MenuAction = { label: 'Paste', icon: 'paste', section: 'content', group: 'clipboard', shortcut: fixedShortcut('paste'), onClick: a.paste };
  const historyItems: MenuAction[] = [
    { label: 'Undo', icon: 'undo', section: 'content', group: 'history', shortcut: fixedShortcut('undo'), onClick: () => a.history('undo') },
    { label: 'Redo', icon: 'redo', section: 'content', group: 'history', shortcut: fixedShortcut('redo'), onClick: () => a.history('redo') },
  ];
  const goToRow: MenuAction = { label: 'Go to Row…', icon: 'goToRow', section: 'navigate', onClick: a.goToRow, shortcut: chord('preview.goToHeading') };
  const deletes = deleteMenuItems(sel, range, rowCount, colCount, { rows: a.deleteRows, columns: a.deleteColumns }, {
    rows: chord('grid.deleteRows'),
    columns: chord('grid.deleteColumns'),
  });
  if (target.kind === 'row') {
    // 081 FR-083 — the entry row is not a line of the file: the operations that need a real row draw disabled.
    const onEntryRow = target.row >= rowCount;
    const needsRealRow = onEntryRow ? { disabled: true, title: ENTRY_ROW_REASON } : {};
    items.push(
      { ...cutItem(true), ...needsRealRow },
      ...copyItems,
      pasteItem,
      // T7 — Clear Cells on whole rows, beside the delete.
      clearCells,
      deletes.rows,
      ...historyItems,
      insertSubmenu([
        // T5 — in a blank file there is no real row for it to need: above the entry row is where the first row goes.
        { ...insertOne[0]!, ...(rowCount === 0 ? {} : needsRealRow) },
        insertOne[1]!,
        { ...insertMany[0]!, ...(rowCount === 0 ? {} : needsRealRow) },
        insertMany[1]!,
        ...insertCopied,
      ]),
      goToRow,
    );
  } else if (target.kind === 'column') {
    items.push(
      cutItem(false),
      ...copyItems,
      pasteItem,
      clearCells,
      deletes.columns,
      ...historyItems,
      insertSubmenu([insertOne[2]!, insertOne[3]!, insertMany[2]!, insertMany[3]!, ...insertCopied]),
      width(target.col),
      { label: 'Reset Column Width', icon: 'resetColumnWidth', section: 'viewState', onClick: () => a.resetWidth(target.col) },
    );
  } else if (target.kind === 'corner') {
    // T13 — the corner selected every cell: only what acts on all of them. Nothing that
    // acts on the active cell, a row or a column — no Paste, Insert, Edit in Dialog or Column Width.
    items.push(cutItem(false), ...copyItems, clearCells, ...historyItems, goToRow);
  } else {
    items.push(
      cutItem(false),
      ...copyItems,
      pasteItem,
      { label: 'Select All', icon: 'selectAll', section: 'content', group: 'clipboard', shortcut: fixedShortcut('selectAll'), onClick: a.selectAll },
      // T9 — the deletes are the headers' alone: a cell's menu (and the select-all corner's) does not offer them.
      clearCells,
      ...historyItems,
      ...(cellDialogAvailable
        ? [
            {
              label: 'Edit in Dialog…',
              icon: 'cellDialog' as const,
              section: 'content' as const,
              group: 'cell',
              // FR-036d — the dialog edits one cell: a block, whole rows or whole columns disable it, and say why.
              ...(sel.rows === true || range.top !== range.bottom || range.left !== range.right
                ? { disabled: true, title: 'Select one cell to edit it in a dialog' }
                : {}),
              onClick: () => a.openCellDialog(target.row, target.col),
            },
          ]
        : []),
      goToRow,
      insertSubmenu([...insertOne, ...insertMany]),
      width(at.col),
    );
  }
  items.push(...gridViewToggleRows(args.toggles));
  return items;
}
