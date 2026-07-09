import { describe, it, expect } from 'vitest';
import { isValidThemeName, checkRename, activateTheme } from '../../src/config/theme-ops.js';
import { DEFAULT_APP_SETTINGS } from '../../src/config/app-settings.js';

describe('isValidThemeName', () => {
  it('accepts ordinary names incl. spaces and hyphens', () => {
    expect(isValidThemeName('My Theme')).toBe(true);
    expect(isValidThemeName('English Garden')).toBe(true);
    expect(isValidThemeName('VI-VIM')).toBe(true);
  });
  it('rejects empty, dot, and path-unsafe names', () => {
    expect(isValidThemeName('')).toBe(false);
    expect(isValidThemeName('  ')).toBe(false);
    expect(isValidThemeName('.')).toBe(false);
    expect(isValidThemeName('..')).toBe(false);
    expect(isValidThemeName('a/b')).toBe(false);
    expect(isValidThemeName('C:evil')).toBe(false);
  });
});

describe('checkRename (FR-036a: reject collision)', () => {
  const existing = ['throng', 'matrix', 'Cyberpunk'];

  it('rejects a name already used by another theme (case-insensitive)', () => {
    expect(checkRename(existing, 'matrix', 'throng')).toEqual({ ok: false, error: 'exists' });
    expect(checkRename(existing, 'matrix', 'THRONG')).toEqual({ ok: false, error: 'exists' });
    expect(checkRename(existing, 'matrix', 'cyberpunk')).toEqual({ ok: false, error: 'exists' });
  });

  it('allows a unique name and a case-only change of the theme itself', () => {
    expect(checkRename(existing, 'matrix', 'Matrix')).toEqual({ ok: true });
    expect(checkRename(existing, 'matrix', 'neo')).toEqual({ ok: true });
  });

  it('rejects an invalid name', () => {
    expect(checkRename(existing, 'matrix', '')).toEqual({ ok: false, error: 'invalid' });
    expect(checkRename(existing, 'matrix', 'a/b')).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('activateTheme (FR-035: select = activate)', () => {
  it('sets appearance.theme without mutating the input', () => {
    const next = activateTheme(DEFAULT_APP_SETTINGS, 'matrix');
    expect(next.appearance.theme).toBe('matrix');
    expect(DEFAULT_APP_SETTINGS.appearance.theme).toBe('throng'); // unchanged
  });
});
