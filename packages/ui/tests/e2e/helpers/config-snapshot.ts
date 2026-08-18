import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ALL_DEFAULT_THEMES } from '@throng/core';
import { writeConfigAtomic } from './config-write.js';

/**
 * 034 (FR-045, SC-010) — return a RUNNING app's config root to a known state, so a preferences
 * spec can share one Electron launch across its whole file.
 *
 * ══ WHY THIS EXISTS ══
 *
 * The `@prefs` family spent 88 Electron launches — one per test — on the stated grounds that "every
 * test seeds THRONG_CONFIG_ROOT before the app starts". That was mostly untrue: the majority call
 * their `freshCfgRoot()` with NO arguments, so the isolated root exists for write ISOLATION between
 * tests, not for pre-launch state. What those tests actually need is not a fresh PROCESS, it is a
 * config root that looks untouched at the start of each test.
 *
 * Rewriting a running app's config root is already how this suite works — `config-hotreload.e2e.ts`
 * and `keybindings.e2e.ts` both do it, through {@link writeConfigAtomic}, and the app hot-reloads.
 * The only missing piece was an UNDO, and this is it: photograph the root once the app has finished
 * its first-run seeding, and put it back between tests.
 *
 * ══ THE TWO RULES A CALLER MUST HONOUR ══
 *
 * 1. **Restore with the preferences window CLOSED.** A dirty JSON buffer in that window raises the
 *    `json-external-change` notice when the file changes underneath it (see
 *    `preferences-json.e2e.ts`), so a restore against an open window would hand the NEXT test a
 *    surprise notice it never asked for. Closing it also re-captures the on-entry snapshot that
 *    Revert and Revert All compare against — the preferences window is destroyed on close and
 *    re-mounted on open (`preferences-window.ts`), so that snapshot is per-OPEN, not per-launch,
 *    which is what makes sharing an app safe at all.
 *
 * 2. **Snapshot AFTER the app has settled**, not before it launches. First run seeds fifteen theme
 *    files, `settings.json` and `keybindings.json`; a snapshot taken before that is a photograph of
 *    an empty folder, and restoring it would delete the shipped set.
 *
 * ══ WHAT IS DELIBERATELY NOT RESTORED ══
 *
 * `icon-packs/` is excluded. `ensureBundledPacks()` runs ONCE, on the startup path, so a test that
 * damages a pack cannot be repaired by rewriting files — it needs its own launch, and the two
 * `icon-packs.e2e.ts` tests that care about that keep one. Excluding the directory also keeps the
 * snapshot small: it is the only part of a config root that holds binary-ish payloads.
 *
 * Synchronous, like {@link writeConfigAtomic}, because the callers are `afterEach` hooks and
 * `beforeAll` bodies that read it inline between Playwright awaits.
 */

/** Directories whose contents are seeded only at startup and must survive a restore. */
const UNRESTORED_DIRS = new Set(['icon-packs']);

/** The scratch directory {@link writeConfigAtomic} stages into — transient, never part of the state. */
const SCRATCH_PREFIX = '.throng-write-';

export interface ConfigRootSnapshot {
  /** The config root this snapshot describes. */
  readonly cfgRoot: string;
  /** Relative POSIX-ish path → exact file content, for every restorable file. */
  readonly files: ReadonlyMap<string, string>;
}

/** Every restorable file under `dir`, as paths relative to `root`. */
function collect(root: string, dir: string, into: Map<string, string>): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // vanished under us (a scratch dir being cleaned) — nothing to record
  }
  for (const entry of entries) {
    if (entry.startsWith(SCRATCH_PREFIX)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue; // removed between readdir and stat
    }
    if (stats.isDirectory()) {
      if (UNRESTORED_DIRS.has(relative(root, full))) continue;
      collect(root, full, into);
      continue;
    }
    if (!stats.isFile()) continue;
    try {
      into.set(relative(root, full), readFileSync(full, 'utf8'));
    } catch {
      continue; // removed between stat and read
    }
  }
}

