/**
 * config-write-ipc — the renderer→main config **write** path (feature 007,
 * FR-016/017/042). The renderer is sandboxed (no `fs`); the preferences window
 * applies edits by sending raw JSON here, which this module validates, confines
 * to the config roots, and persists via the existing atomic {@link FileConfigStore}.
 * The existing config watcher then rebroadcasts `throng:config`, which is what
 * live-applies the change (immediate-apply = the existing hot-reload path).
 *
 * The decision logic ({@link writeConfigDoc}) is kept free of Electron so it is
 * unit/integration-testable; {@link registerConfigWriteIpc} is the thin `ipcMain`
 * adapter.
 */
import { ipcMain } from 'electron';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ConfigDocId, IConfigStore } from '@throng/core';
import type { ResetOne, RestoreResult } from './shipped-defaults-service.js';

export type WriteResult = { ok: true } | { ok: false; error: string };

/** Channel the preload `config.write` bridge invokes. */
export const CONFIG_WRITE_CHANNEL = 'throng:config:write';

/**
 * A theme `name` must be a single, safe path segment so it can never escape the
 * `themes/` directory (FR-042). Rejects path separators, drive-colon, and
 * Windows-reserved chars, but allows spaces/hyphens so names like
 * "Windows Terminal" and "English Garden" are valid. Settings/keybindings have
 * fixed, safe paths and need no name check.
 */
function isSafeThemeName(name: string): boolean {
  if (name.length === 0 || name === '.' || name === '..') return false;
  return !/[<>:"/\\|?*]/.test(name);
}

/**
 * True iff writing `id` resolves to a path within the config roots. Derives the
 * root from `pathOf({kind:'settings'})` (always `<root>/settings.json`) so it
 * needs no extra access to the store's private root, then checks the target does
 * not climb out via `..`.
 */
function isConfined(store: IConfigStore, id: ConfigDocId): boolean {
  if (id.kind === 'theme' && !isSafeThemeName(id.name)) return false;
  const root = resolve(dirname(store.pathOf({ kind: 'settings' })));
  const target = resolve(store.pathOf(id));
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Validate + confine + persist a config document supplied as raw JSON text.
 *
 * - Refuses anything that escapes the config roots (FR-042).
 * - Refuses text that is not a parseable JSON **object** — nothing is written
 *   and the last valid file on disk is left intact (FR-017). Structural
 *   tolerance/merge is a *read*-time concern (`parseAppSettings` etc.); on write
 *   we persist exactly what the caller supplied.
 * - A successful write is atomic (temp+rename) via {@link FileConfigStore.write}.
 */
export async function writeConfigDoc(
  store: IConfigStore,
  id: ConfigDocId,
  json: string,
): Promise<WriteResult> {
  if (!isConfined(store, id)) {
    return { ok: false, error: 'path-escape' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'not-an-object' };
  }
  await store.write(id, parsed);
  return { ok: true };
}

/** Wire the `config.write` handler onto `ipcMain` (called from main.ts). */
export function registerConfigWriteIpc(store: IConfigStore): void {
  ipcMain.handle(
    CONFIG_WRITE_CHANNEL,
    (_event, id: ConfigDocId, json: string): Promise<WriteResult> => writeConfigDoc(store, id, json),
  );
}

/** Theme-file management + font/icon-pack discovery for the Themes tab (007/014). */
export interface ConfigManagementDeps {
  store: {
    listThemes(): Promise<string[]>;
    renameTheme(from: string, to: string): Promise<{ ok: boolean; error?: 'exists' | 'invalid' }>;
    deleteTheme(name: string): Promise<void>;
    readRaw(id: ConfigDocId): Promise<string>;
  };
  /**
   * Feature 010's restore/reset API. Feature 014 exposed the THEME half; feature 015
   * exposes the rest — until then `resetBinding`/`resetSetting`/`resetEverything`
   * existed on the service but were reachable from nowhere in the renderer.
   */
  shippedDefaults: {
    restoreAllThemes(): Promise<RestoreResult>;
    restoreTheme(name: string): Promise<RestoreResult>;
    resetBinding(action: string): Promise<ResetOne>;
    resetSetting(path: string): Promise<ResetOne>;
    resetEverything(): Promise<RestoreResult>;
    resetSettings(): Promise<RestoreResult>;
    resetKeybindings(): Promise<RestoreResult>;
  };
  listFonts(): Promise<string[]>;
  listIconPacks(): Promise<{ name: string; assetBase: string }[]>;
}

export function registerConfigManagementIpc(deps: ConfigManagementDeps): void {
  ipcMain.handle('throng:config:readRaw', (_e, id: ConfigDocId) => {
    // A theme name reaches the filesystem here too — confine it exactly as the write path does.
    if (id?.kind === 'theme' && !isSafeThemeName(id.name)) return Promise.resolve('');
    return deps.store.readRaw(id);
  });
  ipcMain.handle('throng:config:listThemes', () => deps.store.listThemes());
  ipcMain.handle('throng:config:renameTheme', (_e, from: string, to: string) =>
    deps.store.renameTheme(from, to),
  );
  ipcMain.handle('throng:config:deleteTheme', (_e, name: string) => {
    // Never let a crafted name (e.g. '../settings') escape the themes directory.
    if (!isSafeThemeName(name)) return Promise.resolve();
    return deps.store.deleteTheme(name);
  });
  // Feature 014: the real "Restore All" (010 FR-008) + single-theme restore/recreate (FR-005/005a).
  // The old `throng:config:restoreDefaultThemes` channel is GONE: it was create-if-missing only
  // (it never reverted an edited built-in), and leaving a half-working restore callable from the
  // renderer is precisely what this feature set out to remove.
  ipcMain.handle('throng:config:restoreAllThemes', () => deps.shippedDefaults.restoreAllThemes());
  ipcMain.handle('throng:config:restoreTheme', (_e, name: string) =>
    deps.shippedDefaults.restoreTheme(name),
  );
  // Feature 015: the granular reset controls. These take an ACTION ID or a dotted
  // SETTINGS PATH — never a filesystem path — so unlike the theme channels there is no
  // path-escape surface to guard: the service resolves the target file itself.
  // `resetPreferences` is deliberately NOT called `resetEverything` on the wire: it
  // resets settings, key bindings and built-in themes, and nothing else — the project
  // list, window layout and workspace state are never touched (FR-005b).
  ipcMain.handle('throng:config:resetBinding', (_e, action: string) =>
    deps.shippedDefaults.resetBinding(action),
  );
  ipcMain.handle('throng:config:resetSetting', (_e, path: string) =>
    deps.shippedDefaults.resetSetting(path),
  );
  ipcMain.handle('throng:config:resetPreferences', () => deps.shippedDefaults.resetEverything());
  // The per-tab "Reset to Defaults" (FR-011): one whole editor, restored in MAIN from the
  // shipped record — the renderer never computes a defaults document.
  ipcMain.handle('throng:config:resetSettings', () => deps.shippedDefaults.resetSettings());
  ipcMain.handle('throng:config:resetKeybindings', () => deps.shippedDefaults.resetKeybindings());
  ipcMain.handle('throng:config:listFonts', () => deps.listFonts());
  ipcMain.handle('throng:config:listIconPacks', () => deps.listIconPacks());
}
