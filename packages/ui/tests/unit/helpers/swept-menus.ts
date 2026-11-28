/**
 * Every panel, sidebar, title-bar and notification menu throng builds, each built with every optional row switched on
 * and every command bound (`ALL_BOUND`). Shared by the two menu sweeps: menu-shortcuts.test.ts (every row shows its
 * key) and menu-placement.test.ts (every panel row sits on the menu of what it acts on). A new menu builder is added
 * here in the change that adds it.
 */
import {
  COMMAND_SCOPES,
  SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS,
  TERMINAL_PANEL_TOGGLES,
  firstBinding,
  pathForms,
  type ActionId,
  type FlavourOption,
  type Keybindings,
  type Panel,
  type PreviewAffordance,
} from '@throng/core';
import type { EditorView } from '@codemirror/view';
import type { MenuAction } from '../../../src/renderer/workspace/context-menu.js';
import { fixedShortcut, type FixedShortcut } from '../../../src/renderer/common/fixed-shortcut.js';
import { CLEAR_CELLS_SHORTCUT } from '../../../src/renderer/grid/grid-menu-items.js';
import { buildContextMenuItems } from '../../../src/renderer/explorer/context-menu-items.js';
import { editorContentMenu } from '../../../src/renderer/editor/content-menu.js';
import { panelHeaderMenu, type PanelHeaderMenuArgs } from '../../../src/renderer/workspace/panel-header-menu.js';
import { tabContextMenu } from '../../../src/renderer/workspace/tab-menu.js';
import { splitMenuItems } from '../../../src/renderer/workspace/split-menu.js';
import { terminalContentMenu } from '../../../src/renderer/terminal/terminal-content-menu.js';
import { cogMenuItems } from '../../../src/renderer/title-bar/cog-menu-items.js';
import { findInFilesContentMenu } from '../../../src/renderer/find-in-files/content-menu.js';
import { previewContentMenu } from '../../../src/renderer/preview/content-menu.js';
import { csvGridMenu, type CsvGridMenuArgs } from '../../../src/renderer/preview/providers/csv/csv-menu.js';
import { spreadsheetMenu } from '../../../src/renderer/preview/providers/spreadsheet/spreadsheet-menu.js';
import { projectMenu } from '../../../src/renderer/sidebar/project-menu.js';
import { categoryMenu } from '../../../src/renderer/sidebar/category-menu.js';
import { buildEntryMenu, buildPanelMenu, DISMISS_SHORTCUT } from '../../../src/renderer/notifications/notifications-menu.js';
import { linkMenuActions } from '../../../src/renderer/links/link-menu.js';
import type { GridSelection } from '../../../src/renderer/grid/grid-selection.js';

export const noop = (): void => {};

/** Every command bound, each to a chord no other command shares, so a row's key names its command. */
export const ALL_BOUND: Keybindings = {
  version: 1,
  bindings: Object.fromEntries(
    (Object.keys(COMMAND_SCOPES) as ActionId[]).map((id, i) => [id, [`Ctrl+Shift+Alt+Key${i}`]]),
  ),
};
export const bound = (id: ActionId): string => firstBinding(ALL_BOUND, id)!;

export const FIXED_KEYS: readonly FixedShortcut[] = ['cut', 'copy', 'paste', 'selectAll', 'undo', 'redo'];

/** What a shown key may be: a live binding, or a key a surface handles itself (rule 4). */
export const SHOWABLE = new Set<string>([
  ...(Object.keys(COMMAND_SCOPES) as ActionId[]).map(bound),
  ...FIXED_KEYS.map((k) => fixedShortcut(k)),
  CLEAR_CELLS_SHORTCUT,
  DISMISS_SHORTCUT,
]);

/* ── Fixtures: every optional row switched on ─────────────────────────────────────────────────────── */

export const FLAVOURS: readonly FlavourOption[] = [{ value: 'bash', label: 'Bash', defaultShellArguments: '' }];
export const markdown = SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS.find((p) => p.id === 'markdown')!;
export const AFFORDANCE: PreviewAffordance = { state: 'enabled', provider: markdown };
export const FORMS = pathForms('/project', 'src/app.ts');

export const explorerOps = {
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
  expandChildren: noop,
  collapseChildren: noop,
  findInFiles: noop,
  properties: noop,
  openInTerminal: noop,
  openInDefaultProgram: noop,
  excludeFromSearch: noop,
};

