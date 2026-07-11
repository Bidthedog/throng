import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  buildShippedDefaults,
  parseAppSettings,
  parseKeybindings,
  type AppSettings,
  type Keybindings,
  type Theme,
} from '@throng/core';
import { FileConfigStore } from '../../src/main/config-store.js';
import { ShippedDefaultsService } from '../../src/main/shipped-defaults-service.js';

/** Single-item resets + reset-everything (010, US3/US4/US5). */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-reset-'));
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

describe('ShippedDefaultsService.resetBinding', () => {
  it('resets only the named action to its shipped binding', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await store.write({ kind: 'keybindings' }, {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'zoom.in': ['Ctrl+Q'], 'file.copy': ['Ctrl+Y'] },
    });

    const res = await service.resetBinding('zoom.in');
    expect(res.ok).toBe(true);
    const kb = await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings) as Keybindings;
    expect(kb.bindings['zoom.in']).toEqual(DEFAULT_KEYBINDINGS.bindings['zoom.in']);
    expect(kb.bindings['file.copy']).toEqual(['Ctrl+Y']); // untouched
  });

  it('reports no-default for an unknown action and writes nothing', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await store.write({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS);
    const before = readFileSync(join(root, 'keybindings.json'), 'utf8');
    const res = await service.resetBinding('no.such.action');
    expect(res).toEqual({ ok: false, reason: 'no-default' });
    expect(readFileSync(join(root, 'keybindings.json'), 'utf8')).toBe(before);
  });
});

describe('ShippedDefaultsService.resetSetting', () => {
  it('resets one leaf by dotted path, leaving siblings untouched', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await store.write({ kind: 'settings' }, {
      ...DEFAULT_APP_SETTINGS,
      editor: { ...DEFAULT_APP_SETTINGS.editor, autoSave: true, autoSaveDebounceMs: 999 },
    });

    const res = await service.resetSetting('editor.autoSave');
    expect(res.ok).toBe(true);
    const s = await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings) as AppSettings;
    expect(s.editor.autoSave).toBe(DEFAULT_APP_SETTINGS.editor.autoSave);
    expect(s.editor.autoSaveDebounceMs).toBe(999); // sibling untouched
  });

  it('reports no-default for an unknown path and writes nothing', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await store.write({ kind: 'settings' }, DEFAULT_APP_SETTINGS);
    const before = readFileSync(join(root, 'settings.json'), 'utf8');
    const res = await service.resetSetting('editor.doesNotExist');
    expect(res).toEqual({ ok: false, reason: 'no-default' });
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe(before);
  });
});

describe('ShippedDefaultsService.resetEverything', () => {
  it('restores settings + keybindings + all built-in themes; keeps a custom theme', async () => {
    const root = freshRoot();
    const { store, service } = makeService(root);
    await service.seed();
    // Modify all three + add a custom theme.
    await store.write({ kind: 'settings' }, { ...DEFAULT_APP_SETTINGS, appearance: { theme: 'Matrix' } });
    await store.write({ kind: 'keybindings' }, { version: 1, bindings: { 'zoom.in': ['Ctrl+Q'] } });
    await store.write({ kind: 'theme', name: 'Matrix' }, { ...SHIPPED.themes.Matrix, colours: { ...SHIPPED.themes.Matrix.colours, accent: '#ffffff' } });
    const custom: Theme = { name: 'Mine', colours: { accent: '#111' }, fonts: SHIPPED.themes.throng.fonts, icons: {} };
    await store.write({ kind: 'theme', name: 'Mine' }, custom);
    const customBefore = readFileSync(join(root, 'themes', 'Mine.json'), 'utf8');

    const res = await service.resetEverything();
    expect(res.ok).toBe(true);

    const s = await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings) as AppSettings;
    expect(s).toEqual(SHIPPED.settings);
    const kb = await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings) as Keybindings;
    expect(kb).toEqual(SHIPPED.keybindings);
    const matrix = JSON.parse(readFileSync(join(root, 'themes', 'Matrix.json'), 'utf8')) as Theme;
    expect(matrix).toEqual(SHIPPED.themes.Matrix);
    // Custom theme untouched.
    expect(readFileSync(join(root, 'themes', 'Mine.json'), 'utf8')).toBe(customBefore);
  });
});
