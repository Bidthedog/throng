/**
 * Application settings (FR-031/032, data-model §2). A sectioned, user-scoped
 * document. Pure schema + defaults + tolerant parse/merge/validate — a malformed
 * document resolves to defaults rather than throwing (research D1). No OS/DOM.
 */
import { DEFAULT_EXCLUDE_GLOBS } from '../explorer/exclude.js';
import type { DragModifierKey } from '../explorer/drag.js';
import { SHIPPED_INDENT_BY_LANGUAGE, type IndentProfile } from '../editor/languages.js';

/** Confirmation depth for a destroy action: none / single / double (wry second). */
export type ConfirmLevel = 'none' | 'single' | 'double';

/** File delete behaviour: OS Recycle Bin (default, recoverable) or permanent (004, FR-018). */
export type DeleteMode = 'recycle' | 'permanent';

/** File Explorer tree preferences (004, contracts/config-additions.md). */
export interface ExplorerSettings {
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

/** Default target when opening a file (US7, #141): reuse the last active editor, or a new one. */
export type EditorOpenTarget = 'lastActive' | 'new';

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
  /** Where an opened file lands (US7, #141): the last active editor, or a new editor panel. */
  openTarget: EditorOpenTarget;
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
  /**
   * The GLOBAL indentation profile (016, FR-018) — the fallback when nothing more specific applies.
   *
   * The order of precedence is: what the FILE already does (inferred, FR-018a) ▸ the language's
   * profile ▸ this. The file wins because a document's existing indentation is a fact about that
   * document, and a setting that overruled it would silently mix tabs and spaces in a file the user
   * did not intend to convert (FR-018d).
   */
  indent: IndentProfile;
  /** Per-language indentation, keyed by language id (FR-018/FR-022). Shipped from the registry. */
  indentByLanguage: Record<string, IndentProfile>;
  /** User extension→language mappings (FR-005a): `.foo` → `python`. Shipped EMPTY. */
  languageByExtension: Record<string, string>;
  /** Persist the undo history alongside the crash-recovery snapshot (FR-027a). */
  persistUndoHistory: boolean;
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
const EDITOR_OPEN_TARGETS: readonly EditorOpenTarget[] = ['lastActive', 'new'];
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
  /** In-panel search preferences (013). */
  search: SearchSettings;
}

/** In-panel search preferences (013, FR-002a / SC-007). */
export interface SearchSettings {
  /**
   * Quiet period (ms) after the last keystroke before the as-you-type search re-runs.
   * Bounds the cost of searching a large file or scrollback while keeping results inside
   * the 1000 ms budget (SC-007). Externalised rather than hardcoded (Principle X).
   */
  asYouTypeDebounceMs: number;
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
    openTarget: 'lastActive',
    autoSave: false,
    autoSaveDebounceMs: 300,
    saveAllScope: 'project',
    defaultLineEnding: 'lf',
    maxOpenFileBytes: 10485760,
    projectPathDisplay: 'full',
    subWorkspacePathDisplay: 'full',
    warnOnMissingFile: true,
    // Two spaces is the majority convention across the languages this editor ships with; the ones
    // that disagree say so in the registry, and the file itself overrules both (FR-018a).
    indent: { style: 'spaces', indentWidth: 2, tabWidth: 4 },
    // DERIVED from the language registry, so there is one place a convention is declared.
    indentByLanguage: SHIPPED_INDENT_BY_LANGUAGE,
    // Shipped EMPTY, and it MUST be resettable back to empty (FR-022c): a user who maps `.foo` to
    // Python and then clears it must end up with no mapping, not with the mapping restored.
    languageByExtension: {},
    persistUndoHistory: true,
  },
  newProject: {
    startingFolder: 'lastViewed',
    overridePath: '',
    lastProjectFolder: '',
  },
  search: {
    asYouTypeDebounceMs: 120,
  },
};

/** Tolerant parse of the search section; a bad or negative value falls back. */
function searchSettings(raw: unknown, d: SearchSettings): SearchSettings {
  const v = isRecord(raw) ? raw : {};
  return {
    asYouTypeDebounceMs:
      typeof v.asYouTypeDebounceMs === 'number' &&
      Number.isFinite(v.asYouTypeDebounceMs) &&
      v.asYouTypeDebounceMs >= 0
        ? v.asYouTypeDebounceMs
        : d.asYouTypeDebounceMs,
  };
}

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
  return { deleteMode, excludeGlobs, dragCopyModifier, dragMoveModifier };
}

