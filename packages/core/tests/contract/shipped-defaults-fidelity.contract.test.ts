import { describe, expect, it } from 'vitest';
import {
  ALL_DEFAULT_THEMES,
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  SHIPPED_DEFAULTS_VERSION,
  THRONG_THEME,
  buildShippedDefaults,
  serializeShippedDefaults,
} from '@throng/core';

/**
 * Fidelity contract (010, FR-004 / SC-007): the shipped-defaults record is
 * GENERATED from the live definitions, never hand-copied. Any divergence between
 * the record and the definitions fails here, so feature 009's palette/token
 * changes flow through with no edit to this feature.
 */
describe('shipped-defaults fidelity contract', () => {
  const record = buildShippedDefaults();

  it('themes deep-equal the definitions, with throng carrying its icon pack', () => {
    const expected = {
      ...ALL_DEFAULT_THEMES,
      throng: { ...THRONG_THEME, iconPack: 'throng' },
    };
    expect(record.themes).toEqual(expected);
  });

  it('settings and keybindings deep-equal the definitions', () => {
    expect(record.settings).toEqual(DEFAULT_APP_SETTINGS);
    expect(record.keybindings).toEqual(DEFAULT_KEYBINDINGS);
  });

  it('carries the shipped-defaults version', () => {
    expect(record.version).toBe(SHIPPED_DEFAULTS_VERSION);
  });

  it('is deep-frozen (immutable)', () => {
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.themes)).toBe(true);
    expect(Object.isFrozen(record.themes.throng)).toBe(true);
    expect(Object.isFrozen(record.themes.throng.colours)).toBe(true);
    expect(Object.isFrozen(record.settings)).toBe(true);
    expect(Object.isFrozen(record.keybindings.bindings)).toBe(true);
  });

  it('repeated builds deep-equal', () => {
    expect(buildShippedDefaults()).toEqual(buildShippedDefaults());
  });

  it('serialises to JSON that round-trips to the record', () => {
    const json = serializeShippedDefaults(record);
    expect(json.endsWith('\n')).toBe(true);
    expect(JSON.parse(json)).toEqual(record);
  });
});
