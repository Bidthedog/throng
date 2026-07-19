// Public surface of the platform- and process-agnostic core (Principles II/VIII/X).
// Contains zero OS, Electron, or process-specific calls (verified by the
// structural guard test in tests/unit/no-os-imports.test.ts).
//
// Exports grow per implementation phase; each addition keeps the tree compiling.

export type { IPlatformInfo, OsName } from './abstractions/platform-info.js';
// The OS clipboard seam (016, FR-013a) — core reads the live clipboard to decide a paste mode.
export type { IClipboard } from './abstractions/clipboard.js';
export type { ClipboardMode, ClipboardRecord, CursorRange, SelectionShape } from './editor/clipboard-mode.js';
export { clipboardModeFor, pasteModeFor } from './editor/clipboard-mode.js';
// `cut-line` (016, FR-016a) — what Ctrl+X takes when nothing is selected.
export { cutLine } from './editor/cut-line.js';
export type { CursorSpan, CutLineResult, LineIndex, LineRef } from './editor/cut-line.js';
// Which indentation a document actually uses (016, FR-018) — the file outranks every preference.
export { effectiveIndent, indentUnitOf } from './editor/effective-indent.js';
// The document authority's wire (016, FR-028f) — shared by UI main (the authority) and every
// renderer (the replicas), so neither end owns the contract between them.
export type {
  CanonicalChangeMsg,
  DispatchChangeMsg,
  MergeClass,
  ResetDocumentMsg,
} from './editor/document-sync.js';
// The undo history, as it survives a crash (016, FR-027a) — bounded, and carried INSIDE the
// recovery snapshot so it can never outlive it.
export { MAX_HISTORY_BYTES, boundHistory } from './editor/undo-persistence.js';
export type { SerialisedHistory, SerialisedUndoEntry } from './editor/undo-persistence.js';
export type { IUserContext, CurrentUser } from './abstractions/user-context.js';
export type {
  IDisplayInfo,
  DisplayBounds,
  DisplayDescriptor,
  WindowBounds,
} from './abstractions/display-info.js';
export { createStaticDisplayInfo } from './display/static-display-info.js';
export type {
  IPersistenceSettings,
  IDaemonSettings,
  IUiSettings,
  IWorkspaceSettings,
  IConfigSettings,
} from './config/settings.js';
export { defaultPipeName, sanitisePipeToken } from './config/pipe-endpoint.js';
export { compareVersions, isPlaceholderVersion, matchReleaseVersions } from './config/product-version.js';
export type { ReleaseVersionSources, VersionMatchResult } from './config/product-version.js';
export { evaluatePublishGate } from './config/publish-gate.js';
export type { PublishGateInput, PublishGateResult } from './config/publish-gate.js';
export { decideLiveTerminalHandoff, resolveLiveTerminalChoice } from './config/install-handoff.js';
export type {
  LiveTerminalChoice,
  LiveTerminalHandoffInput,
  LiveTerminalHandoffDecision,
  LiveTerminalChoiceOutcome,
} from './config/install-handoff.js';
export {
  VERIFICATION_STEPS,
  verdictFromSteps,
  isVerdictPassingFor,
} from './config/verification-verdict.js';
export type { VerificationStep, VerificationVerdict } from './config/verification-verdict.js';

// User-scoped application configuration (003): abstractions + pure schemas.
export type { IConfigStore, ConfigDocId, ConfigReadOptions, WriteOutcome } from './abstractions/config-store.js';
export type { IFileWatcher, Disposable } from './abstractions/file-watcher.js';

// File Explorer tree (004): OS seams + pure domain.
export type { IFileSystem, DirEntry } from './abstractions/file-system.js';
export type { IShellIntegration } from './abstractions/shell-integration.js';
export type { FileNode, NodeKind, RenameResult, DedupeStyle, DragModifiers, DragEffect, ClickAction, ExpandNode, TargetNode } from './explorer/index.js';

// Path identity (019, FR-007): is this the same file, is this file under that folder — asked of
// paths spelled by different producers (the tree's `/`, `node:path.join`'s `\`). Pure rules.
export { normaliseForCompare, samePath, isUnderPath } from './fs/path-id.js';

// Terminal shell detection (005 Phase B): OS seam.
export type { IShellDetection, DetectedShell } from './abstractions/shell-detection.js';

