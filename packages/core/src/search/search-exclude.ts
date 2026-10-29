import picomatch from 'picomatch';

/**
 * What a Find in Files scan skips (060 #532, FR-025–FR-030, research R19).
 *
 * Search no longer borrows the File Explorer's excluded globs or the project's hidden paths: those
 * decide what the TREE draws. A scan compiles one list, built here from three sources — the search
 * exclusion preference (switchable per panel), the project's own Hidden to Find & Replace list, and
 * the panel's box — so the rule that decides what is searched lives in one place.
 */

/**
 * The shipped search exclusion list (FR-026): the File Explorer's shipped globs AS THEY STOOD when
 * #532 was specified, then the build, cache, log, editor and lock-file patterns agreed with it.
 *
 * A literal copy rather than a spread of `DEFAULT_EXCLUDE_GLOBS`: the two lists are not linked
 * (FR-025), so a later addition to the explorer's defaults must not join search without a decision.
 */
export const DEFAULT_SEARCH_EXCLUDE_GLOBS: readonly string[] = Object.freeze([
  '**/.git',
  '**/.svn',
  '**/.hg',
  '**/CVS',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/node_modules',
  '**/dist',
  '**/build',
  '**/out',
  '**/coverage',
  '**/.claude',
  '**/.vscode',
  '**/.idea',
  '**/log',
  '**/logs',
  '**/*.log',
  '**/.remember',
  '**/.cache',
  '**/.turbo',
  '**/.next',
  '**/.nuxt',
  '**/target',
  '**/bin',
  '**/obj',
  '**/.venv',
  '**/__pycache__',
  '**/*.min.js',
  '**/*.map',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
]);

/** True when `glob` compiles. Unbalanced brackets and the like are refused, not guessed at. */
function isValidGlob(glob: string): boolean {
  try {
    picomatch.makeRe(glob, { strictBrackets: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * The panel's box (FR-029): semicolon-separated, trimmed, empty entries dropped. An entry that does
 * not compile is reported in `invalid` — for the box's one notice — and left out of `globs`, so the
 * rest of the box still applies.
 */
export function parseExcludeBox(text: string): { globs: string[]; invalid: string[] } {
  const globs: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(';')) {
    const entry = raw.trim();
    if (entry.length === 0) continue;
    (isValidGlob(entry) ? globs : invalid).push(entry);
  }
  return { globs, invalid };
}

/**
 * The one glob list a scan compiles (FR-027, FR-029, FR-030).
 *
 * The project's list and the panel's box always apply; the global list only while the panel's
 * toggle is on. Every entry is given as itself AND `entry/**`, so a glob naming a folder excludes
 * everything beneath it however the walk reaches it — `hiddenPathGlobs`' rule, for the same reason.
 * Invalid entries are dropped here too, so a hand-edited setting cannot fail a scan.
 */
export function searchExcludeGlobs(lists: {
  global: readonly string[];
  useGlobal: boolean;
  project: readonly string[];
  extra: readonly string[];
}): string[] {
  const out: string[] = [];
  const add = (entries: readonly string[]): void => {
    for (const raw of entries) {
      const entry = typeof raw === 'string' ? raw.trim() : '';
      if (entry.length === 0 || !isValidGlob(entry)) continue;
      out.push(entry, `${entry.replace(/\/+$/, '')}/**`);
    }
  };
  if (lists.useGlobal) add(lists.global);
  add(lists.project);
  add(lists.extra);
  return out;
}

const GLOB_METACHARACTERS = /[\\*?[\]{}()!+@|^$]/g;

/**
 * A path chosen from a menu ("Exclude from Find in Files in this project", FR-033, FR-034) as the
 * glob that matches exactly it: normalised to project-relative POSIX, every glob metacharacter
 * escaped. `searchExcludeGlobs` adds its subtree.
 */
export function pathToSearchGlob(relPath: string): string {
  const rel = relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return rel.replace(GLOB_METACHARACTERS, (c) => `\\${c}`);
}
