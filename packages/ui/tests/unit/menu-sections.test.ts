/**
 * SC-010 / SC-016 below E2E: every menu builder in the app, over a table of fixtures (033 US5, T057).
 *
 * SC-010 asks for "one check that enumerates the menus rather than a per-menu eyeball". The E2E
 * spec (`menu-sections.e2e.ts`) enumerates them in the RUNNING app; this one enumerates the
 * BUILDERS, which is where the sections are declared and where a regression is cheapest to catch.
 * SC-016's sibling requirement is that these tests prove what they claim, so nothing here asserts
 * "a section exists" — each fixture is driven through the SAME divider derivation the renderer uses
 * (`withDividers`, which `ContextMenu` calls per level) and the resulting divider positions are
 * checked against the section boundaries.
 *
 * The Key Bindings chord menu is deliberately absent (FR-052): it builds one item inline in
 * `preferences/keybindings-tab.tsx`, and a one-item menu has one section and no boundary, so there
 * is nothing here for it to assert. The type change (T059) still covers it — which is the point of
 * moving the guarantee to the provider.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  MENU_SECTION_ORDER,
  groupBySection,
  type MenuSection,
  type Panel,
} from '@throng/core';
import type { EditorView } from '@codemirror/view';
import type { MenuAction, MenuItem } from '../../src/renderer/workspace/context-menu.js';
import { withDividers } from '../../src/renderer/workspace/menu-dividers.js';
import { buildContextMenuItems } from '../../src/renderer/explorer/context-menu-items.js';
import { editorContentMenu } from '../../src/renderer/editor/content-menu.js';
import { panelHeaderMenu } from '../../src/renderer/workspace/panel-header-menu.js';
import { tabContextMenu } from '../../src/renderer/workspace/tab-menu.js';
import { terminalContentMenu } from '../../src/renderer/terminal/terminal-content-menu.js';
import { cogMenuItems } from '../../src/renderer/title-bar/cog-menu-items.js';

const isSeparator = (item: MenuItem): item is { separator: true } => 'separator' in item;
const isAction = (item: MenuItem): item is MenuAction => !('separator' in item);

/** Where the dividers actually land once the renderer has joined the groups. */
function separatorIndices(actions: MenuAction[]): number[] {
  return withDividers(actions)
    .map((item, index) => (isSeparator(item) ? index : -1))
    .filter((index) => index >= 0);
}

/**
 * The whole of SC-010, applied to one level of one menu — then to every submenu beneath it,
 * because FR-048's "per level" is exactly where a grouping pass is most likely to stop short.
 */
function assertSectioned(actions: MenuAction[], where: string): void {
  for (const action of actions) {
    // FR-049 — every item declares a section, and it is one the application knows.
    expect(MENU_SECTION_ORDER, `${where} → ${action.label ?? '(no label)'}`).toContain(action.section);
  }

  const rendered = withDividers(actions);
  const groups = groupBySection(actions, (a) => a.section);

  // M4/M5 — one divider per boundary, so a single-section menu carries none and an empty menu
  // carries none either.
  expect(rendered.filter(isSeparator).length, `${where}: divider count`).toBe(
    Math.max(0, groups.length - 1),
  );

  // FR-050 — a divider appears at EVERY section change and NOWHERE else.
  let previous: MenuSection | null = null;
  let dividerPending = false;
  rendered.forEach((item, index) => {
    if (isSeparator(item)) {
      expect(previous, `${where}: menu begins with a divider at ${index}`).not.toBeNull();
      expect(dividerPending, `${where}: two dividers in a row at ${index}`).toBe(false);
      dividerPending = true;
      return;
    }
    if (previous !== null) {
      expect(
        dividerPending,
        `${where}: ${previous} → ${item.section} at ${index} (divider ${dividerPending ? 'present' : 'missing'})`,
      ).toBe(item.section !== previous);
    }
    previous = item.section;
    dividerPending = false;
  });
  expect(dividerPending, `${where}: menu ends with a divider`).toBe(false);

  // FR-047 — the sections appear in the one fixed order.
  const seen = [...new Set(rendered.filter(isAction).map((a) => a.section))];
  expect(seen, `${where}: section order`).toEqual(
    [...seen].sort((a, b) => MENU_SECTION_ORDER.indexOf(a) - MENU_SECTION_ORDER.indexOf(b)),
  );

  // N4 — nothing is reordered WITHIN a section by the grouping.
  for (const group of groups) {
    const asBuilt = actions.filter((a) => a.section === group[0]!.section);
    expect(group, `${where}: intra-section order`).toEqual(asBuilt);
  }

  for (const action of actions) {
    if (action.submenu && action.submenu.length > 0) {
      assertSectioned(action.submenu, `${where} > ${action.label ?? '(no label)'}`);
    }
  }
}

const noop = (): void => {};

// ---------------------------------------------------------------------------
// The table. One row per menu the app can draw, with the fixtures that make its
// conditional items appear and disappear.
// ---------------------------------------------------------------------------

