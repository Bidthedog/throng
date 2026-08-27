/**
 * 041 FR-003c/FR-003d (#278) — WHICH REMOVED FOLDER IS A CAUSE, AND WHICH IS A CASUALTY OF ONE.
 *
 * ══ THE DEFECT ══
 *
 * One `git worktree remove` produced five dialogs. Main classifies a filesystem failure against
 * `subjectOf(raw)` — the last segment of the first path the errno quotes — so five vanished folders
 * mint five DIFFERENT cause keys (`path-missing:<folder>`), `shouldSuppressForCause` compares keys
 * for equality and matches none of them, and 029 FR-019's one-cause-one-notice rule never engages.
 * Each notice also carried `ENOENT: no such file or directory, realpath '<path>'` under a first line
 * that had already said the folder could not be found.
 *
 * ══ WHY THIS IS DECIDED PER EVENT, AND NEVER BY WAITING ══
 *
 * The obvious fix is to buffer the removals briefly and keep the shallowest. It is forbidden: 030
 * FR-036 says consolidation is by cause or by originating operation, "never by time or by window",
 * and 041 FR-003b does not supersede it. A wait is also unnecessary, which is the part worth stating
 * — "is an ancestor of this also absent?" is answerable from the path and the filesystem ALONE, with
 * no reference to any other event. So a watcher may report `/a/b/c` before `/a/b` and the answer does
 * not change.
 *
 * That is what the permutation test below measures. It permutes arrival order rather than waiting,
 * because a result that needs a delay to be right IS the time-grouping the requirement forbids — a
 * test that slept would pass for the wrong reason and would keep passing after a regression.
 *
 * The absence probe is INJECTED (Constitution II/IX): a filesystem call inside `@throng/core` would
 * breach the platform-abstracted core, and a test that had to build five directory trees per
 * permutation could not afford 120 of them.
 */
import { describe, expect, it } from 'vitest';
import { ancestorsWithinRoot, isSuppressedByAncestor } from '../../../src/notice/index.js';

const ROOT = 'D:/proj';

/** An absence oracle over a fixed set of gone paths — what the composition root supplies for real. */
function absent(...gone: string[]): (path: string) => boolean {
  const set = new Set(gone);
  return (path) => set.has(path);
}

