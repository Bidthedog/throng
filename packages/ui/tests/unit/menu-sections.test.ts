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
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  MENU_SECTION_ORDER,
  PREVIEW_KIND,
  SHIPPED_PREVIEW_PROVIDERS,
  buildLinkMenu,
  groupBySection,
  previewAffordance,
  previewSettingsDefaults,
  type FlavourOption,
  type MenuSection,
  type Panel,
  type PreviewAffordance,
} from '@throng/core';
import type { EditorView } from '@codemirror/view';
import type { MenuAction, MenuItem } from '../../src/renderer/workspace/context-menu.js';
import { withDividers } from '../../src/renderer/workspace/menu-dividers.js';
import { buildContextMenuItems } from '../../src/renderer/explorer/context-menu-items.js';
import { editorContentMenu } from '../../src/renderer/editor/content-menu.js';
import {
  panelHeaderMenu,
  type PanelHeaderMenuActions,
  type PanelHeaderPreviewState,
} from '../../src/renderer/workspace/panel-header-menu.js';
import { tabContextMenu } from '../../src/renderer/workspace/tab-menu.js';
import { terminalContentMenu } from '../../src/renderer/terminal/terminal-content-menu.js';
import { cogMenuItems } from '../../src/renderer/title-bar/cog-menu-items.js';
import { findInFilesContentMenu } from '../../src/renderer/find-in-files/content-menu.js';
import { previewContentMenu } from '../../src/renderer/preview/content-menu.js';

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
  // 043 FR-029b — required too; the folder fixture draws Find in Files from it.
  findInFiles: noop,
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
  reloadTerminal: noop,
  copyDetails: noop,
  clearPanelType: noop,
  redraw: noop,
  sendToNewTab: noop,
  sendToTab: noop,
  // 043 FR-015 — the panel's search commands. Required fields, so a builder that grew a row and a
  // fixture that did not is a compile error rather than a silently unexercised item.
  find: noop,
  replace: noop,
  replaceAll: noop,
  destroy: noop,
  // 044 — Open Preview on an editor (FR-002), Back / Forward on an editor or a preview (FR-111), and a
  // preview's own Refresh and route back to its source (FR-028, FR-015b).
  openPreview: noop,
  navigateBack: noop,
  navigateForward: noop,
  refreshPreview: noop,
  openInEditor: noop,
  goToEditor: noop,
  // 044 FR-122 — Synchronise Scrolling, on an editor that offers a preview and on a text preview.
  toggleSyncScroll: noop,
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
  panelFailure?: boolean;
  detach?: typeof detachFixture | null;
  preview?: PanelHeaderPreviewState | null;
  history?: { canGoBack: boolean; canGoForward: boolean } | null;
  openPreview?: PreviewAffordance;
  panelVerb?: string;
  syncScroll?: boolean;
}): MenuAction[] =>
  panelHeaderMenu({
    panel: over.panel,
    panelVerb: over.panelVerb ?? 'Destroy',
    keybindings: DEFAULT_KEYBINDINGS,
    otherTabs: [{ id: 't2', title: 'Tab 2' }],
    editor: over.editor ?? null,
    panelFailure: over.panelFailure ?? false,
    detach: over.detach ?? null,
    preview: over.preview ?? null,
    history: over.history ?? null,
    openPreview: over.openPreview,
    syncScroll: over.syncScroll ?? false,
    actions: panelActions,
  });

/*
 * 044 — the affordance an editor's Open Preview is drawn from, computed by the REAL decision
 * (`previewAffordance`, core) over the shipped registry and its shipped settings, so these fixtures
 * cannot drift from what the app would hand the builder.
 */
const PREVIEW_SETTINGS = previewSettingsDefaults(SHIPPED_PREVIEW_PROVIDERS);
const editorAffordance = (over: { previewOpen?: boolean; enabled?: boolean; path?: string } = {}): PreviewAffordance => {
  const providerId = SHIPPED_PREVIEW_PROVIDERS.list()[0].id;
  return previewAffordance({
    registry: SHIPPED_PREVIEW_PROVIDERS,
    settings: {
      ...PREVIEW_SETTINGS,
      providers: {
        ...PREVIEW_SETTINGS.providers,
        [providerId]: { ...PREVIEW_SETTINGS.providers[providerId], enabled: over.enabled ?? true },
      },
    },
    absPath: over.path ?? 'D:/project/README.md',
    projectRoot: 'D:/project',
    isFolder: false,
    previewOpen: over.previewOpen ?? false,
    surface: 'editor',
  });
};

const previewPanel = (): Panel => panel({ kind: PREVIEW_KIND, config: { filePath: 'D:/project/README.md' } });
const textPreview = (parented = false): PanelHeaderPreviewState => ({ providerKind: 'text', parented });
const binaryPreview: PanelHeaderPreviewState = { providerKind: 'binary', parented: false };

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


const terminalMenu = (over: { selection?: string; startFailure?: boolean }): MenuAction[] =>
  terminalContentMenu({
    selection: over.selection ?? '',
    redrawChord: 'Ctrl+Shift+R',
    startFailure: over.startFailure ?? false,
    actions: {
      copySelection: noop,
      paste: noop,
      redraw: noop,
      tryAgain: noop,
      reloadTerminal: noop,
      copyDetails: noop,
      clearPanelType: noop,
    },
  });

/*
 * 046 iterate round 1 (checkpoint 2026-09-24; FR-074, FR-107) retired the Navigate section (and the
 * `SidePaneActions` it alone existed to dispatch through): Next/Previous Project and the two Focus
 * rows drop out of the cog entirely (they keep their chords, listed under Focus & Zoom in the Key
 * Bindings editor instead). Round 1 replaced it with a `viewState` Zoom row.
 *
 * 046 iterate round 2 (FR-113) REMOVES that Zoom row too — the maintainer's own words, mid-build:
 * "Remove the new 'Zoom' options from the menu." The cog is back to its single `application`
 * section, and `cogMenuItems` no longer takes a window zoom level at all.
 */
const cogMenu = (): MenuAction[] =>
  cogMenuItems({
    openPreferences: noop,
    openLogs: noop,
    openAbout: noop,
    keybindings: DEFAULT_KEYBINDINGS,
  });

/**
 * The Find in Files panel's menu (043 FR-025a), in the three states that change its shape:
 * idle, scanning, and with replace disclosed and its commit granularities live.
 *
 * `find-in-files-menu.test.ts` pins the labels, the sections and the state marks; what this
 * table adds is the GENERIC invariant every menu in the app is held to — that the dividers the
 * renderer derives land on the section boundaries and nowhere else. A builder missing from this
 * import list is never checked for that at all, which is why the contract names the omission.
 */
const findInFilesMenu = (over: {
  running?: boolean;
  replaceEnabled?: boolean;
  commit?: boolean;
}): MenuAction[] =>
  findInFilesContentMenu({
    running: over.running ?? false,
    replaceEnabled: over.replaceEnabled ?? false,
    grouping: 'file',
    keybindings: DEFAULT_KEYBINDINGS,
    actions: {
      run: noop,
      cancel: noop,
      toggleReplace: noop,
      setGrouping: noop,
      focusScope: noop,
      setAllCollapsed: noop,
    },
    ...(over.commit
      ? { commit: { replaceAll: noop, replaceInFile: noop, replaceMatch: noop } }
      : {}),
  });

/*
 * 044 FR-035, FR-035c, FR-015b, FR-015e — the preview body menu in full (contracts/menus-and-controls.md
 * §4): Content where the provider draws selectable text, Navigate for a text provider, View & state last.
 *
 * 045 T277 — no `link` parameter any more: the Contextual section (Open Link, the copy item) is gone
 * from this builder (FR-169). A right-click over a link opens the ONE Link menu instead
 * (`preview/preview-link-menu.ts`), never this one — `preview-link-menu.test.ts` pins its rows.
 */
const previewBodyMenu = (over: {
  selectionEmpty?: boolean;
  textSelection?: boolean;
  route?: 'standalone' | 'parented' | 'binary';
}): MenuAction[] =>
  previewContentMenu({
    selectionEmpty: over.selectionEmpty ?? false,
    content: over.textSelection === false ? null : { copyFormat: 'rich', copy: noop, selectAll: noop },
    editorRoute: over.route === 'binary' ? null : { parented: over.route === 'parented', run: noop },
    // 044 FR-122b — every text-provider preview carries Synchronise Scrolling; a binary one does not.
    syncScroll: over.route === 'binary' ? null : { on: false, toggle: noop },
  });

/*
 * 044 FR-122b — the editor content menu of an editor that offers a preview: Open Preview in Navigate
 * (§3) and Synchronise Scrolling closing View & state, after Word Wrap (§10).
 */
