import { describe, expect, it } from 'vitest';
import { movedPathOf } from '../../src/main/editor-coordinator.js';

/**
 * `movedPathOf` — where an open document's file went after an in-app move (019 FR-002/FR-005), shared by
 * the editor coordinator and 044's standalone previews.
 *
 * Adversarial review (core hardening): the remainder below a moved FOLDER was cut at the length of
 * `normaliseForCompare(move.from)`. Lower-casing is not length-preserving — `'İ'.toLowerCase()` is two
 * UTF-16 units — so a folder with an `İ` in its name cut one character into the file name and re-pointed
 * the editor at `D:/ya.md`. The cut counts SEGMENTS instead.
 */
describe('movedPathOf', () => {
  it('a file named by the move goes to its destination', () => {
    expect(movedPathOf('D:/p/a.md', [{ from: 'd:\\p\\A.md', to: 'D:/p/b.md' }])).toBe('D:/p/b.md');
  });

  it('a file under a moved folder keeps its remainder, spelled with the destination’s separator', () => {
    expect(movedPathOf('D:/p/docs/sub/a.md', [{ from: 'D:\\p\\docs', to: 'D:\\p\\guide' }])).toBe(
      'D:\\p\\guide\\sub\\a.md',
    );
  });

  it('a folder whose name lower-cases to a LONGER string (İ) keeps the whole remainder', () => {
    expect(movedPathOf('D:/İx/a.md', [{ from: 'D:/İx', to: 'D:/y' }])).toBe('D:/y/a.md');
    expect(movedPathOf('D:/İx/sub/b.md', [{ from: 'D:/İx/', to: 'D:/y/' }])).toBe('D:/y/sub/b.md');
  });

  it('a path the move does not touch is null', () => {
    expect(movedPathOf('D:/p/package-lock.json', [{ from: 'D:/p/pack', to: 'D:/q' }])).toBeNull();
  });
});
