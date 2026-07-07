/**
 * Exclude-glob matching for the file tree (004, FR-005a, research D12). Hides
 * entries whose root-relative path matches the active glob list. The default
 * list is the VS Code `files.exclude` defaults. Pure (picomatch is pure JS).
 */
import picomatch from 'picomatch';

/** Default exclude globs — the VS Code `files.exclude` defaults (canonical order). */
export const DEFAULT_EXCLUDE_GLOBS: readonly string[] = [
  '**/.git',
  '**/.svn',
  '**/.hg',
  '**/CVS',
  '**/.DS_Store',
  '**/Thumbs.db',
];

/**
 * True when `relPath` (root-relative, POSIX) matches any of `globs`. `dot: true`
 * so dotted names (`.git`, `.DS_Store`) match. An empty glob list excludes nothing.
 */
export function isExcluded(relPath: string, globs: readonly string[]): boolean {
  if (globs.length === 0 || relPath.length === 0) return false;
  const isMatch = picomatch(globs as string[], { dot: true });
  return isMatch(relPath);
}
