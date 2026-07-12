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
import { onConfigWritten } from './write-config.js';

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

    /**
     * Adopt a document the moment it is written, without waiting for the watcher (issue #50).
     *
     * Every edit serialises the WHOLE document from this state. The watcher's round-trip through
     * the filesystem takes long enough that a user editing quickly gets there first, and their
     * second edit would be computed from the copy that predates the first — silently reverting
     * it. Nothing errored; the change simply vanished. Applying the written document here means
     * the next edit always builds on the last one. The watcher broadcast that follows carries the
     * same values, so it confirms this rather than contradicting it; a genuine external change
     * still wins, because it arrives afterwards.
     */
    const offWrite = onConfigWritten((id, json) => {
      if (!active) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return; // main refuses invalid JSON anyway; nothing to adopt
      }
      setState((prev) => {
        if (id.kind === 'settings') return { ...prev, settings: parseAppSettings(parsed) };
        if (id.kind === 'keybindings') return { ...prev, keybindings: parseKeybindings(parsed) };
        // A theme write only changes what is on screen when it IS the theme on screen.
        if (id.kind === 'theme' && id.name === prev.settings.appearance.theme && parsed && typeof parsed === 'object') {
          return { ...prev, theme: { ...THRONG_THEME, ...(parsed as Partial<Theme>) } as Theme };
        }
        return prev;
      });
    });

    return () => {
      active = false;
      off?.();
      offWrite();
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
