import { describe, it, expect } from 'vitest';
import { isWithinRoot, isDropAllowed, isRoot } from '@throng/core';

const ROOT = 'C:/proj';

describe('explorer path-rules confinement (004 T035/T040)', () => {
  it('accepts the root and paths inside it', () => {
    expect(isWithinRoot(ROOT, 'C:/proj')).toBe(true);
    expect(isWithinRoot(ROOT, 'C:/proj/src/index.ts')).toBe(true);
    // Normalisation: separators + case + trailing slash.
    expect(isWithinRoot(ROOT, 'C:\\proj\\src')).toBe(true);
    expect(isWithinRoot('C:/Proj', 'C:/proj/src')).toBe(true);
  });

  it('rejects paths outside the root (incl. a resolved symlink escape)', () => {
    expect(isWithinRoot(ROOT, 'C:/other')).toBe(false);
    expect(isWithinRoot(ROOT, 'C:/proj-evil')).toBe(false);
    // A symlink under the root that the caller resolved to an outside real path.
    expect(isWithinRoot(ROOT, 'D:/secrets')).toBe(false);
  });

  it('allows a drop into a sibling folder but not into self/descendant/outside', () => {
    expect(isDropAllowed('C:/proj/a', 'C:/proj/b', ROOT)).toBe(true);
    expect(isDropAllowed('C:/proj/a', 'C:/proj/a', ROOT)).toBe(false); // into itself
    expect(isDropAllowed('C:/proj/a', 'C:/proj/a/sub', ROOT)).toBe(false); // own descendant
    expect(isDropAllowed('C:/proj/a', 'C:/other', ROOT)).toBe(false); // outside
  });

  it('treats the root row (relPath "") as immutable', () => {
    expect(isRoot({ relPath: '' })).toBe(true);
    expect(isRoot({ relPath: 'src' })).toBe(false);
  });
});
