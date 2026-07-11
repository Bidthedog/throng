/**
 * Application settings (FR-031/032, data-model §2). A sectioned, user-scoped
 * document. Pure schema + defaults + tolerant parse/merge/validate — a malformed
 * document resolves to defaults rather than throwing (research D1). No OS/DOM.
 */
import { DEFAULT_EXCLUDE_GLOBS } from '../explorer/exclude.js';
import type { DragModifierKey } from '../explorer/drag.js';

/** Confirmation depth for a destroy action: none / single / double (wry second). */
export type ConfirmLevel = 'none' | 'single' | 'double';

/** File-tree open trigger: single click (default) or double click (004, FR-027). */
export type OpenMode = 'single' | 'double';

/** File delete behaviour: OS Recycle Bin (default, recoverable) or permanent (004, FR-018). */
export type DeleteMode = 'recycle' | 'permanent';

/** File Explorer tree preferences (004, contracts/config-additions.md). */
export interface ExplorerSettings {
  openMode: OpenMode;
  deleteMode: DeleteMode;
  /** Globs hiding entries by root-relative path; default = VS Code files.exclude. */
  excludeGlobs: string[];
  /** Drag modifier that copies (default Ctrl, Windows-style) (006, FR-095). */
  dragCopyModifier: DragModifierKey;
  /** Drag modifier that forces move (default Shift) (006, FR-095). */
  dragMoveModifier: DragModifierKey;
}

/** A user-defined terminal flavour (005 Phase B, settings.terminals.flavours). */
export interface TerminalFlavourConfig {
  id: string;
  label: string;
  /** Executable path or command. */
  file: string;
  /** Base args inherent to launching it (before user Startup Params). */
  args: string[];
  /** Default Startup Params pre-filled when this flavour is chosen. */
  defaultParams: string;
}

/** Terminal preferences (005 Phase B, contracts/config-additions.md). */
export interface TerminalSettings {
  /** User-defined flavours, shown in the Flavour dropdown alongside built-ins. */
  flavours: TerminalFlavourConfig[];
  /** Built-in flavour ids to hide from the dropdown. */
  disabledBuiltins: string[];
  /** Per-flavour-id Startup Params override (wins over the catalogue default). */
  defaultParams: Record<string, string>;
}

/** File-tree click that opens a file into the last active editor (006, FR-009). */
export type EditorOpenOnClick = 'single' | 'double' | 'none';

/** Scope a `Ctrl+Shift+S` Save-All covers (006, FR-023). */
export type SaveAllScopeSetting = 'tab' | 'project' | 'all';

/** New-document line-ending style (006, FR-026a). */
export type DefaultLineEnding = 'lf' | 'crlf' | 'cr';

/** How an editor pill shows a document's identity (006, FR-088): the fully-qualified
 *  path, or just the file name. Chosen separately for project- and sub-workspace-
 *  owned editors. */
export type EditorPathDisplay = 'full' | 'name';

/** Editor panel preferences (006, contracts/config-additions.md). */
export interface EditorSettings {
  /** How a file-tree click opens into the last active editor. */
  openOnClick: EditorOpenOnClick;
  /** Write on edit-settle without an explicit Ctrl+S. */
  autoSave: boolean;
  /** Debounce (ms) after typing stops before an auto-save writes (FR-060). */
  autoSaveDebounceMs: number;
  /** Default scope of a Ctrl+Shift+S Save-All. */
  saveAllScope: SaveAllScopeSetting;
  /** Line ending applied to brand-new documents. */
  defaultLineEnding: DefaultLineEnding;
  /** Files larger than this (bytes) report "too large" instead of opening (FR-062). */
  maxOpenFileBytes: number;
  /** Project-owned editor pill: full (project-relative) path, or just the name (FR-088). */
  projectPathDisplay: EditorPathDisplay;
  /** Sub-workspace-owned editor pill: full (absolute) path, or just the name (FR-088). */
  subWorkspacePathDisplay: EditorPathDisplay;
  /** Show the "Cannot open file" popup when an editor's file is missing/deleted
   *  (FR-105). When false, missing-file editors restore silently. */
  warnOnMissingFile: boolean;
}

/** Where the new-project folder picker opens (011, FR-041). */
export type StartingFolderMode = 'profile' | 'lastViewed' | 'override';

/** New-project folder-picker preferences (011, US3). `lastProjectFolder` is
 *  internal bookkeeping (the folder last chosen for a project) — not surfaced in
 *  the settings editor; see SETTINGS_INTERNAL_KEYS. */
