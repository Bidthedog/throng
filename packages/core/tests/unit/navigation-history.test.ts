import { describe, it, expect } from 'vitest';
import {
  EMPTY_HISTORY,
  MAX_VIEW_STATE_BYTES,
  applyCap,
  canGoBack,
  canGoForward,
  moveTo,
  parseHistory,
  recordCurrentPlace,
  recordJump,
  recordOpen,
  rewriteCurrent,
  rewritePaths,
  serialiseHistory,
  setCurrentViewState,
  targetOf,
  type NavigationHistory,
} from '../../src/navigation/history.js';
import { samePath } from '../../src/fs/path-id.js';

/**
 * 044 T006 — the navigation history reducer (#136), invariants H1–H10 of data-model §4, and SC-007
 * as a seeded property test.
 *
 * The reducer is the whole of the history's behaviour: main's service only decides WHEN to call it,
 * and every renderer only renders what it returns. So "Back then Forward returns exactly to where the
 * user was" is a property of these functions or of nothing.
 */

const CAP = 10;

function build(paths: string[], index = paths.length - 1): NavigationHistory {
  return { entries: paths.map((filePath) => ({ filePath })), index };
}

/** Preview scroll anchors as the renderer records them; the top of a document is never `null` (FR-115). */
const TOP = { line: 0, offsetRatio: 0 };
const AT_10 = { line: 10, offsetRatio: 0 };
const AT_20 = { line: 20, offsetRatio: 0.5 };
const AT_30 = { line: 30, offsetRatio: 0 };

/** A file entry with no view state, then `[path, viewState]` entries; current is the last unless given. */
function jumps(first: string, ...rest: Array<[string, unknown]>): NavigationHistory {
  const entries = [{ filePath: first }, ...rest.map(([filePath, viewState]) => ({ filePath, viewState }))];
  return { entries, index: entries.length - 1 };
}

/** H12 — no two CONSECUTIVE entries name one file at an equal place. */
function h12Holds(h: NavigationHistory): boolean {
  for (let i = 1; i < h.entries.length; i += 1) {
    const [a, b] = [h.entries[i - 1]!, h.entries[i]!];
    if (samePath(a.filePath, b.filePath) && JSON.stringify(a.viewState) === JSON.stringify(b.viewState)) return false;
  }
  return true;
}

/** How many adjacent pairs name one file, however spelled. */
function sameFilePairs(h: NavigationHistory): number {
  let pairs = 0;
  for (let i = 1; i < h.entries.length; i += 1) {
    if (samePath(h.entries[i - 1]!.filePath, h.entries[i]!.filePath)) pairs += 1;
  }
  return pairs;
}

/** H1 — the structural invariant every result must satisfy. */
function assertH1(h: NavigationHistory): void {
  if (h.entries.length === 0) {
    expect(h.index).toBe(-1);
  } else {
    expect(Number.isInteger(h.index)).toBe(true);
    expect(h.index).toBeGreaterThanOrEqual(0);
    expect(h.index).toBeLessThan(h.entries.length);
  }
}

describe('EMPTY_HISTORY and H1', () => {
  it('is empty with index -1, and has nowhere to go', () => {
    expect(EMPTY_HISTORY).toEqual({ entries: [], index: -1 });
    assertH1(EMPTY_HISTORY);
    expect(canGoBack(EMPTY_HISTORY)).toBe(false);
    expect(canGoForward(EMPTY_HISTORY)).toBe(false);
    expect(targetOf(EMPTY_HISTORY, 'back')).toBeNull();
    expect(targetOf(EMPTY_HISTORY, 'forward')).toBeNull();
  });
});

describe('recordOpen (FR-103, H2, H3)', () => {
  it('the first open is the first entry', () => {
    const h = recordOpen(EMPTY_HISTORY, 'C:/p/a.md', CAP);
    expect(h).toEqual(build(['C:/p/a.md']));
  });

  it('H2: opening the CURRENT file returns the same history, however its path is spelled', () => {
    const h = build(['C:/p/a.md', 'C:/p/b.md']);
    expect(recordOpen(h, 'C:/p/b.md', CAP)).toBe(h);
    expect(recordOpen(h, 'c:\\P\\B.md', CAP)).toBe(h);
  });

  it('H3: discards every newer entry and appends, making it current', () => {
    const h = build(['a', 'b', 'c', 'd'], 1);
    expect(recordOpen(h, 'e', CAP)).toEqual(build(['a', 'b', 'e']));
  });

  it('H3: appends even when the path occurs EARLIER in the history (#136)', () => {
    const h = build(['a', 'b', 'c']);
    expect(recordOpen(h, 'a', CAP)).toEqual(build(['a', 'b', 'c', 'a']));
  });

  it('applies the cap as it appends, dropping the oldest (FR-108)', () => {
    const h = build(['a', 'b', 'c']);
    expect(recordOpen(h, 'd', 3)).toEqual(build(['b', 'c', 'd']));
  });

  it('H10: an editor entry is recorded with its file only — no viewState key at all', () => {
    const h = recordOpen(EMPTY_HISTORY, 'C:/p/a.ts', CAP);
    expect(Object.keys(h.entries[0])).toEqual(['filePath']);
  });
});

describe('moveTo, canGoBack, canGoForward, targetOf (FR-102, H4, H5)', () => {
  const h = build(['a', 'b', 'c'], 1);

  it('H4: changes the index only — entries identical by reference', () => {
    const moved = moveTo(h, 0);
    expect(moved.index).toBe(0);
    expect(moved.entries).toBe(h.entries);
  });

  it('H5: moving away and back equals the original', () => {
    for (let i = 0; i < h.entries.length; i += 1) {
      expect(moveTo(moveTo(h, i), h.index)).toEqual(h);
    }
  });

  it('ignores an index outside the list', () => {
    expect(moveTo(h, -1)).toBe(h);
    expect(moveTo(h, 3)).toBe(h);
    expect(moveTo(h, 1.5)).toBe(h);
  });

  it('back is possible only with an older entry, forward only with a newer one', () => {
    expect(canGoBack(h)).toBe(true);
    expect(canGoForward(h)).toBe(true);
    expect(canGoBack(moveTo(h, 0))).toBe(false);
    expect(canGoForward(moveTo(h, 2))).toBe(false);
  });

  it('targetOf names the neighbouring index and its entry, or null at an end', () => {
    expect(targetOf(h, 'back')).toEqual({ index: 0, entry: { filePath: 'a' } });
    expect(targetOf(h, 'forward')).toEqual({ index: 2, entry: { filePath: 'c' } });
    expect(targetOf(moveTo(h, 0), 'back')).toBeNull();
    expect(targetOf(moveTo(h, 2), 'forward')).toBeNull();
  });
});