/**
 * Has the app finished seeding this config root? Poll on this BEFORE snapshotting.
 *
 * First run writes `settings.json`, `keybindings.json` and one file per shipped theme, and the
 * window paints before all of that has landed. A snapshot taken mid-seed photographs a partial root
 * and every restore afterwards would delete whatever arrived late.
 *
 * The theme count is DERIVED from `ALL_DEFAULT_THEMES` rather than written down, because a number
 * copied into a test is a number that goes stale the first time a theme is added — and it would go
 * stale silently, as a snapshot that is merely a little bit wrong.
 */
export function configRootSeeded(cfgRoot: string): boolean {
  if (!existsSync(join(cfgRoot, 'settings.json'))) return false;
  if (!existsSync(join(cfgRoot, 'keybindings.json'))) return false;
  try {
    const themes = readdirSync(join(cfgRoot, 'themes')).filter((f) => f.endsWith('.json'));
    return themes.length >= Object.keys(ALL_DEFAULT_THEMES).length;
  } catch {
    return false;
  }
}

/**
 * Photograph `cfgRoot` as it stands. Call it in `beforeAll`, AFTER {@link configRootSeeded} says
 * the app has finished its first-run seeding.
 */
export function snapshotConfigRoot(cfgRoot: string): ConfigRootSnapshot {
  const files = new Map<string, string>();
  collect(cfgRoot, cfgRoot, files);
  if (files.size === 0) {
    throw new Error(
      `snapshotConfigRoot(${cfgRoot}): the root is empty. Either the path is wrong or the snapshot ` +
        'was taken before the app finished seeding it — restoring an empty snapshot would delete ' +
        'the shipped themes, settings and key bindings.',
    );
  }
  return { cfgRoot, files };
}

/**
 * Put the config root back exactly as {@link snapshotConfigRoot} found it, and report what changed.
 *
 * Three passes, and the ORDER is deliberate:
 *   1. rewrite files whose content differs, or that a test deleted (a deleted built-in theme);
 *   2. remove files the snapshot does not have (a cloned or renamed theme);
 *   3. remove directories left empty by (2) that the snapshot did not have.
 *
 * Restoring settings.json BEFORE deleting a clone matters. A theme test can end with a cloned theme
 * ACTIVE — `appearance.theme` naming a file the second pass is about to remove — and the config
 * watcher can wake in between. Putting `appearance.theme` back first means the transient state the
 * watcher might see is "the active theme has been switched", not "the active theme's file has
 * vanished". Both are survivable, but only one of them is ordinary.
 *
 * Only files that ACTUALLY differ are written, so a read-only test costs the config watcher nothing.
 * Every write is atomic, for the reason `config-write.ts` documents at length: a truncate-then-fill
 * against a running app lets the watcher read the file half-written and broadcast the shipped
 * defaults, and nothing re-reads afterwards.
 *
 * @returns the relative paths this call touched — empty when the test changed nothing.
 */
