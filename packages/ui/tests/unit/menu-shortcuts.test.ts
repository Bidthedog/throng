/**
 * Every menu row a key performs shows that key (maintainer's v1 review, #732).
 *
 * ══ THE DESIGN: A RATCHET OVER EVERY ROW ══
 *
 * A menu row does not say which command it runs: `onClick` is a closure, and a row's label is rarely its command's
 * Key Bindings label ("Zoom In" is `panel.zoomIn`, "Zoom panel type in"). So no test can work out, from a row alone,
 * whether a key performs it. This one makes every row ANSWER instead:
 *
 * 1. Every builder in `helpers/swept-menus.ts` is built with every optional row switched on and a keybindings fixture that binds EVERY
 *    command (`ALL_BOUND`), so a row that reads its command's binding (`firstBinding`) always shows a key here, even
 *    for a command the shipped defaults leave unbound (the CSV grid's inserts).
 * 2. Every row, submenu leaves included, must either show a `shortcut` or be listed in `NO_KEY` with the reason no
 *    key performs it. A row added tomorrow that shows no key fails until its author does one or the other: the
 *    question "does a key do this?" is asked of every new row, which is the point.
 * 3. The list fails both ways: an entry no menu draws any more, or one whose row now shows a key, fails too, so the
 *    list stays the exact set of keyless rows (as `e2e-budget.json` ratchets the E2E count).
 * 4. Every shortcut shown must be a live binding from `ALL_BOUND` or one of the fixed keys the surfaces handle
 *    themselves (`fixedShortcut`, Del). A hard-coded chord that ignores a rebind ('Ctrl+G' typed into a row) fails.
 *
 * A submenu PARENT is exempt: it opens its leaves, which answer for themselves. One that shows a key anyway (the
 * editor's Encoding ▸ shows `editor.changeEncoding`) is still checked by rule 4.
 *
 * ══ BLIND SPOTS ══
 *
 * - **A builder missing from `MENUS`.** Only the builders imported here are swept. A new menu module needs a row in
 *   the table; one assembled inline in a component cannot be built here at all, which is why the CSV and spreadsheet
 *   grid menus were moved into `csv-menu.ts` and `spreadsheet-menu.ts`. Still inline, and not swept: the Key
 *   Bindings tab's one-row chord menu, the Sub-workspaces panel's Minimise / Restore row and the Resource Monitor's
 *   node menus (`resources/node-actions.tsx`).
 * - **A caller that does not pass the chord.** Builders such as `editorContentMenu` and `previewContentMenu` take a
 *   row's chord as an argument from their React caller (`use-editor.ts`, `preview-panel.tsx`). This test hands every
 *   one in, so it proves the builder draws it, not that the caller reads `firstBinding` for it.
 * - **A row whose shown key does something else.** The test checks that a key is shown, not that it is the right
 *   key: it cannot tell `preview.print` on a row that saves. The fixed keys were each confirmed against the surface's
 *   own key handling when they were added; `NO_KEY`'s reasons record where a key exists and deliberately is not shown.
 * - **Rows only some states draw.** The fixtures switch every optional row on, but rows that replace one another
 *   (Collapse / Expand This Section, Enter / Exit Focus Mode) need a fixture per state; the table carries the ones
 *   that exist today, and a new either/or row needs its second state added.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WINDOWS_HOST_TRAITS, configureHostTraits, macosHostTraits } from '@throng/core';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';
import { fixedShortcut } from '../../src/renderer/common/fixed-shortcut.js';
import { FIXED_KEYS, MENUS, SHOWABLE, csv } from './helpers/swept-menus.js';

/* ── The keyless rows, and why no key performs each ───────────────────────────────────────────────── */

const NONE = 'no command, and no key the surface handles, performs it';
const PICK = 'one entry of a list the user picks from: no key names an entry';
const SEARCH_SCOPE =
  'search.findInFiles / search.replaceInFiles keep the panel’s scope and term; this row resets the panel to the right-clicked node (043 FR-091)';
