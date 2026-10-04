import { describe, expect, it } from 'vitest';
import { classifyTopLevel, clashKind, keepBothName, landingPlan, newerOf } from '@throng/core';

/*
 * 050 R3 — the pure rules a paste or drag is planned by. Main supplies the real paths and walks the
 * filesystem; these decide what each fact means.
 */
describe('classifyTopLevel (050 FR-018c, 006 drop-onto-own-parent)', () => {
  it('a source whose parent IS the target is a same-folder duplicate, for copy and cut alike', () => {
    expect(classifyTopLevel('C:/p/src', 'C:/p/src', 'C:/p/src/a.txt', 'copy')).toBe('same-folder-duplicate');
    expect(classifyTopLevel('C:/p/src', 'C:/p/src', 'C:/p/src/a.txt', 'cut')).toBe('same-folder-duplicate');
  });

  it('compares separator- and case-normalised, as NTFS does', () => {
    expect(classifyTopLevel('C:\\P\\Src', 'c:/p/src/', 'C:\\P\\Src\\a.txt', 'copy')).toBe('same-folder-duplicate');
  });

  it('a target that is the source, or inside it, is refused as its own descendant', () => {
    expect(classifyTopLevel('C:/p', 'C:/p/dir', 'C:/p/dir', 'cut')).toBe('into-own-descendant');
    expect(classifyTopLevel('C:/p', 'C:/p/dir/sub', 'C:/p/dir', 'copy')).toBe('into-own-descendant');
  });

  it('a sibling that merely shares a prefix is not a descendant', () => {
    expect(classifyTopLevel('C:/p', 'C:/p/dir-two', 'C:/p/dir', 'cut')).toBe('ordinary');
  });

  it('anything else is ordinary, across roots included', () => {
    expect(classifyTopLevel('C:/a/src', 'D:/b/dst', 'C:/a/src/x.md', 'cut')).toBe('ordinary');
  });
});

describe('clashKind (050 FR-018c, edge case "clash with a different kind")', () => {
  it('folder onto folder merges', () => {
    expect(clashKind('folder', 'folder')).toBe('merge');
  });

  it('every other pairing is replaceable and never merges', () => {
    expect(clashKind('file', 'file')).toBe('replaceable');
    expect(clashKind('file', 'folder')).toBe('replaceable');
    expect(clashKind('folder', 'file')).toBe('replaceable');
  });
});

describe('keepBothName (050 FR-018a)', () => {
  it('is the non-clobbering name a copy has always taken', () => {
    expect(keepBothName('a.txt', ['a.txt'])).toBe('a copy.txt');
    expect(keepBothName('a.txt', ['a.txt', 'a copy.txt'])).toBe('a copy 2.txt');
  });

  it('is case-insensitive about what is taken', () => {
    expect(keepBothName('A.TXT', ['a.txt'])).toBe('A copy.TXT');
  });
});

describe('landingPlan (050 FR-033, SC-010)', () => {
  it('keeps the structure relative to the deepest folder holding every item', () => {
    expect(landingPlan(['C:\\r\\test\\test.md', 'C:\\r\\test.md'], 'C:\\r\\test2')).toEqual([
      { src: 'C:\\r\\test\\test.md', destDir: 'C:\\r\\test2\\test' },
      { src: 'C:\\r\\test.md', destDir: 'C:\\r\\test2' },
    ]);
  });

  it('lands every item directly in the target when they share one folder, as before', () => {
    expect(landingPlan(['C:/a/x.md', 'C:/a/y.md'], 'D:/b/dst')).toEqual([
      { src: 'C:/a/x.md', destDir: 'D:/b/dst' },
      { src: 'C:/a/y.md', destDir: 'D:/b/dst' },
    ]);
  });

  it('keeps several levels, spelled in the target\'s separator and the source\'s case', () => {
    expect(landingPlan(['C:/r/A/B/one.md', 'C:/r/C/two.md'], 'D:\\dst')).toEqual([
      { src: 'C:/r/A/B/one.md', destDir: 'D:\\dst\\A\\B' },
      { src: 'C:/r/C/two.md', destDir: 'D:\\dst\\C' },
    ]);
  });

  it('drops an item inside another selected folder: it travels with that folder', () => {
    expect(landingPlan(['C:/r/test', 'C:/r/test/test.md', 'C:/r/top.md'], 'C:/r/dst')).toEqual([
      { src: 'C:/r/test', destDir: 'C:/r/dst' },
      { src: 'C:/r/top.md', destDir: 'C:/r/dst' },
    ]);
  });

  it('compares parents case- and separator-insensitively, as NTFS does', () => {
    expect(landingPlan(['C:\\R\\Test\\a.md', 'c:/r/test/b.md'], 'C:/dst')).toEqual([
      { src: 'C:\\R\\Test\\a.md', destDir: 'C:/dst' },
      { src: 'c:/r/test/b.md', destDir: 'C:/dst' },
    ]);
  });
});

describe('newerOf (050 FR-018)', () => {
  it('marks the side with the later modified time', () => {
    expect(newerOf({ modifiedMs: 1 }, { modifiedMs: 2 })).toBe('incoming');
    expect(newerOf({ modifiedMs: 5 }, { modifiedMs: 2 })).toBe('existing');
  });

  it('marks neither when the times are equal or one side has none (a folder)', () => {
    expect(newerOf({ modifiedMs: 2 }, { modifiedMs: 2 })).toBe('neither');
    expect(newerOf({}, { modifiedMs: 2 })).toBe('neither');
  });
});
