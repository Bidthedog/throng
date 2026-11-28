/**
 * A row goes on the menu of what it acts on (constitution 8.2.0, Principle VI; maintainer's v1 review, #732).
 *
 * A panel has two menus. Its BODY menu, opened by a right-click in the body or on an element in it, holds what acts on
 * the content under the pointer and how the body shows it. Its TITLE menu holds what acts on the panel, its file and
 * its link to other panels. The lists and the test for a row neither names are in the throng-renderer-ui skill's
 * `references/constitution-ux.md`, *A row goes on the menu of what it acts on*.
 *
 * Every top-level row of every swept body and title menu (helpers/swept-menus.ts) must be named by exactly one of the
 * two lists below, so a new row fails here until it is sorted. A submenu's rows go where their parent goes.
 */
import { describe, expect, it } from 'vitest';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { MENUS } from './helpers/swept-menus.js';

/** The swept menus a right-click in a panel's body, or on an element in it, opens. */
const BODY_MENUS = new Set([
  'Editor',
  'Terminal',
  'Preview body',
  'CSV cell',
  'CSV row header',
  'CSV column header',
  'CSV corner',
  'Spreadsheet cell',
  'Spreadsheet column header',
  'Spreadsheet corner',
]);
/** The panel header's menu. */
const TITLE_MENUS = new Set(['Panel header']);

/** Rows about the content under the pointer, or how the body shows it. */
const BODY_ROWS = new Set([
  // The clipboard and the edit history.
  'Cut',
  'Copy',
  'Copy as',
  'Paste',
  'Select All',
  'Undo',
  'Redo',
  // Edits to the content.
  'Insert',
  'Clear Cells',
  'Delete Rows',
  'Delete Column',
  'Edit in Dialog…',
  'Column Width…',
  'Reset Column Width',
  // Finding and moving through the content.
  'Find',
  'Find…',
  'Replace',
  'Replace All',
  'Go To Line…',
  'Go to Heading…',
  'Go to Row…',
  'Go to Page…',
  // How the body draws it.
  'Word Wrap',
  'View Whitespace',
  'Outlining',
  'Wrap',
  'Lock First Row',
  'Lock First Column',
  'Single Page',
  'Two Pages',
  'Pages Side by Side',
  // An element's own actions.
  'Copy Image',
  'Copy Diagram as Image',
]);

/** Rows about the panel, its file, or its link to other panels. */
const TITLE_ROWS = new Set([
  // The file.
  'Save',
  'Save As…',
  'Revert',
  'Reload from disk',
  'Copy Path',
  'Print…',
  'Find in File Explorer',
  'Open in OS Explorer',
  'Open in OS Default Program',
  'Open Preview',
  'Open in Editor',
  'Set Language…',
  'Reset Language',
  'Encoding',
  'Line Endings',
  // The panel.
  'Split',
  'Send to Tab',
  'Sync to',
  'Refresh',
  'Refresh / redraw terminal',
  'Back',
  'Forward',
  'Zoom',
  'Enter Focus Mode',
  'Exit Focus Mode',
  'Synchronise Scrolling',
  // A terminal's own toggles (076), under the labels core gives them.
  'Remember the last running command',
  'Reopen in the last directory',
  'Terminal notifications',
  'Edit Long Cells in Dialog',
  'Try again',
  'Copy details',
  'Clear panel type',
  'Flag',
  'Destroy Panel',
  'Close Panel',
]);

/**
 * A diagram's Enter and Exit Focus Mode maximise that one diagram over the document, not the panel: an element's
 * action, which the preview body menu draws in its Contextual section.
 */
const elementRow = (item: MenuAction): boolean =>
  item.section === 'contextual' && (item.label === 'Enter Focus Mode' || item.label === 'Exit Focus Mode');

/** A row's label without the live value some rows carry: "Encoding (UTF-8)" is the Encoding row. */
const rowName = (label: string | undefined): string => (label ?? '(no label)').replace(/ \([^)]*\)$/u, '');

interface Placed {
  menu: string;
  row: string;
  where: 'body' | 'title';
  element: boolean;
}

const PLACED: readonly Placed[] = MENUS.flatMap((m) => {
  const where = BODY_MENUS.has(m.name) ? 'body' : TITLE_MENUS.has(m.name) ? 'title' : null;
  if (where === null) return [];
  return m.build().map((item) => ({ menu: m.name, row: rowName(item.label), where, element: elementRow(item) }));
});

const label = (p: Placed): string => `${p.menu} › ${p.row}`;

describe('a row goes on the menu of what it acts on (constitution 8.2.0, #732)', () => {
  it('sweeps every body menu and the title menu', () => {
    const names = new Set(MENUS.map((m) => m.name));
    expect([...BODY_MENUS, ...TITLE_MENUS].filter((n) => !names.has(n)), 'menus named here that the sweep no longer builds').toEqual([]);
  });

  it('names every row in exactly one list', () => {
    expect([...BODY_ROWS].filter((r) => TITLE_ROWS.has(r)), 'rows in both lists').toEqual([]);
    const unsorted = PLACED.filter((p) => !p.element && !BODY_ROWS.has(p.row) && !TITLE_ROWS.has(p.row));
    expect([...new Set(unsorted.map(label))], 'sort each new row into BODY_ROWS or TITLE_ROWS (constitution-ux.md)').toEqual([]);
  });

  it('puts no panel or file row on a body menu', () => {
    const wrong = PLACED.filter((p) => p.where === 'body' && !p.element && TITLE_ROWS.has(p.row));
    expect([...new Set(wrong.map(label))], 'move these to the title menu').toEqual([]);
  });

  it('puts no content row on the title menu', () => {
    const wrong = PLACED.filter((p) => p.where === 'title' && BODY_ROWS.has(p.row));
    expect([...new Set(wrong.map(label))], 'move these to the body menu').toEqual([]);
  });

  it('names no row that no swept menu draws', () => {
    const drawn = new Set(PLACED.map((p) => p.row));
    expect([...BODY_ROWS, ...TITLE_ROWS].filter((r) => !drawn.has(r)), 'stale list entries').toEqual([]);
  });
});