/** Every ordering of an array — the point of the permutation test, not a general utility. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

describe('ancestorsWithinRoot', () => {
  // The caller has to KNOW which paths to probe before it can answer `isAbsent` for them, and the
  // walk that decides which those are is the one `isSuppressedByAncestor` performs. Exported so the
  // two cannot drift — a call site that probed a different set from the one the predicate walks
  // would be asking about paths the answer never consults.
  it('lists every proper ancestor inside the root, deepest first', () => {
    expect(ancestorsWithinRoot(`${ROOT}/a/b/c`, ROOT)).toEqual([`${ROOT}/a/b`, `${ROOT}/a`]);
  });

  it('excludes the path itself — it is absent by definition, which is why we are asking', () => {
    expect(ancestorsWithinRoot(`${ROOT}/a/b/c`, ROOT)).not.toContain(`${ROOT}/a/b/c`);
  });

  it('excludes the root, so a vanished root is never reported as an ancestor', () => {
    expect(ancestorsWithinRoot(`${ROOT}/a/b`, ROOT)).toEqual([`${ROOT}/a`]);
  });

  it('is empty for a direct child of the root — it is its own cause (FR-003a)', () => {
    expect(ancestorsWithinRoot(`${ROOT}/a`, ROOT)).toEqual([]);
  });

  it('is empty for a path outside the root', () => {
    expect(ancestorsWithinRoot('D:/elsewhere/a/b', ROOT)).toEqual([]);
  });

  it('agrees with the predicate: absence of any listed ancestor suppresses', () => {
    // The anti-drift assertion. Whatever this returns is exactly the set the predicate consults, so
    // marking any ONE of them absent must flip the answer.
    const path = `${ROOT}/a/b/c`;
    for (const ancestor of ancestorsWithinRoot(path, ROOT)) {
      expect(isSuppressedByAncestor(path, ROOT, absent(ancestor))).toBe(true);
    }
  });
});

describe('isSuppressedByAncestor', () => {
  it('suppresses a folder whose parent is also absent', () => {
    expect(isSuppressedByAncestor(`${ROOT}/a/b`, ROOT, absent(`${ROOT}/a`, `${ROOT}/a/b`))).toBe(true);
  });

  it('does not suppress a folder whose parent survives — it is its own cause (FR-003a)', () => {
    expect(isSuppressedByAncestor(`${ROOT}/a/b`, ROOT, absent(`${ROOT}/a/b`))).toBe(false);
  });

  it('suppresses a deep descendant whose ancestor several levels up went', () => {
    const gone = absent(`${ROOT}/a`, `${ROOT}/a/b`, `${ROOT}/a/b/c`, `${ROOT}/a/b/c/d`);
    expect(isSuppressedByAncestor(`${ROOT}/a/b/c/d`, ROOT, gone)).toBe(true);
  });

  it('stops walking at the project root, so a vanished root is not an ancestor', () => {
    // Beyond the root, absence says nothing about THIS project — and a root that has itself gone is
    // FR-002's fallback case, where the notice names the highest thing it can name truthfully.
    expect(isSuppressedByAncestor(ROOT, ROOT, absent(ROOT, 'D:/'))).toBe(false);
  });

  it('does not suppress a sibling — three independent removals are three causes (SC-006c)', () => {
    const gone = absent(`${ROOT}/a`, `${ROOT}/b`, `${ROOT}/c`);
    expect(isSuppressedByAncestor(`${ROOT}/a`, ROOT, gone)).toBe(false);
    expect(isSuppressedByAncestor(`${ROOT}/b`, ROOT, gone)).toBe(false);
    expect(isSuppressedByAncestor(`${ROOT}/c`, ROOT, gone)).toBe(false);
  });

  it.each([1, 3, 5])('yields exactly one cause for a removal with %i expanded descendants (SC-001)', (depth) => {
    // SC-001's stated measurement points. The removed folder is `a`; the descendants beneath it are
    // the tree nodes that were open and are now defeated by its going.
    const removed = `${ROOT}/a`;
    const descendants = Array.from({ length: depth }, (_, i) => `${removed}/${'d/'.repeat(i)}d`);
    const gone = absent(removed, ...descendants);

    const causes = [removed, ...descendants].filter((p) => !isSuppressedByAncestor(p, ROOT, gone));

    expect(causes).toEqual([removed]);
  });

  it('gives the same answer under EVERY arrival order (FR-003c, SC-006f)', () => {
    // The heart of it. A watcher gives no ordering guarantee, and a rule phrased as "suppressed by
    // the ancestor's notice" would need to have SEEN that notice. This one needs to have seen
    // nothing, so all 120 orderings agree.
    const removed = `${ROOT}/a`;
    const descendants = [`${removed}/b`, `${removed}/b/c`, `${removed}/x`, `${removed}/x/y`];
    const gone = absent(removed, ...descendants);

    for (const order of permutations([removed, ...descendants])) {
      const causes = order.filter((p) => !isSuppressedByAncestor(p, ROOT, gone));
      expect(causes).toEqual([removed]);
    }
  });

  it('names one subject and never revises it, whatever the order (FR-003d)', () => {
    // A notice raised and then amended to name a different folder is a second report wearing the
    // first one's clothes. Because each event decides alone, the surviving cause is the same path in
    // every ordering — there is no "first answer" to revise.
    const removed = `${ROOT}/a`;
    const descendants = [`${removed}/b`, `${removed}/b/c`];
    const gone = absent(removed, ...descendants);

    const survivors = new Set(
      permutations([removed, ...descendants]).map(
        (order) => order.filter((p) => !isSuppressedByAncestor(p, ROOT, gone)).join(','),
      ),
    );

    expect([...survivors]).toEqual([removed]);
  });

  it('handles both separators, since a stored root may use either', () => {
    expect(isSuppressedByAncestor('D:\\proj\\a\\b', 'D:\\proj', absent('D:\\proj\\a', 'D:\\proj\\a\\b'))).toBe(true);
  });

  it('is false for a path outside the project root entirely', () => {
    // Nothing to walk: the removal is not in this project, so no ancestor of it inside the root can
    // be reported as its cause.
    expect(isSuppressedByAncestor('D:/elsewhere/a', ROOT, absent('D:/elsewhere', 'D:/elsewhere/a'))).toBe(false);
  });
});
