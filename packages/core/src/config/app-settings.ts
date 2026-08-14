/**
 * Application settings (FR-031/032, data-model §2). A sectioned, user-scoped
 * document. Pure schema + defaults + tolerant parse/merge/validate — a malformed
 * document resolves to defaults rather than throwing (research D1). No OS/DOM.
 */
import { DEFAULT_EXCLUDE_GLOBS } from '../explorer/exclude.js';
import type { DragModifierKey } from '../explorer/drag.js';
import { SHIPPED_INDENT_BY_LANGUAGE, type IndentProfile } from '../editor/languages.js';
import { DEFAULT_LOG_LEVEL, parseLogLevel, type LogLevel } from '../diagnostics/log-level.js';
import { DEFAULT_ROTATION } from '../diagnostics/rotation.js';

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
  /**
   * Follow the active editor: expand and select its file in the tree whenever it changes (#188).
   * Default ON — the tree is the thing you act on the current file WITH, so it keeping a stale
   * selection made every rename/reveal/delete start with a hunt. Off restores the old behaviour,
   * where only the manual "Reveal File" action moves it (#137).
   */
  autoRevealActiveFile: boolean;
}

/** A user-defined terminal flavour (005 Phase B, settings.terminals.flavours). */
export interface TerminalFlavourConfig {
  id: string;
  label: string;
  /** Executable path or command. */
  file: string;
  /** Base args inherent to launching it (before the user's Shell Arguments). */
  args: string[];
  /** Default Shell Arguments pre-filled when this flavour is chosen (025: was `defaultParams`). */
  defaultShellArguments: string;
  /**
   * How this flavour is handed a Startup Command so it runs AND leaves an interactive shell
   * behind (025 FR-011): an argv template with exactly one `{command}` placeholder, e.g.
   * `['/K', '{command}']`. Absent → the universal PTY-write fallback (FR-012).
   */
  commandRecipe?: string[];
}

/** Terminal preferences (005 Phase B, contracts/config-additions.md). */
export interface TerminalSettings {
  /** User-defined flavours, shown in the Flavour dropdown alongside built-ins. */
  flavours: TerminalFlavourConfig[];
  /** Built-in flavour ids to hide from the dropdown. */
  disabledBuiltins: string[];
  /** Per-flavour-id Shell Arguments override (wins over the catalogue default).
   *  025: renamed from `defaultParams`; the old key is still read (FR-002d). */
  defaultShellArguments: Record<string, string>;
  /** Per-flavour-id Startup Command recipe override (025 FR-011). Wins over a user flavour's
   *  own `commandRecipe` and over the built-in catalogue. */
  commandRecipes: Record<string, string[]>;
  /**
   * How often the daemon observes each terminal's foreground command, in milliseconds
   * (025 FR-019c). Externalised rather than a module constant: it is the knob that trades the
   * staleness window (FR-019d) against observation cost.
   */
  commandPollMs: number;
  /**
   * Ask shells that cannot be observed from outside to REPORT their working directory
   * (025 follow-up). PowerShell's `Set-Location` never moves the process working directory, so
   * without this its terminals always reopen at the project root. On by default; switch it off if
   * it disagrees with a custom prompt.
   */
  shellIntegration: boolean;
  /** 024 US1 (#152): show the terminal's per-panel status bar (new surface; carries the shell
   *  flavour label). When off, the bar is hidden and its row reclaimed. */
  showStatusBar: boolean;
  /** 024 US7 (#159 follow-up): how long the pointer must rest on a terminal link before the
   *  "Ctrl+Click to open…" hover tip appears, in milliseconds. Default 500. */
  linkHoverDelayMs: number;
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
  /** US8 (#154): remember a document's scroll position across in-place reopens (default off). */
  saveDocumentScroll: boolean;
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
  /** 024 US1 (#152): starting word-wrap state for a freshly-opened document. The per-document
   *  status-bar/menu/chord toggle overrides this in memory only (not persisted). */
  defaultWordWrap: boolean;
  /** 024 US1 (#152): show the editor's per-panel status strip. When off, the strip is hidden and
   *  its row reclaimed; the wrap command and language picker stay reachable by chord/menu. */
  showStatusBar: boolean;
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
  /** Tab-strip preferences (031). */
  tabs: TabSettings;
  /** New-project folder-picker preferences (011). */
  newProject: NewProjectSettings;
  /** In-panel search preferences (013). */
  search: SearchSettings;
  /** Durable diagnostics (#123). */
  diagnostics: DiagnosticsSettings;
}

