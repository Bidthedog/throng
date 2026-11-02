/**
 * MOVED DOWN from `component/file-clipboard-store.test.ts` (pass 2): `isCut` is a pure path comparison and
 * renders nothing (050 T023, FR-004).
 */
import { describe, expect, it } from 'vitest';
import type { FileClipboard } from '@throng/core';
import { isCut } from '../../src/renderer/explorer/file-clipboard-store.js';

const item = (absPath: string, projectId = 'p1') => ({ absPath, projectId, projectRoot: 'C:/a' });

describe('isCut (050 T023, FR-004)', () => {
  const cutOf = (...paths: string[]): FileClipboard => ({ mode: 'cut', items: paths.map((p) => item(p)) });

  it('compares normalised paths: separators, case and a trailing slash do not matter', () => {
    const clipboard = cutOf('C:\\Proj\\src\\a.ts');
    expect(isCut(clipboard, 'c:/proj/src/a.ts')).toBe(true);
    expect(isCut(clipboard, 'C:/Proj/src/a.ts/')).toBe(true);
    expect(isCut(clipboard, 'C:/Proj/src/b.ts')).toBe(false);
  });

  it('is false for a copy, and for an empty clipboard', () => {
    expect(isCut({ mode: 'copy', items: [item('C:/a/x')] }, 'C:/a/x')).toBe(false);
    expect(isCut(null, 'C:/a/x')).toBe(false);
  });

  it('does not match a path that merely shares a prefix', () => {
    expect(isCut(cutOf('C:/a/foo'), 'C:/a/foobar')).toBe(false);
  });
});
