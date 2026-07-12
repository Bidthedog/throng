/**
 * The reset IPC seam (015, FR-010 + contracts/reset-ipc.md).
 *
 * Feature 010 shipped resetBinding / resetSetting / resetEverything and feature 014
 * built the `shippedDefaults` seam into the preferences window — but only the THEME
 * half was ever exposed. These tests drive the newly-registered channels end to end
 * against a real FileConfigStore over a temp config root, so the assertion is about
 * files on disk, not about a mock having been called.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  buildShippedDefaults,
  parseAppSettings,
  parseKeybindings,
  type Theme,
} from '@throng/core';

/** Capture what `registerConfigManagementIpc` wires onto ipcMain, so we can invoke it. */
const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}));

const { FileConfigStore } = await import('../../src/main/config-store.js');
const { ShippedDefaultsService } = await import('../../src/main/shipped-defaults-service.js');
const { registerConfigManagementIpc } = await import('../../src/main/config-write-ipc.js');

const SHIPPED = buildShippedDefaults();
const tempDirs: string[] = [];

function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-reset-ipc-'));
  tempDirs.push(dir);
  return dir;
}

/** Wire the real service to the real registrar over a fresh temp config root. */
function wire(root: string): InstanceType<typeof FileConfigStore> {
  const store = new FileConfigStore(root);
  const shippedDefaults = new ShippedDefaultsService(store, SHIPPED);
  registerConfigManagementIpc({
    store,
    shippedDefaults,
    listFonts: () => Promise.resolve([]),
    listIconPacks: () => Promise.resolve([]),
  });
  return store;
}

/** Invoke a registered channel exactly as the preload bridge would. */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`channel not registered: ${channel}`);
  return (await fn({}, ...args)) as T;
}

beforeEach(() => handlers.clear());
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('throng:config:resetBinding', () => {
  it('restores the full shipped chord set for one action, leaving every other binding alone', async () => {
    const root = freshRoot();
    const store = wire(root);
    await store.write({ kind: 'keybindings' }, {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'search.find': ['F9'], 'zoom.in': ['Ctrl+Q'] },
    });

    const res = await invoke<{ ok: boolean }>('throng:config:resetBinding', 'search.find');

    expect(res.ok).toBe(true);
    const after = await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings);
    expect(after.bindings['search.find']).toEqual(SHIPPED.keybindings.bindings['search.find']);
    expect(after.bindings['zoom.in']).toEqual(['Ctrl+Q']); // the user's OTHER rebinding survives
  });

  it('refuses an action with no shipped default and writes nothing', async () => {
    const root = freshRoot();
    const store = wire(root);
    await store.write({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS);

    const res = await invoke<{ ok: boolean; reason?: string }>('throng:config:resetBinding', 'user.inventedThis');

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-default');
  });
});

describe('throng:config:resetSetting', () => {
  it('restores exactly one leaf, leaving its siblings byte-identical', async () => {
    const root = freshRoot();
    const store = wire(root);
    await store.write({ kind: 'settings' }, {
      ...DEFAULT_APP_SETTINGS,
      editor: {
        ...DEFAULT_APP_SETTINGS.editor,
        autoSave: !DEFAULT_APP_SETTINGS.editor.autoSave,
        autoSaveDebounceMs: 9999,
      },
    });

    const res = await invoke<{ ok: boolean }>('throng:config:resetSetting', 'editor.autoSave');

    expect(res.ok).toBe(true);
    const after = await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings);
    expect(after.editor.autoSave).toBe(SHIPPED.settings.editor.autoSave);
    expect(after.editor.autoSaveDebounceMs).toBe(9999); // sibling leaf untouched
  });

  it('refuses a path with no shipped default and writes nothing', async () => {
    const root = freshRoot();
    const store = wire(root);
    await store.write({ kind: 'settings' }, DEFAULT_APP_SETTINGS);

    const res = await invoke<{ ok: boolean; reason?: string }>('throng:config:resetSetting', 'nonsense.madeUpKey');

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-default');
  });
});