// Terminal PTY + directory-lock OS seams (005 Phase C).
export type {
  IPtyHost,
  PtyStartOptions,
  PtyHandle,
  PtyExit,
} from './abstractions/pty-host.js';
export type { IDirectoryLock, LockHandle } from './abstractions/directory-lock.js';


// Elevation OS seam (005 Phase G): report whether a process runs elevated (FR-025).
export type { IElevationState } from './abstractions/elevation.js';

// Process-cwd OS seam (012 revision): read a running process's working directory
// (the daemon polls each terminal's shell pid to show its live cwd in the title).
export type { IProcessCwd } from './abstractions/process-cwd.js';

// De-elevation OS seam (005 Phase G, FR-025c): wrap a launch to run de-elevated.
export type { IDeElevator, DeElevateSpec } from './abstractions/de-elevator.js';
export { passthroughDeElevator } from './abstractions/de-elevator.js';
export {
  toNodes,
  sortNodes,
  joinRel,
  parentRel,
  isExcluded,
  DEFAULT_EXCLUDE_GLOBS,
  isWithinRoot,
  isDropAllowed,
  isRoot,
  resolveTarget,
  validateRename,
  dedupeName,
  resolveDragEffect,
  DEFAULT_DRAG_MODIFIERS,
  decideClick,
  nextExpandTargets,
} from './explorer/index.js';
export type { DragModifierKey, DragModifierConfig } from './explorer/index.js';
export type {
  AppSettings,
  ConfirmLevel,
  PaneState,
  ExplorerSettings,
  DeleteMode,
  TerminalSettings,
  TerminalFlavourConfig,
  EditorSettings,
  EditorOpenOnClick,
  SaveAllScopeSetting,
  DefaultLineEnding,
  EditorPathDisplay,
  NewProjectSettings,
  StartingFolderMode,
} from './config/app-settings.js';
export { DEFAULT_APP_SETTINGS, parseAppSettings } from './config/app-settings.js';
export type { StartingFolderConfig, StartingFolderContext } from './config/starting-folder.js';
export { resolveStartingFolder, isOverrideResolvable } from './config/starting-folder.js';
// Shared zoom range & mapping (012) — global + per-type zoom use one source.
export {
  ZOOM_STEP,
  ZOOM_MIN_LEVEL,
  ZOOM_MAX_LEVEL,
  clampZoomLevel,
  zoomFactor,
  stepZoomLevel,
} from './config/zoom.js';
export type {
  Keybindings,
  ActionId,
  KeyEvent,
  DispatchScope,
  CommandScopes,
  ChordCollision,
  ColumnSelectModifier,
  PlatformBindings,
} from './config/keybindings.js';
export {
  DEFAULT_KEYBINDINGS,
  DEFAULT_BINDING_PLATFORM,
  SHIPPED_KEYBINDINGS_BY_PLATFORM,
  COMMAND_SCOPES,
  shippedBindingsFor,
  chordCollisions,
  columnSelectHeld,
  scopeLabel,
  scopeNames,
  scopesIntersect,
  parseKeybindings,
  eventToToken,
  normalizeToken,
  resolveAction,
} from './config/keybindings.js';
export type { Theme, ThemeFonts, IconValue, TextCase, TypographyRole, ThemeFontRole } from './config/theme.js';
export {
  THRONG_THEME,
  OPTIONAL_THEME_COLOUR_TOKENS,
  TOKEN_PARENT,
  resolveColour,
  resolveSplitColour,
  toCssVariables,
} from './config/theme.js';
// Themes editor + icon packs + fonts (007).
export { THEME_METADATA, THEME_AREA_GROUPS, THEME_PROPERTY_VOCABULARY, areaForToken, assertThemeAreaGroups, assertNamingConvention, buildThemeMetadata, descriptorForThemeToken, themeEditableTokens, mechanicalCopy } from './config/theme-metadata.js';
// Hand-written token copy + theme-quality guards (009).
export { THEME_TOKEN_COPY, BANNED_ABBREVIATIONS, containsAbbreviation } from './config/theme-copy.js';
export type { TokenCopy } from './config/theme-copy.js';
export {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  rgbToLab,
  ciede2000,
  themePairDistance,
  closestPair,
  assertDistinct,
  DISTINCTNESS_THRESHOLD,
  CLOSEST_LEGITIMATE_PAIR_DELTA,
  WCAG_AA_BODY,
  WCAG_AA_LARGE_UI,
  IN_SCOPE_THEMES,
  SYNTAX_TOKENS,
  SYNTAX_BODY_MIN,
  BY_DESIGN_LOW_CONTRAST_THEMES,
  CONTRAST_PAIRINGS,
  contrastPairingsFor,
  measureContrast,
  contrastFailures,
  assertInScopeContrast,
  assertSyntaxBodyContrast,
  knownContrastIssues,
} from './config/theme-quality.js';
export type { Rgb, Lab, ClosestPair, ContrastPairing, ContrastResult, KnownContrastIssue } from './config/theme-quality.js';
export { parseFontStack, serializeFontStack } from './config/font-stack.js';
export type { IconPackManifest, IconAsset, LoadedIconPack } from './config/icon-pack.js';
export { parseIconPack, resolveIconValue, resolveIconAsset } from './config/icon-pack.js';
export { sanitiseSvg } from './config/svg-sanitise.js';
export type { ThemeRenameResult } from './config/theme-ops.js';
export { isValidThemeName, checkRename, activateTheme, migrateTheme, migrateThemeColours } from './config/theme-ops.js';
export { matchFamilies } from './config/font-typeahead.js';
export type { SearchableField, SearchableDescriptor } from './config/settings-search.js';
export { searchTokens, fieldHaystack, matchesQuery, filterFields } from './config/settings-search.js';
export { DEFAULT_THEMES, ALL_DEFAULT_THEMES } from './config/default-themes/index.js';
export type { OnEntrySnapshot, WritePlan, WritePlanEntry } from './config/theme-reset.js';
export {
  revertAll,
} from './config/theme-reset.js';
// Shipped defaults (010): the authoritative immutable/versioned record + pure
// restore/reset/seed/upgrade decision logic. I/O lives in UI-main.
export type { ShippedDefaults, ThemeUpgradePlan } from './config/shipped-defaults.js';
export {
  SHIPPED_DEFAULTS_VERSION,
  buildShippedDefaults,
  serializeShippedDefaults,
  reservedThemeNames,
  isReservedThemeName,
  ownAtPath,
  resetBindingValue,
  resetSettingValue,
  fillMissingThemeProps,
  planThemeUpgrade,
} from './config/shipped-defaults.js';
// The overridden-test (015): is this item still what the app shipped? Decides when a
// per-item reset affordance is shown — the affordance IS the row's "modified" cue.
// Its sibling, the differs-from-entry test, decides when the per-item REVERT affordance is
// shown: same comparison, but against the document the window was opened with (FR-016).
export {
  isSettingOverridden,
  isBindingOverridden,
  isThemeTokenOverridden,
  settingDiffersFromEntry,
  bindingDiffersFromEntry,
  themeTokenDiffersFromEntry,
} from './config/overridden.js';
// Theme-editor model (014): pure row classification + name validation for the restore/create controls.
export type { ThemeRow, ThemeRowKind, ThemeNameValidation } from './config/theme-editor-model.js';
export { classifyThemes, validateThemeName, cloneName } from './config/theme-editor-model.js';
export type { IFontEnumeration } from './abstractions/font-enumeration.js';
// Editor metadata registry (007, FR-025a) — the declarative source the visual
// preference editors render from, plus the completeness/path helpers.
export type {
  ControlKind,
  FieldDescriptor,
  MapColumn,
  MetadataRegistry,
  RegistryAudit,
} from './config/metadata.js';
export {
  leavesOf,
  // Map-aware leaves (016, F5): a key DECLARED `control: 'map'` is one leaf, not one per entry.
  leavesOfDeclared,
  tokensOf,
  getAtPath,
  setAtPath,
  auditRegistry,
  assertEveryKeyDescribed,
  // Declared clearability (015, FR-016a): what a clear writes, and the guard that stops a
  // `clearable` declaration from lying about whether the field can survive being emptied.
  emptyValueFor,
  isEmptyValue,
  auditClearable,
} from './config/metadata.js';
export {
  SETTINGS_METADATA,
  SETTINGS_INTERNAL_KEYS,
  settingsLeaves,
} from './config/settings-metadata.js';
export { KEYBINDINGS_METADATA } from './config/keybindings-metadata.js';
export type { CaptureEvent } from './config/chord-capture.js';
export {
  captureToken,
  isBindableChord,
  isReservedChord,
  RESERVED_CHORDS,
  EXCLUDED_KEYS,
  findConflict,
  applyReplace,
  applyReassign,
  applyAdd,
  applyRemove,
} from './config/chord-capture.js';

