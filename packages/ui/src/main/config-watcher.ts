/**
 * config-watcher — re-reads the user config when files under the config root
 * change and broadcasts the result to renderer windows for hot-reload (T034 /
 * research D3). Pure-ish: it owns no Electron references; `broadcast` is supplied
 * by main.ts so this stays unit-testable.
 */
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  isValidThemeName,
  parseAppSettings,
  parseKeybindings,
  THRONG_THEME,
  type AppSettings,
  type Disposable,
  type IConfigSettings,
  type IConfigStore,
  type IFileWatcher,
  type Keybindings,
  type Theme,
} from '@throng/core';

export interface ConfigPayload {
  settings: AppSettings;
  theme: Theme;
  keybindings: Keybindings;
}

/** Read the active settings + the theme they select + keybindings, merged over defaults. */
export async function readConfigPayload(store: IConfigStore): Promise<ConfigPayload> {
  const settings = await store.read({ kind: 'settings' }, DEFAULT_APP_SETTINGS, parseAppSettings);
  // Confine the active-theme name to a safe single segment before it becomes a file
  // path — a hand-edited `appearance.theme` like "../../x" must not read off-tree.
  const activeThemeName = isValidThemeName(settings.appearance.theme)
    ? settings.appearance.theme
    : THRONG_THEME.name;
  const theme = await store.read(
    { kind: 'theme', name: activeThemeName },
    THRONG_THEME,
    (raw) => (raw && typeof raw === 'object' ? { ...THRONG_THEME, ...(raw as Partial<Theme>) } : THRONG_THEME),
    { create: false }, // a settings-named theme that doesn't exist falls back to defaults, no stray file (#6)
  );
  const keybindings = await store.read({ kind: 'keybindings' }, DEFAULT_KEYBINDINGS, parseKeybindings);
  return { settings, theme, keybindings };
}

/** Begin watching the config root; re-read + broadcast on every (debounced) change. */
export function startConfigWatcher(deps: {
  store: IConfigStore;
  watcher: IFileWatcher;
  config: IConfigSettings;
  broadcast: (payload: ConfigPayload) => void;
}): Disposable {
  return deps.watcher.watch(deps.config.configRoot, () => {
    void readConfigPayload(deps.store).then(deps.broadcast);
  });
}