const editorMenuWithPreview = (syncOn = true): MenuAction[] =>
  editorContentMenu({
    view: {} as EditorView,
    panelId: 'p1',
    viewId: 'v1',
    lineEnding: () => 'lf',
    wordWrap: { on: true, toggle: noop, chord: 'Alt+Z' },
    gotoLine: { open: noop, chord: 'Ctrl+G' },
    openPreview: { affordance: editorAffordance(), open: noop },
    syncScroll: { on: syncOn, toggle: noop },
    languageName: 'Markdown',
  });

/*
 * 044 FR-003, FR-012, FR-062 — the Files & Folders file row with *Open In → Preview*, from the REAL
 * decision on the explorer surface, in each of its four states.
 */
const explorerAffordance = (over: { previewOpen?: boolean; enabled?: boolean; path?: string } = {}): PreviewAffordance => {
  const providerId = SHIPPED_PREVIEW_PROVIDERS.list()[0].id;
  return previewAffordance({
    registry: SHIPPED_PREVIEW_PROVIDERS,
    settings: {
      ...PREVIEW_SETTINGS,
      providers: {
        ...PREVIEW_SETTINGS.providers,
        [providerId]: { ...PREVIEW_SETTINGS.providers[providerId], enabled: over.enabled ?? true },
      },
    },
    absPath: over.path ?? 'D:/project/README.md',
    projectRoot: 'D:/project',
    isFolder: false,
    previewOpen: over.previewOpen ?? false,
    surface: 'explorer',
  });
};
const explorerFileWithPreview = (affordance: PreviewAffordance): MenuAction[] =>
  buildContextMenuItems({
    node: { relPath: 'README.md', kind: 'file' },
    selectedRelPaths: ['README.md'],
    clipboard: null,
    ops: explorerOps,
    openIn: [
      { label: 'Last Active Editor', icon: 'add', section: 'navigate', onClick: noop },
      { label: 'New Editor', icon: 'add', section: 'navigate', onClick: noop },
    ],
    preview: { affordance, open: noop },
    keybindings: DEFAULT_KEYBINDINGS,
    projectRoot: 'D:/project',
    undoState: { canUndo: false, canRedo: false },
  });

