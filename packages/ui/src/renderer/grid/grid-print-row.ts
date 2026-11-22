/**
 * 075 FR-062, FR-063 — the Print… row every preview's body menu carries, for the grid bodies (CSV, Spreadsheet), which
 * build their own cell, row and column menus rather than `previewContentMenu`. 075 FR-075b (2026-11-20) — both now
 * print: the row runs the chrome's Print… (`onPrint`). Without the route it is drawn disabled with the reason every
 * other surface gives (`PRINT_UNAVAILABLE`), never left out.
 */

import { PRINT_UNAVAILABLE } from '../preview/print/print-command.js';
import type { MenuAction } from '../workspace/context-menu.js';

/** The Print… row, placed where `previewContentMenu` places it; `shortcut` is the bound chord, if any. */
export function gridPrintRow(shortcut?: string, onPrint?: () => void): MenuAction {
  return {
    label: 'Print…',
    icon: 'print',
    section: 'navigate',
    group: 'print',
    ...(shortcut !== undefined ? { shortcut } : {}),
    ...(onPrint !== undefined ? { onClick: onPrint } : { disabled: true, title: PRINT_UNAVAILABLE, onClick: () => {} }),
  };
}
