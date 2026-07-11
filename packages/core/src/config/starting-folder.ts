/**
 * New-project folder-picker starting-location resolution (011, US3, FR-040/041/043).
 *
 * Pure: returns the *candidate* starting folder for the OS folder dialog. Existence
 * and drive-availability are OS-specific and validated in UI-main, which falls back
 * to the profile folder when the candidate cannot be resolved (Principle II). This
 * module never touches the filesystem.
 */
import type { NewProjectSettings } from './app-settings.js';

/** The newProject fields the resolver needs (a subset of {@link NewProjectSettings}). */
export type StartingFolderConfig = Pick<
  NewProjectSettings,
  'startingFolder' | 'overridePath' | 'lastProjectFolder'
>;

export interface StartingFolderContext {
  /** The logged-in OS user's profile/home directory — the universal fallback. */
  profileDir: string;
}

/**
 * The ordered list of candidate folders the new-project picker should try, most
 * preferred first. UI-main opens the dialog at the FIRST candidate that resolves to
 * a real directory, silently cascading to the next when one cannot be resolved
 * (never existed, deleted, or a disconnected/inaccessible drive), and finally to the
 * profile/home folder (FR-043):
 * - `profile`    -> [profile]
 * - `lastViewed` -> [last chosen project folder, profile]
 * - `override`   -> [override path, last chosen project folder, profile]
 *
 * Blank candidates are dropped (e.g. a renderer that leaves the profile dir to
 * UI-main passes `profileDir: ''`), and duplicates are removed while preserving
 * order. The returned paths are only *candidates*: existence is verified in UI-main.
 */
export function resolveStartingFolder(
  cfg: StartingFolderConfig,
  ctx: StartingFolderContext,
): string[] {
  const ordered: string[] = [];
  switch (cfg.startingFolder) {
    case 'profile':
      ordered.push(ctx.profileDir);
      break;
    case 'override':
      ordered.push(cfg.overridePath, cfg.lastProjectFolder, ctx.profileDir);
      break;
    case 'lastViewed':
    default:
      ordered.push(cfg.lastProjectFolder, ctx.profileDir);
      break;
  }
  const seen = new Set<string>();
  return ordered.filter((p) => {
    if (p.trim().length === 0 || seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

/**
 * Whether a configured override path is resolvable (FR-044). A blank override is
 * not "unresolvable" in the error sense, but it is not a usable override either —
 * treat blank as not resolvable so the settings editor can flag a set-but-missing
 * override. `exists` is injected so this stays pure/testable.
 */
export function isOverrideResolvable(
  overridePath: string,
  exists: (path: string) => boolean,
): boolean {
  if (overridePath.trim().length === 0) return false;
  return exists(overridePath);
}
