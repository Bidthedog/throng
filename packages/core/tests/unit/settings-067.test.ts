import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

const descriptor = (key: string) => SETTINGS_METADATA.find((d) => d.key === key);

describe('067 settings (FR-021, FR-035, FR-064, FR-064a, FR-105)', () => {
  it('ships the documented defaults', () => {
    expect(DEFAULT_APP_SETTINGS.explorer.showOpenInOsDefaultProgram).toBe(true);
    expect(DEFAULT_APP_SETTINGS.projects.openFromOutside).toBe('switch');
    expect(DEFAULT_APP_SETTINGS.terminals.formHistory).toEqual({ enabled: true, maxEntries: 10 });
  });

  it.each([
    'explorer.showOpenInOsDefaultProgram',
    'projects.openFromOutside',
    'terminals.formHistory.enabled',
    'terminals.formHistory.maxEntries',
  ])('describes %s for the visual editor', (key) => {
    expect(descriptor(key)).toBeDefined();
  });

  it('bounds the history size at 1 to 50 in the descriptor', () => {
    expect(descriptor('terminals.formHistory.maxEntries')).toMatchObject({ min: 1, max: 50 });
  });

  it.each([
    [17, 17],
    [12.6, 13],
  ])('reads a stored history size of %s as %s', (stored, expected) => {
    const parsed = parseAppSettings({ terminals: { formHistory: { maxEntries: stored } } });
    expect(parsed.terminals.formHistory.maxEntries).toBe(expected);
  });

  it('falls back to the defaults for values of the wrong shape', () => {
    const parsed = parseAppSettings({
      explorer: { showOpenInOsDefaultProgram: 'yes' },
      projects: { openFromOutside: 'sideways' },
      terminals: { formHistory: { enabled: 'no', maxEntries: 'many' } },
    });
    expect(parsed.explorer.showOpenInOsDefaultProgram).toBe(true);
    expect(parsed.projects.openFromOutside).toBe('switch');
    expect(parsed.terminals.formHistory).toEqual({ enabled: true, maxEntries: 10 });
  });

  it('honours stored values', () => {
    const parsed = parseAppSettings({
      explorer: { showOpenInOsDefaultProgram: false },
      projects: { openFromOutside: 'load' },
      terminals: { formHistory: { enabled: false, maxEntries: 3 } },
    });
    expect(parsed.explorer.showOpenInOsDefaultProgram).toBe(false);
    expect(parsed.projects.openFromOutside).toBe('load');
    expect(parsed.terminals.formHistory).toEqual({ enabled: false, maxEntries: 3 });
  });
});