const DRAG_MODIFIER_KEYS: readonly DragModifierKey[] = ['ctrl', 'shift', 'alt'];

function cloneExplorer(e: ExplorerSettings): ExplorerSettings {
  return {
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
  const openTarget = EDITOR_OPEN_TARGETS.includes(v.openTarget as EditorOpenTarget)
    ? (v.openTarget as EditorOpenTarget)
    : fallback.openTarget;
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
  const persistUndoHistory =
    typeof v.persistUndoHistory === 'boolean' ? v.persistUndoHistory : fallback.persistUndoHistory;
  return {
    openOnClick,
    openTarget,
    autoSave,
    autoSaveDebounceMs,
    saveAllScope,
    defaultLineEnding,
    maxOpenFileBytes,
    projectPathDisplay,
    subWorkspacePathDisplay,
    warnOnMissingFile,
    indent: indentProfile(v.indent, fallback.indent),
    indentByLanguage: indentMap(v.indentByLanguage, fallback.indentByLanguage),
    languageByExtension: extensionMap(v.languageByExtension, fallback.languageByExtension),
    persistUndoHistory,
  };
}

/** A malformed profile falls back WHOLE — half a profile is not a convention. */
function indentProfile(v: unknown, fallback: IndentProfile): IndentProfile {
  if (!isRecord(v)) return { ...fallback };
  const style = v.style === 'tabs' || v.style === 'spaces' ? v.style : fallback.style;
  const indentWidth =
    typeof v.indentWidth === 'number' && v.indentWidth > 0 && v.indentWidth <= 16
      ? Math.floor(v.indentWidth)
      : fallback.indentWidth;
  const tabWidth =
    typeof v.tabWidth === 'number' && v.tabWidth > 0 && v.tabWidth <= 16
      ? Math.floor(v.tabWidth)
      : fallback.tabWidth;
  return { style, indentWidth, tabWidth };
}

/**
 * A keyed map, parsed TOLERANTLY — and an explicit `{}` means EMPTY, not "use the defaults".
 *
 * That distinction is the whole of FR-022c. A map that fell back to its shipped value whenever it
 * was empty could never be cleared: the user would delete every row, save, and watch the rows come
 * straight back. `terminals.defaultParams` set the precedent; this follows it.
 *
 * Individual malformed entries are DROPPED rather than failing the whole map — one bad row in a
 * hand-edited JSON file must not cost the user the other twenty.
 */
function indentMap(
  v: unknown,
  fallback: Record<string, IndentProfile>,
): Record<string, IndentProfile> {
  if (!isRecord(v)) return cloneIndentMap(fallback);
  const out: Record<string, IndentProfile> = {};
  for (const [key, value] of Object.entries(v)) {
    if (!isRecord(value)) continue; // a row that is not a profile at all
    if (value.style !== 'tabs' && value.style !== 'spaces') continue; // …or has no style
    out[key] = indentProfile(value, { style: 'spaces', indentWidth: 2, tabWidth: 4 });
  }
  return out;
}

function extensionMap(v: unknown, fallback: Record<string, string>): Record<string, string> {
  if (!isRecord(v)) return { ...fallback };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(v)) {
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

function cloneIndentMap(m: Record<string, IndentProfile>): Record<string, IndentProfile> {
  return Object.fromEntries(Object.entries(m).map(([k, p]) => [k, { ...p }]));
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
    search: searchSettings(raw.search, d.search),
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
    editor: {
      ...s.editor,
      // Deep-cloned: a shallow copy would hand every caller the SAME map object, and the shipped
      // defaults are frozen — a mutation would either throw or silently edit everyone's settings.
      indent: { ...s.editor.indent },
      indentByLanguage: cloneIndentMap(s.editor.indentByLanguage),
      languageByExtension: { ...s.editor.languageByExtension },
    },
    newProject: { ...s.newProject },
    search: { ...s.search },
  };
}
