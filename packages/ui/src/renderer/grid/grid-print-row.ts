/**
 * 075 FR-062, FR-063 — the Print… row every preview's body menu carries, for the grid bodies (CSV, Spreadsheet), which
 * build their own cell, row and column menus rather than `previewContentMenu`. Neither provider declares `print`, so
 * the row is always drawn disabled with the reason every other surface gives (`PRINT_UNAVAILABLE`), never left out.
 */

import { PRINT_UNAVAILABLE } from '../preview/print/print-command.js';
import type { MenuAction } from '../workspace/context-menu.js';

/** The disabled Print… row, placed where `previewContentMenu` places it; `shortcut` is the bound chord, if any. */
export function gridPrintRow(shortcut?: string): MenuAction {
  return {
    label: 'Print…',
    icon: 'print',
    section: 'navigate',
    group: 'print',
    ...(shortcut !== undefined ? { shortcut } : {}),
    disabled: true,
    title: PRINT_UNAVAILABLE,
    onClick: () => {},
  };
}
