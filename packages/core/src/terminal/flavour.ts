/**
 * Terminal flavour domain (005 Phase B): the merged catalogue the Flavour dropdown
 * shows — built-ins detected on the machine (minus disabled) ∪ user-defined
 * flavours from settings, deduped by id with user entries winning (FR-010/010a).
 */
import type { DetectedShell } from '../abstractions/shell-detection.js';
import type { TerminalSettings } from '../config/app-settings.js';
import { resolveDefaultParams } from './defaults.js';

/** A flavour available to a Terminal Panel — the Flavour dropdown's source. */
export interface TerminalFlavour {
  id: string;
  label: string;
  /** Executable path or command. */
  file: string;
  /** Base args inherent to launching it (before user Startup Params). */
  args: string[];
  /** Whether it came from the built-in catalogue or the user's settings. */
  source: 'builtin' | 'user';
  /** Resolved default Startup Params pre-filled when chosen. */
  defaultParams: string;
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
    defaultParams: resolveDefaultParams(f.id, 'user', f, settings),
  }));
  const builtins: TerminalFlavour[] = detected
    .filter((d) => !disabled.has(d.id))
    .map((d) => ({
      id: d.id,
      label: d.label,
      file: d.file,
      args: [...d.defaultArgs],
      source: 'builtin',
      defaultParams: resolveDefaultParams(d.id, 'builtin', undefined, settings),
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
