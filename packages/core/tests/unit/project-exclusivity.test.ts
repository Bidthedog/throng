import { describe, it, expect } from 'vitest';
import {
  assertFolderExclusive,
  isFolderConflict,
  normaliseFolder,
  ProjectFolderConflictError,
} from '@throng/core';

describe('project folder exclusivity (FR-029)', () => {
  it('normalises paths (slashes, case, trailing) for comparison', () => {
    expect(normaliseFolder('D:\\Test\\')).toBe('d:/test');
    expect(normaliseFolder('D:/Test//Sub/')).toBe('d:/test/sub');
  });

  it('detects identical, ancestor, and descendant conflicts; siblings are fine', () => {
    expect(isFolderConflict('D:\\test', 'D:/test')).toBe(true); // identical
    expect(isFolderConflict('D:\\test\\sub', 'D:\\test')).toBe(true); // descendant
    expect(isFolderConflict('D:\\test', 'D:\\test\\sub')).toBe(true); // ancestor
    expect(isFolderConflict('D:\\test', 'D:\\testing')).toBe(false); // prefix but not a subfolder
    expect(isFolderConflict('D:\\a', 'D:\\b')).toBe(false); // siblings
  });

  it('assertFolderExclusive throws on conflict and excludes the edited project', () => {
    const existing = [
      { id: 'p1', rootFolder: 'D:\\test' },
      { id: 'p2', rootFolder: 'D:\\other' },
    ];
    expect(() => assertFolderExclusive('D:\\test\\sub', existing)).toThrow(ProjectFolderConflictError);
    // editing p1 to a deeper path under itself is still its own folder — excluded by selfId
    expect(() => assertFolderExclusive('D:\\test', existing, 'p1')).not.toThrow();
    // editing p2 onto p1's tree conflicts
    expect(() => assertFolderExclusive('D:\\test\\x', existing, 'p2')).toThrow(ProjectFolderConflictError);
  });
});
