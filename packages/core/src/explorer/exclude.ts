/**
 * Exclude-glob matching for the file tree (004, FR-005a, research D12). Hides
 * entries whose root-relative path matches the active glob list. The default
 * list is the VS Code `files.exclude` defaults. Pure (picomatch is pure JS).
 */
import picomatch from 'picomatch';

/**
 * Default exclude globs — the VS Code `files.exclude` defaults, plus `**\/node_modules` (FR-070).
 *
 * The first six are the VS Code list verbatim, in its canonical order, and they are what this
 * constant shipped as up to and including shipped-defaults version 4.
 *
 * The seventh is throng's own, added by 033 FR-070 and NOT part of the VS Code list. It changes the
 * Files & Folders tree for every project on the shipped default, which is the intent rather than a
 * side effect: FR-006's whole claim is that there is one answer to "is this file hidden?", and a
 * dependency tree the user never edits was the loudest place that answer was the wrong one.
 *
 * Adding an entry here reaches FRESH installs only. First-run `seed()` materialises the whole
 * settings document, so an existing install holds the previous array literally and `parseAppSettings`
 * honours it — reaching those users needs the `SHIPPED_DEFAULTS_VERSION` bump and the guarded
 * settings migration in `shipped-defaults.ts` as well (FR-070a). See `V4_EXCLUDE_GLOBS` there.
 */
export const DEFAULT_EXCLUDE_GLOBS: readonly string[] = [
  // The VS Code `files.exclude` defaults.
  '**/.git',
  '**/.svn',
  '**/.hg',
  '**/CVS',
  '**/.DS_Store',
  '**/Thumbs.db',
  // throng's own (033, FR-070).
  '**/node_modules',
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
 * Every character picomatch would read as a PATTERN rather than as itself.
 *
 * `/` is deliberately absent: a hidden path is a root-relative POSIX path and its separators are
 * separators. Everything else here would silently change which files a literal name matches.
 */
const GLOB_METACHARACTERS = /[\\*?[\]{}()!+@|^$]/g;

/**
 * Turn the per-project hidden set (004, "Hide in this project") into globs for {@link compileExcluder}
 * (033, FR-069a, plan D3).
 *
 * ══ WHY GLOBS, AND NOT A SET ══
 *
 * The tree hides a folder by REMOVING ITS NODE, so its descendants disappear implicitly and nobody
 * ever had to think about them. The file index is FLAT, so a `hidden.has(rel)` there would hide
 * `docs` — which is not even in the index, because the index holds files — and go on listing
 * `docs/guide.md`. Each entry therefore becomes TWO patterns, `p` and `p/**`.
 *
 * ══ WHY THIS IS NOT A SECOND EXCLUSION MECHANISM (FR-069c) ══
 *
 * Its output is APPENDED to the glob list and compiled by the same `compileExcluder`, so there is
 * exactly one predicate in the system and therefore exactly one answer to "is this file hidden?".
 * That is FR-069c satisfied by construction rather than by care — there is no second rule set that
 * could drift from the first, because there is no second rule set.
 *
 * ══ WHY THE ESCAPING IS LOAD-BEARING ══
 *
 * A hidden path is a LITERAL and a glob is a pattern. A file genuinely named `a[1].ts` becomes a
 * character class if it is used as a pattern unhandled — which matches `a1.ts` and not `a[1].ts`, so
 * hiding one file would hide a different one and leave the chosen one visible.
 */
export function hiddenPathGlobs(paths: readonly string[]): string[] {
  const globs: string[] = [];
  for (const raw of paths) {
    if (typeof raw !== 'string') continue;
    // Roots and their descendants reach this layer as both `a/b` and `a\b` (#229), and a hidden path
    // written with a leading slash is the same path. Normalise before escaping, never after — the
    // escape would otherwise turn the separator into a literal backslash.
    const rel = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (rel.length === 0) continue; // an empty pattern matches at the root — the whole project
    const literal = rel.replace(GLOB_METACHARACTERS, (c) => `\\${c}`);
    globs.push(literal, `${literal}/**`);
  }
  return globs;
}

/**
 * True when `relPath` (root-relative, POSIX) matches any of `globs`.
 *
 * One call, one compile. Over a set of paths, compile once with `compileExcluder` and reuse it.
 */
export function isExcluded(relPath: string, globs: readonly string[]): boolean {
  return compileExcluder(globs)(relPath);
}