/**
 * Diagnostics preferences (#123).
 *
 * The log level is a SETTING rather than a constant because the build a user is running is the one
 * they cannot rebuild: when an installed throng misbehaves, turning the detail up has to be
 * something they can do from the preferences editor, not something we ship in the next release
 * (Constitution Principle X).
 */
export interface DiagnosticsSettings {
  /** Threshold for what reaches the log files: error | warn | info | debug. */
  logLevel: LogLevel;
  /** Size (KB) a log file may reach before it rotates. */
  maxFileSizeKb: number;
  /** How many files to keep per log, INCLUDING the live one — the retention window. */
  keepFiles: number;
}

/**
 * Where a tab created with **+** lands (031 US6, FR-053/FR-053a).
 *
 * `afterActive` is the default because a new tab is nearly always *about* the tab you were just
 * on — appending it to the end put it wherever the strip happened to have grown to, which on a
 * scrolled strip is somewhere you cannot even see.
 */
/*
 * 031 FR-053a — re-exported, NOT redeclared.
 *
 * Two agents introduced this type independently, with identical values, which would have been a
 * duplicate identifier the moment the barrel exported both. The OPERATION owns it: `addTab`'s
 * position is the operation's own vocabulary, and the setting exists to choose between the values
 * the operation offers. Typing the setting from the operation makes it impossible for the two to
 * drift into disagreement; the reverse would point the layout layer at the settings layer for a
 * word that is really about layout.
 */
export type { NewTabPosition } from '../workspace/operations.js';
import type { NewTabPosition } from '../workspace/operations.js';

/**
 * Tab-strip preferences (031).
 *
 * Every one of these is bounded by its DESCRIPTOR alone (FR-041): there is no hand-written clamp
 * here, and there must never be one — the read-side guard enforces what `settings-metadata.ts`
 * declares, so a range stated twice is a range that can disagree with itself (#227). The same goes
 * for `newTabPosition`'s two allowed values, which are declared once, on its descriptor.
 */
export interface TabSettings {
  /**
   * How long (ms) the strip takes to ease to a new scroll position (FR-030). 0 scrolls instantly,
   * as does an active `prefers-reduced-motion`, which overrides this without changing it.
   */
  smoothScrollMs: number;
  /**
   * How long (ms) the pointer must rest on a tab before its close affordance will act (FR-044h).
   * The delay is what stops a close arriving on the way past a tab the user never meant to touch.
   */
  closeArmingDelayMs: number;
  /**
   * The most characters (grapheme clusters, FR-033a) a tab OR panel name may use (FR-034).
   *
   * One setting for both, deliberately (FR-033): they are the same kind of name in the same strip,
   * and two limits would be two things to discover and keep in agreement.
   */
  maxNameLength: number;
  /**
   * The widest a tab may render, in CHARACTERS (FR-050) — the same unit as `maxNameLength`, so the
   * two can be read against each other without converting anything.
   *
   * It is a cap on the VIEW, not on the name: a title past it is ellipsised where it is drawn and
   * shown in full on hover (FR-050a/b), while the name itself is untouched. A tab can therefore be
   * ellipsised without ever being truncated.
   */
  maxWidth: number;
  /** Where a tab created with **+** is inserted (FR-053a). */
  newTabPosition: NewTabPosition;
  /**
   * How long (ms) a press-and-hold on a scroll chevron waits before it starts repeating (FR-054a).
   * Short enough that holding is the obvious way to cross a long strip; long enough that an
   * ordinary click never turns into one.
   */
  chevronRepeatDelayMs: number;
  /**
   * How long (ms) the pointer must rest on a tab before its info popover appears (US7, FR-058).
   *
   * A separate setting from {@link closeArmingDelayMs} even though both time a hover, because they
   * guard opposite mistakes: the arming delay stops something DESTRUCTIVE from happening too
   * eagerly, while this one only decides when a read-only surface shows up. Anyone who wants the
   * popover instantly (0) still wants the close button to make them wait.
   */
  popoverDelayMs: number;
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
    autoRevealActiveFile: true,
  },
  terminals: {
    flavours: [],
    disabledBuiltins: [],
    defaultShellArguments: {},
    commandRecipes: {},
    commandPollMs: 1000,
    shellIntegration: true,
    showStatusBar: true,
    linkHoverDelayMs: 500,
  },
  editor: {
    openOnClick: 'single',
    openTarget: 'lastActive',
    autoSave: false,
    saveDocumentScroll: false,
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
    defaultWordWrap: true,
    showStatusBar: true,
  },
  tabs: {
    smoothScrollMs: 300,
    closeArmingDelayMs: 300,
    maxNameLength: 64,
    maxWidth: 32,
    newTabPosition: 'afterActive',
    chevronRepeatDelayMs: 350,
    popoverDelayMs: 500,
  },
  newProject: {
    startingFolder: 'lastViewed',
    overridePath: '',
    lastProjectFolder: '',
  },
  search: {
    asYouTypeDebounceMs: 120,
  },
  diagnostics: {
    logLevel: DEFAULT_LOG_LEVEL,
    maxFileSizeKb: DEFAULT_ROTATION.maxBytes / 1024,
    keepFiles: DEFAULT_ROTATION.keep,
  },
};