export const explorer = (kind: 'file' | 'folder', relPath: string): MenuAction[] =>
  buildContextMenuItems({
    node: { relPath, kind },
    selectedRelPaths: [relPath],
    clipboard: { mode: 'copy', relPaths: ['src/other.ts'] },
    ops: explorerOps,
    openIn: [{ label: 'New Editor', icon: 'add', section: 'navigate', onClick: noop }],
    keybindings: ALL_BOUND,
    projectRoot: '/project',
    undoState: { canUndo: true, canRedo: true },
    flavours: FLAVOURS,
    preview: { affordance: AFFORDANCE, openLastActive: noop, openNew: noop, lastPreviewTitle: null },
  });

export const fold = (collapsed: boolean) => ({
  section: { slug: 'a', level: 2 as const, collapsed },
  hasSections: true,
  collapseSection: noop,
  expandSection: noop,
  collapseAllInside: noop,
  expandAllInside: noop,
  collapseAll: noop,
  expandAll: noop,
  chords: {
    collapseSection: bound('markdown.collapseSection'),
    expandSection: bound('markdown.expandSection'),
    collapseAllInside: bound('markdown.collapseAllInside'),
    expandAllInside: bound('markdown.expandAllInside'),
    collapseAll: bound('markdown.collapseAll'),
    expandAll: bound('markdown.expandAll'),
  },
});

export const editor = (collapsed: boolean): MenuAction[] =>
  editorContentMenu({
    view: {} as EditorView,
    panelId: 'p1',
    viewId: 'v1',
    lineEnding: () => 'lf',
    wordWrap: { on: true, toggle: noop, chord: bound('editor.toggleWordWrap') },
    whitespace: { on: false, toggle: noop, chord: bound('editor.toggleWhitespace') },
    gotoLine: { open: noop, chord: bound('navigate.gotoLine') },
    search: {
      find: noop,
      replace: noop,
      replaceAll: noop,
      chords: { find: bound('search.find'), replace: bound('search.replace'), replaceAll: bound('search.replaceAll') },
    },
    markdownFold: fold(collapsed),
  });

/** v1 review (#732) — the editor's format rows, on its title menu now. */
export const EDITOR_FORMAT: NonNullable<PanelHeaderMenuArgs['editorFormat']> = {
  panelId: 'p1',
  languageName: 'Markdown',
  resetLanguage: { enabled: true, reset: noop },
  encoding: {
    current: { encoding: 'utf8', hasBom: false },
    canReopen: true,
    change: noop,
    openReopenPicker: noop,
    chords: { reopen: bound('editor.reopenWithEncoding') },
    changeChord: bound('editor.changeEncoding'),
  },
  lineEndings: {
    lineEnding: 'lf',
    mixed: false,
    convert: noop,
    chords: {
      lf: bound('editor.convertLineEndingsToLf'),
      cr: bound('editor.convertLineEndingsToCr'),
      crlf: bound('editor.convertLineEndingsToCrlf'),
    },
    insert: {
      insert: noop,
      chords: {
        lf: bound('editor.insertLineBreakLf'),
        cr: bound('editor.insertLineBreakCr'),
        crlf: bound('editor.insertLineBreakCrlf'),
      },
    },
  },
};

export const panelActions: PanelHeaderMenuArgs['actions'] = new Proxy({} as PanelHeaderMenuArgs['actions'], { get: () => noop });
export const panel = (over: Partial<Panel>): Panel => ({ type: 'panel', id: 'p1', originProjectId: 'proj', title: 'Panel 1', ...over });
export const header = (over: Partial<PanelHeaderMenuArgs>): MenuAction[] =>
  panelHeaderMenu({
    panel: panel({}),
    panelVerb: 'Destroy',
    keybindings: ALL_BOUND,
    otherTabs: [{ id: 't2', title: 'Tab 2' }],
    editor: null,
    panelFailure: true,
    detach: {
      subWorkspaces: [{ id: 's1', name: 'Sub One', alreadyHasPanel: false, tabs: [{ id: 't9', title: 'Tab 9' }] }],
      detachToNew: noop,
      syncToExisting: noop,
    },
    history: { canGoBack: true, canGoForward: true },
    maximise: { maximised: false, toggle: noop },
    actions: panelActions,
    ...over,
  });
export const PREVIEW_PANEL = panel({ kind: 'preview', config: { filePath: '/project/README.md' } });

