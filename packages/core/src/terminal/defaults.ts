/**
 * Per-flavour default Startup Params (005 Phase B). Built-in flavours carry a
 * documented catalogue default (PowerShell `-NoLogo`, CMD `/K`, Git Bash `-i -l`);
 * a `settings.terminals.defaultParams[id]` entry overrides it (Principle X), and a
 * user-defined flavour falls back to its own `defaultParams`.
 */
import type { TerminalFlavourConfig, TerminalSettings } from '../config/app-settings.js';

/** Built-in catalogue: flavour id → its documented default Startup Params. */
export const BUILTIN_FLAVOUR_DEFAULT_PARAMS: Record<string, string> = {
  'windows-powershell': '-NoLogo',
  pwsh: '-NoLogo',
  cmd: '/K',
  'git-bash': '-i -l',
};

/**
 * Resolve the default Startup Params for a flavour. Precedence:
 * `settings.defaultParams[id]` (explicit override) → the user entry's own
 * `defaultParams` (user flavours) or the built-in catalogue default (built-ins) →
 * empty string.
 */
export function resolveDefaultParams(
  id: string,
  source: 'builtin' | 'user',
  userEntry: TerminalFlavourConfig | undefined,
  settings: TerminalSettings,
): string {
  const override = settings.defaultParams[id];
  if (typeof override === 'string') return override;
  if (source === 'user') return userEntry?.defaultParams ?? '';
  return BUILTIN_FLAVOUR_DEFAULT_PARAMS[id] ?? '';
}