// Project domain (Principle I).
export type { Project, ProjectInput } from './projects/project.js';
export {
  validateProjectInput,
  isValidHexColour,
  createProject,
  applyProjectUpdate,
  ProjectValidationError,
  ProjectNotFoundError,
  ProjectFolderConflictError,
  normaliseFolder,
  isFolderConflict,
  assertFolderExclusive,
  sanitiseHiddenPaths,
  applyHiddenPaths,
} from './projects/project.js';
export { ProjectService } from './projects/project-service.js';
export type { ProjectServiceDeps, DeleteResult } from './projects/project-service.js';

// Workspace docking domain (Principle XI). Invariants + operations arrive with US2.
export type {
  Panel,
  PanelKind,
  PanelConfig,
  EditorPanelConfig,
  EncodingId,
  LineEndingId,
  SplitNode,
  LayoutNode,
  Tab,
  WorkspaceLayout,
  SubWorkspace,
  SubWorkspaceBounds,
} from './workspace/model.js';
export { LAYOUT_SCHEMA_VERSION, isPanel, isSplit } from './workspace/model.js';
// Move-focus geometry (012) — directional + cyclic keyboard focus over the tree.
export { panelRects, moveFocus, cycleOrder, nextInCycle } from './workspace/focus-move.js';
export type { Rect, Direction } from './workspace/focus-move.js';

