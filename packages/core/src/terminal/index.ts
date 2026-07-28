/** Public surface of the pure terminal domain (005). Grows across Phases B/C. */
export {
  TERMINAL_KIND,
  terminalPanelType,
  readTerminalPanelConfig,
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
} from './lifecycle.js';
export { resolveShellFile, type ShellProbe, type ShellResolver } from './resolve-shell.js';
export { sanitizeSpawnEnv } from './spawn-env.js';
export { canRunAsAdmin, shouldRespawnDaemonElevated, shouldDeElevate } from './elevation.js';
export {
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
} from './kitty-keyboard.js';
export {
  captureDecision,
  foregroundCommand,
  isCapturableCommand,
  shouldNotifyCaptureOutcome,
  captureLogLine,
  MAX_CAPTURABLE_COMMAND_LENGTH,
  type CaptureOutcome,
  type CaptureReason,
} from './command-capture.js';
export { resolveStartDirectory } from './start-directory.js';
