import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_SETTINGS, parseAppSettings, SETTINGS_METADATA } from '../../src/index.js';

/**
 * 080 FR-063 — one setting decides whether throng asks before it hands any external link to the OS. It sits in
 * Preferences' Confirmations group, is on by default, and a stored value that is not a boolean reads as the
 * default.
 */
describe('confirmations.openExternalLink (080 FR-063)', () => {
  it('is on by default', () => {
    expect(DEFAULT_APP_SETTINGS.confirmations.openExternalLink).toBe(true);
  });

  it('keeps a stored off, and reads anything that is not a boolean as on', () => {
    expect(parseAppSettings({ confirmations: { openExternalLink: false } }).confirmations.openExternalLink).toBe(false);
    expect(parseAppSettings({ confirmations: { openExternalLink: 'no' } }).confirmations.openExternalLink).toBe(true);
    expect(parseAppSettings({}).confirmations.openExternalLink).toBe(true);
  });

  it('is a toggle in the Confirmations group with a one-line description', () => {
    const d = SETTINGS_METADATA.find((s) => s.key === 'confirmations.openExternalLink');
    expect(d?.group).toBe('Confirmations');
    expect(d?.control).toBe('toggle');
    expect(d?.description.length).toBeLessThanOrEqual(100);
  });
});
