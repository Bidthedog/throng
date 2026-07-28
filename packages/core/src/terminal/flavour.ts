/**
 * Terminal flavour domain (005 Phase B): the merged catalogue the Flavour dropdown
 * shows — built-ins detected on the machine (minus disabled) ∪ user-defined
 * flavours from settings, deduped by id with user entries winning (FR-010/010a).
 */
import type { DetectedShell } from '../abstractions/shell-detection.js';
import type { TerminalSettings } from '../config/app-settings.js';
import { resolveDefaultShellArguments } from './defaults.js';
import {
  flavourReportsDirectory,
  resolveCommandRecipe,
  resolveShellIntegration,
} from './command-recipe.js';

/** A flavour available to a Terminal Panel — the Flavour dropdown's source. */
export interface TerminalFlavour {
  id: string;
  label: string;
  /** Executable path or command. */
  file: string;
  /** Base args inherent to launching it (before the user's Shell Arguments). */
  args: string[];
  /** Whether it came from the built-in catalogue or the user's settings. */
  source: 'builtin' | 'user';
  /** Resolved default Shell Arguments pre-filled when chosen. */
  defaultShellArguments: string;
  /** Resolved recipe for handing this flavour a Startup Command (025 FR-010/FR-011).
   *  Absent → the universal PTY-write fallback (FR-012). */
  commandRecipe?: readonly string[];
  /** Snippet asking this shell to report its cwd (025 follow-up). */
  shellIntegration?: string;
  /** Whether this flavour can report its directory as configured — gates the Reopen control. */
  reportsDirectory: boolean;
}

/**
 * Merge machine-detected built-ins with user-defined flavours. User entries are
 * listed first and win on an id collision (dedupe keeps the first occurrence);
 * built-ins named in `disabledBuiltins` are omitted.
 */
export function mergeFlavours(
  detected: DetectedShell[],
  settings: TerminalSettings,
): TerminalFlavour[] {
  const disabled = new Set(settings.disabledBuiltins);
  const users: TerminalFlavour[] = settings.flavours.map((f) => ({
    id: f.id,
    label: f.label,
    file: f.file,
    args: [...f.args],
    source: 'user',
    defaultShellArguments: resolveDefaultShellArguments(f.id, 'user', f, settings),
    commandRecipe: resolveCommandRecipe(f.id, 'user', f, settings),
    shellIntegration: resolveShellIntegration(f.id, settings.shellIntegration),
    reportsDirectory: flavourReportsDirectory(f.id, settings.shellIntegration),
  }));
  const builtins: TerminalFlavour[] = detected
    .filter((d) => !disabled.has(d.id))
    .map((d) => ({
      id: d.id,
      label: d.label,
      file: d.file,
      args: [...d.defaultArgs],
      source: 'builtin',
      defaultShellArguments: resolveDefaultShellArguments(d.id, 'builtin', undefined, settings),
      commandRecipe: resolveCommandRecipe(d.id, 'builtin', undefined, settings),
      shellIntegration: resolveShellIntegration(d.id, settings.shellIntegration),
      reportsDirectory: flavourReportsDirectory(d.id, settings.shellIntegration),
    }));
  return dedupeById([...users, ...builtins]);
}

function dedupeById(list: TerminalFlavour[]): TerminalFlavour[] {
  const seen = new Set<string>();
  const out: TerminalFlavour[] = [];
  for (const flavour of list) {
    if (seen.has(flavour.id)) continue;
    seen.add(flavour.id);
    out.push(flavour);
  }
  return out;
}
