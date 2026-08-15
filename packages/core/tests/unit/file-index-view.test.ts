import { describe, it, expect } from 'vitest';
import {
  IDLE_FILE_INDEX_VIEW,
  applyIndexUpdate,
  type FileIndexView,
} from '../../src/explorer/file-index-view.js';

/**
 * 033 FR-075 — what the renderer does with each shape of push (contracts/file-index.md §4).
 *
 * ══ WHY THIS IS IN CORE ══
 *
 * `use-file-index.ts` is a hook and there is no component test tier in this repository, so the rule
 * it holds could only ever be asserted through an Electron window. But the rule is ARITHMETIC — a
 * set, a delta and a sort — so it comes out into core and is asserted directly, the same split the
 * plan's Structure Decision makes everywhere else.
 *
 * ══ THE RULE THAT WAS MISSING, AND WHAT IT COST (finding F2) ══
 *
 * Main disowns a root's set when its watch fails (S11): status goes back to `building`, `paths` is
 * emptied, and the push carries NEITHER `paths` NOR a delta. The renderer's reducer read that as
 * "status changed, keep what you have" — so the modal went on offering a candidate set main had
 * explicitly stopped maintaining, and every file in it was as stale as the disk allowed.
 *
 * Both halves looked correct in isolation, which is why the contract now states the rule rather than
 * leaving it to be inferred: a `building` push with no paths and no delta means DISCARD.
 */
const ready = (...paths: string[]): FileIndexView => ({ status: 'ready', paths });

describe('applyIndexUpdate (FR-075, contracts/file-index.md §4)', () => {
  it('a ready push carrying `paths` replaces the set wholesale', () => {
    const next = applyIndexUpdate(ready('old.ts'), {
      status: 'ready',
      paths: ['a.ts', 'b.ts'],
    });
    expect(next).toEqual({ status: 'ready', paths: ['a.ts', 'b.ts'] });
  });

  it('an EMPTY `paths` array is a real answer, not an absent one', () => {
    // An empty project is `ready` with nothing in it, and a reducer that treated `[]` as "no paths
    // field" would leave the previous project's files on screen under the new project's name.
    expect(applyIndexUpdate(ready('a.ts'), { status: 'ready', paths: [] })).toEqual({
      status: 'ready',
      paths: [],
    });
  });

  it('a delta is applied and the result stays in the index’s own sort order', () => {
    const next = applyIndexUpdate(ready('a.ts', 'm.ts', 'z.ts'), {
      status: 'ready',
      added: ['b.ts', 'y.ts'],
      removed: ['m.ts'],
    });
    // `.sort()` — UTF-16 code-unit order, the same order `walkFiles` produces and `diffPaths` merges
    // against. A renderer copy in a DIFFERENT order is equal as a set and wrong as a list.
    expect(next.paths).toEqual(['a.ts', 'b.ts', 'y.ts', 'z.ts']);
    expect(next.status).toBe('ready');
  });

  it('a delta with only removals is applied', () => {
    expect(applyIndexUpdate(ready('a.ts', 'b.ts'), { status: 'ready', removed: ['a.ts'] }).paths)
      .toEqual(['b.ts']);
  });

  it('a delta with only additions is applied', () => {
    expect(applyIndexUpdate(ready('b.ts'), { status: 'ready', added: ['a.ts'] }).paths).toEqual([
      'a.ts',
      'b.ts',
    ]);
  });

  it('FR-075 — a push with no paths and no delta DISCARDS what is held', () => {
    const next = applyIndexUpdate(ready('a.ts', 'b.ts'), { status: 'building' });
    expect(next.status).toBe('building');
    expect(
      next.paths,
      'main has disowned the set; serving it anyway looks current and is not',
    ).toEqual([]);
  });

  it('FR-075 — the discard holds for a `ready` push with neither field, too', () => {
    // The rule is about the ABSENCE of both fields, not about the status word. A `ready` push that
    // named no set and no change would be main saying nothing at all, and nothing is not a set.
    expect(applyIndexUpdate(ready('a.ts'), { status: 'ready' }).paths).toEqual([]);
  });

  it('an empty delta is a no-op, not a discard', () => {
    // S7 means main never sends this, but the two shapes are one keystroke apart and the difference
    // between them is the whole of FR-075.
    const view = ready('a.ts', 'b.ts');
    const next = applyIndexUpdate(view, { status: 'ready', added: [], removed: [] });
    expect(next.paths).toEqual(['a.ts', 'b.ts']);
  });

  it('never mutates the view it was handed', () => {
    const view = ready('a.ts', 'z.ts');
    applyIndexUpdate(view, { status: 'ready', added: ['b.ts'], removed: ['z.ts'] });
    expect(view.paths).toEqual(['a.ts', 'z.ts']);
  });

  it('applies to the idle view without special-casing it', () => {
    expect(IDLE_FILE_INDEX_VIEW).toEqual({ status: 'idle', paths: [] });
    expect(applyIndexUpdate(IDLE_FILE_INDEX_VIEW, { status: 'ready', paths: ['a.ts'] })).toEqual({
      status: 'ready',
      paths: ['a.ts'],
    });
  });
});
