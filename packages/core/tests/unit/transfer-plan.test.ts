import { describe, expect, it } from 'vitest';
import { classifyTopLevel, clashKind, keepBothName, newerOf } from '@throng/core';

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