// Editor domain (006): pure encoding/confinement/scope/registry/indicators/overlap
// + the editorPanelType descriptor. UI-main service/renderer consume these.
export {
  EDITOR_KIND,
  editorPanelType,
  type EditorValues,
  type EditorDocument,
  type EditorOwnerKind,
  NEW_DOCUMENT_NAME,
  isPathed,
  type DecodedFile,
  type EncodeOptions,
  detectEncoding,
  detectLineEnding,
  decode,
  encode,
  newDocumentDefaults,
  isProbablyBinary,
  type SaveConfinementKind,
  type SaveConfinement,
  isWithinTree,
  isOutsideAllProjects,
  resolveSaveConfinement,
  resolveDrop,
  type DropCandidate,
  type DropDecision,
  type DropRejection,
  type SaveAllScope,
  type ScopeEditor,
  type ScopeContext,
  editorsInScope,
  partitionByPathed,
  type OpenDocEntry,
  type OpenDocRegistry,
  type OpenDecision,
  createOpenRegistry,
  isOpenAnywhere,
  openOrFocus,
  registerOpen,
  unregisterPath,
  unregisterPanel,
  panelUnsaved,
  tabUnsaved,
  projectUnsaved,
  projectRootWouldContainOpenEditor,
  editorPathParts,
  toDisplayPath,
  type EditorPathParts,
  // Language registry, extension-only detection, bounded indentation inference (016).
  type IndentProfile,
  SHIPPED_INDENT_BY_LANGUAGE,
  type LanguageDescriptor,
  type LanguageResolution,
  type LanguageSource,
  type ResolveLanguageArgs,
  type InferredIndent,
  LANGUAGES,
  PLAIN_TEXT_ID,
  PLAIN_TEXT_NAME,
  languageById,
  languageName,
  isKnownLanguage,
  detectLanguage,
  resolveLanguage,
  inferIndent,
  // Rectangular (column) selection (016, US6).
  columnAt,
  isRectangular,
  offsetAt,
  padding,
  rectPaste,
  rowsOf,
  seedFromSelections,
  type PadStyle,
  type RectPasteChange,
  type RowSpan,
} from './editor/index.js';

