/**
 * The two thin per-editor restore operations (015, FR-011/FR-011b) — what the
 * preferences window's per-tab "Reset to Defaults" runs.
 *
 * They exist so that the RENDERER never computes a defaults document: the values come
 * from feature 010's shipped record and the write goes through feature 010's atomic
 * path, exactly as feature 014's single-theme restore does. Before this, the per-tab
 * reset resolved defaults from a SECOND source (theme-reset.ts's DEFAULT_* constants),
 * which had already drifted from the record once.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  buildShippedDefaults,
  parseAppSettings,
  parseKeybindings,
  type Theme,
} from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-per-editor-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SHIPPED = buildShippedDefaults();
function makeService(root: string): { store: FileConfigStore; service: ShippedDefaultsService } {
  const store = new FileConfigStore(root);
  return { store, service: new ShippedDefaultsService(store, SHIPPED) };
}

describe('ShippedDefaultsService.resetSettings', () => {
  it('restores the whole settings document from the shipped record', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await store.write({ kind: 'settings' }, {
      ...DEFAULT_APP_SETTINGS,
      editor: { ...DEFAULT_APP_SETTINGS.editor, autoSave: !DEFAULT_APP_SETTINGS.editor.autoSave },
      appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: 'Cyberpunk' },
    });

    const res = await service.resetSettings();

    expect(res.ok).toBe(true);
    const after = await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings);
    expect(after).toEqual(SHIPPED.settings);
  });

  it('leaves key bindings and themes untouched', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    const customBindings = {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'zoom.in': ['Ctrl+Q'] },
    };
    await store.write({ kind: 'keybindings' }, customBindings);
    const editedTheme = { ...SHIPPED.themes.throng, colours: { ...SHIPPED.themes.throng.colours, accent: '#abcdef' } };
    await store.write({ kind: 'theme', name: 'throng' }, editedTheme);

    await service.resetSettings();

    const bindingsAfter = await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings);
    expect(bindingsAfter.bindings['zoom.in']).toEqual(['Ctrl+Q']);
    const themeAfter = JSON.parse(await store.readRaw({ kind: 'theme', name: 'throng' })) as Theme;
    expect(themeAfter.colours.accent).toBe('#abcdef');
  });

  it('is idempotent on a config already at its shipped values', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await store.write({ kind: 'settings' }, SHIPPED.settings);

    const res = await service.resetSettings();

    expect(res.ok).toBe(true);
    const after = await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings);
    expect(after).toEqual(SHIPPED.settings);
  });
});

describe('ShippedDefaultsService.resetKeybindings', () => {
  it('restores the whole keybindings document from the shipped record', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await store.write({ kind: 'keybindings' }, {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'zoom.in': ['Ctrl+Q'], 'search.find': ['F9'] },
    });

    const res = await service.resetKeybindings();

    expect(res.ok).toBe(true);
    const after = await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings);
    expect(after).toEqual(SHIPPED.keybindings);
  });

  it('leaves settings untouched', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await store.write({ kind: 'settings' }, { ...DEFAULT_APP_SETTINGS, appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: 'Cyberpunk' } });

    await service.resetKeybindings();

    const after = await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings);
    expect(after.appearance.theme).toBe('Cyberpunk');
  });
});