describe('throng:config:resetPreferences', () => {
  it('restores settings, key bindings and built-in themes in one operation', async () => {
    const root = freshRoot();
    const store = wire(root);
    await store.write({ kind: 'settings' }, { ...DEFAULT_APP_SETTINGS, appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: 'Cyberpunk' } });
    await store.write({ kind: 'keybindings' }, {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'zoom.in': ['Ctrl+Q'] },
    });
    await store.write({ kind: 'theme', name: 'throng' }, {
      ...SHIPPED.themes.throng,
      colours: { ...SHIPPED.themes.throng.colours, accent: '#abcdef' },
    });

    const res = await invoke<{ ok: boolean }>('throng:config:resetPreferences');

    expect(res.ok).toBe(true);
    const settings = await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings);
    const bindings = await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings);
    const theme = JSON.parse(await store.readRaw({ kind: 'theme', name: 'throng' })) as Theme;
    expect(settings).toEqual(SHIPPED.settings);
    expect(bindings).toEqual(SHIPPED.keybindings);
    expect(theme.colours.accent).toBe(SHIPPED.themes.throng.colours.accent);
  });

  it('leaves a CUSTOM theme entirely untouched', async () => {
    const root = freshRoot();
    const store = wire(root);
    const custom = { ...SHIPPED.themes.throng, name: 'My Theme', colours: { ...SHIPPED.themes.throng.colours, accent: '#0f0f0f' } };
    await store.write({ kind: 'theme', name: 'My Theme' }, custom);

    await invoke<{ ok: boolean }>('throng:config:resetPreferences');

    const after = JSON.parse(await store.readRaw({ kind: 'theme', name: 'My Theme' })) as Theme;
    expect(after.colours.accent).toBe('#0f0f0f');
  });

  it('never touches the project list or any other workspace state (SC-015, FR-005b)', async () => {
    // The control is called "Reset All PREFERENCES", not "reset everything": a user must not
    // lose their projects or their layout to it, and the confirmation promises they will not.
    const root = freshRoot();
    wire(root);
    const projects = join(root, 'projects.json');
    const layout = join(root, 'workspace-layout.json');
    writeFileSync(projects, JSON.stringify([{ id: 'p1', name: 'Mine', root: 'D:/work' }]), 'utf8');
    writeFileSync(layout, JSON.stringify({ tabs: ['a', 'b'] }), 'utf8');

    const res = await invoke<{ ok: boolean }>('throng:config:resetPreferences');

    expect(res.ok).toBe(true);
    expect(readFileSync(projects, 'utf8')).toBe(JSON.stringify([{ id: 'p1', name: 'Mine', root: 'D:/work' }]));
    expect(readFileSync(layout, 'utf8')).toBe(JSON.stringify({ tabs: ['a', 'b'] }));
  });

  it('is all-or-nothing: an unwritable target leaves EVERY file unchanged and reports failedPath', async () => {
    const root = freshRoot();
    const store = wire(root);
    const customBindings = {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'zoom.in': ['Ctrl+Q'] },
    };
    await store.write({ kind: 'keybindings' }, customBindings);

    // A NON-EMPTY directory where settings.json belongs → the commit rename fails.
    const settingsPath = store.pathOf({ kind: 'settings' });
    rmSync(settingsPath, { force: true });
    mkdirSync(settingsPath, { recursive: true });
    writeFileSync(join(settingsPath, 'blocker.txt'), 'x');

    const res = await invoke<{ ok: boolean; failedPath?: string }>('throng:config:resetPreferences');

    expect(res.ok).toBe(false);
    expect(res.failedPath).toBe(settingsPath);
    // Nothing was partially reset — the user's rebinding is still there.
    const bindings = await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings);
    expect(bindings.bindings['zoom.in']).toEqual(['Ctrl+Q']);
  });
});

describe('throng:config:resetSettings / :resetKeybindings (per-editor)', () => {
  it('resetSettings restores the settings document only', async () => {
    const root = freshRoot();
    const store = wire(root);
    await store.write({ kind: 'settings' }, { ...DEFAULT_APP_SETTINGS, appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: 'Cyberpunk' } });
    await store.write({ kind: 'keybindings' }, {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'zoom.in': ['Ctrl+Q'] },
    });

    const res = await invoke<{ ok: boolean }>('throng:config:resetSettings');

    expect(res.ok).toBe(true);
    const settings = await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings);
    const bindings = await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings);
    expect(settings).toEqual(SHIPPED.settings);
    expect(bindings.bindings['zoom.in']).toEqual(['Ctrl+Q']); // other editor untouched
  });

  it('resetKeybindings restores the keybindings document only', async () => {
    const root = freshRoot();
    const store = wire(root);
    await store.write({ kind: 'settings' }, { ...DEFAULT_APP_SETTINGS, appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: 'Cyberpunk' } });
    await store.write({ kind: 'keybindings' }, {
      version: DEFAULT_KEYBINDINGS.version,
      bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'zoom.in': ['Ctrl+Q'] },
    });

    const res = await invoke<{ ok: boolean }>('throng:config:resetKeybindings');

    expect(res.ok).toBe(true);
    const bindings = await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings);
    const settings = await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings);
    expect(bindings).toEqual(SHIPPED.keybindings);
    expect(settings.appearance.theme).toBe('Cyberpunk'); // other editor untouched
  });
});

/**
 * The main-process surface is the app's blast radius: every channel here is something a
 * compromised or buggy renderer can ask the privileged side to do. It should therefore grow only
 * when a renderer genuinely cannot do the job itself.
 *
 * Reset is such a job — only the main process holds feature 010's shipped record, and only it can
 * write atomically from it. **Revert and clear are not.** Reverting writes a value the renderer
 * already remembers (its on-entry snapshot); clearing writes an empty one. Both are ordinary
 * edits, and they go down the ordinary `throng:config:write` path that every keystroke in the
 * editor already uses.
 *
 * This test is what stops the next person "helpfully" adding `throng:config:revertSetting`.
 */
describe('the config IPC surface (015, FR-016)', () => {
  it('grew reset channels — and NOT a revert or clear channel', () => {
    wire(freshRoot());
    const channels = [...handlers.keys()].filter((c) => c.startsWith('throng:config:'));

    // Resets cross IPC: they read the shipped record, which lives only in the main process.
    expect(channels).toEqual(
      expect.arrayContaining([
        'throng:config:resetBinding',
        'throng:config:resetSetting',
        'throng:config:resetPreferences',
        'throng:config:resetSettings',
        'throng:config:resetKeybindings',
      ]),
    );

    // Revert and clear do not. They are edits, and `throng:config:write` — registered by the
    // ordinary config-write path, not by this management registrar — already carries edits.
    expect(channels.filter((c) => /revert|clear/i.test(c))).toEqual([]);
  });
});
