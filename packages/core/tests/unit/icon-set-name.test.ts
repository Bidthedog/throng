import { describe, expect, it } from 'vitest';
import { validateIconSetName } from '../../src/icons/icon-set-name.js';

/** 069 FR-025 — what a new icon set may be called. Layer: unit, pure rules. */
describe('validateIconSetName (069 FR-025)', () => {
  it('accepts an ordinary name', () => {
    expect(validateIconSetName('My set', [])).toEqual({ ok: true });
    expect(validateIconSetName('mine-2', ['other'])).toEqual({ ok: true });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['throng', 'default'],
    ['Throng', 'default'],
    ['THRONG', 'default'],
  ])('refuses %j as %s', (name, reason) => {
    const r = validateIconSetName(name, []);
    expect(r).toMatchObject({ ok: false, reason });
  });

  it('refuses a name equal to an existing set, ignoring case', () => {
    expect(validateIconSetName('Mine', ['mine'])).toMatchObject({ ok: false, reason: 'exists' });
    expect(validateIconSetName('mine', ['MINE'])).toMatchObject({ ok: false, reason: 'exists' });
  });

  it.each(['old.bak', 'old.BAK', 'old.bak.1', 'old.bak.12', 'x.Bak.3'])('refuses the backup-style name %s', (name) => {
    expect(validateIconSetName(name, [])).toMatchObject({ ok: false, reason: 'backup' });
  });

  it('accepts names that merely contain bak', () => {
    expect(validateIconSetName('bak', [])).toEqual({ ok: true });
    expect(validateIconSetName('my.bakery', [])).toEqual({ ok: true });
    expect(validateIconSetName('a.bak.x', [])).toEqual({ ok: true });
  });

  it.each(['CON', 'prn', 'Aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9', 'con.txt'])('refuses the Windows-reserved name %s', (name) => {
    expect(validateIconSetName(name, [])).toMatchObject({ ok: false, reason: 'reserved' });
  });

  it('accepts COM0 and COM10, which Windows does not reserve', () => {
    expect(validateIconSetName('COM0', [])).toEqual({ ok: true });
    expect(validateIconSetName('COM10', [])).toEqual({ ok: true });
  });

  it.each(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])('refuses the character %s', (ch) => {
    expect(validateIconSetName(`a${ch}b`, [])).toMatchObject({ ok: false, reason: 'character' });
  });

  it('refuses control characters', () => {
    expect(validateIconSetName(`a${String.fromCharCode(1)}b`, [])).toMatchObject({ ok: false, reason: 'character' });
    expect(validateIconSetName(`a${String.fromCharCode(31)}b`, [])).toMatchObject({ ok: false, reason: 'character' });
    expect(validateIconSetName(`a${String.fromCharCode(127)}b`, [])).toMatchObject({ ok: false, reason: 'character' });
  });

  it('refuses a trailing dot or space', () => {
    expect(validateIconSetName('mine.', [])).toMatchObject({ ok: false, reason: 'trailing' });
    expect(validateIconSetName('mine ', [])).toMatchObject({ ok: false, reason: 'trailing' });
  });

  it('refuses . and ..', () => {
    expect(validateIconSetName('.', [])).toMatchObject({ ok: false });
    expect(validateIconSetName('..', [])).toMatchObject({ ok: false });
  });

  it('gives each refusal its own non-empty reason text that says "icon set", never "pack"', () => {
    const cases = ['', 'throng', 'x.bak', 'CON', 'a:b', 'a.', 'dup'];
    const texts = cases.map((n) => {
      const r = validateIconSetName(n, ['dup']);
      expect(r.ok, n).toBe(false);
      return r.ok ? '' : r.message;
    });
    expect(new Set(texts).size).toBe(texts.length);
    for (const t of texts) {
      expect(t.length).toBeGreaterThan(0);
      expect(t).not.toMatch(/pack/i);
    }
  });
});
