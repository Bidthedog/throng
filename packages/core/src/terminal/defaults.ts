/**
 * Per-flavour default Shell Arguments (005 Phase B; renamed in 025). Built-in flavours carry a
 * documented catalogue default (PowerShell `-NoLogo`, CMD `/K`, Git Bash `-i -l`);
 * a `settings.terminals.defaultShellArguments[id]` entry overrides it (Principle X), and a
 * user-defined flavour falls back to its own `defaultShellArguments`.
 */
import type { TerminalFlavourConfig, TerminalSettings } from '../config/app-settings.js';

/** Built-in catalogue: flavour id → its documented default Shell Arguments. */
export const BUILTIN_FLAVOUR_DEFAULT_SHELL_ARGUMENTS: Record<string, string> = {
  'windows-powershell': '-NoLogo',
  pwsh: '-NoLogo',
  cmd: '/K',
  'git-bash': '-i -l',
};

/**
 * Resolve the default Shell Arguments for a flavour. Precedence:
 * `settings.defaultShellArguments[id]` (explicit override) → the user entry's own
 * `defaultShellArguments` (user flavours) or the built-in catalogue default (built-ins) →
 * empty string.
 */
export function resolveDefaultShellArguments(
  id: string,
  source: 'builtin' | 'user',
  userEntry: TerminalFlavourConfig | undefined,
  settings: TerminalSettings,
): string {
  const override = settings.defaultShellArguments[id];
  if (typeof override === 'string') return override;
  if (source === 'user') return userEntry?.defaultShellArguments ?? '';
  return BUILTIN_FLAVOUR_DEFAULT_SHELL_ARGUMENTS[id] ?? '';
}
