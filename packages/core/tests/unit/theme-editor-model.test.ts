import { describe, it, expect } from 'vitest';
import {
  classifyThemes,
  validateThemeName,
  cloneName,
  type ThemeRow,
} from '../../src/config/theme-editor-model.js';

describe('classifyThemes (FR-005a)', () => {
  it('tags present themes as built-in or custom by reserved membership', () => {
    const rows = classifyThemes(['throng', 'MyTheme'], ['throng', 'Matrix']);
    expect(rows).toContainEqual({ name: 'throng', kind: 'built-in' });
    expect(rows).toContainEqual({ name: 'MyTheme', kind: 'custom' });
  });

  // A DELETED built-in is simply gone from the picker: it is recovered only by restoring all
  // built-in themes, so there is nothing to list for it (FR-005a).
  it('lists only themes that are present — a deleted built-in produces no entry', () => {
    const rows: ThemeRow[] = classifyThemes(['throng'], ['throng', 'Matrix', 'Cyberpunk']);
    expect(rows.map((r) => r.name)).toEqual(['throng']);
  });

  it('preserves the input order of the present themes', () => {
    const rows = classifyThemes(['MyTheme', 'throng', 'Matrix'], ['throng', 'Matrix', 'Cyberpunk']);
    expect(rows.map((r) => r.name)).toEqual(['MyTheme', 'throng', 'Matrix']);
    expect(rows.map((r) => r.kind)).toEqual(['custom', 'built-in', 'built-in']);
  });

  it('is a pure function that does not mutate its inputs', () => {
    const present = ['throng'];
    const reserved = ['throng', 'Matrix'];
    classifyThemes(present, reserved);
    expect(present).toEqual(['throng']);
    expect(reserved).toEqual(['throng', 'Matrix']);
  });

  it('returns an empty list when nothing is present', () => {
    expect(classifyThemes([], ['throng', 'Matrix'])).toEqual([]);
  });
});

describe('validateThemeName (FR-007)', () => {
  const ctx = { reserved: ['throng', 'Matrix'], existing: ['throng', 'MyTheme', 'Other'] };

  it('rejects an empty or whitespace-only name', () => {
    expect(validateThemeName('', ctx)).toEqual({ ok: false, reason: 'empty' });
    expect(validateThemeName('   ', ctx)).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects a reserved built-in name, including a deleted built-in', () => {
    expect(validateThemeName('throng', ctx)).toEqual({ ok: false, reason: 'reserved' });
    // Matrix reserved even if not currently present (deleted built-in)
    expect(validateThemeName('Matrix', ctx)).toEqual({ ok: false, reason: 'reserved' });
  });

  it('rejects a name already used by another theme', () => {
    expect(validateThemeName('MyTheme', ctx)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('accepts a fresh, non-reserved, non-duplicate name', () => {
    expect(validateThemeName('Fresh', ctx)).toEqual({ ok: true });
  });

  it('trims before validating', () => {
    expect(validateThemeName('  Fresh  ', ctx)).toEqual({ ok: true });
    expect(validateThemeName('  throng  ', ctx)).toEqual({ ok: false, reason: 'reserved' });
  });

  it('applies precedence empty -> reserved -> duplicate', () => {
    expect(validateThemeName('throng', { reserved: ['throng'], existing: ['throng'] })).toEqual({
      ok: false,
      reason: 'reserved',
    });
  });

  it('allows renaming a theme to its own current name (renamingFrom excluded from duplicate)', () => {
    expect(validateThemeName('MyTheme', { ...ctx, renamingFrom: 'MyTheme' })).toEqual({ ok: true });
  });

  // Theme names become FILE names (`themes/<name>.json`). Windows — the primary target — is
  // case-insensitive, so `Throng.json` IS `throng.json`. A case-sensitive check would let a
  // clone silently overwrite a built-in, and let a custom be clobbered by a later restore.
  it('rejects a reserved name in ANY case (a file name collides case-insensitively)', () => {
    expect(validateThemeName('Throng', ctx)).toEqual({ ok: false, reason: 'reserved' });
    expect(validateThemeName('THRONG', ctx)).toEqual({ ok: false, reason: 'reserved' });
    // A DELETED built-in stays reserved in any case, too.
    expect(validateThemeName('matrix', ctx)).toEqual({ ok: false, reason: 'reserved' });
    expect(validateThemeName('MATRIX', ctx)).toEqual({ ok: false, reason: 'reserved' });
  });

  it('rejects a duplicate of any EXISTING theme in any case', () => {
    expect(validateThemeName('mytheme', ctx)).toEqual({ ok: false, reason: 'duplicate' });
    expect(validateThemeName('OTHER', ctx)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('excludes renamingFrom case-insensitively', () => {
    expect(validateThemeName('MYTHEME', { ...ctx, renamingFrom: 'MyTheme' })).toEqual({ ok: true });
  });
});

describe('cloneName (FR-006)', () => {
  it('appends " - Clone" to the source name', () => {
    expect(cloneName('throng')).toBe('throng - Clone');
    expect(cloneName('My Theme')).toBe('My Theme - Clone');
  });
});