describe('applyCap (FR-108, H6)', () => {
  it('returns the same history when already within the cap', () => {
    const h = build(['a', 'b']);
    expect(applyCap(h, 2)).toBe(h);
  });

  it('drops oldest first and shifts the index', () => {
    expect(applyCap(build(['a', 'b', 'c', 'd', 'e'], 4), 2)).toEqual(build(['d', 'e'], 1));
    expect(applyCap(build(['a', 'b', 'c', 'd', 'e'], 3), 3)).toEqual(build(['c', 'd', 'e'], 1));
  });

  it('never drops the current entry — newer entries go once the older ones are exhausted', () => {
    // Current is 'b'. Only one older entry exists, so the second drop must come off the newest end.
    const capped = applyCap(build(['a', 'b', 'c', 'd'], 1), 2);
    expect(capped.entries[capped.index].filePath).toBe('b');
    expect(capped).toEqual(build(['b', 'c'], 0));
    // A cap of one keeps exactly the current entry.
    expect(applyCap(build(['a', 'b', 'c'], 1), 1)).toEqual(build(['b'], 0));
  });

  it('treats a cap below one as one', () => {
    expect(applyCap(build(['a', 'b']), 0)).toEqual(build(['b'], 0));
  });

  it('leaves an empty history empty', () => {
    expect(applyCap(EMPTY_HISTORY, 1)).toBe(EMPTY_HISTORY);
  });
});

describe('rewritePaths (FR-109, H7, H9)', () => {
  it('rewrites an entry equal to a moved file, keeping order, index and viewState', () => {
    const h: NavigationHistory = {
      entries: [{ filePath: 'C:/p/a.md', viewState: { top: 4 } }, { filePath: 'C:/p/b.md' }],
      index: 1,
    };
    const next = rewritePaths(h, [{ from: 'c:\\p\\A.md', to: 'C:/p/renamed.md' }]);
    expect(next).toEqual({
      entries: [{ filePath: 'C:/p/renamed.md', viewState: { top: 4 } }, { filePath: 'C:/p/b.md' }],
      index: 1,
    });
  });

  it('rewrites entries UNDER a moved folder, on a segment boundary only', () => {
    const h = build(['C:/p/docs/a.md', 'C:/p/docs/deep/b.md', 'C:/p/docs-old/c.md', 'C:/p/other.md']);
    const next = rewritePaths(h, [{ from: 'C:/p/docs', to: 'C:/p/guide' }]);
    expect(next.entries.map((e) => e.filePath)).toEqual([
      'C:/p/guide/a.md',
      'C:/p/guide/deep/b.md',
      'C:/p/docs-old/c.md',
      'C:/p/other.md',
    ]);
    expect(next.index).toBe(h.index);
  });

  it('tolerates a trailing separator on the moved folder, joining in the destination’s separator', () => {
    const h = build(['C:\\p\\docs\\a.md']);
    expect(rewritePaths(h, [{ from: 'C:/p/docs/', to: 'D:/q/' }]).entries[0].filePath).toBe('D:/q/a.md');
  });

  it('writes the whole moved tail in the destination’s separator, never a mixed path', () => {
    const h = build(['C:/p/docs/deep/b.md', 'C:\\p\\docs/mixed\\c.md']);
    expect(rewritePaths(h, [{ from: 'C:\\p\\docs', to: 'D:\\q' }]).entries.map((e) => e.filePath)).toEqual([
      'D:\\q\\deep\\b.md',
      'D:\\q\\mixed\\c.md',
    ]);
  });

  it('returns the same history when no move applies', () => {
    const h = build(['C:/p/a.md']);
    expect(rewritePaths(h, [{ from: 'C:/p/z.md', to: 'C:/p/y.md' }])).toBe(h);
    expect(rewritePaths(h, [])).toBe(h);
  });
});

/*
 * Review of batch B, M-3 — H2a covered only `rewriteCurrent`. An in-app rename onto a file the history
 * still names (it need only be gone from DISK) fused two entries just the same: history `[a, b]`, delete
 * `a.md`, rename `b.md` to `a.md` → `[a, a]`, and Back moved the position while showing the same file.
 */
describe('rewritePaths merges adjacent entries that now name one file (H2a, H7 amended)', () => {
  it('renaming the current file onto the previous one: one entry, the CURRENT one kept with its viewState, index moved', () => {
    const h: NavigationHistory = {
      entries: [{ filePath: 'C:/p/a.md', viewState: { top: 1 } }, { filePath: 'C:/p/b.md', viewState: { top: 2 } }],
      index: 1,
    };
    const next = rewritePaths(h, [{ from: 'C:/p/b.md', to: 'C:/p/a.md' }]);
    expect(next).toEqual({ entries: [{ filePath: 'C:/p/a.md', viewState: { top: 2 } }], index: 0 });
    assertH1(next);
    expect(canGoBack(next)).toBe(false);
  });

  it('renaming the previous file onto the current one: the current entry is kept, index moves back', () => {
    const h: NavigationHistory = {
      entries: [{ filePath: 'C:/p/b.md', viewState: { top: 1 } }, { filePath: 'C:/p/a.md', viewState: { top: 2 } }],
      index: 1,
    };
    expect(rewritePaths(h, [{ from: 'C:/p/b.md', to: 'C:/p/a.md' }])).toEqual({
      entries: [{ filePath: 'C:/p/a.md', viewState: { top: 2 } }],
      index: 0,
    });
  });

  it('a fused pair away from the current entry keeps its first entry, and index shifts only for drops before it', () => {
    const h = build(['C:/p/x.md', 'C:/p/y.md', 'C:/p/q.md', 'C:/p/r.md', 'C:/p/s.md'], 3);
    const next = rewritePaths(h, [
      { from: 'C:/p/x.md', to: 'C:/p/y.md' },
      { from: 'C:/p/s.md', to: 'C:/p/r.md' },
    ]);
    expect(next).toEqual(build(['C:/p/y.md', 'C:/p/q.md', 'C:/p/r.md'], 2));
  });

  it('entries that name one file but are NOT adjacent are left alone (H3)', () => {
    const h = build(['C:/p/b.md', 'C:/p/m.md', 'C:/p/a.md'], 2);
    expect(rewritePaths(h, [{ from: 'C:/p/b.md', to: 'C:/p/a.md' }])).toEqual(build(['C:/p/a.md', 'C:/p/m.md', 'C:/p/a.md'], 2));
  });
});

