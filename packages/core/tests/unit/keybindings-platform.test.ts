/**
 * Platform-keyed shipped chords (016, FR-017e / SC-010b — Principle II).
 *
 * All three platforms are populated. macOS's table is DERIVED from Windows' by a stated rule (070 FR-029,
 * superseding this file's earlier "no macOS chord is guessed"); `keybindings-macos.test.ts` holds its invariants.
 *
 * The requirement is about SHAPE: adding `macos` was an addition of VALUES, with no existing key moving or changing
 * type. That is what these assertions pin.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDING_PLATFORM,
  DEFAULT_KEYBINDINGS,
  MACOS_BINDINGS,
  SHIPPED_KEYBINDINGS_BY_PLATFORM,
  shippedBindingsFor,
} from '../../src/config/keybindings.js';

describe('platform-keyed shipped defaults (FR-017e)', () => {
  it('keys the shipped record by platform', () => {
    expect(Object.keys(SHIPPED_KEYBINDINGS_BY_PLATFORM)).toEqual(['windows', 'linux', 'macos']);
    expect(DEFAULT_BINDING_PLATFORM).toBe('windows');
  });

  it('populates Windows, Linux (062 FR-033) and macOS, whose table is the derived one (070 FR-029)', () => {
    expect(SHIPPED_KEYBINDINGS_BY_PLATFORM.linux).toBeDefined();
    expect(SHIPPED_KEYBINDINGS_BY_PLATFORM.macos).toBe(MACOS_BINDINGS);
    expect(shippedBindingsFor('macos').bindings['editor.save']).toEqual(['Meta+S']);
    expect(shippedBindingsFor('macos').columnSelectModifier).toBe('Alt');
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
    expect(Object.keys(withMac).sort()).toEqual(['linux', 'macos', 'windows']);
  });

  it('resolves macOS to its own table, not the Windows fallback', () => {
    expect(shippedBindingsFor('macos')).not.toBe(shippedBindingsFor('windows'));
    expect(shippedBindingsFor('macos').bindings['file.copy']).toEqual(['Meta+C']);
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