export function restoreConfigRoot(snapshot: ConfigRootSnapshot): string[] {
  const { cfgRoot, files } = snapshot;
  const current = new Map<string, string>();
  collect(cfgRoot, cfgRoot, current);
  const touched: string[] = [];

  // 1. Anything the test edited or deleted.
  for (const [rel, content] of files) {
    if (current.get(rel) === content) continue;
    const target = join(cfgRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    /*
     * A test may have replaced a FILE with a DIRECTORY to make a write fail — `preferences-reset`
     * does exactly that to settings.json. A rename onto a non-empty directory cannot succeed, so
     * clear the way first. `rmSync` with `force` is a no-op when the path is already a file.
     */
    if (existsSync(target) && statSync(target).isDirectory()) {
      rmSync(target, { recursive: true, force: true });
    }
    writeConfigAtomic(target, content);
    touched.push(rel);
  }

  // 2. Anything the test created.
  for (const rel of current.keys()) {
    if (files.has(rel)) continue;
    try {
      rmSync(join(cfgRoot, rel), { force: true });
    } catch {
      /*
       * Pass 1 can have removed this path's PARENT — a test that replaced settings.json with a
       * directory leaves `settings.json/blocker.txt` in `current`, and pass 1 has since put the real
       * file back. `force` covers ENOENT but not ENOTDIR, and the entry is already gone either way.
       */
      continue;
    }
    touched.push(rel);
  }

  // 3. Directories the test created and (2) has just emptied.
  pruneEmptyDirs(cfgRoot, cfgRoot, snapshotDirs(files));

  return touched;
}

/** The paths that differ from the snapshot right now — empty when the root is back as it was. */
export function diffConfigRoot(snapshot: ConfigRootSnapshot): string[] {
  const current = new Map<string, string>();
  collect(snapshot.cfgRoot, snapshot.cfgRoot, current);
  const drift: string[] = [];
  for (const rel of current.keys()) if (!snapshot.files.has(rel)) drift.push(rel);
  for (const [rel, content] of snapshot.files) {
    if (current.get(rel) !== content) drift.push(rel);
  }
  return drift;
}

/**
 * Restore, then PROVE it held — the half a single pass cannot give you.
 *
 * This is the shared-app trap the 034 branch has already paid for three times: every reverted
 * conversion on this branch left a resource alive past the test that created it. Here that resource
 * is a WRITE. The preferences editors write on a debounce, so a test whose last assertion is about
 * the SCREEN (`await expect(reset).toBeDisabled()`) can finish with a write still in flight; it lands
 * a moment after the restore and the NEXT test opens on a config root nobody asked for. The symptom
 * is a failure in an unrelated test, which is exactly the shape that costs an afternoon.
 *
 * So: restore, let the loop turn, look again, and restore anything that arrived late. If the root
 * will not converge inside the budget, FAIL — loudly, naming the paths — rather than hand the
 * poisoned root to the next test. The failure is charged to the test that leaked, which is the right
 * address even though that test's own assertions passed.
 *
 * Asynchronous on purpose. `config-write.ts` blocks with `Atomics.wait` because its callers are
 * inline between Playwright awaits; this one is an `afterEach`, and a blocked event loop in teardown
 * is issue #211 — the cost lands on whichever test runs next, as a timeout with no relation to its
 * own work.
 */
export async function settleConfigRoot(
  snapshot: ConfigRootSnapshot,
  timeoutMs = 5_000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  const touched = new Set(restoreConfigRoot(snapshot));
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const drift = diffConfigRoot(snapshot);
    if (drift.length === 0) return [...touched];
    if (Date.now() >= deadline) {
      throw new Error(
        `the config root would not settle back to its baseline within ${timeoutMs}ms — something ` +
          'is still writing to it after the test that started the write finished. The next test ' +
          `would have opened on it. Paths still drifting: ${drift.join(', ')}`,
      );
    }
    for (const path of restoreConfigRoot(snapshot)) touched.add(path);
  }
}

/** Every directory the snapshot implies, relative to the root. */
function snapshotDirs(files: ReadonlyMap<string, string>): Set<string> {
  const dirs = new Set<string>();
  for (const rel of files.keys()) {
    let dir = dirname(rel);
    while (dir !== '.' && dir !== '' && !dirs.has(dir)) {
      dirs.add(dir);
      dir = dirname(dir);
    }
  }
  return dirs;
}

/** Remove empty directories the snapshot did not have. Depth-first, best-effort. */
function pruneEmptyDirs(root: string, dir: string, keep: ReadonlySet<string>): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = relative(root, full);
    if (UNRESTORED_DIRS.has(rel)) continue;
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    pruneEmptyDirs(root, full, keep);
    if (keep.has(rel)) continue;
    try {
      if (readdirSync(full).length === 0) rmSync(full, { recursive: true, force: true });
    } catch {
      /* raced with the app; the temp sweep gets it */
    }
  }
}
