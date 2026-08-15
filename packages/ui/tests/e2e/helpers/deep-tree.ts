/**
 * 033 — the project fixture Quick Open is asserted against (#219).
 *
 * One temp project root, shaped so that each claim the feature makes has something to be true OF:
 *
 *  - **Nested folders several levels deep** — `src/app/components/widgets/deep-widget.ts` is five
 *    segments down, so "the walk descends" is not a one-level statement.
 *  - **A `node_modules/` folder and a `.git/` folder** — both excluded by the shipped defaults since
 *    FR-070, and both materialised so "nothing leaked" has something to be true of.
 *  - **Two files sharing a basename in different folders** (SC-003) — `src/app/config.ts` and
 *    `src/server/config.ts`. A row showing only `config.ts` twice is indistinguishable to the user,
 *    so the rows must carry the full root-relative path, and this pair is what proves they do.
 *  - **A name match and a directory-only match for one query** (SC-013, FR-007a) — see below.
 *
 * ══ `node_modules` AND `.git` ARE BOTH EXCLUDED BY DEFAULT (FR-070, since 2026-08-15) ══
 *
 * The shipped `DEFAULT_EXCLUDE_GLOBS` (`packages/core/src/explorer/exclude.ts`) is the VS Code
 * `files.exclude` default list — a doubled-star glob for each of `.git`, `.svn`, `.hg`, `CVS`,
 * `.DS_Store` and `Thumbs.db` — **plus `**\/node_modules`**, which FR-070 added because FR-006's
 * whole claim is that there is one answer to "is this file hidden?" and a dependency tree the user
 * never edits was the loudest place that answer was wrong.
 *
 * This inverted: before FR-070 a project on default settings DID list `node_modules` files, and this
 * comment said so in terms. If you are reading a spec written against the old behaviour, that is why.
 *
 *  - {@link DeepTree.excludedByDefaults} — hidden with no configuration at all: the `.git` file AND
 *    the `node_modules` file.
 *  - {@link DeepTree.listedByDefaults} — everything the app lists as shipped.
 *
 * The globs come from the real exported constant, never a copy. {@link createDeepTree} additionally
 * re-checks the two folders against `isExcluded` at build time, so if the shipped list ever changes
 * the fixture fails loudly with a message naming the drift, rather than quietly describing a project
 * that no longer exists. It is the guard that made FR-070 safe to make, and it must keep working in
 * the other direction — so it is re-pointed at the new expectation, never removed.
 *
 * ══ THE HIDDEN-PATH HALF (FR-069a, SC-022) ══
 *
 * {@link DEEP_TREE.hidable} names a plain `src/…` file that NO glob touches, so a spec can hide it
 * through "Hide in this project" and prove the per-project hidden set independently of the globs.
 * SC-018 requires both halves asserted separately, which needs two distinct files — one hidden by
 * each mechanism — and this is the second of them.
 *
 * ══ WHY THE RANKING PAIR IS THIS PAIR ══
 *
 * Query `router` matches exactly two files:
 *
 *   src/router/handlers.ts   — the term is in a DIRECTORY segment only
 *   src/server/router.ts     — the term is in the FILE NAME
 *
 * K1 says the name hit outranks the directory-only hit. The index is produced SORTED (W7), and
 * `src/router/…` sorts before `src/server/…`, so the seeded order puts the directory match first: the
 * ranker has to actually reorder them for the assertion to pass. A fixture where the right answer is
 * already first would pass against no ranking at all — which is the difference between a test and a
 * decoration. No other path in the tree contains `router`, so the two-row result is exact.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_EXCLUDE_GLOBS, isExcluded } from '@throng/core';
import { cleanupTemp } from '../harness.js';

/** The paths a spec refers to by name, so no assertion has to re-derive one. */
export const DEEP_TREE = {
  /** SC-003 — one basename, two folders. Only the full path tells them apart. */
  sharedBasename: {
    query: 'config',
    inApp: 'src/app/config.ts',
    inServer: 'src/server/config.ts',
  },
  /** SC-013 / FR-007a — one query, a name hit and a directory-only hit. */
  ranking: {
    query: 'router',
    /** Must rank FIRST (K1). Sorts second, so the order is evidence. */
    byName: 'src/server/router.ts',
    /** Must rank SECOND. Sorts first. */
    byDirectory: 'src/router/handlers.ts',
  },
  /** Five segments down — the deepest file in the tree. */
  deepFile: 'src/app/components/widgets/deep-widget.ts',
  /**
   * A term carried ONLY by files inside the excluded folders, so "nothing leaked" is a positive
   * query with an expected result of zero rows rather than an absence argued from a long list.
   */
  excludedQuery: 'quarantined',
  /**
   * The file SC-018's second half is about (FR-069a): hidden by **"Hide in this project"**, which
   * no glob in the shipped list touches.
   *
   * Deliberately not a `.ts` file — `.ts` is a live query in `quick-open.e2e.ts` with an exact row
   * count, and a fixture file that quietly joined that result set would make an unrelated assertion
   * a maintenance burden every time this fixture grew. Its query term appears in no other path, so
   * "one row" and "no rows" are both exact.
   */
  hidable: {
    query: 'hidden-in-project',
    path: 'src/hidden-in-project.txt',
  },
} as const;