const TERMINAL_COPY = 'Ctrl+C is the shell’s interrupt: a terminal has no copy chord (#142)';
const NEXT_MARKED = 'focus.nextMarkedPanel walks every project; this row walks this project alone (057 FR-106)';
const CELL_DIALOG = 'F2 and Enter edit in the cell; no key opens the dialog';
const GRID_TOGGLE = 'a per-panel view toggle with no command in Key Bindings (073 FR-013, FR-039a)';
const PREVIEW_OUTLINE = 'the outlining keys do not reach a preview: its Outlining rows keep the commands and show no key (v1 review)';
const COPY_OTHER_FORMAT = 'the copy key copies in the preferred format; the other format has no key of its own';
const GRID_MENUS = ['CSV cell', 'CSV row header', 'CSV column header', 'CSV corner', 'Spreadsheet cell', 'Spreadsheet column header', 'Spreadsheet corner'];

/**
 * Every row no key performs, by its path from the menu's name. A path ending `› *` covers every row beneath that
 * submenu: kept for pick lists (encodings, path forms, targets), where a new entry is one more item
 * of the same list rather than a new command.
 */
const NO_KEY: Readonly<Record<string, string>> = {
  'Preview body › Outlining › *': PREVIEW_OUTLINE,
  'Explorer file › New File': NONE,
  'Explorer file › Open In › OS File Explorer': NONE,
  'Explorer file › Open In › Open in OS Default Program': NONE,
  'Explorer file › Open In › New Editor': NONE,
  'Explorer file › Open In › Last Preview Panel': NONE,
  'Explorer file › Open In › New Preview Panel': NONE,
  'Explorer file › Open In › Terminal › *': PICK,
  'Explorer file › Open In › Search › Find': SEARCH_SCOPE,
  'Explorer file › Open In › Search › Find & Replace': SEARCH_SCOPE,
  'Explorer file › Copy Path › *': PICK,
  'Explorer file › Hide in this project': NONE,
  'Explorer file › Exclude from Find in Files in this project': NONE,
  'Explorer file › Properties': NONE,
  'Explorer folder › New File': NONE,
  'Explorer folder › Open In › OS File Explorer': NONE,
  'Explorer folder › Open In › Terminal › *': PICK,
  'Explorer folder › Open In › Search › Find': SEARCH_SCOPE,
  'Explorer folder › Open In › Search › Find & Replace': SEARCH_SCOPE,
  'Explorer folder › Copy Path › *': PICK,
  'Explorer folder › Collapse All Children': NONE,
  'Explorer folder › Expand All Children': NONE,
  'Explorer folder › Hide in this project': NONE,
  'Explorer folder › Exclude from Find in Files in this project': NONE,
  'Explorer folder › Properties': NONE,
  'Explorer root › New File': NONE,
  'Explorer root › Open In › OS File Explorer': NONE,
  'Explorer root › Open In › Terminal › *': PICK,
  'Explorer root › Open In › Search › Find': SEARCH_SCOPE,
  'Explorer root › Open In › Search › Find & Replace': SEARCH_SCOPE,
  'Explorer root › Copy Path › *': PICK,
  'Explorer root › Collapse All Children': NONE,
  'Explorer root › Expand All Children': NONE,
  'Explorer root › Properties': NONE,
  'Panel header › Set Language… (Markdown)': NONE,
  'Panel header › Reset Language': NONE,
  'Panel header › Encoding (UTF-8) › UTF-8': PICK,
  'Panel header › Encoding (UTF-8) › UTF-8 with BOM': PICK,
  'Panel header › Encoding (UTF-8) › UTF-16 LE': PICK,
  'Panel header › Encoding (UTF-8) › UTF-16 BE': PICK,
  'Panel header › Encoding (UTF-8) › Windows Code Pages › *': PICK,
  'Panel header › Line Endings (LF) › Mixed': NONE,
  'Panel header › Copy Path › *': PICK,
  'Panel header › Send to Tab › *': PICK,
  'Panel header › Sync to › *': PICK,
  'Panel header › Revert': NONE,
  'Panel header › Reload from disk': NONE,
  'Panel header › Find in File Explorer': NONE,
  'Panel header › Open in OS Explorer': NONE,
  'Panel header › Open in OS Default Program': NONE,
  'Panel header › Try again': NONE,
  'Panel header › Copy details': NONE,
  'Panel header › Clear panel type': NONE,
  'Panel header › Open in Editor': NONE,
  'Panel header › Refresh': NONE,
  'Panel header › Edit Long Cells in Dialog': NONE,
  'Tab › Sync to › *': PICK,
  'Tab › Destroy Tab': NONE,
  'Tab › Destroy other tabs': NONE,
  'Terminal › Copy': TERMINAL_COPY,
  'Cog › Key Bindings': NONE,
  'Cog › Themes': NONE,
  'Cog › Open Logs Folder': NONE,
  'Cog › About throng': NONE,
  'Find in Files › Replace All': NONE,
  'Find in Files › Replace in src/app.ts': NONE,
  'Find in Files › Replace Match in src/app.ts': NONE,
  'Find in Files › Open In › New Editor': NONE,
  'Find in Files › Open In › Last Preview Panel': NONE,
  'Find in Files › Open In › New Preview Panel': NONE,
  'Find in Files › Exclude from Find in Files in this project': NONE,
  'Find in Files › Collapse all': NONE,
  'Find in Files › Expand all': NONE,
  'Preview body › Copy as › Plain Text': COPY_OTHER_FORMAT,
  'Preview body › Copy Diagram as Image': NONE,
  'Preview body › Single Page': PICK,
  'Preview body › Two Pages': PICK,
  'Preview body › Pages Side by Side': PICK,
  'Preview body › Copy Image': NONE,
  'CSV cell › Copy as › Plain Text': COPY_OTHER_FORMAT,
  'CSV cell › Edit in Dialog…': CELL_DIALOG,
  'CSV cell › Column Width…': NONE,
  'CSV row header › Copy as › Plain Text': COPY_OTHER_FORMAT,
  'CSV row header › Insert › Copied Rows Above': NONE,
  'CSV row header › Insert › Copied Rows Below': NONE,
  'CSV column header › Copy as › Plain Text': COPY_OTHER_FORMAT,
  'CSV column header › Insert › Copied Columns Left': NONE,
  'CSV column header › Insert › Copied Columns Right': NONE,
  'CSV column header › Column Width…': NONE,
  'CSV column header › Reset Column Width': NONE,
  'CSV corner › Copy as › Plain Text': COPY_OTHER_FORMAT,
  'Spreadsheet cell › Copy as › Plain Text': COPY_OTHER_FORMAT,
  'Spreadsheet column header › Copy as › Plain Text': COPY_OTHER_FORMAT,
  'Spreadsheet column header › Column Width…': NONE,
  'Spreadsheet column header › Reset Column Width': NONE,
  'Spreadsheet corner › Copy as › Plain Text': COPY_OTHER_FORMAT,
  'Project › Edit': NONE,
  'Project › Rename': NONE,
  'Project › Remove': NONE,
  'Project › Open in OS Explorer': NONE,
  'Project › Copy Path › *': PICK,
  'Project › Go to Next Marked Panel': NEXT_MARKED,
  'Project › Move to Category › *': PICK,
  'Project › Unload Project': NONE,
  'Project › Unload Project and End Terminals': NONE,
  'Category › Rename Category': NONE,
  'Category › Delete Category': NONE,
  'Category › Move Category Up': NONE,
  'Category › Move Category Down': NONE,
  'Category › Minimise Category': NONE,
  'Notifications panel › Dismiss all': NONE,
  'Notifications panel › Oldest first': PICK,
  'Notifications panel › Newest first': PICK,
  'Notifications panel › Priority, oldest first': PICK,
  'Notifications panel › Priority, newest first': PICK,
  'Notifications panel › Minimise': NONE,
  'Notification › Copy': NONE,
  'Notification › Open File': NONE,
  'Link › Find in File Explorer': NONE,
  'Link › Copy Link to Clipboard': NONE,
  ...Object.fromEntries(
    GRID_MENUS.flatMap((m) => ['Wrap cell contents', 'Lock First Row', 'Lock First Column'].map((t) => [`${m} › ${t}`, GRID_TOGGLE])),
  ),
};