const explorerOps = {
  beginRename: noop,
  cut: noop,
  copy: noop,
  paste: noop,
  remove: noop,
  reveal: noop,
  hide: noop,
  newFolder: noop,
  newFile: noop,
  undoFileOp: noop,
  redoFileOp: noop,
  // 033 US4 — required on ContextMenuOps; the folder fixture draws both rows from them.
  expandChildren: noop,
  collapseChildren: noop,
};

const explorerFile = (): MenuAction[] =>
  buildContextMenuItems({
    node: { relPath: 'src/app.ts', kind: 'file' },
    selectedRelPaths: ['src/app.ts'],
    clipboard: { mode: 'copy', relPaths: ['src/other.ts'] },
    ops: explorerOps,
    openIn: [
      { label: 'Last Active Editor', icon: 'add', section: 'navigate', onClick: noop },
      { label: 'New Editor', icon: 'add', section: 'navigate', onClick: noop },
    ],
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: true, canRedo: false },
  });

const explorerFolder = (): MenuAction[] =>
  buildContextMenuItems({
    node: { relPath: 'src', kind: 'folder' },
    selectedRelPaths: [],
    clipboard: null,
    ops: explorerOps,
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: false, canRedo: false },
  });

const explorerRoot = (): MenuAction[] =>
  buildContextMenuItems({
    node: { relPath: '', kind: 'folder' },
    selectedRelPaths: [],
    clipboard: null,
    ops: explorerOps,
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
  });

const editorMenu = (languageName?: string): MenuAction[] =>
  editorContentMenu({
    view: {} as EditorView,
    panelId: 'p1',
    viewId: 'v1',
    lineEnding: () => 'lf',
    wordWrap: { on: true, toggle: noop, chord: 'Alt+Z' },
    gotoLine: { open: noop, chord: 'Ctrl+G' },
    languageName,
  });

const panel = (over: Partial<Panel>): Panel => ({
  type: 'panel',
  id: 'p1',
  originProjectId: 'proj',
  title: 'Panel 1',
  ...over,
});

const panelActions = {
  beginRename: noop,
  resetName: noop,
  zoomIn: noop,
  zoomOut: noop,
  resetZoom: noop,
  save: noop,
  saveAs: noop,
  revert: noop,
  reloadFromDisk: noop,
  revealInTree: noop,
  openInOsExplorer: noop,
  tryAgain: noop,
  copyDetails: noop,
  clearPanelType: noop,
  redraw: noop,
  sendToNewTab: noop,
  sendToTab: noop,
  destroy: noop,
};

const detachFixture = {
  subWorkspaces: [
    { id: 's1', name: 'Sub One', alreadyHasPanel: false, tabs: [{ id: 't9', title: 'Tab 9' }] },
    { id: 's2', name: 'Sub Two', alreadyHasPanel: true, tabs: [] },
  ],
  detachToNew: noop,
  syncToExisting: noop,
};

const panelHeader = (over: {
  panel: Panel;
  editor?: { dirty: boolean; hasFilePath: boolean } | null;
  editorFailure?: boolean;
  detach?: typeof detachFixture | null;
}): MenuAction[] =>
  panelHeaderMenu({
    panel: over.panel,
    panelVerb: 'Destroy',
    keybindings: DEFAULT_KEYBINDINGS,
    otherTabs: [{ id: 't2', title: 'Tab 2' }],
    editor: over.editor ?? null,
    editorFailure: over.editorFailure ?? false,
    detach: over.detach ?? null,
    actions: panelActions,
  });

const tabMenu = (detach: boolean): MenuAction[] =>
  tabContextMenu({
    tabId: 't1',
    destroyTabDisabled: false,
    destroyOthersDisabled: true,
    detach: detach
      ? { subWorkspaces: [{ id: 's1', name: 'Sub One' }], detachToNew: noop, syncToExisting: noop }
      : null,
    actions: { rename: noop, destroyTab: noop, destroyOthers: noop },
  });

const terminalMenu = (over: { link?: string | null; selection?: string; startFailure?: boolean }): MenuAction[] =>
  terminalContentMenu({
    link: over.link ?? null,
    selection: over.selection ?? '',
    redrawChord: 'Ctrl+Shift+R',
    startFailure: over.startFailure ?? false,
    actions: {
      openLink: noop,
      copyLinkAddress: noop,
      copySelection: noop,
      paste: noop,
      redraw: noop,
      tryAgain: noop,
      copyDetails: noop,
      clearPanelType: noop,
    },
  });

const cogMenu = (): MenuAction[] =>
  cogMenuItems({ openPreferences: noop, openLogs: noop, openAbout: noop });

