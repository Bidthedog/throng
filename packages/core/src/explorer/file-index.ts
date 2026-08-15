/**
 * The project file index's pure half (033 US1, contracts/file-index.md §1, W1–W8 and D1).
 *
 * Quick Open is seeded from every file beneath the project root, and that set has to be built
 * somewhere and kept current. This module is the *building* and the *comparing*, expressed against
 * the `IFileSystem` seam and nothing else — no `node:*` import, no separator assumption, no mention
 * of an operating system (Principle II, W8). The service that owns the walk's lifetime, its watch
 * and its debounce lives in UI-main; none of that belongs here, and none of it is needed to test
 * the rules below.
 */
import type { IFileSystem } from '../abstractions/file-system.js';
import { toAbsPath } from './tree-drag-payload.js';

export interface WalkOptions {
  /**
   * True when the caller has abandoned the walk — a project switch, or the last subscriber going
   * away. Polled once per directory, so an abandoned walk stops within one `list` rather than
   * enumerating a tree nobody is waiting for (W5).
   */
  cancelled: () => boolean;
  /**
   * True for a root-relative POSIX path the project excludes. An excluded FOLDER is not descended
   * into, which is what makes `node_modules` cost nothing rather than costing everything and then
   * being filtered away (W3). Compile the glob list once with `compileExcluder` and pass the
   * resulting predicate — never a closure that recompiles per path.
   */
  excluded: (relPath: string) => boolean;
}

/**
 * Every FILE beneath `root`, as root-relative POSIX paths, sorted (W1, W2, W7).
 *
 * Folders never appear: they are not open targets, so indexing them would put unopenable rows in
 * the list (Assumption 1). A symlinked directory is not descended into, so no path outside the root
 * can be produced by any route (W4). A directory that vanishes mid-walk is skipped rather than
 * thrown — the tree is being edited while it is being read, and that is ordinary, not exceptional
 * (W6). An abandoned walk produces nothing at all rather than a truncated set that would look
 * complete to its caller (W5).
 */
export async function walkFiles(
  fs: IFileSystem,
  root: string,
  options: WalkOptions,
): Promise<string[]> {
  const found: string[] = [];
  // Root-relative directories still to read; `''` is the root itself.
  const pending: string[] = [''];

  while (pending.length > 0) {
    if (options.cancelled()) return [];

    const relDir = pending.pop() as string;
    let entries;
    try {
      entries = await fs.list(toAbsPath(root, relDir));
    } catch {
      continue; // W6 — it was there when its parent was read, and it is not there now.
    }

    for (const entry of entries) {
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (options.excluded(relPath)) continue;
      if (entry.kind === 'folder') {
        // W4 — a symlinked directory may point anywhere, including outside the root.
        if (!entry.isSymlink) pending.push(relPath);
      } else {
        found.push(relPath);
      }
    }
  }

  return found.sort();
}

/** What changed between two snapshots of a root's files. */
export interface FileIndexDelta {
  added: readonly string[];
  removed: readonly string[];
}

/**
 * The symmetric difference of two SORTED path arrays (D1).
 *
 * A merge rather than a set build, which is why `walkFiles` sorts: at 50,000 paths this walks each
 * array once and allocates only what actually changed. Equal inputs give two empty arrays, and an
 * empty delta is the signal UI-main uses to send nothing at all — so a quiescent project costs no
 * messages. Neither input is mutated.
 */
export function diffPaths(previous: readonly string[], next: readonly string[]): FileIndexDelta {
  const added: string[] = [];
  const removed: string[] = [];

  let p = 0;
  let n = 0;
  while (p < previous.length && n < next.length) {
    const before = previous[p];
    const after = next[n];
    if (before === after) {
      p += 1;
      n += 1;
    } else if (before < after) {
      removed.push(before);
      p += 1;
    } else {
      added.push(after);
      n += 1;
    }
  }
  for (; p < previous.length; p += 1) removed.push(previous[p]);
  for (; n < next.length; n += 1) added.push(next[n]);

  return { added, removed };
}