/*
 * FR-115 × H2a — a preview's jump chain is one document's positions, and it already named one file before
 * any move. Merging adjacent same-file entries is about entries a move FUSED; it must never fuse two jump
 * entries that sit at different headings of the file that moved.
 */
describe('rewritePaths keeps a jump chain whole (H2a reconciled with FR-115)', () => {
  it('moving the file a chain names rewrites every entry of the chain, each with its viewState', () => {
    const h = jumps('C:/p/README.md', ['C:/p/a.md', TOP], ['C:/p/a.md', AT_10]);
    const next = rewritePaths(h, [{ from: 'C:/p/a.md', to: 'C:/p/c.md' }]);
    expect(next).toEqual(
      jumps('C:/p/README.md', ['C:/p/c.md', TOP], ['C:/p/c.md', AT_10]),
    );
  });

  it('a file renamed onto the chain’s file merges into the chain; the chain itself is not fused', () => {
    const h: NavigationHistory = {
      entries: [
        { filePath: 'C:/p/x.md' },
        { filePath: 'C:/p/a.md', viewState: TOP },
        { filePath: 'C:/p/a.md', viewState: AT_10 },
        { filePath: 'C:/p/b.md', viewState: AT_20 },
      ],
      index: 2,
    };
    expect(rewritePaths(h, [{ from: 'C:/p/b.md', to: 'C:/p/a.md' }])).toEqual({
      entries: [
        { filePath: 'C:/p/x.md' },
        { filePath: 'C:/p/a.md', viewState: TOP },
        { filePath: 'C:/p/a.md', viewState: AT_10 },
      ],
      index: 2,
    });
  });

  it('a fused run away from the current entry keeps its FIRST chain whole, and index shifts by the drops before it', () => {
    const h: NavigationHistory = {
      entries: [
        { filePath: 'C:/p/a.md', viewState: TOP },
        { filePath: 'C:/p/a.md', viewState: AT_10 },
        { filePath: 'C:/p/b.md', viewState: AT_20 },
        { filePath: 'C:/p/c.md' },
      ],
      index: 3,
    };
    expect(rewritePaths(h, [{ from: 'C:/p/b.md', to: 'C:/p/a.md' }])).toEqual({
      entries: [{ filePath: 'C:/p/a.md', viewState: TOP }, { filePath: 'C:/p/a.md', viewState: AT_10 }, { filePath: 'C:/p/c.md' }],
      index: 2,
    });
  });

  it('a run holding the current entry keeps the CURRENT entry’s chain whole, whichever came first', () => {
    const h: NavigationHistory = {
      entries: [
        { filePath: 'C:/p/b.md', viewState: AT_20 },
        { filePath: 'C:/p/a.md', viewState: TOP },
        { filePath: 'C:/p/a.md', viewState: AT_10 },
      ],
      index: 1,
    };
    expect(rewritePaths(h, [{ from: 'C:/p/b.md', to: 'C:/p/a.md' }])).toEqual({
      entries: [{ filePath: 'C:/p/a.md', viewState: TOP }, { filePath: 'C:/p/a.md', viewState: AT_10 }],
      index: 0,
    });
  });
});

describe('rewriteCurrent (R14, H8)', () => {
  it('H8: on an empty history it is recordOpen', () => {
    expect(rewriteCurrent(EMPTY_HISTORY, 'C:/p/new.md')).toEqual(recordOpen(EMPTY_HISTORY, 'C:/p/new.md', CAP));
  });

  it('replaces only the current entry, keeping the list, index and viewState', () => {
    const h: NavigationHistory = {
      entries: [{ filePath: 'a' }, { filePath: 'b', viewState: 7 }, { filePath: 'c' }],
      index: 1,
    };
    expect(rewriteCurrent(h, 'b2')).toEqual({
      entries: [{ filePath: 'a' }, { filePath: 'b2', viewState: 7 }, { filePath: 'c' }],
      index: 1,
    });
  });

  it('returns the same history when the path is unchanged', () => {
    const h = build(['a', 'b']);
    expect(rewriteCurrent(h, 'b')).toBe(h);
  });
});

/*
 * Adversarial review (core M3) — H2a, beside H2: a rewrite never leaves the current entry next to an entry
 * naming the same file. Save As onto the PREVIOUS file used to produce `[a.md, a.md]`, where Back moved the
 * position and showed nothing different — a step the user takes and sees nothing happen.
 */
describe('rewriteCurrent merges an adjacent entry naming the same file (H2a)', () => {
  it('Save As onto the previous file: one entry, index moved onto it', () => {
    const h = build(['C:/p/a.md', 'C:/p/b.md'], 1);
    const next = rewriteCurrent(h, 'C:/p/a.md');
    expect(next).toEqual(build(['C:/p/a.md'], 0));
    assertH1(next);
    expect(canGoBack(next)).toBe(false);
  });

  it('Save As onto the next file: the newer neighbour is dropped, index unchanged', () => {
    const h = build(['C:/p/a.md', 'C:/p/b.md', 'C:/p/c.md'], 1);
    expect(rewriteCurrent(h, 'C:/p/c.md')).toEqual(build(['C:/p/a.md', 'C:/p/c.md'], 1));
  });

  it('both neighbours name the target: all three become one, and the rest of the list is kept', () => {
    const h = build(['C:/p/z.md', 'C:/p/a.md', 'C:/p/b.md', 'C:/p/a.md', 'C:/p/y.md'], 2);
    expect(rewriteCurrent(h, 'C:/p/a.md')).toEqual(build(['C:/p/z.md', 'C:/p/a.md', 'C:/p/y.md'], 1));
  });

  it('a neighbour spelled differently is still the same file (samePath), and the CURRENT entry survives with its viewState', () => {
    const h: NavigationHistory = {
      entries: [{ filePath: 'c:\\P\\A.md', viewState: { top: 1 } }, { filePath: 'C:/p/b.md', viewState: { top: 2 } }],
      index: 1,
    };
    expect(rewriteCurrent(h, 'C:/p/a.md')).toEqual({ entries: [{ filePath: 'C:/p/a.md', viewState: { top: 2 } }], index: 0 });
  });

  it('a non-adjacent entry naming the same file is left alone (H3 allows an earlier occurrence)', () => {
    const h = build(['C:/p/a.md', 'C:/p/x.md', 'C:/p/b.md'], 2);
    expect(rewriteCurrent(h, 'C:/p/a.md')).toEqual(build(['C:/p/a.md', 'C:/p/x.md', 'C:/p/a.md'], 2));
  });
});