export const preview = (over: Partial<Parameters<typeof previewContentMenu>[0]>): MenuAction[] =>
  previewContentMenu({
    selectionEmpty: false,
    content: { copyFormat: 'rich', copy: noop, selectAll: noop },
    find: { run: noop, chord: bound('search.find') },
    goToHeading: { run: noop, chord: bound('preview.goToHeading') },
    ...over,
  });

export const toggle = { on: true, onToggle: noop };
export const GRID_TOGGLES = { wrap: toggle, lockFirstRow: toggle, lockFirstColumn: toggle };
export const gridSel: GridSelection = { active: { row: 0, col: 0 }, anchor: { row: 0, col: 0 } } as GridSelection;
export const csv = (target: CsvGridMenuArgs['target'], copied: CsvGridMenuArgs['copied']): MenuAction[] =>
  csvGridMenu({
    target,
    sel: target.kind === 'row' ? { ...gridSel, rows: true } : gridSel,
    range: { top: 0, bottom: 1, left: 0, right: 1 },
    rowCount: 5,
    colCount: 5,
    copied,
    keybindings: ALL_BOUND,
    cellDialogAvailable: true,
    toggles: GRID_TOGGLES,
    // Every action present.
    actions: new Proxy({} as CsvGridMenuArgs['actions'], { get: () => noop }),
  });
export const sheet = (target: CsvGridMenuArgs['target']): MenuAction[] =>
  spreadsheetMenu({ target, keybindings: ALL_BOUND, toggles: GRID_TOGGLES, actions: { copy: noop, selectAll: noop, goToRow: noop, columnWidth: noop, resetWidth: noop } });

