import { describe, it, expect } from 'vitest';
import {
  resetCurrentSettings,
  resetCurrentKeybindings,
  resetCurrentTheme,
  isBuiltInTheme,
  revertAll,
  type OnEntrySnapshot,
} from '../../src/config/theme-reset.js';
import { DEFAULT_APP_SETTINGS } from '../../src/config/app-settings.js';
import { DEFAULT_KEYBINDINGS } from '../../src/config/keybindings.js';
import { DEFAULT_THEMES } from '../../src/config/default-themes/index.js';
import { THRONG_THEME } from '../../src/config/theme.js';

describe('reset current (FR-023)', () => {
  it('resets settings and keybindings to defaults', () => {
    expect(resetCurrentSettings()).toBe(DEFAULT_APP_SETTINGS);
    expect(resetCurrentKeybindings()).toBe(DEFAULT_KEYBINDINGS);
  });

  it('resets a built-in theme to its installed default, but a user theme is disabled (null)', () => {
    expect(resetCurrentTheme('Matrix')).toBe(DEFAULT_THEMES.Matrix);
    expect(resetCurrentTheme('throng')).toBe(THRONG_THEME);
    expect(resetCurrentTheme('MyUserTheme')).toBeNull();
  });

  it('isBuiltInTheme distinguishes built-ins from user themes', () => {
    expect(isBuiltInTheme('throng')).toBe(true);
    expect(isBuiltInTheme('Cyberpunk')).toBe(true);
    expect(isBuiltInTheme('MyUserTheme')).toBe(false);
  });
});

describe('revertAll (FR-024)', () => {
  const snapshot: OnEntrySnapshot = {
    settings: '{"appearance":{"theme":"throng"}}',
    keybindings: '{"version":1,"bindings":{}}',
    themes: { throng: '{"name":"throng"}', Matrix: '{"name":"Matrix"}' },
    activeTheme: 'throng',
  };

  it('produces a write plan restoring settings, keybindings, and every touched theme', () => {
    const plan = revertAll(snapshot);
    expect(plan).toContainEqual({ id: { kind: 'settings' }, json: snapshot.settings });
    expect(plan).toContainEqual({ id: { kind: 'keybindings' }, json: snapshot.keybindings });
    expect(plan).toContainEqual({ id: { kind: 'theme', name: 'throng' }, json: '{"name":"throng"}' });
    expect(plan).toContainEqual({ id: { kind: 'theme', name: 'Matrix' }, json: '{"name":"Matrix"}' });
    expect(plan).toHaveLength(4);
  });

  it('re-activates the on-entry theme by restoring settings (which carries appearance.theme)', () => {
    const plan = revertAll(snapshot);
    const settingsEntry = plan.find((e) => e.id.kind === 'settings');
    expect(JSON.parse(settingsEntry!.json).appearance.theme).toBe('throng');
  });
});
