import { describe, it, expect } from 'vitest';
import {
  resolveTarget,
  validateRename,
  dedupeName,
  resolveDragEffect,
  type FileNode,
} from '@throng/core';

const node = (relPath: string, kind: 'file' | 'folder'): FileNode => ({
  id: relPath,
  name: relPath.split('/').pop() ?? relPath,
  kind,
  relPath,
  isSymlink: false,
  hasChildren: kind === 'folder',
});

describe('explorer target resolution (004 T036/T041)', () => {
  it('targets a folder itself, a file’s parent, or the root', () => {
    expect(resolveTarget(null)).toBe('');
    expect(resolveTarget(node('src', 'folder'))).toBe('src');
    expect(resolveTarget(node('src/app/main.ts', 'file'))).toBe('src/app');
    expect(resolveTarget(node('top.txt', 'file'))).toBe('');
  });
});

describe('explorer rename validation (004 T036/T042)', () => {
  it('rejects empty, dotted, invalid-char, and colliding names', () => {
    expect(validateRename('  ', []).ok).toBe(false);
    expect(validateRename('..', []).ok).toBe(false);
    expect(validateRename('a/b', []).ok).toBe(false);
    expect(validateRename('a:b', []).ok).toBe(false);
    expect(validateRename('Existing', ['existing']).ok).toBe(false); // case-insensitive
  });
  it('accepts a fresh valid name', () => {
    expect(validateRename('new-name.ts', ['other.ts']).ok).toBe(true);
  });

  // 026 / #194 — an item is not a collision with ITSELF.
  //
  // The sibling comparison is case-insensitive, which is right for Windows and wrong for the item
  // being renamed: an item is always one of its own siblings, so a case-only change always
  // self-collided. Callers that know which sibling is the one being renamed pass its current name,
  // and it is excluded from the comparison.
  //
  // This helper has no callers today (the tree renames through the files bridge, which carries its
  // own guard), so the rule was never actually reachable — but two collision rules that disagree is
  // one waiting to be picked up by the next caller. 026 FR-005 makes them agree.
  describe('an item does not collide with itself (026 / #194)', () => {
    it('permits a case-only change when the item’s current name is known', () => {
      expect(validateRename('Job Specs', ['Job specs', 'other'], 'Job specs').ok).toBe(true);
      expect(validateRename('README.md', ['readme.md'], 'readme.md').ok).toBe(true);
    });

    it('still rejects a collision with a DIFFERENT sibling, in any casing', () => {
      expect(validateRename('two.txt', ['one.txt', 'two.txt'], 'one.txt').ok).toBe(false);
      expect(validateRename('TWO.TXT', ['one.txt', 'two.txt'], 'one.txt').ok).toBe(false);
    });

    it('permits renaming to the item’s own name unchanged', () => {
      expect(validateRename('same.txt', ['same.txt'], 'same.txt').ok).toBe(true);
    });

    it('keeps the original behaviour when no current name is given', () => {
      // Existing callers pass two arguments and must be unaffected.
      expect(validateRename('Existing', ['existing']).ok).toBe(false);
    });
  });
});

describe('explorer name de-duplication (004 T036/T042)', () => {
  it('uses the copy scheme for copy/paste', () => {
    expect(dedupeName('report.txt', ['report.txt'])).toBe('report copy.txt');
    expect(dedupeName('report.txt', ['report.txt', 'report copy.txt'])).toBe('report copy 2.txt');
    expect(dedupeName('clean.txt', ['other.txt'])).toBe('clean.txt'); // no collision
  });
  it('uses the numbered scheme for a new folder', () => {
    expect(dedupeName('New folder', ['New folder'], 'numbered')).toBe('New folder (2)');
    expect(dedupeName('New folder', ['New folder', 'New folder (2)'], 'numbered')).toBe(
      'New folder (3)',
    );
  });
});

describe('explorer drag effect (004 T036/T043; 006 FR-095)', () => {
  it('moves by default and copies with Ctrl', () => {
    expect(resolveDragEffect({})).toBe('move');
    expect(resolveDragEffect({ ctrl: true })).toBe('copy');
  });

  it('Shift forces move even alongside no copy (Windows-style default)', () => {
    expect(resolveDragEffect({ shift: true })).toBe('move');
  });

  it('honours a custom modifier config (copy=shift, move=ctrl)', () => {
    const cfg = { copy: 'shift' as const, move: 'ctrl' as const };
    expect(resolveDragEffect({ shift: true }, cfg)).toBe('copy');
    expect(resolveDragEffect({ ctrl: true }, cfg)).toBe('move');
    expect(resolveDragEffect({}, cfg)).toBe('move');
  });

  it('copy modifier wins when both are somehow held', () => {
    expect(resolveDragEffect({ ctrl: true, shift: true })).toBe('copy');
  });
});
