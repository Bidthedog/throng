import { describe, it, expect } from 'vitest';
import { isWithinRoot, isDropAllowed, isRoot, relPathUnderRoot } from '@throng/core';

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

  it('expresses a file under the root relatively, keeping its original spelling (#137/#188)', () => {
    expect(relPathUnderRoot(ROOT, 'C:/proj/src/Index.ts')).toBe('src/Index.ts');
    // Windows spellings of the same file: backslashes, case, a trailing slash, doubled separators.
    expect(relPathUnderRoot(ROOT, 'C:\\Proj\\src\\Index.ts')).toBe('src/Index.ts');
    expect(relPathUnderRoot('C:/proj/', 'C:/proj//src/Index.ts')).toBe('src/Index.ts');
  });

  it('returns null for the root itself and for anything outside it (#188)', () => {
    // The root row is a folder, never a file a reveal could mean.
    expect(relPathUnderRoot(ROOT, 'C:/proj')).toBeNull();
    expect(relPathUnderRoot(ROOT, 'C:/other/file.ts')).toBeNull();
    expect(relPathUnderRoot(ROOT, 'C:/proj-evil/file.ts')).toBeNull(); // prefix, not a child
    expect(relPathUnderRoot('', 'C:/proj/file.ts')).toBeNull();
    expect(relPathUnderRoot(ROOT, '')).toBeNull();
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
