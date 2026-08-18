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
  type FlavourOption,
  type MenuSection,
  type Panel,
} from '@throng/core';
import type { EditorView } from '@codemirror/view';
import type { MenuAction, MenuItem } from '../../src/renderer/workspace/context-menu.js';
import { withDividers } from '../../src/renderer/workspace/menu-dividers.js';
import { buildContextMenuItems } from '../../src/renderer/explorer/context-menu-items.js';
import { editorContentMenu } from '../../src/renderer/editor/content-menu.js';
import {
  panelHeaderMenu,
  type PanelHeaderMenuActions,
} from '../../src/renderer/workspace/panel-header-menu.js';
import { tabContextMenu } from '../../src/renderer/workspace/tab-menu.js';
import { terminalContentMenu } from '../../src/renderer/terminal/terminal-content-menu.js';
import { cogMenuItems } from '../../src/renderer/title-bar/cog-menu-items.js';

/*
 * Split on the ABSENCE of a section, exactly as `context-menu.tsx` now does. `'separator' in item`
 * is structural and a spread can carry that key onto a real action; declaring a section is what an
 * action actually does and a derived divider never will.
 */
const isSeparator = (item: MenuItem): item is { separator: true } => !('section' in item);
const isAction = (item: MenuItem): item is MenuAction => 'section' in item;

/** Where the dividers actually land once the renderer has joined the groups. */
function separatorIndices(actions: MenuAction[]): number[] {
  return withDividers(actions)
    .map((item, index) => (isSeparator(item) ? index : -1))
    .filter((index) => index >= 0);
}

