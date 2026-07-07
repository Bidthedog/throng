// Public surface of the platform- and process-agnostic core (Principles II/VIII/X).
// Contains zero OS, Electron, or process-specific calls (verified by the
// structural guard test in tests/unit/no-os-imports.test.ts).
//
// Exports grow per implementation phase; each addition keeps the tree compiling.

export type { IPlatformInfo, OsName } from './abstractions/platform-info.js';
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

// User-scoped application configuration (003): abstractions + pure schemas.
export type { IConfigStore, ConfigDocId, ConfigReadOptions } from './abstractions/config-store.js';
export type { IFileWatcher, Disposable } from './abstractions/file-watcher.js';

// File Explorer tree (004): OS seams + pure domain.
export type { IFileSystem, DirEntry } from './abstractions/file-system.js';
export type { IShellIntegration } from './abstractions/shell-integration.js';
export type { FileNode, NodeKind, RenameResult, DedupeStyle, DragModifiers, DragEffect, ClickAction, ExpandNode, TargetNode } from './explorer/index.js';

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
  OpenMode,
  DeleteMode,
  TerminalSettings,
  TerminalFlavourConfig,
  EditorSettings,
  EditorOpenOnClick,
  SaveAllScopeSetting,
  DefaultLineEnding,
  EditorPathDisplay,
} from './config/app-settings.js';
export { DEFAULT_APP_SETTINGS, parseAppSettings } from './config/app-settings.js';
export type { Keybindings, ActionId, KeyEvent } from './config/keybindings.js';
export {
  DEFAULT_KEYBINDINGS,
  parseKeybindings,
  eventToToken,
  normalizeToken,
  resolveAction,
} from './config/keybindings.js';
export type { Theme, ThemeFonts } from './config/theme.js';
export { THRONG_THEME, resolveColour, resolveIcon, toCssVariables } from './config/theme.js';

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
  effectiveActivePanelId,
  activeContextLabel,
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
