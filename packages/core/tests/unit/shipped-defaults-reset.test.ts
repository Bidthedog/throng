import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  buildShippedDefaults,
  isReservedThemeName,
  reservedThemeNames,
  resetBindingValue,
  resetSettingValue,
} from '@throng/core';

const D = buildShippedDefaults();

describe('reservedThemeNames / isReservedThemeName (010, FR-006/007/007a)', () => {
  it('lists every built-in incl. throng, and a name stays reserved when deleted from config', () => {
    const names = reservedThemeNames(D);
    expect(names).toContain('throng');
    expect(names).toContain('Matrix');
    // The reserved set is derived from the record, not from any on-disk config —
    // so a deleted built-in's name remains reserved.
    expect(isReservedThemeName('Matrix', D)).toBe(true);
    expect(isReservedThemeName('MyCustomTheme', D)).toBe(false);
  });
});

describe('resetBindingValue (010, FR-009/016)', () => {
  it('restores only the named action, leaving others untouched', () => {
    const current = {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'zoom.in': ['Ctrl+Q'], 'file.copy': ['Ctrl+Y'] },
    };
    const next = resetBindingValue(current, 'zoom.in', D);
    expect(next).not.toBeNull();
    expect(next!.bindings['zoom.in']).toEqual(DEFAULT_KEYBINDINGS.bindings['zoom.in']);
    expect(next!.bindings['file.copy']).toEqual(['Ctrl+Y']); // sibling untouched
    // current not mutated
    expect(current.bindings['zoom.in']).toEqual(['Ctrl+Q']);
  });

  it('returns null for an action with no shipped default', () => {
    expect(resetBindingValue(DEFAULT_KEYBINDINGS, 'no.such.action', D)).toBeNull();
  });
});

describe('resetSettingValue (010, FR-010/011/016)', () => {
  it('restores one leaf by dotted path, leaving siblings untouched', () => {
    const current = {
      ...DEFAULT_APP_SETTINGS,
      editor: { ...DEFAULT_APP_SETTINGS.editor, autoSave: true, autoSaveDebounceMs: 999 },
    };
    const next = resetSettingValue(current, 'editor.autoSave', D);
    expect(next).not.toBeNull();
    expect(next!.editor.autoSave).toBe(DEFAULT_APP_SETTINGS.editor.autoSave); // false
    expect(next!.editor.autoSaveDebounceMs).toBe(999); // sibling untouched
    expect(current.editor.autoSave).toBe(true); // current not mutated
  });

  it('restores a nested enum leaf', () => {
    const current = {
      ...DEFAULT_APP_SETTINGS,
      confirmations: { ...DEFAULT_APP_SETTINGS.confirmations, destroyTab: 'none' as const },
    };
    const next = resetSettingValue(current, 'confirmations.destroyTab', D);
    expect(next!.confirmations.destroyTab).toBe(DEFAULT_APP_SETTINGS.confirmations.destroyTab);
  });

  it('restores an array-valued leaf as a fresh (unshared) array', () => {
    const current = { ...DEFAULT_APP_SETTINGS, explorer: { ...DEFAULT_APP_SETTINGS.explorer, excludeGlobs: [] } };
    const next = resetSettingValue(current, 'explorer.excludeGlobs', D)!;
    expect(next.explorer.excludeGlobs).toEqual(DEFAULT_APP_SETTINGS.explorer.excludeGlobs);
    expect(next.explorer.excludeGlobs).not.toBe(D.settings.explorer.excludeGlobs); // not the frozen record array
  });

  it('returns null for a path with no shipped default', () => {
    expect(resetSettingValue(DEFAULT_APP_SETTINGS, 'editor.nope', D)).toBeNull();
    expect(resetSettingValue(DEFAULT_APP_SETTINGS, 'totally.unknown', D)).toBeNull();
  });
});
