/**
 * The host platform's modifiers, read from host traits rather than `navigator.platform` or the build's default
 * platform (070 FR-030, research R21, R32).
 */
import { describe, expect, it } from 'vitest';
import { linuxHostTraits, macosHostTraits } from '@throng/core';
import { withHostTraits } from '@throng/core/testing';
import {
  columnSelectModifier,
  crosshairKey,
  primaryModifierHeld,
  primaryModifierLabel,
  primaryModifierToken,
} from '../../src/renderer/config/host-modifiers.js';
import { linkModifierName } from '../../src/renderer/editor/link-decorations.js';

const MACOS = macosHostTraits('/tmp/throng', []);
const LINUX = linuxHostTraits('/run/x');
const held = (ctrlKey: boolean, metaKey: boolean) => ({ ctrlKey, metaKey });

describe('the primary modifier', () => {
  it('is Cmd on macOS', () => {
    withHostTraits(MACOS, () => {
      expect(primaryModifierHeld(held(false, true))).toBe(true);
      expect(primaryModifierHeld(held(true, false))).toBe(false);
      expect(primaryModifierLabel()).toBe('Cmd');
      expect(primaryModifierToken()).toBe('Meta');
    });
  });

  it('is Ctrl on Windows and Linux, and Meta does not stand in for it', () => {
    for (const run of [(fn: () => void) => fn(), (fn: () => void) => withHostTraits(LINUX, fn)]) {
      run(() => {
        expect(primaryModifierHeld(held(true, false))).toBe(true);
        expect(primaryModifierHeld(held(false, true))).toBe(false);
        expect(primaryModifierLabel()).toBe('Ctrl');
        expect(primaryModifierToken()).toBe('Ctrl');
      });
    }
  });
});

describe('the editor’s platform-keyed modifiers (016 FR-017e, 070 FR-030)', () => {
  it('read the host platform’s table: Option column-selects and Cmd follows a link on macOS', () => {
    withHostTraits(MACOS, () => {
      expect(columnSelectModifier()).toBe('Alt');
      expect(crosshairKey()).toBe('Alt');
      expect(linkModifierName()).toBe('Meta');
    });
  });

  it('are unchanged on Windows and Linux', () => {
    expect(columnSelectModifier()).toBe('Alt');
    expect(crosshairKey()).toBe('Alt');
    expect(linkModifierName()).toBe('Ctrl');
    withHostTraits(LINUX, () => expect(linkModifierName()).toBe('Ctrl'));
  });
});
