import { describe, expect, it } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 076 FR-025 — Terminal notifications by default is a visual-editor toggle in the Terminal group, beside the
 * other New Panel seeds (Remember the last running command by default, …), and is NOT gated by the attention master
 * switch: a panel's Terminal notifications is still shown and stored while attention is off.
 *
 * Layer: unit — the descriptor model, no app.
 */
describe('the notifications-by-default descriptor (076 FR-025)', () => {
  const d = SETTINGS_METADATA.find((m) => m.key === 'terminals.defaultNotifications');

  it('is a described toggle in Terminal, right after the other New Panel seeds', () => {
    expect(d).toBeDefined();
    expect(d?.label).toBe('Terminal notifications by default');
    expect(d?.group).toBe('Terminal');
    expect(d?.subgroup).toBeUndefined();
    const keys = SETTINGS_METADATA.map((m) => m.key);
    expect(keys.indexOf('terminals.defaultNotifications')).toBe(keys.indexOf('terminals.defaultRememberDirectory') + 1);
    expect(d?.control).toBe('toggle');
    expect(d?.description.length).toBeGreaterThan(40);
  });

  it('stays editable while terminal attention is off', () => {
    expect(d?.enabledWhen).toBeUndefined();
  });
});