/** The menu as DRAWN — one entry per row, a label or `'—'` for a derived divider. */
function shapeOf(actions: MenuAction[]): string[] {
  return withDividers(actions).map((item) =>
    isSeparator(item) ? '—' : (item.label ?? '(no label)'),
  );
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

  /*
   * N4 — nothing is reordered WITHIN a section, asked of what the renderer will actually DRAW.
   *
   * This used to compare `groupBySection(actions)` against `actions`, which is a claim about
   * `groupBySection` and says nothing whatever about `withDividers` — the subject of every other
   * assertion in this function. Reverse the items inside each group as `withDividers` joins them and
   * every menu in the app renders backwards, while the divider count, every boundary index and the
   * section order stay exactly as they were: all seventeen table rows pass, and only the three
   * hand-written label tables at the foot of this file go red. So the rendered rows are what is read
   * back, section by section, against the order the builder emitted them in.
   */
  const drawn = rendered.filter(isAction);
  expect(drawn.length, `${where}: withDividers dropped or duplicated an item`).toBe(actions.length);
  for (const section of [...new Set(actions.map((a) => a.section))]) {
    expect(
      drawn.filter((a) => a.section === section),
      `${where}: intra-section order — ${section}`,
    ).toEqual(actions.filter((a) => a.section === section));
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

/**
 * The flavour catalogue, as `useFlavours()` would hand it over (033 US3, FR-030).
 *
 * Without it — and without `openInTerminal` — `buildContextMenuItems` draws the Terminal parent
 * DISABLED and with no submenu (FR-035), which was the only variant this table ever walked. The
 * enabled one nests three levels deep, and `assertSectioned` recurses into submenus but only into
 * ones that exist, so the deepest level in the whole application was never put through the shared
 * invariants here.
 *
 * What the rows themselves declare is NOT re-asserted below: `explorer-terminal-menu.test.ts`
 * already pins the catalogue's order, the launch call, the disabled variant and every row's
 * `section: 'navigate'` (contract A1–A6). This fixture exists so the enabled shape also meets the
 * generic checks, not to state those guarantees a second time.
 */
const TERMINAL_FLAVOURS: readonly FlavourOption[] = [
  { value: 'windows-powershell', label: 'Windows PowerShell', defaultShellArguments: '' },
  { value: 'cmd', label: 'Command Prompt', defaultShellArguments: '' },
];

const explorerFolderWithTerminal = (): MenuAction[] =>
  buildContextMenuItems({
    node: { relPath: 'src', kind: 'folder' },
    selectedRelPaths: [],
    clipboard: null,
    ops: { ...explorerOps, openInTerminal: noop },
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: false, canRedo: false },
    flavours: TERMINAL_FLAVOURS,
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
  { name: 'Files & Folders — folder row, Terminal enabled', build: explorerFolderWithTerminal },
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

  /*
   * The root, in full — and this pin exists because the index assertion above could not have caught
   * the drift that prompted it. US4 appended Collapse/Expand All Children to the TAIL of Navigate,
   * which moves no boundary, so `[3, 6]` held before and after and said nothing about it. The E2E
   * spec's root expectation was the only thing that noticed, at the most expensive layer there is.
   *
   * What this adds over the indices: that the root draws NO Destroy and NO View & state — you can
   * neither delete nor hide the project root — and that the two subtree items are drawn HERE at all.
   * The root is a folder, so it gets them by construction, and the spec's own edge case ("Collapse
   * All Children on the project root: the root stays open — it is the tree") is only writable
   * because it does.
   */
  it('the empty space (root): the whole shape — no Destroy, no Hide, subtree items closing Navigate', () => {
    expect(shapeOf(explorerRoot())).toEqual([
      'Paste',
      'Undo',
      'Redo',
      '—',
      'New File',
      'New Folder',
      '—',
      'Open In',
      'Copy Path',
      'Collapse All Children',
      'Expand All Children',
    ]);
  });

  /*
   * The folder row, in full. It was asserted by a divider COUNT and by Delete's offset from New
   * Folder, which is a claim about two rows out of eighteen: every other label could move between
   * sections, or within one, and both assertions would still hold. Collapse/Expand All Children
   * are the reason it is worth pinning — US4 appended them to the tail of Navigate, and "appended
   * to the tail of the right group" is exactly the property a count cannot tell from "inserted in
   * the middle of the wrong one".
   */
  it('a folder row: the whole eighteen-row shape, Collapse/Expand closing Navigate', () => {
    expect(shapeOf(explorerFolder())).toEqual([
      'Rename',
      'Cut',
      'Copy',
      'Paste',
      'Undo',
      'Redo',
      '—',
      'New File',
      'New Folder',
      '—',
      'Delete',
      '—',
      'Open In',
      'Copy Path',
      'Collapse All Children',
      'Expand All Children',
      '—',
      'Hide in this project',
    ]);
  });
});

/*
 * The panel header menu — the biggest restructure in the feature (contracts §3.4), and until now
 * the one menu whose SHAPE nothing pinned.
 *
 * `assertSectioned` above checks that the sections are valid, ordered, and that the dividers land
 * at the boundaries; it never compares a label. So every one of these passed the whole suite green:
 * `Reload from disk` re-declared `viewState`, `Send to Tab` re-declared `content`, `Save As…` moved
 * within the Content group (N4/FR-053), `Zoom` becoming `content`. Each is a well-formed menu — and
 * a different one from the one the contract describes.
 *
 * Two rows of the table, therefore, are pinned exhaustively: the simplest panel and the one that
 * draws every conditional the editor adds.
 */
describe('the panel header menu draws exactly the shape contracts/menu-sections.md §3.4 describes', () => {
  it('an untyped panel: Rename · Destroy Panel · Send to Tab · Reset Name, Zoom', () => {
    expect(shapeOf(panelHeader({ panel: panel({}) }))).toEqual([
      'Rename',
      '—',
      'Destroy Panel',
      '—',
      'Send to Tab',
      '—',
      'Reset Name',
      'Zoom',
    ]);
  });

  /*
   * The chords the panel menu SHOWS (034 FR-045).
   *
   * MIGRATED FROM the first half of `packages/ui/tests/e2e/panel-rename-key.e2e.ts:24`, which
   * launched Electron, created a project, made an editor panel and opened a real context menu to
   * assert `menu-item-Rename` contained the text "F2" and `menu-item-Zoom In` contained "Ctrl".
   *
   * `panelHeaderMenu` is a pure function of its `keybindings` argument — `shortcut:
   * firstBinding(keybindings, …)` — so the menu's own claim is settled here, against
   * `DEFAULT_KEYBINDINGS`, and settled HARDER than the E2E settled it: "contains Ctrl" is true of
   * every chord in the application, and would have passed with Zoom In showing Zoom Out's binding.
   *
   * What is NOT claimed here, and stays end-to-end: that this shortcut string reaches the RENDERED
   * menu item. `menu-keyboard.test.ts` mounts the real menu, and the surviving E2E test presses the
   * key for real.
   */
  it('names the chord beside Rename and beside each Zoom item, and names the RIGHT one', () => {
    const items = panelHeader({ panel: panel({ kind: 'editor' }), editor: { dirty: false, hasFilePath: true } });

    expect(items.find((i) => i.label === 'Rename')?.shortcut).toBe('F2');

    const zoom = items.find((i) => i.label === 'Zoom')?.submenu ?? [];
    expect(
      zoom.map((i) => [i.label, i.shortcut]),
      'each zoom item shows its OWN chord — "contains Ctrl" cannot tell them apart',
    ).toEqual([
      ['Zoom In', 'Ctrl+Alt+='],
      ['Zoom Out', 'Ctrl+Alt+-'],
      ['Reset Zoom', 'Ctrl+Alt+0'],
    ]);
  });

  it('shows a REBOUND chord rather than the shipped one, so the menu teaches the live key', () => {
    /*
     * The half that makes the test above evidence rather than a restatement of the defaults table:
     * a menu that hard-coded "F2" passes it perfectly and lies to every user who has rebound
     * `panel.rename`. `firstBinding` is what this asserts, at the one call site that matters.
     */
    const rebound = {
      ...DEFAULT_KEYBINDINGS,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'panel.rename': ['Ctrl+Shift+M'] },
    };
    const items = panelHeaderMenu({
      panel: panel({}),
      panelVerb: 'Destroy',
      keybindings: rebound,
      otherTabs: [],
      editor: null,
      editorFailure: false,
      detach: null,
      actions: panelActions,
    });

    expect(items.find((i) => i.label === 'Rename')?.shortcut).toBe('Ctrl+Shift+M');
  });

  it('an editor panel backed by a file: Destroy moves to the middle, Reset Name leaves Rename’s side', () => {
    const shape = shapeOf(
      panelHeader({ panel: panel({ kind: 'editor' }), editor: { dirty: false, hasFilePath: true } }),
    );
    expect(shape).toEqual([
      // Content — Save As… sits between Save and Revert, and Reload from disk closes the group.
      'Rename',
      'Save',
      'Save As…',
      'Revert',
      'Reload from disk',
      '—',
      // Destroy, alone, third — the same shape the Files & Folders menu has always had.
      'Destroy Panel',
      '—',
      // Navigate — the two reveal items exist only for a panel with a file behind it.
      'Reveal File in Files & Folders',
      'Open in OS Explorer',
      'Send to Tab',
      '—',
      // View & state — Reset Name has left Rename's side, where the constitution names it.
      'Reset Name',
      'Zoom',
    ]);
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

/*
 * "Send to Tab" — the SUBMENU, not merely its parent row (034 FR-045).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-menus.e2e.ts`,
 * `test('Send to Tab offers New Tab on the panel menu')`. That test launched Electron, a daemon and
 * a window, created a project against a real temp folder and typed an editor panel into existence —
 * in order to right-click a panel handle and read one label out of a flyout.
 *
 * WHY IT IS A GAP AT ALL, given the shape tests above already pin `Send to Tab`: `shapeOf` walks
 * `withDividers(actions)`, which is ONE level. It sees the parent row and stops. So what the submenu
 * actually offers was asserted nowhere below E2E, and that is what these three close.
 *
 * The RENDERING half is deliberately not re-proved here — it is already component-proved over this
 * exact row: `packages/ui/tests/component/context-menu-lifecycle.test.ts:150` clicks
 * `menu-item-Send to Tab` and asserts `submenu-Send to Tab` is visible with its children reachable.
 * Builder data here, flyout rendering there; between them they say everything the E2E said.
 *
 * ANTI-VACUITY CONTROL: delete the `New Tab` entry from the `submenu` array in
 * `panel-header-menu.ts` (the one at `label: 'Send to Tab'`) and ALL THREE tests below fail — each
 * one reads `sendToTabRow(...).submenu` and asserts on its contents, so none of them can pass
 * against a menu that does not offer the target.
 */
describe('Send to Tab offers New Tab first, then every other Tab (005 FR-027)', () => {
  /** The `Send to Tab` row, or a failure that says the menu no longer has one. */
  const sendToTabRow = (items: MenuAction[]): MenuAction => {
    const row = items.find((i) => i.label === 'Send to Tab');
    if (!row) throw new Error('the panel header menu has no Send to Tab row');
    return row;
  };

  /** `panelHeader` above fixes `otherTabs`; this one varies it and can spy on the actions. */
  const withTabs = (
    otherTabs: { id: string; title: string }[],
    actions: Partial<PanelHeaderMenuActions> = {},
  ): MenuAction[] =>
    panelHeaderMenu({
      panel: panel({}),
      panelVerb: 'Destroy',
      keybindings: DEFAULT_KEYBINDINGS,
      otherTabs,
      editor: null,
      editorFailure: false,
      detach: null,
      actions: { ...panelActions, ...actions },
    });

  it('puts New Tab ahead of the other Tabs, on an untyped panel and on an editor alike', () => {
    // Both fixtures, because the E2E drove an EDITOR panel and the shape tests above drive an
    // untyped one — the submenu must not depend on which.
    for (const built of [
      panelHeader({ panel: panel({}) }),
      panelHeader({
        panel: panel({ kind: 'editor' }),
        editor: { dirty: false, hasFilePath: true },
      }),
    ]) {
      const submenu = sendToTabRow(built).submenu ?? [];
      expect(submenu.map((i) => i.label)).toEqual(['New Tab', 'Tab 2']);
      // FR-049 applies per level: every submenu row declares a section too.
      expect(submenu.map((i) => i.section)).toEqual(['navigate', 'navigate']);
    }
  });

  it('sends to a NEW tab, not to the first existing one — the two actions are distinct', () => {
    /*
     * The regression this catches, and the reason the labels alone are not enough: `New Tab` wired
     * to `actions.sendToTab(otherTabs[0].id)` draws an identical menu and silently drops the Panel
     * into Tab 2. The E2E could not have caught it either — it only read the label.
     */
    const called: string[] = [];
    const items = withTabs([{ id: 't2', title: 'Tab 2' }], {
      sendToNewTab: () => {
        called.push('new');
      },
      sendToTab: (id: string) => {
        called.push(id);
      },
    });

    const submenu = sendToTabRow(items).submenu ?? [];
    expect(submenu).toHaveLength(2);
    for (const row of submenu) {
      expect(row.onClick, `${row.label ?? '(no label)'} carries no action`).toBeDefined();
      row.onClick?.();
    }

    expect(called).toEqual(['new', 't2']);
  });

  it('still offers New Tab when it is the ONLY target — a lone Tab can still send onward', () => {
    // The empty-`otherTabs` case the E2E never reached: with no other Tab, a submenu built purely
    // by mapping `otherTabs` would be empty, and an empty flyout is a dead row.
    expect(sendToTabRow(withTabs([])).submenu?.map((i) => i.label)).toEqual(['New Tab']);
  });
});