/** Every file written, root-relative POSIX, sorted — the order `walkFiles` produces (W7). */
const ALL_FILES: readonly string[] = [
  '.git/quarantined-object.txt',
  'README.md',
  'docs/guide.md',
  'node_modules/quarantined-pkg/quarantined-module.ts',
  'src/app/components/widgets/deep-widget.ts',
  'src/app/config.ts',
  'src/hidden-in-project.txt',
  'src/router/handlers.ts',
  'src/server/config.ts',
  'src/server/router.ts',
].sort();

/** The folders the exclusion claims are about, and whether the SHIPPED defaults hide each. */
const EXCLUDABLE_FOLDERS: readonly { relPath: string; hiddenByDefaults: boolean }[] = [
  { relPath: '.git', hiddenByDefaults: true },
  // FR-070 — `**/node_modules` joined DEFAULT_EXCLUDE_GLOBS. This row inverted with it.
  { relPath: 'node_modules', hiddenByDefaults: true },
];

/** How many lines each fixture file holds — enough for a Go To Line target that is not line 1. */
export const DEEP_TREE_FILE_LINES = 40;

export interface DeepTree {
  /** The project root, absolute. Hand this to `createProject`. */
  readonly root: string;
  /** Every file on disk, root-relative POSIX, sorted. */
  readonly all: readonly string[];
  /** Hidden by `DEFAULT_EXCLUDE_GLOBS` with no configuration — the `.git` and `node_modules` files. */
  readonly excludedByDefaults: readonly string[];
  /** What the app lists as shipped. Neither `.git` nor `node_modules` is in here (FR-070). */
  readonly listedByDefaults: readonly string[];
}

/**
 * Materialise the fixture under the run's own temp directory and hand back what it contains.
 *
 * `mkdtempSync(join(tmpdir(), …))` is the shape every spec in this suite already uses: `tmpdir()`
 * resolves inside the per-run `throng_e2e_<runhash>` folder, so a crash leaves one collectable
 * directory and `globalTeardown` sweeps whatever a locked handle refused to release.
 */
export function createDeepTree(prefix = 'throng-deeptree-'): DeepTree {
  assertShippedDefaultsUnchanged();

  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const relPath of ALL_FILES) {
    const segments = relPath.split('/');
    const name = segments.pop()!;
    const dir = segments.length === 0 ? root : join(root, ...segments);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), bodyFor(relPath), 'utf8');
  }

  const excludedByDefaults = ALL_FILES.filter(
    (relPath) => relPath.startsWith('.git/') || relPath.startsWith('node_modules/'),
  );
  const listedByDefaults = ALL_FILES.filter((relPath) => !excludedByDefaults.includes(relPath));

  return { root, all: ALL_FILES, excludedByDefaults, listedByDefaults };
}

/**
 * Remove the fixture.
 *
 * Synchronous and forgiving of a held handle, because it delegates to the harness's `cleanupTemp` —
 * the same call every spec's `finally` already makes (#211: a temp directory Windows will not unlink
 * is not a product defect and must not be reported as one).
 */
export function cleanupDeepTree(tree: DeepTree): void {
  cleanupTemp(tree.root);
}

/**
 * Guard the two facts this fixture's expectations rest on, against the SHIPPED constant.
 *
 * Checked on the FOLDER paths, not on the files beneath them, because that is what the walk does:
 * the shipped `.git` glob matches `.git` itself, and an excluded folder is never descended into
 * (W3), so no file under it is ever tested against a glob. Checking
 * `.git/quarantined-object.txt` would report `false` and be read as a bug in the excluder.
 */
function assertShippedDefaultsUnchanged(): void {
  for (const folder of EXCLUDABLE_FOLDERS) {
    const actual = isExcluded(folder.relPath, DEFAULT_EXCLUDE_GLOBS);
    if (actual !== folder.hiddenByDefaults) {
      throw new Error(
        `deep-tree fixture is stale: DEFAULT_EXCLUDE_GLOBS now ${actual ? 'excludes' : 'does not exclude'} ` +
          `"${folder.relPath}", but the fixture's expectations were written for the opposite. ` +
          `Update helpers/deep-tree.ts (excludedByDefaults / listedByDefaults) before trusting any ` +
          `spec that uses it.`,
      );
    }
  }
}

/** Deterministic content: the path on line 1, then numbered lines, so a line is identifiable. */
function bodyFor(relPath: string): string {
  const lines = [`// ${relPath}`];
  for (let n = 2; n <= DEEP_TREE_FILE_LINES; n += 1) lines.push(`line ${n}`);
  return `${lines.join('\n')}\n`;
}