/**
 * A whole number, or the shipped default when the file does not hold one.
 *
 * TYPE tolerance only — deliberately no range (031 T033, FR-009). A range belongs on the
 * descriptor, where the Settings form and the read-side guard both read it; a second copy here is
 * how `diagnostics.keepFiles` came to declare 1–20 and accept 1–50 for a year without anyone
 * noticing the two had drifted (#227).
 */
function wholeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

/**
 * Tolerant parse of the diagnostics section; an unknown level falls back rather than throwing —
 * a typo in a settings file must never stop the application starting.
 *
 * 031 T033: the 64–65536 and 1–50 range checks are gone. Both keys declare their range on a
 * descriptor, and the wider ceiling this function used to carry in silence is now declared out
 * loud as `hardMax: 65536`, so a hand-set 64 MB log cap still survives (FR-015a).
 */
function diagnosticsSettings(raw: unknown, d: DiagnosticsSettings): DiagnosticsSettings {
  const v = isRecord(raw) ? raw : {};
  return {
    logLevel: parseLogLevel(v.logLevel, d.logLevel),
    maxFileSizeKb: wholeNumber(v.maxFileSizeKb, d.maxFileSizeKb),
    keepFiles: wholeNumber(v.keepFiles, d.keepFiles),
  };
}

/**
 * Tolerant parse of the tabs section (031).
 *
 * TYPE only — no range check, and no membership check either. Every bound these settings have is
 * declared on their descriptors and enforced by the read-side guard (FR-009/FR-041); repeating it
 * here is exactly the duplication that let a declared range and a parsed range drift apart in the
 * first place (#227).
 *
 * So `newTabPosition` is accepted as any STRING and handed on. An unrecognised one is not this
 * function's business — `allowedValues` on the descriptor is the single statement of the set, and
 * the guard substitutes the default for anything outside it.
 */
function tabsSettings(raw: unknown, d: TabSettings): TabSettings {
  const v = isRecord(raw) ? raw : {};
  return {
    smoothScrollMs: wholeNumber(v.smoothScrollMs, d.smoothScrollMs),
    closeArmingDelayMs: wholeNumber(v.closeArmingDelayMs, d.closeArmingDelayMs),
    maxNameLength: wholeNumber(v.maxNameLength, d.maxNameLength),
    maxWidth: wholeNumber(v.maxWidth, d.maxWidth),
    newTabPosition:
      typeof v.newTabPosition === 'string' ? (v.newTabPosition as NewTabPosition) : d.newTabPosition,
    chevronRepeatDelayMs: wholeNumber(v.chevronRepeatDelayMs, d.chevronRepeatDelayMs),
    popoverDelayMs: wholeNumber(v.popoverDelayMs, d.popoverDelayMs),
  };
}

/**
 * Tolerant parse of the search section; a value that is not a number falls back.
 *
 * 031 T033: the `>= 0` floor is gone with the other clamps. The descriptor declares 0–1000 and the
 * guard enforces it — where this function enforced a floor and no ceiling whatsoever, so a typo
 * could set a debounce of a minute and the search would simply appear to have stopped working.
 */