/*
 * H2a refined (data-model §14.2) — Save As on a parented preview inside a jump chain. The chain is one
 * document's positions and it is that document that now has another name, so the whole contiguous run
 * naming the OLD path is rewritten, each entry keeping its place; H2a's merge applies outside that run.
 */
describe('rewriteCurrent inside a jump chain (H2a refined, FR-115)', () => {
  it('[a@top, a@h] with the jump current → [b@top, b@h], view states and index kept', () => {
    const h: NavigationHistory = {
      entries: [{ filePath: 'C:/p/a.md', viewState: TOP }, { filePath: 'C:/p/a.md', viewState: AT_10 }],
      index: 1,
    };
    expect(rewriteCurrent(h, 'C:/p/b.md')).toEqual({
      entries: [{ filePath: 'C:/p/b.md', viewState: TOP }, { filePath: 'C:/p/b.md', viewState: AT_10 }],
      index: 1,
    });
  });

  it('the whole run is rewritten whichever entry of it is current, and entries outside it are untouched', () => {
    const h: NavigationHistory = {
      entries: [
        { filePath: 'C:/p/x.md' },
        { filePath: 'C:/p/a.md', viewState: TOP },
        { filePath: 'C:/p/a.md', viewState: AT_10 },
        { filePath: 'C:/p/a.md', viewState: AT_20 },
        { filePath: 'C:/p/y.md' },
      ],
      index: 1,
    };
    expect(rewriteCurrent(h, 'C:/p/b.md')).toEqual({
      entries: [
        { filePath: 'C:/p/x.md' },
        { filePath: 'C:/p/b.md', viewState: TOP },
        { filePath: 'C:/p/b.md', viewState: AT_10 },
        { filePath: 'C:/p/b.md', viewState: AT_20 },
        { filePath: 'C:/p/y.md' },
      ],
      index: 1,
    });
  });

  it('a neighbour OUTSIDE the run naming the new path still merges: it is dropped and index moves back', () => {
    const h: NavigationHistory = {
      entries: [
        { filePath: 'C:/p/b.md', viewState: AT_30 },
        { filePath: 'C:/p/a.md', viewState: TOP },
        { filePath: 'C:/p/a.md', viewState: AT_10 },
        { filePath: 'C:/p/c.md' },
      ],
      index: 2,
    };
    expect(rewriteCurrent(h, 'C:/p/b.md')).toEqual({
      entries: [
        { filePath: 'C:/p/b.md', viewState: TOP },
        { filePath: 'C:/p/b.md', viewState: AT_10 },
        { filePath: 'C:/p/c.md' },
      ],
      index: 1,
    });
  });
});

/**
 * FR-115 — `recordJump` (data-model §14.2, H11–H13). A followed same-document heading in a PREVIEW puts
 * where the reader was on the current entry and appends where the jump landed, unless that is where they
 * already were. Jump entries and file entries are ONE sequence: a jump behaves as `recordOpen` does for a
 * file — newer entries go, even when the next one names the very place (H3's rule, pinned below).
 */
