/**
 * 073 FR-007a, constitution Action controls › Setting toggles — every on/off toggle is titled "<setting>: enabled" or
 * "<setting>: disabled", with the bound chord in parentheses when there is one. One function names them all, so the
 * terminal's toggles, the preview bar's and Synchronise Scrolling cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { settingToggleTitle } from '../../src/config/setting-toggle.js';

describe('settingToggleTitle', () => {
  it('names the setting and its state, either way', () => {
    expect(settingToggleTitle('Wrap cells', true)).toBe('Wrap cells: enabled');
    expect(settingToggleTitle('Wrap cells', false)).toBe('Wrap cells: disabled');
  });

  it('appends the chord in parentheses when one is bound, and only then', () => {
    expect(settingToggleTitle('Synchronise Scrolling', true, 'Ctrl+Alt+F8')).toBe('Synchronise Scrolling: enabled (Ctrl+Alt+F8)');
    expect(settingToggleTitle('Synchronise Scrolling', false, undefined)).toBe('Synchronise Scrolling: disabled');
    expect(settingToggleTitle('Synchronise Scrolling', false, '')).toBe('Synchronise Scrolling: disabled');
  });
});
