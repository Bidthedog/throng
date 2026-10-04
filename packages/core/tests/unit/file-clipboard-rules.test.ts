import { describe, expect, it } from 'vitest';
import {
  afterRun,
  dropDeleted,
  followMoves,
  retainProjects,
  type ClipboardItem,
  type FileClipboard,
} from '@throng/core';

/*
 * 050 R1 — the application clipboard's pure transitions. Main applies them; these decide them.
 */
const item = (absPath: string, projectId = 'pa', projectRoot = 'C:/a'): ClipboardItem => ({
  absPath,
  projectId,
  projectRoot,
});

describe('followMoves (FR-009)', () => {
  it('rewrites an item that was moved, and one under a moved folder, by prefix', () => {
    const items = [item('C:/a/x.md'), item('C:/a/dir/y.md'), item('C:/a/other.md')];
    const out = followMoves(items, [
      { from: 'C:/a/x.md', to: 'C:/a/sub/x.md' },
      { from: 'C:/a/dir', to: 'C:/a/renamed' },
    ]);
    expect(out.map((i) => i.absPath)).toEqual(['C:/a/sub/x.md', 'C:/a/renamed/y.md', 'C:/a/other.md']);
  });

  it('matches separator- and case-insensitively, keeping the item\'s other fields', () => {
    const out = followMoves([item('C:\\A\\Dir\\y.md')], [{ from: 'c:/a/dir', to: 'C:/a/new' }]);
    expect(out[0]).toEqual({ ...item('C:/a/new/y.md') });
  });

  it('spells the rewritten path in the destination\'s own separators (FR-001: OS-spelled)', () => {
    const out = followMoves([item('C:\\a\\dir\\sub\\y.md')], [{ from: 'C:\\a\\dir', to: 'C:\\a\\new' }]);
    expect(out[0]!.absPath).toBe('C:\\a\\new\\sub\\y.md');
  });

  it('does not treat a sibling sharing a prefix as inside the moved folder', () => {
    const items = [item('C:/a/dir-two/y.md')];
    expect(followMoves(items, [{ from: 'C:/a/dir', to: 'C:/a/x' }])).toEqual(items);
  });

  it('returns the same array when nothing matched', () => {
    const items = [item('C:/a/x.md')];
    expect(followMoves(items, [{ from: 'C:/a/q', to: 'C:/a/r' }])).toBe(items);
  });
});

describe('dropDeleted (FR-009)', () => {
  it('drops a deleted item and every item under a deleted folder', () => {
    const items = [item('C:/a/x.md'), item('C:/a/dir/y.md'), item('C:/a/keep.md')];
    expect(dropDeleted(items, ['c:\\a\\x.md', 'C:/a/dir']).map((i) => i.absPath)).toEqual(['C:/a/keep.md']);
  });

  it('returns the same array when nothing matched', () => {
    const items = [item('C:/a/x.md')];
    expect(dropDeleted(items, ['C:/a/z.md'])).toBe(items);
  });
});

describe('retainProjects (FR-011)', () => {
  const clip: FileClipboard = { mode: 'cut', items: [item('C:/a/x.md')] };

  it('keeps the clipboard while its project exists at the same root', () => {
    expect(retainProjects(clip, new Map([['pa', 'C:\\A\\']]))).toBe(clip);
  });

  it('empties it when the project is gone', () => {
    expect(retainProjects(clip, new Map([['pb', 'D:/b']]))).toBeNull();
  });

  it('empties it when the project was re-rooted', () => {
    expect(retainProjects(clip, new Map([['pa', 'C:/elsewhere']]))).toBeNull();
  });

  it('leaves an empty clipboard empty', () => {
    expect(retainProjects(null, new Map())).toBeNull();
  });
});

describe('afterRun (FR-006, FR-019c)', () => {
  const snapshot: FileClipboard = { mode: 'cut', items: [item('C:/a/x.md'), item('C:/a/y.md')] };

  it('keeps exactly the items that did not move, still a cut', () => {
    expect(afterRun(snapshot, snapshot, [item('C:/a/y.md')])).toEqual({ mode: 'cut', items: [item('C:/a/y.md')] });
  });

  it('is empty once every item moved', () => {
    expect(afterRun(snapshot, snapshot, [])).toBeNull();
  });

  it('leaves a clipboard the user replaced during the run alone', () => {
    const replaced: FileClipboard = { mode: 'copy', items: [item('C:/a/z.md')] };
    expect(afterRun(replaced, snapshot, [])).toBe(replaced);
    expect(afterRun(null, snapshot, [item('C:/a/y.md')])).toBeNull();
  });

  it('compares by content, not identity — the same items in a fresh object still count as the snapshot', () => {
    const same: FileClipboard = { mode: 'cut', items: [item('C:/a/x.md'), item('C:/a/y.md')] };
    expect(afterRun(same, snapshot, [item('C:/a/x.md')])).toEqual({ mode: 'cut', items: [item('C:/a/x.md')] });
  });

  it('never touches a copy: it stays on the clipboard after a paste', () => {
    const copy: FileClipboard = { mode: 'copy', items: snapshot.items };
    expect(afterRun(copy, copy, [])).toBe(copy);
  });
});
