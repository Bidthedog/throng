/** Public surface of the pure terminal domain (005). Grows across Phases B/C. */
export {
  TERMINAL_KIND,
  terminalPanelType,
  readTerminalPanelConfig,
  SHIPPED_TERMINAL_PANEL_DEFAULTS,
  type TerminalPanelConfig,
  type TerminalValues,
} from './panel-type.js';
export { mergeFlavours, type TerminalFlavour } from './flavour.js';
export {
  validateFlavourRecord,
  checkFlavourRecord,
  type FlavourProblem,
} from './flavour-record.js';
export { BUILTIN_FLAVOUR_DEFAULT_SHELL_ARGUMENTS, resolveDefaultShellArguments } from './defaults.js';
export {
  BUILTIN_FLAVOUR_COMMAND_RECIPES,
  COMMAND_PLACEHOLDER,
  expandCommandRecipe,
  isValidCommandRecipe,
  resolveCommandRecipe,
  prepareStartupCommand,
  resolveShellIntegration,
  resolveShellIntegrationEnv,
  BASH_PROMPT_COMMAND,
  BUILTIN_SHELL_INTEGRATION_ENV,
  flavourReportsDirectory,
  BUILTIN_SHELL_INTEGRATION,
} from './command-recipe.js';
export { quoteDropPath, formatDroppedPaths } from './drop-paths.js';
export { terminalLinkTarget } from './link-menu.js';
export {
  resolveLaunchSpec,
  tokenizeParams,
  type LaunchSpec,
  type LaunchFlavour,
} from './launch-spec.js';
export {
  isBusy,
  shouldCloseOnOwnerClose,
  attachDecision,
  shouldSurfaceExit,
  terminalExitNotice,
} from './lifecycle.js';
export { resolveShellFile, type ShellProbe, type ShellResolver } from './resolve-shell.js';
export { sanitizeSpawnEnv } from './spawn-env.js';
export { canRunAsAdmin, shouldRespawnDaemonElevated, shouldDeElevate } from './elevation.js';
export {
  KITTY_DISAMBIGUATE,
  WIN32_INPUT_MODE,
  BRACKETED_PASTE_MODE,
  createKittyKeyboardState,
  kittyKeyboardActive,
  win32InputActive,
  applicationReadingInput,
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
} from './kitty-keyboard.js';
export {
  captureDecision,
  foregroundCommand,
  normaliseCommand,
  isResolvedForm,
  isCapturableCommand,
  shouldNotifyCaptureOutcome,
  captureLogLine,
  MAX_CAPTURABLE_COMMAND_LENGTH,
  type CaptureOutcome,
  type CaptureReason,
} from './command-capture.js';
export {
  resolveStartDirectory,
  fallbackToReport,
  requestedStartDirectory,
} from './start-directory.js';
export { appendScrollback } from './scrollback-tail.js';
export {
  MOUSE_REPORTING_MODES,
  createMouseReportingState,
  decideWheel,
  type MouseReportingState,
  type WheelContext,
  type WheelRoute,
} from './wheel-decision.js';
export { trackAltScreen } from './alt-screen.js';
export { encodeModifiedKey, kittyReportsAllKeys, KITTY_REPORT_ALL_KEYS } from './kitty-keyboard.js';
export {
  terminalReloadAction,
  startsTerminal,
  changesDormancy,
  applyReloadMode,
  type TerminalReloadAction,
} from './reload-mode.js';
export {
  shouldWatchForRecovery,
  watchTargetFor,
  reconnectsReleasedBy,
  type PendingReconnect,
} from './reconnect.js';
