import { describe, it, expect } from 'vitest';
import {
  resolveTarget,
  nameProblem,
  dedupeName,
  resolveDragEffect,
  type FileNode,
} from '@throng/core';
import { withHostTraits } from '@throng/core/testing';

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

describe('names a file cannot have (004 T036/T042)', () => {
  it('refuses an empty name and the dot names everywhere, and a slash where it separates', () => {
    for (const os of ['windows', 'linux', 'macos'] as const) {
      withHostTraits(os, () => {
        expect(nameProblem('')).not.toBeNull();
        expect(nameProblem('.')).not.toBeNull();
        expect(nameProblem('..')).not.toBeNull();
        expect(nameProblem('a/b')).not.toBeNull();
        expect(nameProblem('new-name.ts')).toBeNull();
      });
    }
  });

  it('refuses under Windows rules what Windows would reject or rename behind our back', () => {
    withHostTraits('windows', () => {
      for (const name of ['a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0001b', 'trailing.', 'trailing ', 'CON', 'prn.txt', 'com1', 'LPT9.log']) {
        expect(nameProblem(name), name).not.toBeNull();
      }
      for (const name of ['console.ts', 'nullable', 'com10', '.gitignore', 'a b.c']) expect(nameProblem(name), name).toBeNull();
    });
  });

  it('allows under Linux rules what Linux allows', () => {
    withHostTraits('linux', () => {
      for (const name of ['a\\b', 'a:b', 'trailing.', 'CON']) expect(nameProblem(name), name).toBeNull();
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
