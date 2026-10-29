import { describe, expect, it } from 'vitest';
import { leftTruncatePath } from '@throng/core';

/**
 * 060 T003 — `leftTruncatePath` (FR-023, SC-005).
 *
 * The Find in Files menu names the file its two narrow replace rows act on. A whole root-relative path
 * made the menu as wide as the deepest file in the project, so the label is cut from the LEFT — the
 * file name is the part that says which file, and the leading directories are the part a reader can
 * spare — and on whole segments, so what survives still reads as a path.
 */
describe('leftTruncatePath', () => {
  it('returns a path that fits whole, with no ellipsis', () => {
    expect(leftTruncatePath('src/app.ts', 40)).toBe('src/app.ts');
    expect(leftTruncatePath('a'.repeat(40), 40)).toBe('a'.repeat(40));
  });

  it('keeps the longest suffix of whole segments that fits, after a leading …/', () => {
    const path = 'packages/ui/src/renderer/find-in-files/results-list.tsx';
    // `renderer/find-in-files/results-list.tsx` is 39 characters; with `…/` it is 41.
    expect(leftTruncatePath(path, 41)).toBe('…/renderer/find-in-files/results-list.tsx');
  });

  it('never splits a directory segment', () => {
    // One under 41, `renderer/` no longer fits — so the label stops at the next `/`, not mid-word.
    const path = 'packages/ui/src/renderer/find-in-files/results-list.tsx';
    expect(leftTruncatePath(path, 40)).toBe('…/find-in-files/results-list.tsx');
  });

  it('cuts an over-long file name itself from the left, with a leading …', () => {
    const label = leftTruncatePath(`deep/${'x'.repeat(60)}.ts`, 20);
    expect(label).toBe(`…${'x'.repeat(16)}.ts`);
  });

  it('never exceeds the bound, whatever the path (SC-005)', () => {
    const paths = [
      'a.ts',
      'one/two/three/four/five/six/seven/eight/nine/ten.ts',
      `${'d'.repeat(200)}/f.ts`,
      `x/${'y'.repeat(200)}`,
    ];
    for (const p of paths) expect(leftTruncatePath(p, 40).length).toBeLessThanOrEqual(40);
  });

  it('defaults to a 40-character bound', () => {
    const path = 'packages/ui/src/renderer/find-in-files/results-list.tsx';
    expect(leftTruncatePath(path)).toBe(leftTruncatePath(path, 40));
  });
});