// Typed panels (005): the pure panel-type registry + assignment ops, and the
// Terminal panel type. The renderer's type-selection form is generic over these.
export type {
  PanelTypeDescriptor,
  PanelTypeInputSpec,
  PanelTypeContext,
  PanelTypeValues,
  ValidationResult,
  FlavourOption,
  PanelTypeRegistry,
} from './panel-type/index.js';
export {
  createPanelTypeRegistry,
  defaultPanelTypeRegistry,
  setPanelType,
  clearPanelType,
  updatePanelConfig,
} from './panel-type/index.js';
export {
  TERMINAL_KIND,
  terminalPanelType,
  type TerminalPanelConfig,
  type TerminalValues,
  mergeFlavours,
  type TerminalFlavour,
  validateFlavourRecord,
  checkFlavourRecord,
  type FlavourProblem,
  BUILTIN_FLAVOUR_DEFAULT_PARAMS,
  resolveDefaultParams,
  resolveLaunchSpec,
  tokenizeParams,
  type LaunchSpec,
  type LaunchFlavour,
  isBusy,
  shouldCloseOnOwnerClose,
  attachDecision,
  resolveShellFile,
  type ShellProbe,
  type ShellResolver,
  canRunAsAdmin,
  shouldRespawnDaemonElevated,
  shouldDeElevate,
  KITTY_DISAMBIGUATE,
  WIN32_INPUT_MODE,
  createKittyKeyboardState,
  kittyKeyboardActive,
  win32InputActive,
  applyDecPrivateMode,
  kittySet,
  kittyPush,
  kittyPop,
  kittyQueryReply,
  applyKittyCsi,
  encodeEnterKey,
  type KittyKeyboardState,
  type KittyCsiPrefix,
  type KittyCsiResult,
  type KeyChord,
} from './terminal/index.js';
export {
  countPanels,
  collectPanels,
  validateMainLayout,
  isMainLayoutValid,
} from './workspace/invariants.js';
export {
  createDefaultLayout,
  addTab,
  addPanel,
  movePanelToEdge,
  movePanelToTab,
  addTabFromPanel,
  removePanel,
  reorderTab,
  setActiveTab,
  renameTab,
  renamePanel,
  closeTab,
  closeOtherTabs,
  resizeSplit,
  setActivePanel,
  panelAfterRemoval,
  effectiveActivePanelId,
  activeContextLabel,
  panelZoomLevel,
  bumpZoom,
  resetZoom,
} from './workspace/operations.js';
export type { Edge, NewTabIds } from './workspace/operations.js';
export {
  detachPanel,
  detachTab,
  addTabToSubWorkspace,
  addPanelToSubWorkspace,
  reattachPanel,
  canReattachPanel,
  validateSubWorkspace,
  nextSubWorkspaceName,
  nextSubWorkspaceTabName,
  pickUnusedColour,
  renameSubWorkspace,
  recolourSubWorkspace,
  removePanelFromSubWorkspace,
  stripPanelFromSubWorkspaces,
  findPanelLocations,
  DEFAULT_SUBWORKSPACE_NAME,
  DEFAULT_SUBWORKSPACE_COLOUR,
  SUBWORKSPACE_PALETTE,
} from './workspace/sub-workspace.js';
export type { SubWorkspaceIdentity } from './workspace/sub-workspace.js';
export {
  planConfirmations,
  findProjectPanelsInSubWorkspaces,
  canDestroyProject,
} from './workspace/destroy.js';
export type {
  DestroyTarget,
  ConfirmPlan,
  DestroyConfirmSettings,
  BlockingLocation,
} from './workspace/destroy.js';

// Persistence ports (research D4) — implemented by the daemon's repositories.
export type { IProjectStore } from './ports/project-store.js';
export type { IWorkspaceStore, WorkspaceLoadResult } from './ports/workspace-store.js';
export type { ISubWorkspaceStore, SubWorkspaceMeta } from './ports/subworkspace-store.js';

// Note: the OS contract-test helpers are intentionally NOT re-exported here.
// They live behind the "@throng/core/testing" subpath export so test utilities
// stay out of the production API surface.

// 018 / US4 — the themed colour picker's pure core. There was NO colour validation before this:
// the control committed raw text on every keystroke, so `zzz` went into the theme file on disk.
export type { Hsv } from './config/colour.js';
export { parseHex, isValidHex, toHex, rgbToHsv, hsvToRgb } from './config/colour.js';

// 018 / US7 — digit grouping. Strictly a VIEW concern: the parser is the exact inverse of the
// formatter for the active locale, so a grouping character can never reach a settings file.
export { formatGrouped, parseGrouped } from './config/number-format.js';