describe('recordJump (FR-115, H11–H13)', () => {
  const README = 'C:/p/README.md';
  const GUIDE = 'C:/p/guide.md';

  it('H11: an empty history is returned unchanged', () => {
    expect(recordJump(EMPTY_HISTORY, TOP, AT_10, CAP)).toBe(EMPTY_HISTORY);
  });

  it('stores leaving on the current entry and appends a same-file entry at arriving, index at it (H13)', () => {
    const h = build([README, GUIDE]);
    expect(recordJump(h, TOP, AT_10, CAP)).toEqual({
      entries: [{ filePath: README }, { filePath: GUIDE, viewState: TOP }, { filePath: GUIDE, viewState: AT_10 }],
      index: 2,
    });
  });

  it('arriving equal to leaving adds NO entry (FR-115 no-duplicate rule) — only leaving is stored', () => {
    const h = build([README, GUIDE]);
    expect(recordJump(h, AT_10, { line: 10, offsetRatio: 0 }, CAP)).toEqual({
      entries: [{ filePath: README }, { filePath: GUIDE, viewState: AT_10 }],
      index: 1,
    });
  });

  it('arriving equal to leaving, with leaving already stored, returns the SAME history (no broadcast)', () => {
    const h = jumps(README, [GUIDE, AT_10]);
    expect(recordJump(h, { line: 10, offsetRatio: 0 }, AT_10, CAP)).toBe(h);
  });

  it('discards every entry newer than the current one before appending (H13)', () => {
    const h: NavigationHistory = { ...jumps(README, [GUIDE, TOP], [GUIDE, AT_10], [GUIDE, AT_20]), index: 1 };
    expect(recordJump(h, TOP, AT_30, CAP)).toEqual(jumps(README, [GUIDE, TOP], [GUIDE, AT_30]));
  });

  it('ORDERING pinned — arriving equal to the NEXT entry’s place still truncates and appends, as recordOpen does (H3)', () => {
    // [g@top, g@10, g@20] after two Backs; the reader follows the link to 10 again. One sequence: the jump
    // is recorded like any open — g@20 goes, and the list is not left pointing into a stale forward chain.
    const h: NavigationHistory = { ...jumps(README, [GUIDE, TOP], [GUIDE, AT_10], [GUIDE, AT_20]), index: 1 };
    expect(recordJump(h, TOP, AT_10, CAP)).toEqual(jumps(README, [GUIDE, TOP], [GUIDE, AT_10]));
  });

  it('H12: the reader scrolled back to the previous jump’s place — the current entry merges into it (step 2)', () => {
    const h = jumps(README, [GUIDE, TOP], [GUIDE, AT_10]);
    // Leaving is TOP again: storing it would make [g@top, g@top]. It merges, then the new jump appends.
    expect(recordJump(h, TOP, AT_20, CAP)).toEqual(jumps(README, [GUIDE, TOP], [GUIDE, AT_20]));
  });

  it('ORDERING pinned — step 2 merges, then arriving equals that place: no entry, and newer entries are KEPT', () => {
    // [g@top, g@10, g@20] at g@10; the reader scrolls to the top and follows a link to the title at the top.
    const h: NavigationHistory = { ...jumps(README, [GUIDE, TOP], [GUIDE, AT_10], [GUIDE, AT_20]), index: 2 };
    const next = recordJump(h, TOP, TOP, CAP);
    expect(next).toEqual({ ...jumps(README, [GUIDE, TOP], [GUIDE, AT_20]), index: 1 });
    expect(h12Holds(next)).toBe(true);
  });

  it('ORDERING pinned — with no entry added, a NEWER neighbour now equal to the current entry merges too (H12)', () => {
    // [g@top, g@10, g@top] stepped Back to g@10; the reader scrolls to the top and follows the title link.
    const merged: NavigationHistory = { ...jumps(README, [GUIDE, TOP], [GUIDE, AT_10], [GUIDE, TOP]), index: 2 };
    expect(recordJump(merged, TOP, TOP, CAP)).toEqual({ ...jumps(README, [GUIDE, TOP]), index: 1 });

    // [g@top, g@10] stepped Back to g@top; the reader scrolls BY HAND to 10 and follows the link to 10.
    const byHand: NavigationHistory = { ...jumps(README, [GUIDE, TOP], [GUIDE, AT_10]), index: 1 };
    const next = recordJump(byHand, AT_10, AT_10, CAP);
    expect(next).toEqual({ ...jumps(README, [GUIDE, AT_10]), index: 1 });
    expect(h12Holds(next)).toBe(true);
  });

  it('applies the cap as it appends, oldest first, never the current entry (H13, H6)', () => {
    const h = build([README, GUIDE]);
    expect(recordJump(h, TOP, AT_10, 2)).toEqual({
      entries: [{ filePath: GUIDE, viewState: TOP }, { filePath: GUIDE, viewState: AT_10 }],
      index: 1,
    });
  });

  it(`an arriving over ${MAX_VIEW_STATE_BYTES} bytes is dropped as setCurrentViewState drops it — the entry has no viewState`, () => {
    const big = { blob: 'x'.repeat(MAX_VIEW_STATE_BYTES) };
    expect(recordJump(build([GUIDE]), TOP, big, CAP)).toEqual({
      entries: [{ filePath: GUIDE, viewState: TOP }, { filePath: GUIDE }],
      index: 1,
    });
  });

  it('appends for the CURRENT entry’s file, whatever else the history names', () => {
    const h: NavigationHistory = { ...build([README, GUIDE]), index: 0 };
    const next = recordJump(h, TOP, AT_10, CAP);
    expect(next.entries.map((e) => e.filePath)).toEqual([README, README]);
    expect(next.index).toBe(1);
  });

  it('US7 scenario 7: README → guide, two contents links; Back three times reaches README', () => {
    let h = recordOpen(recordOpen(EMPTY_HISTORY, README, CAP), GUIDE, CAP);
    h = recordJump(h, TOP, AT_10, CAP);
    h = recordJump(h, AT_10, AT_20, CAP);
    const back1 = moveTo(h, targetOf(h, 'back')!.index);
    const back2 = moveTo(back1, targetOf(back1, 'back')!.index);
    const back3 = moveTo(back2, targetOf(back2, 'back')!.index);
    expect(back1.entries[back1.index]).toEqual({ filePath: GUIDE, viewState: AT_10 });
    expect(back2.entries[back2.index]).toEqual({ filePath: GUIDE, viewState: TOP });
    expect(back3.entries[back3.index]).toEqual({ filePath: README });
    expect(canGoBack(back3)).toBe(false);
  });
});

describe('same-file entries under moveTo, targetOf and parseHistory (H14, H15)', () => {
  const h: NavigationHistory = {
    entries: [{ filePath: 'C:/p/g.md', viewState: TOP }, { filePath: 'C:/p/g.md', viewState: AT_10 }],
    index: 1,
  };

  it('H14: moveTo across entries of one file changes the index only; targetOf names the same-file neighbour', () => {
    expect(targetOf(h, 'back')).toEqual({ index: 0, entry: { filePath: 'C:/p/g.md', viewState: TOP } });
    const back = moveTo(h, 0);
    expect(back.entries).toBe(h.entries);
    expect(targetOf(back, 'forward')).toEqual({ index: 1, entry: { filePath: 'C:/p/g.md', viewState: AT_10 } });
    expect(moveTo(back, 1)).toEqual(h);
  });

  it('H15: parseHistory keeps consecutive entries for one file whose view states differ', () => {
    expect(parseHistory(serialiseHistory(h), CAP)).toEqual(h);
  });
});

/*
 * Adversarial review (core hardening) — the tail below a moved folder was cut at the length of
 * `normaliseForCompare(from)`, and lower-casing is not length-preserving: `'İ'.toLowerCase()` is two UTF-16
 * units. So a folder with an `İ` in it cut one character too far and wrote `D:/ya.md`. Cut by SEGMENTS.
 */
describe('rewritePaths cuts the moved tail by segments, not by normalised length', () => {
  it('a folder named with İ keeps the whole file name', () => {
    const h = build(['D:/İx/a.md', 'D:/İx/sub/b.md']);
    expect(rewritePaths(h, [{ from: 'D:/İx', to: 'D:/y' }]).entries.map((e) => e.filePath)).toEqual([
      'D:/y/a.md',
      'D:/y/sub/b.md',
    ]);
  });

  it('with a trailing separator on the folder and a backslash destination', () => {
    const h = build(['D:\\İx\\a.md']);
    expect(rewritePaths(h, [{ from: 'D:/İx/', to: 'E:\\z' }]).entries[0].filePath).toBe('E:\\z\\a.md');
  });
});

