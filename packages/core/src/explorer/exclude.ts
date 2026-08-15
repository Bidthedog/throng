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
 * Compile a glob list ONCE into the predicate the tree and the file index both ask
 * (033, contracts/file-index.md §1).
 *
 * Compiling is the expensive half and it depends only on the LIST, so a walk over 50,000 paths
 * compiles once rather than 50,000 times. `dot: true` so dotted names (`.git`, `.DS_Store`) match.
 * An empty glob list excludes nothing and compiles nothing at all.
 */
export function compileExcluder(globs: readonly string[]): (relPath: string) => boolean {
  if (globs.length === 0) return () => false;
  const isMatch = picomatch(globs as string[], { dot: true });
  // The root itself has no relative path, and the project is never excluded from itself.
  return (relPath: string) => relPath.length > 0 && isMatch(relPath);
}

/**
 * True when `relPath` (root-relative, POSIX) matches any of `globs`.
 *
 * One call, one compile. Over a set of paths, compile once with `compileExcluder` and reuse it.
 */
export function isExcluded(relPath: string, globs: readonly string[]): boolean {
  return compileExcluder(globs)(relPath);
}
