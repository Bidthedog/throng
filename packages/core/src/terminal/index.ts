/** Public surface of the pure terminal domain (005). Grows across Phases B/C. */
export {
  TERMINAL_KIND,
  terminalPanelType,
  type TerminalPanelConfig,
  type TerminalValues,
} from './panel-type.js';
export { mergeFlavours, type TerminalFlavour } from './flavour.js';
export {
  validateFlavourRecord,
  checkFlavourRecord,
  type FlavourProblem,
} from './flavour-record.js';
export { BUILTIN_FLAVOUR_DEFAULT_PARAMS, resolveDefaultParams } from './defaults.js';
export {
  resolveLaunchSpec,
  tokenizeParams,
  type LaunchSpec,
  type LaunchFlavour,
} from './launch-spec.js';
export { isBusy, shouldCloseOnOwnerClose, attachDecision } from './lifecycle.js';
export { resolveShellFile, type ShellProbe, type ShellResolver } from './resolve-shell.js';
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
