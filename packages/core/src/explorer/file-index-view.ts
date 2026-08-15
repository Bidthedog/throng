/**
 * The renderer's view of one project's file index, as arithmetic (033, FR-075,
 * contracts/file-index.md §4).
 *
 * ══ WHY THIS IS IN CORE AND NOT IN THE HOOK ══
 *
 * `use-file-index.ts` held this reducer inline. It is a hook, and there is no component test tier in
 * this repository, so the rule could only ever be exercised through a running Electron window — and
 * it was not, which is how finding F2 survived. The rule is a set, a delta and a sort: pure, and
 * therefore assertable here at the cost of one import.
 *
 * ══ THE RULE THAT WAS MISSING (FR-075) ══
 *
 * Main DISOWNS a root's set when its watch fails for good (S11). It sets the root back to `building`,
 * empties its array, and pushes a payload carrying neither `paths` nor a delta — "I am no longer
 * maintaining this". The renderer read that as "the status changed, keep what you have", so Quick
 * Open went on offering a candidate set nothing was keeping current: it looks live and is not,
 * which is the one failure mode the whole index exists to avoid.
 *
 * Both halves looked correct in isolation. That is why the rule is stated rather than inferred.
 */

/** What the renderer holds for one root. `idle` means no subscription at all (R3). */
export interface FileIndexView {
  status: 'idle' | 'building' | 'ready';
  paths: readonly string[];
}

/** One push, as it arrives over `throng:fileIndex:update` (contracts/file-index.md §3). */
export interface FileIndexUpdateView {
  status: 'building' | 'ready';
  /** The whole set. Sent AT MOST ONCE per root per subscription (I2). */
  paths?: readonly string[];
  added?: readonly string[];
  removed?: readonly string[];
}

/** No project, no subscription, nothing held. */
export const IDLE_FILE_INDEX_VIEW: FileIndexView = { status: 'idle', paths: [] };

/**
 * Fold one push into the view.
 *
 * Three shapes, and the third is the one FR-075 is about:
 *
 *  1. **`paths` present** — the whole set, replacing whatever was held. An EMPTY array is a real
 *     answer (an empty project) and not an absent field.
 *  2. **`added`/`removed` present** — a delta against what THIS subscriber was last sent (S8),
 *     re-sorted into the index's own order so the renderer's copy is identical to main's rather than
 *     merely equal to it as a set.
 *  3. **Neither** — main has disowned the set. The held paths are DISCARDED (FR-075).
 *
 * Never mutates `view`.
 */
export function applyIndexUpdate(view: FileIndexView, update: FileIndexUpdateView): FileIndexView {
  if (update.paths !== undefined) return { status: update.status, paths: [...update.paths] };
  if (update.added === undefined && update.removed === undefined) {
    return { status: update.status, paths: [] };
  }
  const removed = new Set(update.removed ?? []);
  const next = view.paths.filter((p) => !removed.has(p));
  for (const added of update.added ?? []) next.push(added);
  /*
   * `.sort()` — UTF-16 code-unit order, the SAME order `walkFiles` produces (W7) and `diffPaths`
   * merges with. Two orders that disagree corrupt every subsequent delta while every test still
   * passes, because a set comparison cannot see the difference.
   */
  next.sort();
  return { status: update.status, paths: next };
}