const TABLE: { name: string; build: () => MenuAction[] }[] = [
  { name: 'Files & Folders — file row', build: explorerFile },
  { name: 'Files & Folders — folder row', build: explorerFolder },
  { name: 'Files & Folders — empty space (root)', build: explorerRoot },
  { name: 'Editor content menu', build: () => editorMenu('TypeScript') },
  { name: 'Editor content menu — language undetected', build: () => editorMenu(undefined) },
  { name: 'Panel header — untyped panel', build: () => panelHeader({ panel: panel({}) }) },
  {
    name: 'Panel header — editor panel, saved file',
    build: () =>
      panelHeader({ panel: panel({ kind: 'editor' }), editor: { dirty: false, hasFilePath: true } }),
  },
  {
    name: 'Panel header — editor panel, unreadable file',
    build: () =>
      panelHeader({
        panel: panel({ kind: 'editor' }),
        editor: { dirty: true, hasFilePath: true },
        editorFailure: true,
      }),
  },
  {
    name: 'Panel header — terminal panel',
    build: () => panelHeader({ panel: panel({ kind: 'terminal' }) }),
  },
  {
    name: 'Panel header — with sub-workspaces to sync to',
    build: () => panelHeader({ panel: panel({ kind: 'terminal' }), detach: detachFixture }),
  },
  { name: 'Tab menu — main window', build: () => tabMenu(true) },
  { name: 'Tab menu — sub-workspace window', build: () => tabMenu(false) },
  { name: 'Terminal content menu — plain', build: () => terminalMenu({}) },
  { name: 'Terminal content menu — link under the pointer', build: () => terminalMenu({ link: 'https://example.test/' }) },
  { name: 'Terminal content menu — with a selection', build: () => terminalMenu({ selection: 'ls -al' }) },
  { name: 'Terminal content menu — start failure', build: () => terminalMenu({ startFailure: true }) },
  { name: 'Cog menu', build: cogMenu },
];

describe('every menu builder declares its sections, and the dividers are derived from them', () => {
  it.each(TABLE)('$name', ({ name, build }) => {
    const actions = build();
    expect(actions.length, `${name}: fixture built no items`).toBeGreaterThan(0);
    assertSectioned(actions, name);
  });
});

describe('zero movement — the Files & Folders menu draws its dividers exactly where it always has', () => {
  /*
   * The evidence that the vocabulary really was derived from this menu (contracts §3.1). These four
   * indices are the four hand-pushed separators the builder carried before US5, counted off the
   * shipped file: after Redo, after New Folder, after Delete, after Copy Path.
   */
  it('a file row: four dividers, at 6, 9, 11 and 14', () => {
    expect(separatorIndices(explorerFile())).toEqual([6, 9, 11, 14]);
  });

  it('the empty space (root): two dividers, at 3 and 6 — no Destroy, no Hide, no leading divider', () => {
    expect(separatorIndices(explorerRoot())).toEqual([3, 6]);
  });
});

describe('the cog menu is one section, therefore no divider (FR-052 as corrected, AS-5)', () => {
  it('draws five Application items and nothing between them', () => {
    const items = cogMenuItems({ openPreferences: noop, openLogs: noop, openAbout: noop });
    expect(items.map((i) => i.section)).toEqual(['application', 'application', 'application', 'application', 'application']);
    expect(separatorIndices(items)).toEqual([]);
  });

  it('keeps the test identifiers roughly ten preferences suites depend on (FR-053)', () => {
    expect(cogMenuItems({ openPreferences: noop, openLogs: noop, openAbout: noop }).map((i) => i.testId)).toEqual([
      'cog-menu-settings',
      'cog-menu-keybindings',
      'cog-menu-themes',
      'cog-menu-logs',
      'cog-menu-about',
    ]);
  });
});

describe('the terminal content menu leads with its contextual items (AS-8)', () => {
  it('puts Open Link and Copy Link Address above Copy/Paste, with one divider between', () => {
    const items = withDividers(terminalMenu({ link: 'https://example.test/' }));
    const labels = items.map((i) => (isSeparator(i) ? '—' : i.label));
    expect(labels).toEqual([
      'Open Link',
      'Copy Link Address',
      '—',
      'Copy',
      'Paste',
      '—',
      'Refresh / redraw terminal',
    ]);
  });

  it('drops the divider between Refresh / redraw terminal and Try again — both are View & state', () => {
    const items = withDividers(terminalMenu({ startFailure: true }));
    const labels = items.map((i) => (isSeparator(i) ? '—' : i.label));
    expect(labels).toEqual([
      'Copy',
      'Paste',
      '—',
      'Refresh / redraw terminal',
      'Try again',
      'Copy details',
      'Clear panel type',
    ]);
  });
});

describe('Go To Line is on the editor content menu, in Navigate, showing its current chord (FR-027)', () => {
  it('sits between the editing items and the view items, with a divider either side', () => {
    const items = withDividers(editorMenu('TypeScript'));
    const labels = items.map((i) => (isSeparator(i) ? '—' : i.label));
    expect(labels).toEqual([
      'Cut',
      'Copy',
      'Paste',
      'Select All',
      'Undo',
      'Redo',
      '—',
      'Go To Line…',
      '—',
      'Set Language… (TypeScript)',
      'Word Wrap ✓',
    ]);
  });

  it('shows the chord it is bound to right now', () => {
    const goto = editorMenu().find((i) => i.label === 'Go To Line…');
    expect(goto?.section).toBe('navigate');
    expect(goto?.shortcut).toBe('Ctrl+G');
  });
});
