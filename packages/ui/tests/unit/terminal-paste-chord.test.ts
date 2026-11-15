/**
 * The terminal's paste chord (#142), per platform (070 FR-029): Cmd+V on macOS, where Ctrl+V must reach the shell
 * (readline's quoted-insert); Ctrl+V on Windows and Linux. Shift+Insert everywhere.
 */
import { describe, expect, it } from 'vitest';
import { linuxHostTraits, macosHostTraits } from '@throng/core';
import { withHostTraits } from '@throng/core/testing';
import { isPasteChord } from '../../src/renderer/terminal/paste-chord.js';

const MACOS = macosHostTraits('/tmp/throng', []);

const key = (k: string, mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('isPasteChord', () => {
  it('is Ctrl+V and Shift+Insert on Windows and Linux, never Cmd+V', () => {
    for (const run of [(fn: () => void) => fn(), (fn: () => void) => withHostTraits(linuxHostTraits('/run/x'), fn)]) {
      run(() => {
        expect(isPasteChord(key('v', { ctrlKey: true }))).toBe(true);
        expect(isPasteChord(key('V', { ctrlKey: true }))).toBe(true);
        expect(isPasteChord(key('Insert', { shiftKey: true }))).toBe(true);
        expect(isPasteChord(key('v', { ctrlKey: true, shiftKey: true }))).toBe(false);
        expect(isPasteChord(key('v', { metaKey: true }))).toBe(false);
        expect(isPasteChord(key('v', { altKey: true, ctrlKey: true }))).toBe(false);
      });
    }
  });

  it('is Cmd+V and Shift+Insert on macOS, and leaves Ctrl+V to the shell', () => {
    withHostTraits(MACOS, () => {
      expect(isPasteChord(key('v', { metaKey: true }))).toBe(true);
      expect(isPasteChord(key('Insert', { shiftKey: true }))).toBe(true);
      expect(isPasteChord(key('v', { ctrlKey: true }))).toBe(false);
      expect(isPasteChord(key('v', { metaKey: true, altKey: true }))).toBe(false);
    });
  });
});