export interface NewProjectSettings {
  /** Which folder the picker opens at. Default 'lastViewed'. */
  startingFolder: StartingFolderMode;
  /** The fixed override folder used when startingFolder === 'override'. */
  overridePath: string;
  /** INTERNAL: the folder last chosen for a project (drives 'lastViewed'). */
  lastProjectFolder: string;
}

const STARTING_FOLDER_MODES: readonly StartingFolderMode[] = ['profile', 'lastViewed', 'override'];

const CONFIRM_LEVELS: readonly ConfirmLevel[] = ['none', 'single', 'double'];
const EDITOR_OPEN_ON_CLICK: readonly EditorOpenOnClick[] = ['single', 'double', 'none'];
const SAVE_ALL_SCOPES: readonly SaveAllScopeSetting[] = ['tab', 'project', 'all'];
const LINE_ENDINGS: readonly DefaultLineEnding[] = ['lf', 'crlf', 'cr'];
const PATH_DISPLAYS: readonly EditorPathDisplay[] = ['full', 'name'];

export interface PaneState {
  /** User-configurable maximum width (px) the pane can be dragged to. */
  maxWidth: number;
}

/** Default maximum widths (px) for the side panes; overridable per pane in settings.
 *  The File Explorer gets a roomier default than Projects. */
export const DEFAULT_PROJECTS_MAX_WIDTH = 400;
export const DEFAULT_EXPLORER_MAX_WIDTH = 700;

