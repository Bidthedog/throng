import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { SETTINGS_METADATA, descriptorsForThisPlatform } from '../../src/config/settings-metadata.js';
import { linuxHostTraits } from '../../src/platform/host-traits.js';
import { withHostTraits } from '../../src/testing/with-host-traits.js';

const KEY = 'window.nativeWayland';
const keysShown = (): string[] => descriptorsForThisPlatform(SETTINGS_METADATA).map((d) => d.key);

describe('capabilities Linux does not have (062 FR-008)', () => {
  it.each(['attention.taskbarBadge', 'terminals.defaultRunAsAdmin'])('%s is offered on Windows only', (key) => {
    expect(keysShown()).toContain(key);
    withHostTraits(linuxHostTraits('/run/x'), () => expect(keysShown()).not.toContain(key));
  });
});

describe('window.nativeWayland (062 FR-028)', () => {
  it('ships off, so a Linux window goes through XWayland', () => {
    expect(DEFAULT_APP_SETTINGS.window.nativeWayland).toBe(false);
  });

  it('honours a boolean and replaces anything else with the default', () => {
    expect(parseAppSettings({ window: { nativeWayland: true } }).window.nativeWayland).toBe(true);
    expect(parseAppSettings({ window: { nativeWayland: 'yes' } }).window.nativeWayland).toBe(false);
    expect(parseAppSettings({ window: 'x' }).window.nativeWayland).toBe(false);
  });

  it('is offered on Linux and nowhere else', () => {
    expect(keysShown()).not.toContain(KEY);
    withHostTraits(linuxHostTraits('/run/x'), () => {
      expect(keysShown()).toContain(KEY);
    });
  });
});
