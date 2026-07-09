import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  parseAppSettings,
  parseKeybindings,
  THRONG_THEME,
  type AppSettings,
  type Keybindings,
  type Theme,
} from '@throng/core';

/**
 * Renderer-side mirror of the user configuration (T039). On mount it pulls the
 * current settings + active theme from the main process via the preload bridge,
 * then subscribes to hot-reload pushes so edits to the JSON files apply live
 * (FR-030/031/033). Components read settings through {@link useAppSettings} and
 * the active theme through {@link useActiveTheme}; both fall back to the bundled
 * defaults until the first payload arrives (and in tests without the bridge).
 */
interface ConfigState {
  settings: AppSettings;
  theme: Theme;
  keybindings: Keybindings;
  /** True once the first config payload has arrived (used to snapshot on-entry state). */
  loaded: boolean;
}

const DEFAULT_STATE: ConfigState = {
  settings: DEFAULT_APP_SETTINGS,
  theme: THRONG_THEME,
  keybindings: DEFAULT_KEYBINDINGS,
  loaded: false,
};

const ConfigContext = createContext<ConfigState>(DEFAULT_STATE);

function toState(
  payload: { settings?: unknown; theme?: unknown; keybindings?: unknown } | null | undefined,
): ConfigState {
  if (!payload) return DEFAULT_STATE;
  return {
    settings: payload.settings ? parseAppSettings(payload.settings) : DEFAULT_APP_SETTINGS,
    theme:
      payload.theme && typeof payload.theme === 'object'
        ? ({ ...THRONG_THEME, ...(payload.theme as Partial<Theme>) } as Theme)
        : THRONG_THEME,
    keybindings: payload.keybindings ? parseKeybindings(payload.keybindings) : DEFAULT_KEYBINDINGS,
    loaded: true,
  };
}

export function ConfigProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, setState] = useState<ConfigState>(DEFAULT_STATE);

  useEffect(() => {
    let active = true;
    void window.throng?.config?.get?.().then((payload) => {
      if (active) setState(toState(payload));
    });
    const off = window.throng?.config?.onChange?.((payload) => {
      if (active) setState(toState(payload));
    });
    return () => {
      active = false;
      off?.();
    };
  }, []);

  return <ConfigContext.Provider value={state}>{children}</ConfigContext.Provider>;
}

export function useAppSettings(): AppSettings {
  return useContext(ConfigContext).settings;
}

export function useActiveTheme(): Theme {
  return useContext(ConfigContext).theme;
}

export function useKeybindings(): Keybindings {
  return useContext(ConfigContext).keybindings;
}

/** True once the first config payload has arrived (for on-entry snapshotting). */
export function useConfigLoaded(): boolean {
  return useContext(ConfigContext).loaded;
}

// Renderer config-write plumbing (007, T010): the base helpers every preferences
// tab's apply-client builds on — re-exported here so config consumers have one
// import site for reading (hooks above) and writing config.
export { writeConfig, debounce, type ConfigWriteResult, type Debounced } from './write-config.js';