/* ── The sweep ────────────────────────────────────────────────────────────────────────────────────── */

interface Row {
  path: string;
  shortcut: string | undefined;
  parent: boolean;
}

function rowsOf(items: readonly MenuAction[], prefix: string): Row[] {
  return items.flatMap((item) => {
    const path = `${prefix} › ${item.label ?? '(no label)'}`;
    const self: Row = { path, shortcut: item.shortcut, parent: item.submenu !== undefined };
    return [self, ...(item.submenu ? rowsOf(item.submenu, path) : [])];
  });
}

const ROWS: readonly Row[] = MENUS.flatMap((m) => rowsOf(m.build(), m.name));

/** Whether NO_KEY entry `entry` covers the row at `path`: the path itself, or a `› *` entry's submenu. */
const covers = (entry: string, path: string): boolean =>
  entry.endsWith(' › *') ? path.startsWith(entry.slice(0, -1)) : entry === path;
const leaves = ROWS.filter((r) => !r.parent);

describe('every menu row a key performs shows the key (#732)', () => {
  it('every row shows a key, or NO_KEY says why no key performs it', () => {
    const entries = Object.keys(NO_KEY);
    const missing = leaves.filter((r) => r.shortcut === undefined && !entries.some((e) => covers(e, r.path)));
    expect(
      [...new Set(missing.map((r) => r.path))],
      'show the key (firstBinding for a command, fixedShortcut for a surface key) or list the row in NO_KEY with why no key performs it',
    ).toEqual([]);
  });

  it('NO_KEY names only rows that are drawn, and that still show no key', () => {
    const entries = Object.keys(NO_KEY);
    expect(entries.filter((e) => !leaves.some((r) => covers(e, r.path))), 'stale NO_KEY entries').toEqual([]);
    expect(
      entries.filter((e) => leaves.some((r) => r.shortcut !== undefined && covers(e, r.path))),
      'NO_KEY entries whose rows now show a key',
    ).toEqual([]);
  });

  it('every key shown is a live binding or a key the surface handles itself, never a typed-in chord', () => {
    const stray = ROWS.filter((r) => r.shortcut !== undefined && !SHOWABLE.has(r.shortcut)).map((r) => `${r.path} (${r.shortcut})`);
    expect(stray).toEqual([]);
  });
});

describe('the fixed keys read as the platform presses them (#732)', () => {
  afterEach(() => configureHostTraits(WINDOWS_HOST_TRAITS));

  it('Ctrl off macOS', () => {
    expect(FIXED_KEYS.map((k) => fixedShortcut(k))).toEqual(['Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y']);
  });

  it('Cmd on macOS, and Redo is Shift+Cmd+Z', () => {
    configureHostTraits(macosHostTraits('/tmp/throng-ipc', []));
    expect(FIXED_KEYS.map((k) => fixedShortcut(k))).toEqual(['Cmd+X', 'Cmd+C', 'Cmd+V', 'Cmd+A', 'Cmd+Z', 'Shift+Cmd+Z']);
  });

  it('the CSV grid’s Undo and Redo show them on macOS', () => {
    configureHostTraits(macosHostTraits('/tmp/throng-ipc', []));
    const items = csv({ kind: 'cell', row: 0, col: 0 }, null);
    expect(items.find((i) => i.label === 'Undo')?.shortcut).toBe('Cmd+Z');
    expect(items.find((i) => i.label === 'Redo')?.shortcut).toBe('Shift+Cmd+Z');
  });
});