export interface AppSettings {
  version: number;
  appearance: { theme: string };
  confirmations: {
    destroyProject: ConfirmLevel;
    destroyTab: ConfirmLevel;
    destroyPanel: ConfirmLevel;
    destroySubWorkspace: ConfirmLevel;
  };
  /** Per-pane config. Visibility is not stored here — it is a live per-window
   *  preference (Projects shown by default; Files & Folders only inside a project). */
  panes: {
    projects: PaneState;
    fileExplorer: PaneState;
  };
  behaviour: {
    /** Hover-over-a-tab dwell (ms) during a panel drag before it activates (FR-023). */
    tabHoverActivateMs: number;
    /** Hover dwell (ms) before a context-menu submenu opens (global, all menus). */
    submenuHoverMs: number;
  };
  /** File Explorer tree preferences (004). */
  explorer: ExplorerSettings;
  /** Terminal preferences (005 Phase B). */
  terminals: TerminalSettings;
  /** Editor panel preferences (006). */
  editor: EditorSettings;
  /** New-project folder-picker preferences (011). */
  newProject: NewProjectSettings;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 1,
  appearance: { theme: 'throng' },
  confirmations: {
    destroyProject: 'double',
    destroyTab: 'double',
    destroyPanel: 'double',
    destroySubWorkspace: 'double',
  },
  panes: {
    projects: { maxWidth: DEFAULT_PROJECTS_MAX_WIDTH },
    fileExplorer: { maxWidth: DEFAULT_EXPLORER_MAX_WIDTH },
  },
  behaviour: {
    tabHoverActivateMs: 600,
    submenuHoverMs: 100,
  },
  explorer: {
    openMode: 'single',
    deleteMode: 'recycle',
    excludeGlobs: [...DEFAULT_EXCLUDE_GLOBS],
    dragCopyModifier: 'ctrl',
    dragMoveModifier: 'shift',
  },
  terminals: {
    flavours: [],
    disabledBuiltins: [],
    defaultParams: {},
  },
  editor: {
    openOnClick: 'single',
    autoSave: false,
    autoSaveDebounceMs: 300,
    saveAllScope: 'project',
    defaultLineEnding: 'lf',
    maxOpenFileBytes: 10485760,
    projectPathDisplay: 'full',
    subWorkspacePathDisplay: 'full',
    warnOnMissingFile: true,
  },
  newProject: {
    startingFolder: 'lastViewed',
    overridePath: '',
    lastProjectFolder: '',
  },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function confirmLevel(v: unknown, fallback: ConfirmLevel): ConfirmLevel {
  return CONFIRM_LEVELS.includes(v as ConfirmLevel) ? (v as ConfirmLevel) : fallback;
}

function paneState(v: unknown, fallback: PaneState): PaneState {
  if (!isRecord(v)) return { ...fallback };
  const maxWidth = typeof v.maxWidth === 'number' && v.maxWidth > 0 ? v.maxWidth : fallback.maxWidth;
  return { maxWidth };
}

function explorerSettings(v: unknown, fallback: ExplorerSettings): ExplorerSettings {
  if (!isRecord(v)) return cloneExplorer(fallback);
  const openMode: OpenMode =
    v.openMode === 'single' || v.openMode === 'double' ? v.openMode : fallback.openMode;
  const deleteMode: DeleteMode =
    v.deleteMode === 'recycle' || v.deleteMode === 'permanent' ? v.deleteMode : fallback.deleteMode;
  // An explicit array (even empty = "exclude nothing") is honoured; anything else
  // falls back to the default list. Non-string entries are dropped.
  const excludeGlobs = Array.isArray(v.excludeGlobs)
    ? v.excludeGlobs.filter((g): g is string => typeof g === 'string')
    : [...fallback.excludeGlobs];
  const dragCopyModifier = DRAG_MODIFIER_KEYS.includes(v.dragCopyModifier as DragModifierKey)
    ? (v.dragCopyModifier as DragModifierKey)
    : fallback.dragCopyModifier;
  const dragMoveModifier = DRAG_MODIFIER_KEYS.includes(v.dragMoveModifier as DragModifierKey)
    ? (v.dragMoveModifier as DragModifierKey)
    : fallback.dragMoveModifier;
  return { openMode, deleteMode, excludeGlobs, dragCopyModifier, dragMoveModifier };
}

const DRAG_MODIFIER_KEYS: readonly DragModifierKey[] = ['ctrl', 'shift', 'alt'];

function cloneExplorer(e: ExplorerSettings): ExplorerSettings {
  return {
    openMode: e.openMode,
    deleteMode: e.deleteMode,
    excludeGlobs: [...e.excludeGlobs],
    dragCopyModifier: e.dragCopyModifier,
    dragMoveModifier: e.dragMoveModifier,
  };
}

/** Parse one user flavour entry; returns null when it is malformed (dropped). */
function terminalFlavour(v: unknown): TerminalFlavourConfig | null {
  if (!isRecord(v)) return null;
  if (typeof v.id !== 'string' || v.id.length === 0) return null;
  if (typeof v.file !== 'string' || v.file.length === 0) return null;
  const label = typeof v.label === 'string' && v.label.length > 0 ? v.label : v.id;
  const args = Array.isArray(v.args) ? v.args.filter((a): a is string => typeof a === 'string') : [];
  const defaultParams = typeof v.defaultParams === 'string' ? v.defaultParams : '';
  return { id: v.id, label, file: v.file, args, defaultParams };
}

function terminalSettings(v: unknown, fallback: TerminalSettings): TerminalSettings {
  if (!isRecord(v)) return cloneTerminals(fallback);
  const flavours = Array.isArray(v.flavours)
    ? v.flavours.map(terminalFlavour).filter((f): f is TerminalFlavourConfig => f !== null)
    : [...fallback.flavours];
  const disabledBuiltins = Array.isArray(v.disabledBuiltins)
    ? v.disabledBuiltins.filter((s): s is string => typeof s === 'string')
    : [...fallback.disabledBuiltins];
  const defaultParams: Record<string, string> = {};
  if (isRecord(v.defaultParams)) {
    for (const [key, val] of Object.entries(v.defaultParams)) {
      if (typeof val === 'string') defaultParams[key] = val;
    }
  } else {
    Object.assign(defaultParams, fallback.defaultParams);
  }
  return { flavours, disabledBuiltins, defaultParams };
}

function cloneTerminals(t: TerminalSettings): TerminalSettings {
  return {
    flavours: t.flavours.map((f) => ({ ...f, args: [...f.args] })),
    disabledBuiltins: [...t.disabledBuiltins],
    defaultParams: { ...t.defaultParams },
  };
}

/** Tolerant per-field parse of the `editor` section; bad values fall back to the
 *  default for that field (never throws — mirrors `terminalSettings`). */
function editorSettings(v: unknown, fallback: EditorSettings): EditorSettings {
  if (!isRecord(v)) return { ...fallback };
  const openOnClick = EDITOR_OPEN_ON_CLICK.includes(v.openOnClick as EditorOpenOnClick)
    ? (v.openOnClick as EditorOpenOnClick)
    : fallback.openOnClick;
  const autoSave = typeof v.autoSave === 'boolean' ? v.autoSave : fallback.autoSave;
  const autoSaveDebounceMs =
    typeof v.autoSaveDebounceMs === 'number' && v.autoSaveDebounceMs >= 0
      ? v.autoSaveDebounceMs
      : fallback.autoSaveDebounceMs;
  const saveAllScope = SAVE_ALL_SCOPES.includes(v.saveAllScope as SaveAllScopeSetting)
    ? (v.saveAllScope as SaveAllScopeSetting)
    : fallback.saveAllScope;
  const defaultLineEnding = LINE_ENDINGS.includes(v.defaultLineEnding as DefaultLineEnding)
    ? (v.defaultLineEnding as DefaultLineEnding)
    : fallback.defaultLineEnding;
  const maxOpenFileBytes =
    typeof v.maxOpenFileBytes === 'number' && v.maxOpenFileBytes > 0
      ? v.maxOpenFileBytes
      : fallback.maxOpenFileBytes;
  const projectPathDisplay = PATH_DISPLAYS.includes(v.projectPathDisplay as EditorPathDisplay)
    ? (v.projectPathDisplay as EditorPathDisplay)
    : fallback.projectPathDisplay;
  const subWorkspacePathDisplay = PATH_DISPLAYS.includes(
    v.subWorkspacePathDisplay as EditorPathDisplay,
  )
    ? (v.subWorkspacePathDisplay as EditorPathDisplay)
    : fallback.subWorkspacePathDisplay;
  const warnOnMissingFile =
    typeof v.warnOnMissingFile === 'boolean' ? v.warnOnMissingFile : fallback.warnOnMissingFile;
  return {
    openOnClick,
    autoSave,
    autoSaveDebounceMs,
    saveAllScope,
    defaultLineEnding,
    maxOpenFileBytes,
    projectPathDisplay,
    subWorkspacePathDisplay,
    warnOnMissingFile,
  };
}

/** Tolerant per-field parse of the `newProject` section; bad values fall back to
 *  the default for that field (never throws). */
function newProjectSettings(v: unknown, fallback: NewProjectSettings): NewProjectSettings {
  if (!isRecord(v)) return { ...fallback };
  const startingFolder = STARTING_FOLDER_MODES.includes(v.startingFolder as StartingFolderMode)
    ? (v.startingFolder as StartingFolderMode)
    : fallback.startingFolder;
  const overridePath = typeof v.overridePath === 'string' ? v.overridePath : fallback.overridePath;
  const lastProjectFolder =
    typeof v.lastProjectFolder === 'string' ? v.lastProjectFolder : fallback.lastProjectFolder;
  return { startingFolder, overridePath, lastProjectFolder };
}

/**
 * Parse raw JSON into a complete, valid AppSettings by merging over the defaults.
 * Unknown/invalid fields fall back to their default. Never throws.
 */
export function parseAppSettings(raw: unknown): AppSettings {
  const d = DEFAULT_APP_SETTINGS;
  if (!isRecord(raw)) return structuredCloneSettings(d);

  const appearance = isRecord(raw.appearance) ? raw.appearance : {};
  const confirmations = isRecord(raw.confirmations) ? raw.confirmations : {};
  const panes = isRecord(raw.panes) ? raw.panes : {};
  const behaviour = isRecord(raw.behaviour) ? raw.behaviour : {};
  const explorer = isRecord(raw.explorer) ? raw.explorer : {};

  return {
    version: typeof raw.version === 'number' ? raw.version : d.version,
    appearance: {
      theme: typeof appearance.theme === 'string' && appearance.theme.length > 0
        ? appearance.theme
        : d.appearance.theme,
    },
    confirmations: {
      destroyProject: confirmLevel(confirmations.destroyProject, d.confirmations.destroyProject),
      destroyTab: confirmLevel(confirmations.destroyTab, d.confirmations.destroyTab),
      destroyPanel: confirmLevel(confirmations.destroyPanel, d.confirmations.destroyPanel),
      destroySubWorkspace: confirmLevel(
        confirmations.destroySubWorkspace,
        d.confirmations.destroySubWorkspace,
      ),
    },
    panes: {
      projects: paneState(panes.projects, d.panes.projects),
      fileExplorer: paneState(panes.fileExplorer, d.panes.fileExplorer),
    },
    behaviour: {
      tabHoverActivateMs:
        typeof behaviour.tabHoverActivateMs === 'number' && behaviour.tabHoverActivateMs >= 0
          ? behaviour.tabHoverActivateMs
          : d.behaviour.tabHoverActivateMs,
      submenuHoverMs:
        typeof behaviour.submenuHoverMs === 'number' && behaviour.submenuHoverMs >= 0
          ? behaviour.submenuHoverMs
          : d.behaviour.submenuHoverMs,
    },
    explorer: explorerSettings(explorer, d.explorer),
    terminals: terminalSettings(raw.terminals, d.terminals),
    editor: editorSettings(raw.editor, d.editor),
    newProject: newProjectSettings(raw.newProject, d.newProject),
  };
}

function structuredCloneSettings(s: AppSettings): AppSettings {
  return {
    version: s.version,
    appearance: { ...s.appearance },
    confirmations: { ...s.confirmations },
    panes: {
      projects: { ...s.panes.projects },
      fileExplorer: { ...s.panes.fileExplorer },
    },
    behaviour: { ...s.behaviour },
    explorer: cloneExplorer(s.explorer),
    terminals: cloneTerminals(s.terminals),
    editor: { ...s.editor },
    newProject: { ...s.newProject },
  };
}