const TABLE: { name: string; build: () => MenuAction[] }[] = [
  { name: 'Files & Folders — file row', build: explorerFile },
  {
    name: 'Files & Folders — file row with Open In → Preview (044 FR-003)',
    build: () => explorerFileWithPreview(explorerAffordance()),
  },
  {
    name: 'Files & Folders — file row, Preview disabled while open (044 FR-012)',
    build: () => explorerFileWithPreview(explorerAffordance({ previewOpen: true })),
  },
  { name: 'Files & Folders — folder row', build: explorerFolder },
  { name: 'Files & Folders — folder row, Terminal enabled', build: explorerFolderWithTerminal },
  { name: 'Files & Folders — empty space (root)', build: explorerRoot },
  { name: 'Editor content menu', build: () => editorMenu('TypeScript') },
  { name: 'Editor content menu — language undetected', build: () => editorMenu(undefined) },
  {
    name: 'Editor content menu — offering a preview, Synchronise Scrolling on (044 FR-122b)',
    build: () => editorMenuWithPreview(true),
  },
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
        panelFailure: true,
      }),
  },
  {
    name: 'Panel header — editor panel offering Open Preview, with history (044 FR-002, FR-111)',
    build: () =>
      panelHeader({
        panel: panel({ kind: 'editor' }),
        editor: { dirty: false, hasFilePath: true },
        openPreview: editorAffordance(),
        history: { canGoBack: true, canGoForward: false },
      }),
  },
  {
    name: 'Panel header — editor offering a preview, banner up, sync on (044 FR-122b, 030 FR-042c)',
    build: () =>
      panelHeader({
        panel: panel({ kind: 'editor' }),
        editor: { dirty: true, hasFilePath: true },
        openPreview: editorAffordance(),
        panelFailure: true,
        syncScroll: true,
      }),
  },
  {
    name: 'Panel header — standalone text preview (044 FR-033)',
    build: () => panelHeader({ panel: previewPanel(), preview: textPreview(false) }),
  },
  {
    name: 'Panel header — parented text preview (044 FR-015d)',
    build: () => panelHeader({ panel: previewPanel(), preview: textPreview(true), detach: detachFixture }),
  },
  {
    name: 'Panel header — binary preview (044 FR-015e)',
    build: () => panelHeader({ panel: previewPanel(), preview: binaryPreview }),
  },
  {
    name: 'Panel header — preview with its failure banner up (044 FR-033, 030 FR-042c)',
    build: () => panelHeader({ panel: previewPanel(), preview: textPreview(false), panelFailure: true }),
  },
  {
    name: 'Panel header — terminal panel',
    build: () => panelHeader({ panel: panel({ kind: 'terminal' }) }),
  },
  {
    name: 'Panel header — with sub-workspaces to sync to',
    build: () => panelHeader({ panel: panel({ kind: 'terminal' }), detach: detachFixture }),
  },
  {
    /*
     * 043 FR-061 — the only shape this builder produces whose FIRST section is empty, and the reason
     * it is in the table rather than only in its own file.
     *
     * A Find in Files panel offers no Rename, which is its only `content` row, so the menu now opens
     * on `destroy`. That is exactly the case the derived-divider rule is easiest to get wrong on: a
     * builder that emitted a separator where a section USED to be would render a menu that opens on
     * a rule, and no assertion in `panel-header-zoom-menu.test.ts` — which reads labels — could see
     * it.
     */
    name: 'Panel header — Find in Files panel (its opening section is empty)',
    build: () => panelHeader({ panel: panel({ kind: 'findInFiles' }) }),
  },
  { name: 'Tab menu — main window', build: () => tabMenu(true) },
  { name: 'Tab menu — sub-workspace window', build: () => tabMenu(false) },
  { name: 'Terminal content menu — plain', build: () => terminalMenu({}) },
  { name: 'Terminal content menu — with a selection', build: () => terminalMenu({ selection: 'ls -al' }) },
  { name: 'Terminal content menu — start failure', build: () => terminalMenu({ startFailure: true }) },
  {
    name: 'Preview body menu — text selected, standalone (044 FR-035, FR-015b)',
    build: () => previewBodyMenu({ route: 'standalone' }),
  },
  {
    name: 'Preview body menu — nothing selected, parented (044 FR-015d)',
    build: () => previewBodyMenu({ selectionEmpty: true, route: 'parented' }),
  },
  { name: 'Cog menu', build: cogMenu },
  { name: 'Find in Files panel menu — idle', build: () => findInFilesMenu({}) },
  { name: 'Find in Files panel menu — scanning', build: () => findInFilesMenu({ running: true }) },
  {
    name: 'Find in Files panel menu — replace disclosed, commit wired',
    build: () => findInFilesMenu({ replaceEnabled: true, commit: true }),
  },
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
    // 043 FR-090 — the top-level Find in Files row that closed Navigate here MOVED into
    // Open In → Search. Moved, not duplicated: its absence is part of this shape, not an omission.
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
  it('a folder row: the whole eighteen-row shape, the subtree items closing Navigate', () => {
    // 043 FR-090 — nineteen rows until round five, when the top-level Find in Files row MOVED into
    // Open In → Search. The dividers do not move: it sat inside Navigate, so no boundary went with it.
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
 * 044 US2 fix round 1 (item 5) — the Files & Folders file row's Open In flyout with Preview
 * (contracts/menus-and-controls.md §5). `shapeOf` reads one level, so the flyout is pinned on its own:
 * Preview after the editor targets and before Terminal, OS File Explorer still first, and the top-level
 * shape untouched by its presence.
 */
describe('044 — Files & Folders Open In → Preview, in each of its four states (FR-003, FR-012, FR-062)', () => {
  const flyout = (items: MenuAction[]): MenuAction[] => items.find((i) => i.label === 'Open In')?.submenu ?? [];
  const preview = (items: MenuAction[]): MenuAction | undefined => flyout(items).find((i) => i.label === 'Preview');

  it('enabled: the flyout draws Preview between the editor targets and Terminal', () => {
    const items = explorerFileWithPreview(explorerAffordance());
    expect(shapeOf(flyout(items))).toEqual([
      'OS File Explorer',
      'Last Active Editor',
      'New Editor',
      'Preview',
      'Terminal',
      'Search',
    ]);
    expect(preview(items)?.section).toBe('navigate');
    expect(preview(items)?.disabled).toBe(false);
  });

  it('disabled `preview-open`: the same shape, Preview drawn disabled', () => {
    const affordance = explorerAffordance({ previewOpen: true });
    expect(affordance).toMatchObject({ state: 'disabled', reason: 'preview-open' });
    const items = explorerFileWithPreview(affordance);
    expect(shapeOf(flyout(items))).toEqual(['OS File Explorer', 'Last Active Editor', 'New Editor', 'Preview', 'Terminal', 'Search']);
    expect(preview(items)?.disabled).toBe(true);
  });

  it('disabled `provider-disabled`: the same shape, Preview drawn disabled', () => {
    const affordance = explorerAffordance({ enabled: false });
    expect(affordance).toMatchObject({ state: 'disabled', reason: 'provider-disabled' });
    const items = explorerFileWithPreview(affordance);
    expect(shapeOf(flyout(items))).toEqual(['OS File Explorer', 'Last Active Editor', 'New Editor', 'Preview', 'Terminal', 'Search']);
    expect(preview(items)?.disabled).toBe(true);
  });

  it('absent: no Preview row, and nothing else moves', () => {
    const affordance = explorerAffordance({ path: 'D:/project/notes.txt' });
    expect(affordance.state).toBe('absent');
    const items = explorerFileWithPreview(affordance);
    expect(shapeOf(flyout(items))).toEqual(['OS File Explorer', 'Last Active Editor', 'New Editor', 'Terminal', 'Search']);
  });

  it('the top-level file row is the same shape in every state — Preview lives only in the flyout', () => {
    const shapes = [
      explorerAffordance(),
      explorerAffordance({ previewOpen: true }),
      explorerAffordance({ enabled: false }),
      explorerAffordance({ path: 'D:/project/notes.txt' }),
    ].map((a) => shapeOf(explorerFileWithPreview(a)));
    for (const shape of shapes) expect(shape).toEqual(shapes[0]);
    expect(separatorIndices(explorerFileWithPreview(explorerAffordance()))).toEqual([6, 9, 11, 14]);
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
  it('an untyped panel: Rename · Destroy Panel · Send to Tab · Reset Name', () => {
    /*
     * 043 FR-062a — `Zoom` LEFT this shape, and the requirement is what removed it rather than a
     * tidy-up. The untyped placeholder has no zoom consumer: only `editor-panel.tsx` and
     * `terminal-panel.tsx` read `panelZoomLevel`, so all three commands moved a persisted integer
     * that nothing rendered. Constitution VI's disabled-versus-absent rule makes that absence, not a
     * greyed row, and `panel-header-zoom-menu.test.ts` holds the general correspondence.
     */
    expect(shapeOf(panelHeader({ panel: panel({}) }))).toEqual([
      'Rename',
      '—',
      'Destroy Panel',
      '—',
      'Send to Tab',
      '—',
      'Reset Name',
    ]);
  });

  it('a Find in Files panel: Destroy Panel · Send to Tab · Zoom — Content empty (FR-061)', () => {
    /*
     * The only shape in the table whose FIRST section is empty, which is why it is pinned: the
     * generic divider rule cannot tell a menu that lost its opening section from one that lost it
     * and kept a rule where it used to be, and a menu that opens on a divider is what that looks
     * like on screen.
     *
     * `Rename` is this kind's only Content row (FR-061 — the panel's identity is its query, so a
     * user-chosen name would hide it), and `Reset Name` was its only other View & state row. `Zoom`
     * stays, and that is FR-062a working in the POSITIVE direction: FR-062 gave this panel real
     * zoom, so offering the commands is now correct for exactly the reason offering them on the
     * untyped placeholder is not.
     */
    expect(shapeOf(panelHeader({ panel: panel({ kind: 'findInFiles' }) }))).toEqual([
      'Destroy Panel',
      '—',
      'Send to Tab',
      '—',
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
      // 046 iterate round 1 (FR-102/FR-105) — the shipped default moved from `Ctrl+Alt+=` to
      // `Ctrl+Alt++`; the same-binding rule (FR-105) still resolves the physical `=` key without
      // Shift to this chord, but this is the CANONICAL form `firstBinding` reports.
      ['Zoom In', 'Ctrl+Alt++'],
      ['Zoom Out', 'Ctrl+Alt+-'],
      ['Reset Zoom', 'Ctrl+Alt+Numpad0'],
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
      panelFailure: false,
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
      // 043 FR-015 — the panel's search commands close the Content group. They act on the panel's
      // TEXT, which is the same test that put Save and Revert here.
      'Find',
      'Replace',
      'Replace All',
      '—',
      // Destroy, alone, third — the same shape the Files & Folders menu has always had.
      'Destroy Panel',
      '—',
      // Navigate — the two reveal items exist only for a panel with a file behind it.
      'Reveal File in File Explorer',
      'Open in OS Explorer',
      // 044 FR-111 — Back and Forward on every editor, drawn DISABLED at the ends rather than hidden.
      // No Open Preview here: this fixture hands the builder no affordance, which is `absent`.
      'Back',
      'Forward',
      'Send to Tab',
      '—',
      // View & state — Reset Name has left Rename's side, where the constitution names it.
      'Reset Name',
      'Zoom',
    ]);
  });
});

/**
 * Find, Replace and Replace All reach the panel's own menu (043 FR-015).
 *
 * ══ THE GAP THIS CLOSES ══
 *
 * The constitution requires every discrete panel command to appear in the Panel's menu, and names
 * `search.find` / `search.replace` / `search.replaceAll` as pre-existing gaps to be closed by tracked
 * work. Until now the only way to reach any of them was a chord — so a user who had not read the key
 * bindings could not discover that a panel could search at all, and the panel's menu, which the
 * constitution calls its canonical index of what it can do, did not index them.
 *
 * ══ WHAT IS DELIBERATELY ABSENT ══
 *
 * Stepping through matches and closing the bar stay out: FR-015 exempts them as navigational input,
 * the same exemption scroll and column-select hold. And an UNTYPED panel gets none of the three —
 * there is nothing to search until it has a kind, which is why the untyped shape above is unchanged.
 */
describe('the panel menu indexes the panel’s search commands (043 FR-015)', () => {
  const labelsIn = (items: MenuAction[], section: MenuSection): string[] =>
    items.filter((i) => i.section === section).map((i) => i.label ?? '');

  it('an editor panel offers all three, in Content, after the file commands', () => {
    const items = panelHeader({
      panel: panel({ kind: 'editor' }),
      editor: { dirty: false, hasFilePath: true },
    });

    expect(labelsIn(items, 'content')).toEqual([
      'Rename',
      'Save',
      'Save As…',
      'Revert',
      'Reload from disk',
      'Find',
      'Replace',
      'Replace All',
    ]);
  });

  it('a terminal panel offers Find and nothing else — its find is read-only (FR-013)', () => {
    /*
     * The contrast that makes the row above a decision rather than a list. A terminal can search its
     * scrollback and cannot rewrite it, so offering Replace there would index a command the panel
     * does not have — and `search.replace`'s chord is already inert on a terminal.
     */
    const items = panelHeader({ panel: panel({ kind: 'terminal' }) });

    expect(labelsIn(items, 'content')).toEqual(['Rename', 'Find']);
    expect(items.map((i) => i.label)).not.toContain('Replace');
    expect(items.map((i) => i.label)).not.toContain('Replace All');
  });

  it('an untyped panel offers none of them', () => {
    const items = panelHeader({ panel: panel({}) });
    expect(labelsIn(items, 'content')).toEqual(['Rename']);
  });

  it('each one SHOWS its bound chord, and shows its own', () => {
    /*
     * FR-015 says "showing its bound chord", and `firstBinding` is what makes that the LIVE chord
     * rather than a string typed into the builder. Asserted per item, because "contains Ctrl" is
     * true of all three and would pass with Replace showing Find's binding.
     */
    const items = panelHeader({
      panel: panel({ kind: 'editor' }),
      editor: { dirty: false, hasFilePath: true },
    });

    expect(
      ['Find', 'Replace', 'Replace All'].map((l) => [
        l,
        items.find((i) => i.label === l)?.shortcut,
      ]),
    ).toEqual([
      ['Find', 'Ctrl+F'],
      ['Replace', 'Ctrl+H'],
      ['Replace All', 'Ctrl+Alt+Enter'],
    ]);
  });

  it('follows a REBIND, so the menu teaches the key the user actually has', () => {
    // The half that makes the assertion above evidence rather than a restatement of the defaults
    // table: a builder that hard-coded "Ctrl+F" passes it and lies to everyone who has rebound find.
    const rebound = {
      ...DEFAULT_KEYBINDINGS,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'search.find': ['Ctrl+Shift+K'] },
    };
    const items = panelHeaderMenu({
      panel: panel({ kind: 'editor' }),
      panelVerb: 'Destroy',
      keybindings: rebound,
      otherTabs: [],
      editor: { dirty: false, hasFilePath: false },
      panelFailure: false,
      detach: null,
      actions: panelActions,
    });

    expect(items.find((i) => i.label === 'Find')?.shortcut).toBe('Ctrl+Shift+K');
  });

  it('runs the panel’s OWN search commands', () => {
    /*
     * A menu item that builds correctly and calls nothing is the failure this catches. Each row is
     * clicked and the action it was given is the one that fires — which is also what proves the
     * three are three commands rather than one wired up three times.
     */
    const fired: string[] = [];
    const items = panelHeaderMenu({
      panel: panel({ kind: 'editor' }),
      panelVerb: 'Destroy',
      keybindings: DEFAULT_KEYBINDINGS,
      otherTabs: [],
      editor: { dirty: false, hasFilePath: false },
      panelFailure: false,
      detach: null,
      actions: {
        ...panelActions,
        find: () => fired.push('find'),
        replace: () => fired.push('replace'),
        replaceAll: () => fired.push('replaceAll'),
      },
    });

    for (const label of ['Find', 'Replace', 'Replace All']) {
      items.find((i) => i.label === label)?.onClick?.();
    }
    expect(fired).toEqual(['find', 'replace', 'replaceAll']);
  });
});

/*
 * 044 — the header-menu cluster (contracts/menus-and-controls.md §1–§2, plan Sequencing 6).
 *
 * Exact shapes, for the same reason the editor's is pinned above: `assertSectioned` would pass a
 * well-formed menu that put Open in Editor in View & state, or Refresh in Navigate.
 */
describe('an editor’s header gains Open Preview, Back and Forward in Navigate (044 FR-002, FR-111)', () => {
  const row = (items: MenuAction[], label: string): MenuAction | undefined =>
    items.find((i) => i.label === label);

  it('sits them after Open in OS Explorer and before Send to Tab, in that order', () => {
    const items = panelHeader({
      panel: panel({ kind: 'editor' }),
      editor: { dirty: false, hasFilePath: true },
      openPreview: editorAffordance(),
      history: { canGoBack: true, canGoForward: false },
    });
    expect(shapeOf(items)).toEqual([
      'Rename',
      'Save',
      'Save As…',
      'Revert',
      'Reload from disk',
      'Find',
      'Replace',
      'Replace All',
      '—',
      'Destroy Panel',
      '—',
      'Reveal File in File Explorer',
      'Open in OS Explorer',
      'Open Preview',
      'Back',
      'Forward',
      'Send to Tab',
      '—',
      'Reset Name',
      'Zoom',
      // 044 FR-122b — after Zoom, exactly where Open Preview is present (§2).
      'Synchronise Scrolling',
    ]);
  });

  it('draws Synchronise Scrolling after Zoom and before the banner items (044 FR-122b)', () => {
    const items = panelHeader({
      panel: panel({ kind: 'editor' }),
      editor: { dirty: true, hasFilePath: true },
      openPreview: editorAffordance(),
      panelFailure: true,
      syncScroll: true,
    });
    expect(shapeOf(items).slice(shapeOf(items).lastIndexOf('—') + 1)).toEqual([
      'Reset Name',
      'Zoom',
      'Synchronise Scrolling ✓',
      'Try again',
      'Copy details',
      'Clear panel type',
    ]);
    const sync = row(items, 'Synchronise Scrolling ✓');
    expect(sync?.section).toBe('viewState');
    expect(sync?.icon).toBe('syncScroll');
    expect(sync?.testId).toBe('menu-item-Synchronise Scrolling');
  });

  it('Synchronise Scrolling is present and ENABLED wherever Open Preview is drawn, and absent where it is not (FR-122a)', () => {
    const base = { panel: panel({ kind: 'editor' }), editor: { dirty: false, hasFilePath: true } };
    const sync = (items: MenuAction[]): MenuAction | undefined =>
      items.find((i) => i.testId === 'menu-item-Synchronise Scrolling');
    for (const [why, affordance] of [
      ['enabled', editorAffordance()],
      ['a preview is open', editorAffordance({ previewOpen: true })],
      ['the provider is off', editorAffordance({ enabled: false })],
    ] as const) {
      const item = sync(panelHeader({ ...base, openPreview: affordance }));
      expect(item, why).toBeDefined();
      expect(item?.disabled ?? false, why).toBe(false);
    }
    expect(sync(panelHeader({ ...base, openPreview: editorAffordance({ path: 'D:/project/a.ts' }) }))).toBeUndefined();
    expect(sync(panelHeader(base))).toBeUndefined();
    // Never on a terminal or an untyped panel.
    expect(sync(panelHeader({ panel: panel({ kind: 'terminal' }), syncScroll: true }))).toBeUndefined();
    expect(sync(panelHeader({ panel: panel({}), syncScroll: true }))).toBeUndefined();
  });

  it('draws Back and Forward enabled exactly where the history has an entry, with their live chords', () => {
    const items = panelHeader({
      panel: panel({ kind: 'editor' }),
      editor: { dirty: false, hasFilePath: true },
      history: { canGoBack: true, canGoForward: false },
    });
    expect(row(items, 'Back')?.disabled ?? false).toBe(false);
    expect(row(items, 'Forward')?.disabled).toBe(true);
    expect(row(items, 'Back')?.shortcut).toBe('Alt+ArrowLeft');
    expect(row(items, 'Forward')?.shortcut).toBe('Alt+ArrowRight');
    expect(row(items, 'Back')?.section).toBe('navigate');

    // No history known at all: both drawn, both disabled — never hidden (FR-104, FR-111).
    const none = panelHeader({ panel: panel({ kind: 'editor' }), editor: { dirty: false, hasFilePath: false } });
    expect(row(none, 'Back')?.disabled).toBe(true);
    expect(row(none, 'Forward')?.disabled).toBe(true);
  });

  it('Open Preview follows the affordance: enabled, disabled while one is open or the provider is off, absent otherwise', () => {
    const base = { panel: panel({ kind: 'editor' }), editor: { dirty: false, hasFilePath: true } };

    const enabled = row(panelHeader({ ...base, openPreview: editorAffordance() }), 'Open Preview');
    expect(enabled?.disabled ?? false).toBe(false);
    expect(enabled?.section).toBe('navigate');
    expect(enabled?.icon).toBe('preview');

    // FR-012 — the file already has its one preview.
    expect(row(panelHeader({ ...base, openPreview: editorAffordance({ previewOpen: true }) }), 'Open Preview')?.disabled).toBe(true);
    // FR-062 — the provider is disabled: drawn, and disabled.
    expect(row(panelHeader({ ...base, openPreview: editorAffordance({ enabled: false }) }), 'Open Preview')?.disabled).toBe(true);
    // FR-001/FR-004 — no provider claims the file: absent.
    expect(row(panelHeader({ ...base, openPreview: editorAffordance({ path: 'D:/project/a.ts' }) }), 'Open Preview')).toBeUndefined();
    expect(row(panelHeader(base), 'Open Preview')).toBeUndefined();
  });

  it('runs the actions it was given', () => {
    const fired: string[] = [];
    const items = panelHeaderMenu({
      panel: panel({ kind: 'editor' }),
      panelVerb: 'Destroy',
      keybindings: DEFAULT_KEYBINDINGS,
      otherTabs: [],
      editor: { dirty: false, hasFilePath: true },
      panelFailure: false,
      detach: null,
      openPreview: editorAffordance(),
      history: { canGoBack: true, canGoForward: true },
      actions: {
        ...panelActions,
        openPreview: () => fired.push('openPreview'),
        navigateBack: () => fired.push('navigateBack'),
        navigateForward: () => fired.push('navigateForward'),
        toggleSyncScroll: () => fired.push('toggleSyncScroll'),
      },
    });
    for (const label of ['Open Preview', 'Back', 'Forward', 'Synchronise Scrolling']) row(items, label)?.onClick?.();
    expect(fired).toEqual(['openPreview', 'navigateBack', 'navigateForward', 'toggleSyncScroll']);
  });
});

describe('a preview panel’s header menu draws exactly contracts/menus-and-controls.md §1 (044 FR-033)', () => {
  it('a standalone text preview: Close · Navigate with Open in Editor, Back, Forward · Refresh, Zoom, Synchronise Scrolling', () => {
    expect(shapeOf(panelHeader({ panel: previewPanel(), preview: textPreview(false) }))).toEqual([
      'Close Panel',
      '—',
      'Reveal File in File Explorer',
      'Open in OS Explorer',
      'Open in Editor',
      'Back',
      'Forward',
      'Send to Tab',
      '—',
      'Refresh',
      'Zoom',
      // 044 FR-122b — every text-provider preview (§1, §10).
      'Synchronise Scrolling',
    ]);
  });

  it('a parented text preview goes to its editor instead, and offers Sync to where the window can', () => {
    expect(
      shapeOf(panelHeader({ panel: previewPanel(), preview: textPreview(true), detach: detachFixture })),
    ).toEqual([
      'Close Panel',
      '—',
      'Reveal File in File Explorer',
      'Open in OS Explorer',
      'Go to Editor',
      'Back',
      'Forward',
      'Send to Tab',
      'Sync to',
      '—',
      'Refresh',
      'Zoom',
      'Synchronise Scrolling',
    ]);
  });

  it('a binary preview offers no route to an editor, and no Synchronise Scrolling (FR-015e, FR-122a)', () => {
    expect(shapeOf(panelHeader({ panel: previewPanel(), preview: binaryPreview, syncScroll: true }))).toEqual([
      'Close Panel',
      '—',
      'Reveal File in File Explorer',
      'Open in OS Explorer',
      'Back',
      'Forward',
      'Send to Tab',
      '—',
      'Refresh',
      'Zoom',
    ]);
  });

  it('its verb is Close whatever the ownership verb would be (011 FR-030)', () => {
    const labels = panelHeader({ panel: previewPanel(), preview: textPreview(false), panelVerb: 'Destroy' }).map(
      (i) => i.label,
    );
    expect(labels).toContain('Close Panel');
    expect(labels).not.toContain('Destroy Panel');
  });

  it('never presents Rename, Reset Name, Save, Save As…, Revert, Reload from disk or Find (FR-030, FR-033)', () => {
    const labels = panelHeader({ panel: previewPanel(), preview: textPreview(true), panelFailure: true }).map(
      (i) => i.label,
    );
    for (const absent of ['Rename', 'Reset Name', 'Save', 'Save As…', 'Revert', 'Reload from disk', 'Find', 'Replace', 'Replace All']) {
      expect(labels, absent).not.toContain(absent);
    }
  });

  it('carries Try again, Copy details and Clear panel type in View & state while its banner is up', () => {
    const items = panelHeader({ panel: previewPanel(), preview: textPreview(false), panelFailure: true });
    expect(shapeOf(items)).toEqual([
      'Close Panel',
      '—',
      'Reveal File in File Explorer',
      'Open in OS Explorer',
      'Open in Editor',
      'Back',
      'Forward',
      'Send to Tab',
      '—',
      'Refresh',
      'Zoom',
      // 044 FR-122b — after Zoom, before the banner items (maintainer's answer, §1).
      'Synchronise Scrolling',
      'Try again',
      'Copy details',
      'Clear panel type',
    ]);
  });

  it('Synchronise Scrolling is checked while on, carries the syncScroll icon and runs the toggle (FR-122b)', () => {
    const fired: string[] = [];
    const items = panelHeaderMenu({
      panel: previewPanel(),
      panelVerb: 'Destroy',
      keybindings: DEFAULT_KEYBINDINGS,
      otherTabs: [],
      editor: null,
      panelFailure: false,
      detach: null,
      preview: textPreview(true),
      syncScroll: true,
      actions: { ...panelActions, toggleSyncScroll: () => fired.push('toggleSyncScroll') },
    });
    const sync = items.find((i) => i.testId === 'menu-item-Synchronise Scrolling');
    expect(sync).toMatchObject({ label: 'Synchronise Scrolling ✓', icon: 'syncScroll', section: 'viewState' });
    expect(sync?.disabled ?? false).toBe(false);
    sync?.onClick?.();
    expect(fired).toEqual(['toggleSyncScroll']);
  });

  it('and none of them while it is not', () => {
    const labels = panelHeader({ panel: previewPanel(), preview: textPreview(false), panelFailure: false }).map(
      (i) => i.label,
    );
    for (const row of ['Try again', 'Copy details', 'Clear panel type']) expect(labels).not.toContain(row);
  });

  it('draws Back / Forward from the history, Refresh with its icon, and runs its own actions', () => {
    const fired: string[] = [];
    const items = panelHeaderMenu({
      panel: previewPanel(),
      panelVerb: 'Destroy',
      keybindings: DEFAULT_KEYBINDINGS,
      otherTabs: [],
      editor: null,
      panelFailure: false,
      detach: null,
      preview: textPreview(false),
      history: { canGoBack: false, canGoForward: true },
      actions: {
        ...panelActions,
        refreshPreview: () => fired.push('refreshPreview'),
        openInEditor: () => fired.push('openInEditor'),
        goToEditor: () => fired.push('goToEditor'),
        navigateBack: () => fired.push('navigateBack'),
        navigateForward: () => fired.push('navigateForward'),
        revealInTree: () => fired.push('revealInTree'),
        openInOsExplorer: () => fired.push('openInOsExplorer'),
        destroy: () => fired.push('destroy'),
      },
    });
    const find = (label: string): MenuAction | undefined => items.find((i) => i.label === label);
    expect(find('Back')?.disabled).toBe(true);
    expect(find('Forward')?.disabled ?? false).toBe(false);
    expect(find('Refresh')?.icon).toBe('refresh');
    expect(find('Open in Editor')?.icon).toBe('editorPanel');

    for (const label of ['Refresh', 'Open in Editor', 'Forward', 'Reveal File in File Explorer', 'Open in OS Explorer', 'Close Panel']) {
      find(label)?.onClick?.();
    }
    expect(fired).toEqual(['refreshPreview', 'openInEditor', 'navigateForward', 'revealInTree', 'openInOsExplorer', 'destroy']);

    const parented = panelHeaderMenu({
      panel: previewPanel(),
      panelVerb: 'Destroy',
      keybindings: DEFAULT_KEYBINDINGS,
      otherTabs: [],
      editor: null,
      panelFailure: false,
      detach: null,
      preview: textPreview(true),
      actions: { ...panelActions, goToEditor: () => fired.push('goToEditor') },
    });
    parented.find((i) => i.label === 'Go to Editor')?.onClick?.();
    expect(fired.at(-1)).toBe('goToEditor');
  });
});

/*
 * 046 US2 (FR-019) narrowed this describe's premise: the cog menu as a WHOLE is no longer one
 * section (the "T120" describe further below pins its full two-section shape and one divider — now
 * `[viewState, application]`, FR-074/FR-107, iterate round 1). What still holds, and is worth stating
 * on its own, is the `application` GROUP itself — the five preferences/diagnostic/about rows carry no
 * divider AMONG THEMSELVES, which FR-052/AS-5 were actually about. `cog()` is `cogMenu()` from this
 * file's own table fixture, not a fresh inline builder, so this block does not carry its own opinion
 * of `CogMenuActions`'s shape.
 */
describe('the cog menu’s Application section is one group, therefore no divider WITHIN it (FR-052 as corrected, AS-5)', () => {
  const cog = (): MenuAction[] => cogMenu();

  it('draws five Application items and nothing between them', () => {
    const application = cog().filter((i) => i.section === 'application');
    expect(application.map((i) => i.section)).toEqual(['application', 'application', 'application', 'application', 'application']);
    expect(separatorIndices(application)).toEqual([]);
  });

  it('keeps the test identifiers roughly ten preferences suites depend on (FR-053)', () => {
    expect(cog().filter((i) => i.section === 'application').map((i) => i.testId)).toEqual([
      'cog-menu-settings',
      'cog-menu-keybindings',
      'cog-menu-themes',
      'cog-menu-logs',
      'cog-menu-about',
    ]);
  });
});

/**
 * 045 T277 — the terminal's content menu carries no link row at all any more (FR-169): a right-click
 * over a link opens the ONE Link menu instead of this one, so this menu's shape no longer varies with
 * what the pointer is over. `links/link-menu.ts` and `links/open-link-or-panel-menu.ts` own that run
 * now, and `terminal-file-link-menu.test.ts` pins it.
 */
describe('the terminal content menu (AS-8)', () => {
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

/**
 * 045 T080 — the file-link run is ONE contextual section, in both content menus (FR-031).
 *
 * The pin exists for one reason: the run is six rows long and it is the first contextual section the
 * editor's menu has ever had, so the obvious mistake is to give it a section name of its own —
 * 'link', say — which would sort it somewhere else in every menu in the app and derive a divider
 * through the middle of it. `MENU_SECTION_ORDER` is the whole vocabulary and this run adds nothing
 * to it; what the shape below proves is that one divider sits between the run and Copy/Paste and
 * none sits inside it.
 */
describe('045 — the file-link run is one contextual section (FR-031, Principle VI)', () => {
  it('the editor content menu, with no link under the pointer, is unchanged', () => {
    expect(shapeOf(editorMenu())).toEqual([
      'Cut',
      'Copy',
      'Paste',
      'Select All',
      'Undo',
      'Redo',
      '—',
      'Go To Line…',
      '—',
      'Set Language…',
      'Word Wrap ✓',
    ]);
  });
});

/**
 * 045 T274 — the Link menu (FR-169) is its own menu, drawn through the same divider derivation as
 * every other: one contextual section, so NO divider inside it in any state. The content-menu pins
 * above describe the pre-FR-169 runs and move with T277, which removes those runs.
 */
describe('045 T274 — the Link menu draws no divider in any state (FR-169, Principle VI)', () => {
  const states = [
    { kind: 'file', inProject: true, executable: false, preview: 'enabled' },
    null,
    'pending',
  ] as const;
  for (const resolution of states) {
    it(`resolution ${resolution === null ? 'null' : typeof resolution === 'string' ? resolution : 'resolved'}`, () => {
      const items = buildLinkMenu({
        cls: 'onDevice',
        resolution,
        applicable: {
          inProjectByName: true,
          previewByExtension: 'enabled',
          executableByExtension: false,
          folderByGrammar: false,
        },
        openEditors: [{ id: 'e1', name: 'notes.md' }],
        openLink: noop,
      });
      const actions = items.map(
        (i): MenuAction => ({ label: i.label, section: i.section, onClick: noop }),
      );
      expect(separatorIndices(actions)).toEqual([]);
      for (const item of items) expect(MENU_SECTION_ORDER).toContain(item.section);
    });
  }
});

/*
 * 045 T167's editor-over-a-web-link shape pin is gone with the rows it pinned: FR-169 moved every link
 * action into the ONE Link menu, which opens INSTEAD of the content menu over a link (FR-171). The
 * content menu's own shape is pinned above; `editor-web-link-menu.test.ts` asserts the Link menu an
 * editor opens, and `terminal-file-link-menu.test.ts` its rows and sections.
 */

/*
 * 045 T277 — the preview body menu carries no link row at all any more (FR-169): a right-click over a
 * link opens the ONE Link menu instead of this one (`preview/preview-link-menu.ts`, built from core's
 * `buildLinkMenu` — the shape T274's describe above pins), so this menu's shape no longer varies with
 * what the pointer is over. `preview-link-menu.test.ts` pins the Link menu's own rows.
 */
describe('the preview body menu in full (044 FR-035, FR-035c, FR-015b, FR-015e)', () => {
  const labelsOf = (items: MenuAction[]): string[] =>
    withDividers(items).map((i) => (isSeparator(i) ? '—' : (i.label ?? '')));

  it('with text selected: Content (the three copies and Select All), then Navigate, then View & state', () => {
    expect(labelsOf(previewBodyMenu({ route: 'standalone' }))).toEqual([
      'Copy',
      'Copy as Rich Text',
      'Copy as Plain Text',
      'Select All',
      '—',
      'Open in Editor',
      // 044 FR-122b — the View & state section, last (§4, §10).
      '—',
      'Synchronise Scrolling',
    ]);
  });

  it('with nothing selected, parented: Content (disabled), then Navigate reads Go to Editor', () => {
    expect(labelsOf(previewBodyMenu({ selectionEmpty: true, route: 'parented' }))).toEqual([
      'Copy',
      'Copy as Rich Text',
      'Copy as Plain Text',
      'Select All',
      '—',
      'Go to Editor',
      '—',
      'Synchronise Scrolling',
    ]);
  });

  it('Synchronise Scrolling: checked while on, the syncScroll icon, its chord when bound, and the toggle once (FR-122b)', () => {
    const toggle = { calls: 0 };
    const build = (on: boolean, chord?: string): MenuAction[] =>
      previewContentMenu({
        selectionEmpty: true,
        syncScroll: { on, toggle: () => void (toggle.calls += 1), ...(chord !== undefined ? { chord } : {}) },
      });
    const on = build(true, 'Ctrl+Alt+F8');
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({
      label: 'Synchronise Scrolling ✓',
      testId: 'menu-item-Synchronise Scrolling',
      icon: 'syncScroll',
      section: 'viewState',
      shortcut: 'Ctrl+Alt+F8',
    });
    expect(build(false)[0]?.label).toBe('Synchronise Scrolling');
    expect(build(false)[0]?.shortcut).toBeUndefined();
    on[0]?.onClick?.();
    expect(toggle.calls).toBe(1);
  });

  it('the three copies are disabled while nothing is selected; Select All never is', () => {
    const items = previewBodyMenu({ selectionEmpty: true, route: 'standalone' });
    const state = (label: string): boolean | undefined => items.find((i) => i.label === label)?.disabled;
    expect(state('Copy')).toBe(true);
    expect(state('Copy as Rich Text')).toBe(true);
    expect(state('Copy as Plain Text')).toBe(true);
    expect(state('Select All') ?? false).toBe(false);
  });

  it('a binary provider with no selectable text draws neither Content nor Navigate', () => {
    expect(previewBodyMenu({ textSelection: false, route: 'binary' })).toEqual([]);
  });

  it('the icons are theme tokens: copy for the copies, selectAll, and editorPanel for the route', () => {
    const items = previewBodyMenu({ route: 'standalone' });
    expect(items.map((i) => [i.label, i.icon])).toEqual([
      ['Copy', 'copy'],
      ['Copy as Rich Text', 'copy'],
      ['Copy as Plain Text', 'copy'],
      ['Select All', 'selectAll'],
      ['Open in Editor', 'editorPanel'],
      ['Synchronise Scrolling', 'syncScroll'],
    ]);
  });
});

describe('the editor content menu closes with Synchronise Scrolling where it offers a preview (044 FR-122b)', () => {
  it('draws it after Word Wrap, in View & state, checked while on', () => {
    expect(shapeOf(editorMenuWithPreview(true))).toEqual([
      'Cut',
      'Copy',
      'Paste',
      'Select All',
      'Undo',
      'Redo',
      '—',
      'Go To Line…',
      'Open Preview',
      '—',
      'Set Language… (Markdown)',
      'Word Wrap ✓',
      'Synchronise Scrolling ✓',
    ]);
    expect(shapeOf(editorMenuWithPreview(false)).at(-1)).toBe('Synchronise Scrolling');
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
      panelFailure: false,
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


/*
 * 039 FR-024/FR-029 (#293) — Reload, for a dormant terminal Panel.
 *
 * Two things are being pinned. That the action HAS a menu item at all, which the constitution
 * requires of any panel action in the same increment that adds it — the placeholder's button is
 * such an action. And that it appears only while the Panel is dormant, because a command that is
 * always present but only sometimes meaningful is worse than one that comes and goes.
 */
describe('the dormant terminal Reload item (039 FR-024)', () => {
  const labels = (p: Parameters<typeof panel>[0]): string[] =>
    panelHeader({ panel: panel(p) }).map((i) => i.label);

  it('offers Reload while the Panel is dormant', () => {
    expect(labels({ kind: 'terminal', dormant: true })).toContain('Reload');
  });

  it('does NOT offer it on a running terminal', () => {
    expect(labels({ kind: 'terminal' })).not.toContain('Reload');
  });

  it('does NOT offer it on an untyped or editor Panel', () => {
    expect(labels({})).not.toContain('Reload');
    expect(labels({ kind: 'editor' })).not.toContain('Reload');
  });

  /*
   * FR-029 — dormancy is a state, not a failure. The failure items (Try again / Copy details /
   * Clear panel type) appear only for `panelFailure`, so a dormant Panel must show Reload
   * WITHOUT them. If Reload ever arrives beside them, dormancy has been routed through the failure
   * surfaces and the 'one condition, one notice' rule has been broken.
   */
  it('shows Reload without any failure item beside it (FR-029)', () => {
    const l = labels({ kind: 'terminal', dormant: true });
    expect(l).toContain('Reload');
    expect(l).not.toContain('Try again');
    expect(l).not.toContain('Copy details');
  });
});

/**
 * 046 iterate round 2 (T155, FR-113) — SUPERSEDES the round-1 block this replaces (T120, FR-074,
 * FR-107), which pinned a `[viewState, application]` cog with the Zoom row leading it. The
 * maintainer's own words, mid-build: "Remove the new 'Zoom' options from the menu." The cog is
 * pinned back to its single `application` section — the shape the 2026-09-09 audit (constitution
 * Principle VI) describes, and round 1 had temporarily widened.
 *
 * Zoom itself is unaffected: the chords still fire, and the panel header's own Zoom submenu
 * (`panel-header-zoom-menu.test.ts`) is untouched — only the cog's OWN Zoom row is gone, which is
 * `cog-zoom-row.test.ts`'s subject at the component layer.
 */
describe('046 T155 — the cog menu is back to a single [application] section, no viewState row (FR-113)', () => {
  it('no item is sectioned `viewState`, and none of the three zoom rows is drawn', () => {
    const items = cogMenu();
    expect(items.some((i) => i.section === 'viewState'), 'a viewState-sectioned row survived FR-113').toBe(false);
    for (const retired of ['Zoom', 'Zoom In', 'Zoom Out', 'Reset Zoom']) {
      expect(items.map((i) => i.label), retired).not.toContain(retired);
    }
  });

  it('the section order is exactly [application] — no divider at all', () => {
    const items = cogMenu();
    const seen = [...new Set(items.map((i) => i.section))];
    expect(seen).toEqual(['application']);
    assertSectioned(items, 'cog menu');
  });

  it('opens and closes on the same section — Application, throughout', () => {
    const items = cogMenu();
    expect(items[0]?.section).toBe('application');
    expect(items.at(-1)?.section).toBe('application');
  });
});

/**
 * 046 iterate round 1 (checkpoint 2026-09-24; T120, FR-081, FR-038, FR-111) — SUPERSEDES the block
 * this replaces (046 US4/US5, T061/T079), which pinned THREE unconditional Unload rows (`Unload` /
 * `Unload and Keep Terminals Running` / `Unload and End Terminals`) — still what
 * `project-menu.ts:61-80` actually builds today, so every Unload assertion below is RED until T128.
 *
 * Two rows now (contracts/menus.md §6): **Unload Project** always runs the LIVE preference
 * (`onUnload(undefined)`, exactly as the old plain `Unload` row did — `unload.md` §6 step 3, `variant
 * ?? settings.projects.unloadTerminalAction`), and one more row names whichever action the
 * preference does NOT pick, so the two rows are never the same command twice (006 FR-030). This adds
 * `defaultAction` to `ProjectMenuArgs` — the LIVE `projects.unloadTerminalAction` value — purely to
 * choose row 2's label and its explicit variant; nothing here changes `onUnload`'s own signature. Row
 * 2's label and its identifying `onClick` variant are pinned across BOTH preference values, since
 * "follows a live preference change on the next open" is a claim about two shapes, not one.
 *
 * `Move to Category ▸` is unaffected by this round and keeps its T081/US5 pin unchanged below.
 */
describe('046 T120 — the project row menu draws TWO Unload rows, following the live preference (contracts/menus.md §1, §6; FR-081, FR-038, FR-111)', () => {
  const SHAPE = (defaultAction: 'keepRunning' | 'endTerminals'): string[] => [
    'Edit',
    'Rename',
    '—',
    'Remove',
    '—',
    'Move to Category',
    'Unload Project',
    defaultAction === 'keepRunning'
      ? 'Unload Project and End Terminals'
      : 'Unload Project and Keep Terminals Running',
  ];
  const OTHER_ROW = (defaultAction: 'keepRunning' | 'endTerminals'): string =>
    defaultAction === 'keepRunning' ? 'Unload Project and End Terminals' : 'Unload Project and Keep Terminals Running';
  const OTHER_VARIANT = (defaultAction: 'keepRunning' | 'endTerminals'): 'keepRunning' | 'endTerminals' =>
    defaultAction === 'keepRunning' ? 'endTerminals' : 'keepRunning';

  async function build(opts: {
    loaded: boolean;
    defaultAction?: 'keepRunning' | 'endTerminals';
    onEdit?: () => void;
    onRename?: () => void;
    onRemove?: () => void;
    onUnload?: (variant?: 'keepRunning' | 'endTerminals') => void;
    categories?: { id: string; name: string }[];
    onMoveToCategory?: (categoryId: string) => void;
    onNewCategory?: () => void;
  }): Promise<MenuAction[]> {
    const { projectMenu } = await import('../../src/renderer/sidebar/project-menu.js');
    return projectMenu({
      loaded: opts.loaded,
      defaultAction: opts.defaultAction ?? 'keepRunning',
      onEdit: opts.onEdit ?? noop,
      onRename: opts.onRename ?? noop,
      onRemove: opts.onRemove ?? noop,
      onUnload: opts.onUnload ?? noop,
      categories: opts.categories ?? [],
      onMoveToCategory: opts.onMoveToCategory ?? noop,
      onNewCategory: opts.onNewCategory ?? noop,
    });
  }

  for (const defaultAction of ['keepRunning', 'endTerminals'] as const) {
    it(`with the project LOADED and the preference "${defaultAction}", exactly two Unload rows, both enabled`, async () => {
      const items = await build({ loaded: true, defaultAction });

      expect(shapeOf(items)).toEqual(SHAPE(defaultAction));
      assertSectioned(items, 'project menu');
      for (const label of ['Unload Project', OTHER_ROW(defaultAction)]) {
        expect(items.find((i) => i.label === label)?.disabled ?? false, label).toBe(false);
        expect(items.find((i) => i.label === label)?.section, label).toBe('viewState');
      }
    });

    it(`with the project NOT loaded and the preference "${defaultAction}", both rows are drawn but disabled (FR-038) — never absent`, async () => {
      const items = await build({ loaded: false, defaultAction });

      expect(shapeOf(items)).toEqual(SHAPE(defaultAction));
      for (const label of ['Unload Project', OTHER_ROW(defaultAction)]) {
        expect(items.find((i) => i.label === label)?.disabled, label).toBe(true);
      }
    });

    it(`"Unload Project" runs the live preference (no variant); the other row names and runs "${OTHER_VARIANT(defaultAction)}" explicitly — no dialog either way (FR-111)`, async () => {
      const onUnload = vi.fn();
      const items = await build({ loaded: true, defaultAction, onUnload });

      items.find((i) => i.label === 'Unload Project')?.onClick?.();
      expect(onUnload, 'Unload Project defers to the live preference, exactly as the old plain row did').toHaveBeenLastCalledWith(undefined);
      items.find((i) => i.label === OTHER_ROW(defaultAction))?.onClick?.();
      expect(onUnload).toHaveBeenLastCalledWith(OTHER_VARIANT(defaultAction));
    });
  }

  it('never draws the third, now-retired row ("Unload and Keep Terminals Running" / "Unload and End Terminals" as unconditional labels)', async () => {
    const items = await build({ loaded: true, defaultAction: 'keepRunning' });
    expect(items.filter((i) => i.label?.startsWith('Unload')).length, 'exactly two Unload rows').toBe(2);
  });

  it('Move to Category ▸ (FR-053) lists every category it is given, in order, then New Category…, carries the category icon, and never disables', async () => {
    const onMoveToCategory = vi.fn();
    const onNewCategory = vi.fn();
    const items = await build({
      loaded: true,
      categories: [
        { id: 'cat-a', name: 'Side Quests' },
        { id: 'cat-b', name: 'Someday' },
      ],
      onMoveToCategory,
      onNewCategory,
    });

    const moveTo = items.find((i) => i.label === 'Move to Category');
    expect(moveTo?.icon).toBe('category');
    expect(moveTo?.section).toBe('viewState');
    expect(moveTo?.disabled ?? false).toBe(false);
    expect(shapeOf(moveTo?.submenu ?? [])).toEqual(['Side Quests', 'Someday', 'New Category…']);
    assertSectioned(moveTo?.submenu ?? [], 'project menu → Move to Category');

    moveTo?.submenu?.find((i) => i.label === 'Side Quests')?.onClick?.();
    expect(onMoveToCategory).toHaveBeenCalledWith('cat-a');
    moveTo?.submenu?.find((i) => i.label === 'New Category…')?.onClick?.();
    expect(onNewCategory).toHaveBeenCalledTimes(1);
  });

  it('every item carries an icon token (Edit editVisual, Rename rename, Remove destroy, both Unload rows unload)', async () => {
    const items = await build({ loaded: true, defaultAction: 'keepRunning' });
    const iconOf = (label: string): string | undefined => items.find((i) => i.label === label)?.icon;

    expect(iconOf('Edit')).toBe('editVisual');
    expect(iconOf('Rename')).toBe('rename');
    expect(iconOf('Remove')).toBe('destroy');
    expect(iconOf('Unload Project')).toBe('unload');
    expect(iconOf('Unload Project and End Terminals')).toBe('unload');
  });

  it('Edit, Rename and Remove call their own collaborator and no other', async () => {
    const onEdit = vi.fn();
    const onRename = vi.fn();
    const onRemove = vi.fn();
    const items = await build({ loaded: true, onEdit, onRename, onRemove });

    items.find((i) => i.label === 'Edit')?.onClick?.();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onRename).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();

    items.find((i) => i.label === 'Rename')?.onClick?.();
    expect(onRename).toHaveBeenCalledTimes(1);

    items.find((i) => i.label === 'Remove')?.onClick?.();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

/**
 * 046 T079/T080, extended by iterate round 1 (checkpoint 2026-09-24; T120, FR-083) — the category
 * header's context menu (`category-menu.ts`, contracts/menus.md §2 and §6, FR-050, FR-053, FR-083).
 * A non-default header draws [content, destroy, **navigate**, viewState] as of this round — `navigate`
 * is NEW (`ORDER` in `menu-sections.ts` places it ahead of `viewState`), holding **Move Category Up**
 * and **Move Category Down**. Up is disabled on the first non-default category, Down on the last;
 * neither is drawn on the default category's menu, whatever its own reorder state — Principle VI's
 * absent-not-disabled rule again, the same reason Delete and Minimise are absent there. The default
 * header's own tests are UNCHANGED by this round; the shape and section pins for a NON-default header
 * are RED until T138, which does not exist yet (`category-menu.ts` builds no Move row today).
 *
 * `canMoveUp` / `canMoveDown` / `onMoveUp` / `onMoveDown` are this file's own guess at T138's
 * `CategoryMenuArgs` extension — plausible, not confirmed against `category-menu.ts`, which has no
 * such fields yet. The boundary WORDING ("first" / "last") is `projects-panel-category-menu.test.ts`
 * (T133)'s, at the component layer that actually computes position from a live category order; this
 * file only pins that the two booleans it is GIVEN reach the two rows' `disabled`.
 *
 * Minimise Category is the Word Wrap idiom (`content-menu.ts:217-218`): the checkmark lives in the
 * LABEL (`Minimise Category` / `Minimise Category ✓`) and the test id is pinned to the bare label so
 * it stays reachable while the state it reports changes.
 */
describe('046 T120 — the category header menu draws [content, destroy, navigate, viewState] (contracts/menus.md §2, §6, FR-050, FR-053, FR-083)', () => {
  async function build(opts: {
    isDefault: boolean;
    minimised: boolean;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    onRename?: () => void;
    onDelete?: () => void;
    onToggleMinimised?: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
  }): Promise<MenuAction[]> {
    const { categoryMenu } = await import('../../src/renderer/sidebar/category-menu.js');
    return categoryMenu({
      isDefault: opts.isDefault,
      minimised: opts.minimised,
      canMoveUp: opts.canMoveUp ?? true,
      canMoveDown: opts.canMoveDown ?? true,
      onRename: opts.onRename ?? noop,
      onDelete: opts.onDelete ?? noop,
      onToggleMinimised: opts.onToggleMinimised ?? noop,
      onMoveUp: opts.onMoveUp ?? noop,
      onMoveDown: opts.onMoveDown ?? noop,
    });
  }

  it('a non-default category draws Rename Category, Delete Category, Move Category Up/Down and Minimise Category, sectioned [content, destroy, navigate, viewState]', async () => {
    const items = await build({ isDefault: false, minimised: false });

    expect(shapeOf(items)).toEqual([
      'Rename Category',
      '—',
      'Delete Category',
      '—',
      'Move Category Up',
      'Move Category Down',
      '—',
      'Minimise Category',
    ]);
    assertSectioned(items, 'category menu (non-default)');
    expect(items.find((i) => i.label === 'Rename Category')?.section).toBe('content');
    expect(items.find((i) => i.label === 'Delete Category')?.section).toBe('destroy');
    expect(items.find((i) => i.label === 'Move Category Up')?.section).toBe('navigate');
    expect(items.find((i) => i.label === 'Move Category Down')?.section).toBe('navigate');
    expect(items.find((i) => i.label === 'Minimise Category')?.section).toBe('viewState');
  });

  it('Move Category Up is disabled on the first non-default category (canMoveUp false), Down stays enabled', async () => {
    const items = await build({ isDefault: false, minimised: false, canMoveUp: false, canMoveDown: true });
    expect(items.find((i) => i.label === 'Move Category Up')?.disabled).toBe(true);
    expect(items.find((i) => i.label === 'Move Category Down')?.disabled ?? false).toBe(false);
  });

  it('Move Category Down is disabled on the last non-default category (canMoveDown false), Up stays enabled', async () => {
    const items = await build({ isDefault: false, minimised: false, canMoveUp: true, canMoveDown: false });
    expect(items.find((i) => i.label === 'Move Category Up')?.disabled ?? false).toBe(false);
    expect(items.find((i) => i.label === 'Move Category Down')?.disabled).toBe(true);
  });

  it('the default category draws Rename Category ONLY — no divider — even when canMoveUp/canMoveDown are both true', async () => {
    const items = await build({ isDefault: true, minimised: false, canMoveUp: true, canMoveDown: true });

    expect(shapeOf(items)).toEqual(['Rename Category']);
    expect(items.find((i) => i.label === 'Delete Category')).toBeUndefined();
    expect(items.find((i) => i.label === 'Move Category Up')).toBeUndefined();
    expect(items.find((i) => i.label === 'Move Category Down')).toBeUndefined();
    expect(items.find((i) => i.label === 'Minimise Category')).toBeUndefined();
  });

  it('every item carries an icon token (Rename rename, Delete destroy, Move Up/Down moveUp/moveDown, Minimise collapse/expand)', async () => {
    const collapsed = await build({ isDefault: false, minimised: false });
    expect(collapsed.find((i) => i.label === 'Rename Category')?.icon).toBe('rename');
    expect(collapsed.find((i) => i.label === 'Delete Category')?.icon).toBe('destroy');
    expect(collapsed.find((i) => i.label === 'Move Category Up')?.icon).toBe('moveUp');
    expect(collapsed.find((i) => i.label === 'Move Category Down')?.icon).toBe('moveDown');
    expect(collapsed.find((i) => i.label === 'Minimise Category')?.icon).toBe('collapse');

    const expanded = await build({ isDefault: false, minimised: true });
    // The label itself carries the checkmark while minimised ("Minimise Category ✓", the Word Wrap
    // idiom below), so this looks it up by the STABLE test id rather than the exact label text.
    expect(expanded.find((i) => i.testId === 'menu-item-Minimise Category')?.icon).toBe('expand');
  });

  it('the Minimise Category label carries the checkmark while minimised, at a STABLE test id (the Word Wrap idiom)', async () => {
    const collapsed = await build({ isDefault: false, minimised: false });
    const row1 = collapsed.find((i) => i.label === 'Minimise Category');
    expect(row1?.testId ?? `menu-item-${row1?.label}`).toBe('menu-item-Minimise Category');

    const expanded = await build({ isDefault: false, minimised: true });
    const row2 = expanded.find((i) => i.label?.startsWith('Minimise Category'));
    expect(row2?.label).toBe('Minimise Category ✓');
    expect(row2?.testId).toBe('menu-item-Minimise Category');
  });

  it('Rename, Delete, the toggle and each Move row call their own collaborator and no other', async () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const onToggleMinimised = vi.fn();
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const items = await build({
      isDefault: false,
      minimised: false,
      onRename,
      onDelete,
      onToggleMinimised,
      onMoveUp,
      onMoveDown,
    });

    items.find((i) => i.label === 'Rename Category')?.onClick?.();
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(onToggleMinimised).not.toHaveBeenCalled();
    expect(onMoveUp).not.toHaveBeenCalled();
    expect(onMoveDown).not.toHaveBeenCalled();

    items.find((i) => i.label === 'Delete Category')?.onClick?.();
    expect(onDelete).toHaveBeenCalledTimes(1);

    items.find((i) => i.label === 'Move Category Up')?.onClick?.();
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).not.toHaveBeenCalled();

    items.find((i) => i.label === 'Move Category Down')?.onClick?.();
    expect(onMoveDown).toHaveBeenCalledTimes(1);

    items.find((i) => i.label === 'Minimise Category')?.onClick?.();
    expect(onToggleMinimised).toHaveBeenCalledTimes(1);
  });

  it('the default category still runs Rename', async () => {
    const onRename = vi.fn();
    const items = await build({ isDefault: true, minimised: false, onRename });

    items.find((i) => i.label === 'Rename Category')?.onClick?.();
    expect(onRename).toHaveBeenCalledTimes(1);
  });
});