describe('setCurrentViewState (FR-101, FR-107, H9)', () => {
  it('sets the viewState on the current entry only', () => {
    const h = build(['a', 'b', 'c'], 1);
    const next = setCurrentViewState(h, { top: 120 });
    expect(next.entries[1]).toEqual({ filePath: 'b', viewState: { top: 120 } });
    expect(next.entries[0]).toBe(h.entries[0]);
    expect(next.entries[2]).toBe(h.entries[2]);
  });

  it('H9: survives moveTo in both directions and rewritePaths', () => {
    let h = setCurrentViewState(build(['a', 'b'], 0), { top: 9 });
    h = moveTo(moveTo(h, 1), 0);
    h = rewritePaths(h, [{ from: 'a', to: 'z' }]);
    expect(h.entries[0]).toEqual({ filePath: 'z', viewState: { top: 9 } });
  });

  it(`drops a viewState larger than ${MAX_VIEW_STATE_BYTES} bytes serialised`, () => {
    expect(MAX_VIEW_STATE_BYTES).toBe(1024);
    const h = build(['a']);
    const big = { blob: 'x'.repeat(MAX_VIEW_STATE_BYTES) };
    expect(setCurrentViewState(h, big).entries[0]).toEqual({ filePath: 'a' });
    // Counted in UTF-8 BYTES, not UTF-16 units: 400 three-byte characters exceed the limit.
    expect(setCurrentViewState(h, '€'.repeat(400)).entries[0]).toEqual({ filePath: 'a' });
    expect(setCurrentViewState(h, '€'.repeat(300)).entries[0].viewState).toBe('€'.repeat(300));
  });

  it('drops a viewState that is not JSON', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const h = build(['a']);
    expect(setCurrentViewState(h, cyclic).entries[0]).toEqual({ filePath: 'a' });
    expect(setCurrentViewState(h, () => 1).entries[0]).toEqual({ filePath: 'a' });
  });

  it('is a no-op on an empty history', () => {
    expect(setCurrentViewState(EMPTY_HISTORY, { top: 1 })).toBe(EMPTY_HISTORY);
  });

  it('returns the SAME history when the resulting entry equals the current one', () => {
    const withState = setCurrentViewState(build(['a', 'b'], 1), { top: 5, anchor: { line: 3 } });
    // An equal value, freshly built — deep equality, not reference.
    expect(setCurrentViewState(withState, { top: 5, anchor: { line: 3 } })).toBe(withState);

    const without = build(['a', 'b'], 1);
    expect(setCurrentViewState(without, undefined)).toBe(without);
    // A value that would be dropped leaves an entry that has none exactly as it was.
    expect(setCurrentViewState(without, { blob: 'x'.repeat(MAX_VIEW_STATE_BYTES) })).toBe(without);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(setCurrentViewState(without, cyclic)).toBe(without);
  });

  it('still changes the history when the value differs, or when an oversized value clears a kept one', () => {
    const withState = setCurrentViewState(build(['a']), { top: 5 });
    expect(setCurrentViewState(withState, { top: 6 })).not.toBe(withState);
    const cleared = setCurrentViewState(withState, { blob: 'x'.repeat(MAX_VIEW_STATE_BYTES) });
    expect(cleared).not.toBe(withState);
    expect(cleared.entries[0]).toEqual({ filePath: 'a' });
  });
});

/**
 * 044 T219 — FR-115's fourth sentence is UNCONDITIONAL, and `recordJump` was the only place holding it.
 *
 * ══ THE PRESS THE READER LOSES ══
 *
 * Preview `guide.md`, Ctrl+click its contents link to *Install* (a jump: `[guide, guide@install]`),
 * then scroll back to the top by hand. Switching tab detaches the view, which reports where the
 * reader is — and that report goes through `setCurrentViewState`, which has no neighbour merge. The
 * list is now `[guide@top, guide@top]`: Back is ENABLED, the press is ACCEPTED, the position moves
 * from entry 1 to entry 0 — and nothing on screen changes, because both entries are the same file at
 * the same place. The button then greys out. One dead press, every time.
 *
 * `history.ts`'s own H2a comment already names this shape a defect in those words: *"Back moved the
 * position while the panel showed the same file — a step that visibly does nothing."*
 *
 * ══ WHY THE MERGE IS NOT INSIDE `setCurrentViewState` ══
 *
 * `recordJump` calls that reducer as its step 1 and then applies its OWN, more nuanced sequencing
 * (steps 2–4), so a merge inside it would fire twice for a jump. `recordCurrentPlace` is the
 * composition the three bare routes want, and it is what `NavigationHistoryService` calls — one
 * choke point, so no route can acquire the defect back by being added later.
 */