function searchSettings(raw: unknown, d: SearchSettings): SearchSettings {
  const v = isRecord(raw) ? raw : {};
  return {
    asYouTypeDebounceMs:
      typeof v.asYouTypeDebounceMs === 'number' && Number.isFinite(v.asYouTypeDebounceMs)
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
  const autoRevealActiveFile =
    typeof v.autoRevealActiveFile === 'boolean' ? v.autoRevealActiveFile : fallback.autoRevealActiveFile;
  return { deleteMode, excludeGlobs, dragCopyModifier, dragMoveModifier, autoRevealActiveFile };
}

const DRAG_MODIFIER_KEYS: readonly DragModifierKey[] = ['ctrl', 'shift', 'alt'];

function cloneExplorer(e: ExplorerSettings): ExplorerSettings {
  return {
    deleteMode: e.deleteMode,
    excludeGlobs: [...e.excludeGlobs],
    dragCopyModifier: e.dragCopyModifier,
    dragMoveModifier: e.dragMoveModifier,
    autoRevealActiveFile: e.autoRevealActiveFile,
  };
}

/** Parse one user flavour entry; returns null when it is malformed (dropped). */
function terminalFlavour(v: unknown): TerminalFlavourConfig | null {
  if (!isRecord(v)) return null;
  if (typeof v.id !== 'string' || v.id.length === 0) return null;
  if (typeof v.file !== 'string' || v.file.length === 0) return null;
  const label = typeof v.label === 'string' && v.label.length > 0 ? v.label : v.id;
  const args = Array.isArray(v.args) ? v.args.filter((a): a is string => typeof a === 'string') : [];
  // 025 FR-002d: read-side migration. A flavour written before this feature spells it
  // `defaultParams`; the new key wins when both are present, and re-reading migrated data never
  // sees the old key, so this is idempotent by construction (FR-002e).
  const defaultShellArguments =
    typeof v.defaultShellArguments === 'string'
      ? v.defaultShellArguments
      : typeof v.defaultParams === 'string'
        ? v.defaultParams
        : '';
  const commandRecipe = Array.isArray(v.commandRecipe)
    ? v.commandRecipe.filter((a): a is string => typeof a === 'string')
    : undefined;
  const entry: TerminalFlavourConfig = {
    id: v.id,
    label,
    file: v.file,
    args,
    defaultShellArguments,
  };
  if (commandRecipe !== undefined) entry.commandRecipe = commandRecipe;
  return entry;
}

function terminalSettings(v: unknown, fallback: TerminalSettings): TerminalSettings {
  if (!isRecord(v)) return cloneTerminals(fallback);
  const flavours = Array.isArray(v.flavours)
    ? v.flavours.map(terminalFlavour).filter((f): f is TerminalFlavourConfig => f !== null)
    : [...fallback.flavours];
  const disabledBuiltins = Array.isArray(v.disabledBuiltins)
    ? v.disabledBuiltins.filter((s): s is string => typeof s === 'string')
    : [...fallback.disabledBuiltins];
  // 025 FR-002d: prefer the new key; fall back to the pre-025 `defaultParams` spelling; only then
  // to the shipped default. Nothing is rewritten on disk — a read-side migration cannot half-write
  // a config file, which is why it was chosen over an eager rewrite (research R6, cf. #102).
  const migratedShellArgs = isRecord(v.defaultShellArguments)
    ? v.defaultShellArguments
    : isRecord(v.defaultParams)
      ? v.defaultParams
      : null;
  const defaultShellArguments: Record<string, string> = {};
  if (migratedShellArgs) {
    for (const [key, val] of Object.entries(migratedShellArgs)) {
      if (typeof val === 'string') defaultShellArguments[key] = val;
    }
  } else {
    Object.assign(defaultShellArguments, fallback.defaultShellArguments);
  }
  const commandRecipes: Record<string, string[]> = {};
  if (isRecord(v.commandRecipes)) {
    for (const [key, val] of Object.entries(v.commandRecipes)) {
      if (Array.isArray(val)) {
        commandRecipes[key] = val.filter((a): a is string => typeof a === 'string');
      }
    }
  } else {
    for (const [key, val] of Object.entries(fallback.commandRecipes)) commandRecipes[key] = [...val];
  }
  const shellIntegration =
    typeof v.shellIntegration === 'boolean' ? v.shellIntegration : fallback.shellIntegration;
  // 031 T033: both of these used to clamp here as well as declare a range on their descriptors.
  // `commandPollMs`'s two agreed (250–5000) and `linkHoverDelayMs`'s did not (declared 0–2000,
  // clamped 0–5000) — and nothing could have told you which, because only one of the two was ever
  // enforced. The clamps are gone; the descriptors are the range (FR-015, FR-016).
  const commandPollMs = wholeNumber(v.commandPollMs, fallback.commandPollMs);
  const showStatusBar =
    typeof v.showStatusBar === 'boolean' ? v.showStatusBar : fallback.showStatusBar;
  const linkHoverDelayMs = wholeNumber(v.linkHoverDelayMs, fallback.linkHoverDelayMs);
  return {
    flavours,
    disabledBuiltins,
    defaultShellArguments,
    commandRecipes,
    commandPollMs,
    shellIntegration,
    showStatusBar,
    linkHoverDelayMs,
  };
}

function cloneTerminals(t: TerminalSettings): TerminalSettings {
  return {
    flavours: t.flavours.map((f) => ({
      ...f,
      args: [...f.args],
      ...(f.commandRecipe ? { commandRecipe: [...f.commandRecipe] } : {}),
    })),
    disabledBuiltins: [...t.disabledBuiltins],
    defaultShellArguments: { ...t.defaultShellArguments },
    commandRecipes: Object.fromEntries(
      Object.entries(t.commandRecipes).map(([k, v]) => [k, [...v]]),
    ),
    commandPollMs: t.commandPollMs,
    shellIntegration: t.shellIntegration,
    showStatusBar: t.showStatusBar,
    linkHoverDelayMs: t.linkHoverDelayMs,
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
  const saveDocumentScroll =
    typeof v.saveDocumentScroll === 'boolean' ? v.saveDocumentScroll : fallback.saveDocumentScroll;
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
  const defaultWordWrap =
    typeof v.defaultWordWrap === 'boolean' ? v.defaultWordWrap : fallback.defaultWordWrap;
  const showStatusBar =
    typeof v.showStatusBar === 'boolean' ? v.showStatusBar : fallback.showStatusBar;
  return {
    openOnClick,
    openTarget,
    autoSave,
    saveDocumentScroll,
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
    defaultWordWrap,
    showStatusBar,
  };
}

/**
 * A malformed profile falls back WHOLE — half a profile is not a convention.
 *
 * 031 (#227): the RANGE checks that used to live here are gone. They hard-coded 1–16, which is
 * exactly what `editor.indent.indentWidth` / `.tabWidth` and `editor.indentByLanguage`'s columns
 * already declare, so the number existed twice and only one copy was reachable from the Settings
 * form. Raising the descriptor's maximum — a change the guard's contract says needs no other edit —
 * would have left this substituting the default for anything above 16, silently.
 *
 * What stays is what the guard cannot do: the TYPE tolerance, and the floor. A fractional width is
 * meaningless rather than out of range, and the guard clamps ranges without rounding.
 */
function indentProfile(v: unknown, fallback: IndentProfile): IndentProfile {
  if (!isRecord(v)) return { ...fallback };
  const style = v.style === 'tabs' || v.style === 'spaces' ? v.style : fallback.style;
  const width = (raw: unknown, fb: number): number =>
    typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fb;
  return {
    style,
    indentWidth: width(v.indentWidth, fallback.indentWidth),
    tabWidth: width(v.tabWidth, fallback.tabWidth),
  };
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
 *
 * 031 (#227): this does NOT apply the declared-bounds guard. It cannot — `settings-metadata.ts`
 * imports `DEFAULT_APP_SETTINGS` from here, so importing the registry back would close a cycle whose
 * only symptom is an undefined registry at module-init time. The guarded entry point lives in
 * `settings-read.ts`, which imports both and is what every reader should call.
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
    tabs: tabsSettings(raw.tabs, d.tabs),
    newProject: newProjectSettings(raw.newProject, d.newProject),
    search: searchSettings(raw.search, d.search),
    diagnostics: diagnosticsSettings(raw.diagnostics, d.diagnostics),
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
    tabs: { ...s.tabs },
    newProject: { ...s.newProject },
    search: { ...s.search },
    diagnostics: { ...s.diagnostics },
  };
}
