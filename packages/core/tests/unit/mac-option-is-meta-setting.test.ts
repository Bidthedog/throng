import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { SETTINGS_METADATA, descriptorsForThisPlatform } from '../../src/config/settings-metadata.js';
import { linuxHostTraits, macosHostTraits } from '../../src/platform/host-traits.js';
import { withHostTraits } from '../../src/testing/with-host-traits.js';

/**
 * 070 — the one setting this spec adds, `terminals.macOptionIsMeta` (FR-031, research R22): a descriptor, a default
 * that lets Option type the layout's characters, a parse that keeps a boolean and nothing else, offered on macOS
 * only.
 *
 * This file used to be `settings-inertness-070.test.ts` and also checked, by matching source text, that production
 * code reads the key. That reader guarantee now belongs to `no-inert-settings.test.ts` (spec 071, FR-014), which
 * proves it for every descriptor through the type checker.
 *
 * Layer: unit — the settings model, no app.
 */

const KEY = 'terminals.macOptionIsMeta';

const keysShown = (): string[] => descriptorsForThisPlatform(SETTINGS_METADATA).map((d) => d.key);

describe('terminals.macOptionIsMeta (070 FR-031)', () => {
  it('ships off, so Option types the characters the keyboard layout puts on it', () => {
    expect(DEFAULT_APP_SETTINGS.terminals.macOptionIsMeta).toBe(false);
  });

  it('honours a boolean and replaces anything else with the default', () => {
    expect(parseAppSettings({ terminals: { macOptionIsMeta: true } }).terminals.macOptionIsMeta).toBe(true);
    expect(parseAppSettings({ terminals: { macOptionIsMeta: 'yes' } }).terminals.macOptionIsMeta).toBe(false);
    expect(parseAppSettings({}).terminals.macOptionIsMeta).toBe(false);
  });

  it('survives a re-read of what was written, and a malformed section falls back to the default', () => {
    const on = parseAppSettings({ terminals: { macOptionIsMeta: true } });
    expect(parseAppSettings(JSON.parse(JSON.stringify(on))).terminals.macOptionIsMeta).toBe(true);
    expect(parseAppSettings({ terminals: 'x' }).terminals.macOptionIsMeta).toBe(false);
  });

  it('is a toggle under Terminal, offered on macOS and nowhere else', () => {
    const d = SETTINGS_METADATA.find((x) => x.key === KEY);
    expect(d?.control).toBe('toggle');
    expect(d?.group).toBe('Terminal');
    expect(d?.onlyOn).toBe('macos');
    expect(keysShown()).not.toContain(KEY);
    withHostTraits(linuxHostTraits('/run/x'), () => expect(keysShown()).not.toContain(KEY));
    withHostTraits(macosHostTraits('/tmp/throng', []), () => expect(keysShown()).toContain(KEY));
  });
});