describe('recordCurrentPlace — H12 for the routes that do not go through recordJump (FR-115, T219)', () => {
  it('the reader scrolls back to where an earlier jump left them: the pair never exists', () => {
    // `[guide, guide@install]`, then the view reports the top — which is where entry 0 already is.
    const h = jumps('g.md', ['g.md', AT_30]);
    const next = recordCurrentPlace(h, undefined);

    expect(next.entries).toEqual([{ filePath: 'g.md' }]);
    expect(next.index).toBe(0);
    expect(h12Holds(next)).toBe(true);
    // And the button the reader is about to press is now correctly disabled, rather than lying.
    expect(canGoBack(next)).toBe(false);
    assertH1(next);
  });

  it('merges a NEWER neighbour too, so H12 holds on both sides of the current entry', () => {
    // The reader stepped BACK to the file entry and then scrolled to where the jump entry is.
    const h = { entries: [{ filePath: 'g.md' }, { filePath: 'g.md', viewState: AT_10 }], index: 0 };
    const next = recordCurrentPlace(h, AT_10);

    expect(next.entries).toEqual([{ filePath: 'g.md', viewState: AT_10 }]);
    expect(next.index).toBe(0);
    expect(h12Holds(next)).toBe(true);
    assertH1(next);
  });

  it('a DIFFERENT place beside the same file is left alone — a jump chain is not a duplicate', () => {
    const h = jumps('g.md', ['g.md', AT_30]);
    const next = recordCurrentPlace(h, AT_10);

    expect(next.entries).toEqual([{ filePath: 'g.md' }, { filePath: 'g.md', viewState: AT_10 }]);
    expect(next.index).toBe(1);
    expect(canGoBack(next)).toBe(true);
    expect(h12Holds(next)).toBe(true);
  });

  it('a neighbour naming ANOTHER file is left alone, whatever its place', () => {
    const h = { entries: [{ filePath: 'a.md', viewState: TOP }, { filePath: 'b.md', viewState: AT_10 }], index: 1 };
    expect(recordCurrentPlace(h, TOP).entries).toEqual([
      { filePath: 'a.md', viewState: TOP },
      { filePath: 'b.md', viewState: TOP },
    ]);
  });

  it('returns the history BY IDENTITY when nothing moves, and is a no-op on an empty one', () => {
    // The whole point of the identity contract: a preview reporting an unchanged place on every
    // leave must cost no broadcast and no layout write.
    const h = jumps('g.md', ['g.md', AT_30]);
    expect(recordCurrentPlace(h, AT_30)).toBe(h);
    expect(recordCurrentPlace(EMPTY_HISTORY, TOP)).toBe(EMPTY_HISTORY);
  });

  it('T219 route 1 — the place written, then recordOpen: Back lands somewhere it can be SEEN', () => {
    /*
     * `PreviewService.navigate`'s link intent: `setCurrentViewState(leaving)` then `recordOpen(target)`.
     * A merge applied after the record cannot fix this one — by then the equal pair is two steps back
     * and is no longer adjacent to the current entry — which is why the merge belongs to the write.
     */
    const opened = recordOpen(recordCurrentPlace(jumps('g.md', ['g.md', AT_30]), undefined), 'b.md', CAP);

    expect(opened.entries).toEqual([{ filePath: 'g.md' }, { filePath: 'b.md' }]);
    expect(opened.index).toBe(1);
    expect(h12Holds(opened)).toBe(true);
    // ONE Back, and it shows the reader a different file. Previously it took two, and the second was dead.
    const back = moveTo(opened, targetOf(opened, 'back')!.index);
    expect(back.entries[back.index]!.filePath).toBe('g.md');
    expect(canGoBack(back)).toBe(false);
  });

  it('T219 route 2 — the place written, then moveTo: no equal consecutive pair survives', () => {
    // `PreviewService.navigate`'s history intent: the leaving place first, whatever follows.
    const settled = recordCurrentPlace(jumps('g.md', ['g.md', AT_30]), undefined);
    // The renderer's Back target was entry 0 of the list it mirrored; that entry IS the current one now.
    expect(moveTo(settled, 0)).toBe(settled);
    expect(h12Holds(settled)).toBe(true);
  });
});

describe('serialiseHistory / parseHistory (FR-109)', () => {
  it('serialises to the versioned persisted shape', () => {
    const h: NavigationHistory = {
      entries: [{ filePath: 'C:/p/a.md', viewState: { top: 3 } }, { filePath: 'C:/p/b.md' }],
      index: 0,
    };
    expect(serialiseHistory(h)).toEqual({
      v: 1,
      entries: [{ filePath: 'C:/p/a.md', viewState: { top: 3 } }, { filePath: 'C:/p/b.md' }],
      index: 0,
    });
    expect(serialiseHistory(EMPTY_HISTORY)).toEqual({ v: 1, entries: [], index: -1 });
  });

  it.each([undefined, null, 42, 'x', [], {}, { v: 2, entries: [], index: 0 }, { v: 1, entries: 'no', index: 0 }])(
    'reads %j as empty',
    (raw) => {
      expect(parseHistory(raw, CAP)).toEqual(EMPTY_HISTORY);
    },
  );

  it('drops bad entries and keeps the current entry current', () => {
    const raw = {
      v: 1,
      entries: [{ filePath: 'a' }, null, { filePath: 42 }, { filePath: '' }, { nope: 1 }, { filePath: 'b' }, { filePath: 'c' }],
      index: 5,
    };
    expect(parseHistory(raw, CAP)).toEqual(build(['a', 'b', 'c'], 1));
  });

  it('clamps an index outside the list, or not an integer', () => {
    expect(parseHistory({ v: 1, entries: [{ filePath: 'a' }, { filePath: 'b' }], index: 9 }, CAP).index).toBe(1);
    expect(parseHistory({ v: 1, entries: [{ filePath: 'a' }, { filePath: 'b' }], index: -4 }, CAP).index).toBe(0);
    expect(parseHistory({ v: 1, entries: [{ filePath: 'a' }, { filePath: 'b' }], index: 'x' }, CAP).index).toBe(1);
    expect(parseHistory({ v: 1, entries: [{ filePath: 'a' }, { filePath: 'b' }], index: 0.5 }, CAP).index).toBe(0);
  });

  it('when the current entry itself was bad, lands on the nearest older surviving entry', () => {
    const raw = { v: 1, entries: [{ filePath: 'a' }, { filePath: 'b' }, { filePath: 7 }, { filePath: 'd' }], index: 2 };
    expect(parseHistory(raw, CAP)).toEqual(build(['a', 'b', 'd'], 1));
  });

  it('applies the cap, never dropping the current entry', () => {
    const raw = serialiseHistory(build(['a', 'b', 'c', 'd', 'e'], 4));
    expect(parseHistory(raw, 2)).toEqual(build(['d', 'e'], 1));
  });

  it('drops a viewState over 1 KiB and keeps the entry', () => {
    const raw = { v: 1, entries: [{ filePath: 'a', viewState: 'y'.repeat(2000) }, { filePath: 'b', viewState: { top: 1 } }], index: 1 };
    expect(parseHistory(raw, CAP)).toEqual({
      entries: [{ filePath: 'a' }, { filePath: 'b', viewState: { top: 1 } }],
      index: 1,
    });
  });
});

