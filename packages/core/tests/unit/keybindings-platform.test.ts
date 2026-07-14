/**
 * Platform-keyed shipped chords (016, FR-017e / SC-010b — Principle II).
 *
 * Windows is the only platform this build ships, and the only one whose values are populated.
 * What must NOT happen is a macOS chord GUESSED here — an invented default is worse than an
 * absent one, because it looks decided.
 *
 * The requirement is about SHAPE: adding `macos` later must be an addition of VALUES, with no
 * existing key moving or changing type. That is what these assertions pin.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDING_PLATFORM,
  DEFAULT_KEYBINDINGS,
  SHIPPED_KEYBINDINGS_BY_PLATFORM,
  shippedBindingsFor,
} from '../../src/config/keybindings.js';

describe('platform-keyed shipped defaults (FR-017e)', () => {
  it('keys the shipped record by platform', () => {
    expect(Object.keys(SHIPPED_KEYBINDINGS_BY_PLATFORM)).toEqual(['windows']);
    expect(DEFAULT_BINDING_PLATFORM).toBe('windows');
  });

  it('populates ONLY Windows — no macOS or Linux chord is guessed in Part 1', () => {
    expect(SHIPPED_KEYBINDINGS_BY_PLATFORM.macos).toBeUndefined();
    expect(SHIPPED_KEYBINDINGS_BY_PLATFORM.linux).toBeUndefined();
  });

  it('carries the chords AND the column-select mouse modifier per platform — the modifier is a default too', () => {
    const windows = shippedBindingsFor('windows');
    expect(windows.columnSelectModifier).toBe('Alt');
    expect(windows.bindings['editor.cutLine']).toEqual(['Ctrl+X']);
  });

  it('adding a platform is a change of VALUES, not of SHAPE', () => {
    // The proof: a `macos` entry of the same shape drops in and nothing existing moves or changes
    // type. If the record were flat (action → chords), adding macOS would mean RESHAPING a record
    // 19 call sites already read — which is precisely the foreclosure FR-017e exists to prevent.
    const withMac = {
      ...SHIPPED_KEYBINDINGS_BY_PLATFORM,
      macos: { bindings: { 'editor.cutLine': ['Meta+X'] }, columnSelectModifier: 'Alt' as const },
    };
    expect(withMac.windows).toBe(SHIPPED_KEYBINDINGS_BY_PLATFORM.windows);
    expect(Object.keys(withMac).sort()).toEqual(['macos', 'windows']);
  });

  it('resolves the current platform for an unpopulated one, rather than yielding nothing', () => {
    // Running on macOS today must not leave the app with NO bindings; it falls back to the one
    // populated platform. That is a stopgap the shape makes visible, not a guess baked into data.
    expect(shippedBindingsFor('macos').bindings).toEqual(shippedBindingsFor('windows').bindings);
  });

  it('exposes `.bindings` as the resolved view every existing reader already uses', () => {
    expect(DEFAULT_KEYBINDINGS.bindings).toEqual(shippedBindingsFor(DEFAULT_BINDING_PLATFORM).bindings);
    expect(DEFAULT_KEYBINDINGS.bindings['file.cut']).toEqual(['Ctrl+X']);
  });

  it('ships the seven new commands with their Windows chords, in canonical modifier order', () => {
    const b = DEFAULT_KEYBINDINGS.bindings;
    expect(b['editor.cutLine']).toEqual(['Ctrl+X']);
    expect(b['editor.indentLines']).toEqual(['Tab']);
    expect(b['editor.outdentLines']).toEqual(['Shift+Tab']);
    // Canonical order is Ctrl+Shift+Alt+key (F2). Written `Alt+Shift+…` these would never match.
    expect(b['editor.columnSelectUp']).toEqual(['Shift+Alt+ArrowUp']);
    expect(b['editor.columnSelectDown']).toEqual(['Shift+Alt+ArrowDown']);
    expect(b['editor.columnSelectLeft']).toEqual(['Shift+Alt+ArrowLeft']);
    expect(b['editor.columnSelectRight']).toEqual(['Shift+Alt+ArrowRight']);
  });
});