export const MENUS: readonly { name: string; build: () => MenuAction[] }[] = [
  { name: 'Explorer file', build: () => explorer('file', 'src/app.ts') },
  { name: 'Explorer folder', build: () => explorer('folder', 'src') },
  { name: 'Explorer root', build: () => explorer('folder', '') },
  { name: 'Editor', build: () => editor(false) },
  { name: 'Editor', build: () => editor(true) },
  { name: 'Panel header', build: () => header({}) },
  {
    name: 'Panel header',
    build: () =>
      header({ panel: panel({ kind: 'editor' }), editor: { dirty: true, hasFilePath: true }, openPreview: AFFORDANCE, syncScroll: true, copyPath: FORMS, editorFormat: EDITOR_FORMAT }),
  },
  { name: 'Panel header', build: () => header({ panel: panel({ kind: 'editor' }), editor: { dirty: true, hasFilePath: true }, maximise: { maximised: true, toggle: noop } }) },
  {
    name: 'Panel header',
    build: () =>
      header({
        panel: panel({ kind: 'terminal' }),
        terminalToggles: TERMINAL_PANEL_TOGGLES.map((t) => ({ label: t.label, icon: t.icon, on: true, chord: bound(t.command), toggle: noop })),
      }),
  },
  { name: 'Panel header', build: () => header({ panel: panel({ kind: 'findInFiles' }) }) },
  // A marked panel: its Flag row reads Unflag.
  { name: 'Panel header', build: () => header({ panel: panel({ kind: 'findInFiles' }), flagged: true }) },
  {
    name: 'Panel header',
    build: () => header({ panel: PREVIEW_PANEL, preview: { providerKind: 'text', parented: true, scrollSync: true, printable: true, hasFilePath: true }, syncScroll: true, copyPath: FORMS }),
  },
  {
    name: 'Panel header',
    build: () =>
      header({
        panel: PREVIEW_PANEL,
        // The CSV Preview Editor: a text provider that edits its file, so Save and Save As… are drawn.
        preview: { providerKind: 'text', parented: false, scrollSync: true, printable: true, hasFilePath: true, cellDialog: { on: true }, editable: true },
      }),
  },
  { name: 'Panel header', build: () => header({ panel: PREVIEW_PANEL, preview: { providerKind: 'binary', parented: false, printable: true } }) },
  {
    name: 'Tab',
    build: () =>
      tabContextMenu({
        tabId: 't1',
        destroyTabDisabled: false,
        destroyOthersDisabled: false,
        detach: { subWorkspaces: [{ id: 's1', name: 'Sub One' }], detachToNew: noop, syncToExisting: noop },
        keybindings: ALL_BOUND,
        actions: { rename: noop, destroyTab: noop, destroyOthers: noop },
      }),
  },
  { name: 'Split button', build: () => splitMenuItems('p1', ALL_BOUND, noop) },
  {
    name: 'Terminal',
    build: () =>
      terminalContentMenu({
        selection: 'ls',
        findChord: bound('search.find'),
        actions: { copySelection: noop, paste: noop, find: noop },
      }),
  },
  {
    name: 'Cog',
    build: () => cogMenuItems({ openPreferences: noop, openLogs: noop, openResourceMonitor: noop, openAbout: noop, openHelp: noop, keybindings: ALL_BOUND }),
  },
  {
    name: 'Find in Files',
    build: () =>
      findInFilesContentMenu({
        replaceEnabled: true,
        actions: { setAllCollapsed: noop, excludeFromSearch: noop },
        commit: { replaceAll: noop, replaceInFile: noop, replaceMatch: noop, target: { relPath: 'src/app.ts' } },
        openIn: {
          targets: [{ kind: 'new', label: 'New Editor', disabled: false }],
          pick: noop,
          preview: { affordance: AFFORDANCE, lastPreviewTitle: null },
          pickPreview: noop,
        },
      }),
  },
  { name: 'Preview body', build: () => preview({ fold: fold(false) }) },
  { name: 'Preview body', build: () => preview({ fold: fold(true) }) },
  {
    name: 'Preview body',
    build: () =>
      preview({
        flowingDocument: false,
        goToHeading: { run: noop, chord: bound('preview.goToHeading'), kind: 'page' },
        pageLayout: { value: 'single', set: noop },
        diagram: { inFocus: false, copyImage: noop, toggleFocus: noop, focusChord: bound('panel.toggleMaximise') },
      }),
  },
  { name: 'Preview body', build: () => preview({ diagram: { inFocus: true, copyImage: noop, toggleFocus: noop, focusChord: bound('panel.toggleMaximise'), picture: true } }) },
  { name: 'CSV cell', build: () => csv({ kind: 'cell', row: 0, col: 0 }, null) },
  { name: 'CSV row header', build: () => csv({ kind: 'row', row: 0 }, { kind: 'rows', values: [['a']], text: 'a' }) },
  { name: 'CSV column header', build: () => csv({ kind: 'column', col: 0 }, { kind: 'columns', values: [['a']], text: 'a' }) },
  { name: 'CSV corner', build: () => csv({ kind: 'corner' }, null) },
  { name: 'Spreadsheet cell', build: () => sheet({ kind: 'cell', row: 0, col: 0 }) },
  { name: 'Spreadsheet column header', build: () => sheet({ kind: 'column', col: 0 }) },
  { name: 'Spreadsheet corner', build: () => sheet({ kind: 'corner' }) },
  {
    name: 'Project',
    build: () =>
      projectMenu({
        loaded: true,
        defaultAction: 'keepRunning',
        onEdit: noop,
        onRename: noop,
        onRemove: noop,
        onUnload: noop,
        categories: [{ id: 'c1', name: 'Work' }],
        onMoveToCategory: noop,
        onNewCategory: noop,
        nextMarked: { run: noop },
        rootFolder: '/project',
        onOpenInOsExplorer: noop,
        copyPath: noop,
      }),
  },
  {
    name: 'Category',
    build: () =>
      categoryMenu({ isDefault: false, minimised: false, canMoveUp: true, canMoveDown: true, onRename: noop, onDelete: noop, onToggleMinimised: noop, onMoveUp: noop, onMoveDown: noop }),
  },
  { name: 'Notifications panel', build: () => buildPanelMenu({ order: 'newest', onSetOrder: noop, onDismissAll: noop, minimised: false, onToggleMinimise: noop, hasEntries: true }) },
  {
    name: 'Notification',
    build: () =>
      buildEntryMenu({
        entry: { id: 'n1' } as Parameters<typeof buildEntryMenu>[0]['entry'],
        actions: [{ kind: 'openFile', label: 'Open File', path: '/project/a.ts' } as Parameters<typeof buildEntryMenu>[0]['actions'][number]],
        onCopy: noop,
        onDismiss: noop,
        onRun: noop,
      }),
  },
  {
    name: 'Link',
    build: () =>
      linkMenuActions(
        {
          cls: 'onDevice',
          applicable: { inProjectByName: true, previewByExtension: 'enabled', executableByExtension: false, folderByGrammar: false },
          openEditors: [{ id: 'e1', name: 'notes.md' }],
          chord: bound('preview.followLink'),
          openLink: noop,
          copyLink: noop,
        },
        { kind: 'file', inProject: true, executable: false, preview: 'enabled' },
      ),
  },
];