/**
 * SC-007 — a seeded property test. `mulberry32` is inlined so the sequence is identical on every run
 * and every machine, with no new dependency; a failure message names the seed and the sequence number
 * so the exact case can be replayed.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('SC-007 — Back/Forward and persistence round trips over 500 random op sequences', () => {
  const SEED = 0x044136;
  const SEQUENCES = 500;
  // Mixed spellings of the SAME files — separators and drive-letter case — so H2's "however its path
  // is spelled" is exercised rather than asserted once by hand.
  const POOL = [
    'C:/p/a.md',
    'c:\\p\\a.md',
    'C:/p/b.md',
    'C:\\P\\b.md',
    'C:/p/docs/c.md',
    'c:/p\\docs\\c.md',
    'C:/p/docs/d.md',
    'C:/p/e.md',
    'C:/q/f.md',
  ];

  it('holds H1 throughout, returns to the same file both ways, and round-trips through persistence', () => {
    const rand = mulberry32(SEED);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const viewStates = (x: NavigationHistory): unknown[] => x.entries.map((e) => e.viewState);

    for (let seq = 0; seq < SEQUENCES; seq += 1) {
      const where = `seed ${SEED}, sequence ${seq}`;
      const cap = 1 + Math.floor(rand() * 8);
      let h: NavigationHistory = EMPTY_HISTORY;
      const length = 1 + Math.floor(rand() * 30);

      for (let step = 0; step < length; step += 1) {
        const at = `${where}, step ${step}`;
        const before = h;
        const h12Before = h12Holds(before);
        const op = Math.floor(rand() * 9);
        if (op <= 1) {
          const path = pick(POOL);
          h = recordOpen(h, path, cap);
          // H2 — the current file, however spelled, records nothing.
          const current = before.entries[before.index];
          if (current !== undefined && samePath(current.filePath, path)) expect(h, `${at}: H2`).toBe(before);
        } else if ((op === 2 && canGoBack(h)) || (op === 3 && canGoForward(h))) {
          h = moveTo(h, targetOf(h, op === 2 ? 'back' : 'forward')!.index);
          // H4/H9 — a move changes the position only; every entry's viewState is untouched.
          expect(h.entries, `${at}: H4`).toBe(before.entries);
          expect(viewStates(h), `${at}: H9 across a move`).toEqual(viewStates(before));
        } else if (op === 4) {
          /*
           * The reader reporting where they are, by the route main actually uses (T219).
           *
           * It was `setCurrentViewState` alone, and H12 below carried an `op !== 4` exemption for it —
           * an invariant with a hole exactly where the defect lived. Places are drawn from the same
           * SMALL set the jump op uses, so a report that lands on a neighbour's place is common
           * rather than a one-in-five-thousand coincidence; with `{ top: rand() * 5000 }` the merge
           * branch would essentially never be reached and the strengthened H12 would prove nothing.
           */
          h = recordCurrentPlace(h, pick([TOP, AT_10, AT_20]));
        } else if (op === 5) {
          h = rewritePaths(h, [{ from: 'C:/p/docs', to: 'C:/p/guide' }]);
          // H7 (amended) — order is kept; with nothing fused, index and every viewState are unchanged; a
          // fused pair drops an entry, and the current entry survives with its viewState either way (H9).
          if (h.entries.length === before.entries.length) {
            expect(h.index, `${at}: H7`).toBe(before.index);
            expect(viewStates(h), `${at}: H9 across a path rewrite`).toEqual(viewStates(before));
          } else if (before.entries.length > 0) {
            expect(h.entries[h.index]!.viewState, `${at}: H9 across a merging rewrite`).toEqual(
              before.entries[before.index]!.viewState,
            );
          }
        } else if (op === 6 && h.entries.length > 0) {
          h = rewriteCurrent(h, pick(POOL));
        } else if (op === 7 && h.entries.length > 0) {
          // H6 — a lower cap never drops the current entry, which survives by reference.
          h = applyCap(h, 1 + Math.floor(rand() * cap));
          expect(h.entries[h.index], `${at}: H6`).toBe(before.entries[before.index]);
        } else if (op === 8) {
          // FR-115 — places drawn from a SMALL set, so the equal-place branches (steps 2 and 3) are hit often.
          const places = [TOP, AT_10, AT_20];
          h = recordJump(h, pick(places), pick(places), cap);
          if (before.entries.length === 0) {
            expect(h, `${at}: H11`).toBe(before);
          } else {
            // H13 — the current entry names the file the reader was in, whatever the reducer decided.
            expect(samePath(h.entries[h.index]!.filePath, before.entries[before.index]!.filePath), `${at}: H13`).toBe(true);
          }
          // H10 — nothing but recordJump and setCurrentViewState ever writes a place; neither runs on an editor.
        }
        assertH1(h);
        expect(h.entries.length, where).toBeLessThanOrEqual(cap);
        // H2a (reconciled with FR-115) — NO op but recordJump makes two adjacent entries name one file: the
        // count of such pairs never rises, so a rewrite merges what it fused and never fuses a jump chain apart
        // from what was already there.
        if (op !== 8) {
          expect(sameFilePairs(h), `${at}: H2a`).toBeLessThanOrEqual(sameFilePairs(before));
        }
        /*
         * H12 — NO op makes two consecutive entries one file at one place (T219).
         *
         * This used to exempt op 4. FR-115's fourth sentence carries no such qualifier, and the
         * exemption was the invariant agreeing with the code instead of with the requirement: a
         * reader who scrolls back to where an earlier jump left them got a Back press that was
         * enabled, accepted, and changed nothing.
         */
        if (h12Before) expect(h12Holds(h), `${at}: H12`).toBe(true);
      }

      const current = h.entries[h.index]?.filePath;

      if (canGoBack(h)) {
        const back = moveTo(h, targetOf(h, 'back')!.index);
        const returned = moveTo(back, targetOf(back, 'forward')!.index);
        expect(returned.entries[returned.index].filePath, `${where}: back then forward`).toBe(current);
        expect(returned, `${where}: back then forward`).toEqual(h);
      }
      if (canGoForward(h)) {
        const forward = moveTo(h, targetOf(h, 'forward')!.index);
        const returned = moveTo(forward, targetOf(forward, 'back')!.index);
        expect(returned.entries[returned.index].filePath, `${where}: forward then back`).toBe(current);
        expect(returned, `${where}: forward then back`).toEqual(h);
      }

      expect(parseHistory(serialiseHistory(h), cap), `${where}: persistence round trip`).toEqual(h);
    }
  });
});
