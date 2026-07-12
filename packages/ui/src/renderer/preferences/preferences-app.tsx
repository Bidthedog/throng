import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import {
  isBuiltInTheme,
  resetCurrentKeybindings,
  resetCurrentSettings,
  revertAll,
  type OnEntrySnapshot,
} from '@throng/core';
import {
  ConfigProvider,
  useActiveTheme,
  useAppSettings,
  useConfigLoaded,
  useKeybindings,
  writeConfig,
} from '../config/config-store.js';
import { ThemeProvider } from '../theme/theme-provider.js';
import { TitleBar } from '../title-bar/title-bar.js';
import { SettingsTab } from './settings-tab.js';
import { KeybindingsTab } from './keybindings-tab.js';
import { ThemesTab } from './themes-tab.js';
import { JsonTab } from './json-tab.js';
import './preferences.css';

/**
 * The preferences window app (007, US1 shell — FR-010/011/012). A single shared
 * frameless window with three tabs (Settings / Key Bindings / Themes), the custom
 * title bar (identity + window controls, no cog), tab switching, and always-visible
 * placeholders for the global UI/JSON mode toggle (US5) and the reset controls
 * (US6). The per-tab editors are filled by later phases; this shell ships the
 * empty tabs so the entry point and window behaviour are independently testable.
 */
export type PreferencesTab = 'settings' | 'keybindings' | 'themes';

const TABS: readonly { id: PreferencesTab; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'keybindings', label: 'Key Bindings' },
  { id: 'themes', label: 'Themes' },
];

export function isPreferencesTab(value: string | null): value is PreferencesTab {
  return value === 'settings' || value === 'keybindings' || value === 'themes';
}

/** Reset-to-defaults glyph — a single counter-clockwise arrow (H3, FR-023). */
function ResetIcon(): ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"
      />
      <path fill="currentColor" d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466" />
    </svg>
  );
}

/** Revert-all glyph — a clock-with-counter-arrow (history) implying a session revert (H3, FR-024). */
function RevertAllIcon(): ReactElement {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M8.515 1.019A7 7 0 0 0 8 1V0a8 8 0 0 1 .589.022zm2.004.45a7 7 0 0 0-.985-.299l.219-.976q.576.129 1.126.342zm1.37.71a7 7 0 0 0-.439-.27l.493-.87a8 8 0 0 1 .979.654l-.615.789a7 7 0 0 0-.418-.302zm1.834 1.79a7 7 0 0 0-.653-.796l.724-.69q.406.429.747.91zm.744 1.352a7 7 0 0 0-.214-.468l.893-.45a8 8 0 0 1 .45 1.088l-.95.313a7 7 0 0 0-.179-.483m.53 2.507a7 7 0 0 0-.1-1.025l.985-.17q.1.58.116 1.17zm-.131 1.538q.05-.254.081-.51l.993.123a8 8 0 0 1-.23 1.155l-.964-.267q.069-.247.12-.501m-.952 2.379q.276-.436.486-.908l.914.405q-.24.54-.555 1.038zm-.964 1.205q.183-.183.35-.378l.758.653a8 8 0 0 1-.401.432z"
      />
      <path fill="currentColor" d="M8 1a7 7 0 1 0 4.95 11.95l.707.707A8 8 0 1 1 8 0z" />
      <path fill="currentColor" d="M7.5 3a.5.5 0 0 1 .5.5v5.21l3.248 1.856a.5.5 0 0 1-.496.868l-3.5-2A.5.5 0 0 1 7 9V3.5a.5.5 0 0 1 .5-.5" />
    </svg>
  );
}

function PreferencesShell({ initialTab }: { initialTab: PreferencesTab }): ReactElement {
  const [tab, setTab] = useState<PreferencesTab>(initialTab);
  const [mode, setMode] = useState<'ui' | 'json'>('ui'); // global UI⇄JSON toggle (FR-020)
  const [confirming, setConfirming] = useState<null | 'current' | 'all'>(null);

  // Per-tab scroll position. The three editors share ONE scrolling element (the tab panel is a
  // single DOM node whose children swap), so without this the browser carries one tab's scroll
  // offset over to the next — scrolled deep into Settings, you land mid-way down Themes. Each
  // editor now keeps its own offset, restored when you switch back to it.
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollTops = useRef<Record<PreferencesTab, number>>({
    settings: 0,
    keybindings: 0,
    themes: 0,
  });
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (el) el.scrollTop = scrollTops.current[tab];
  }, [tab, mode]);
  const settings = useAppSettings();
  const keybindings = useKeybindings();
  const theme = useActiveTheme();
  const loaded = useConfigLoaded();
  const activeName = settings.appearance.theme;

  // Reset-all on-entry snapshot (FR-024). Seeded from the mount-time values, then
  // re-captured once the real config has loaded (non-default) — either way it holds
  // the on-entry config. Each theme's on-entry content is captured the first time
  // it is the active theme this session (edits require selecting it first).
  const snapshotRef = useRef<OnEntrySnapshot>({
    settings: JSON.stringify(settings),
    keybindings: JSON.stringify(keybindings),
    themes: { [activeName]: JSON.stringify(theme) },
    activeTheme: activeName,
  });
  const capturedRef = useRef(false);
  useEffect(() => {
    const snap = snapshotRef.current;
    // Capture the true on-entry config the moment it loads (before any edit).
    if (loaded && !capturedRef.current) {
      capturedRef.current = true;
      snap.settings = JSON.stringify(settings);
      snap.keybindings = JSON.stringify(keybindings);
      snap.themes = { [activeName]: JSON.stringify(theme) };
      snap.activeTheme = activeName;
    }
    // Record each theme's on-entry content the first time it is active this session.
    if (capturedRef.current && !(activeName in snap.themes)) {
      snap.themes[activeName] = JSON.stringify(theme);
    }
  }, [loaded, settings, keybindings, theme, activeName]);

  // Reused window: the main process pushes a tab switch when the cog is clicked
  // again while the window is already open (FR-010/011).
  useEffect(() => {
    const off = window.throng?.onPreferencesTab?.((t) => setTab(t));
    return () => off?.();
  }, []);

  // Reset-current is disabled on the Themes tab for a user-created theme (FR-023).
  const resetCurrentDisabled = tab === 'themes' && !isBuiltInTheme(activeName);

  const doResetCurrent = (): void => {
    if (tab === 'settings') void writeConfig({ kind: 'settings' }, JSON.stringify(resetCurrentSettings()));
    else if (tab === 'keybindings')
      void writeConfig({ kind: 'keybindings' }, JSON.stringify(resetCurrentKeybindings()));
    else {
      // Themes (014): delegate to feature 010's atomic single-theme restore — the SAME operation
      // the Themes tab's per-row restore icon uses. The old path went through core's
      // `resetCurrentTheme` → ALL_DEFAULT_THEMES, which is NOT the shipped record (it lacks
      // throng's bundled `iconPack`), so the two controls silently produced different themes.
      // One authoritative per-theme restore, sourced from the shipped record (FR-005/FR-011).
      void window.throng?.config?.restoreTheme?.(activeName);
    }
    setConfirming(null);
  };

  const doResetAll = (): void => {
    for (const entry of revertAll(snapshotRef.current)) void writeConfig(entry.id, entry.json);
    setConfirming(null);
  };

  return (
    <ThemeProvider theme={theme}>
      <div className="prefs-root" data-testid="preferences-window">
        <TitleBar identity="throng — Preferences" showCog={false} />
        <div className="prefs-body">
          <div className="prefs-tabbar" role="tablist" aria-label="Preferences sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`prefs-tab${tab === t.id ? ' prefs-tab--active' : ''}`}
                data-testid={`prefs-tab-${t.id}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
            <div className="prefs-tabbar__spacer" />
            {/* Always-visible toolbar affordances (FR-019/008 — survive min size). */}
            <button
              type="button"
              className="prefs-toolbtn"
              data-testid="prefs-mode-toggle"
              aria-pressed={mode === 'json'}
              title={mode === 'ui' ? 'Switch to JSON editing' : 'Switch to the visual editor'}
              onClick={() => setMode((m) => (m === 'ui' ? 'json' : 'ui'))}
            >
              {mode === 'ui' ? '{ }' : 'UI'}
            </button>
            <button
              type="button"
              className="prefs-toolbtn prefs-toolbtn--icon"
              data-testid="prefs-reset-current"
              title="Reset to Defaults"
              aria-label="Reset to Defaults"
              disabled={resetCurrentDisabled}
              onClick={() => setConfirming('current')}
            >
              <ResetIcon />
            </button>
            <button
              type="button"
              className="prefs-toolbtn prefs-toolbtn--icon"
              data-testid="prefs-reset-all"
              title="Revert All"
              aria-label="Revert All"
              onClick={() => setConfirming('all')}
            >
              <RevertAllIcon />
            </button>
          </div>

          {confirming ? (
            <div className="prefs-confirm" data-testid="prefs-reset-confirm">
              <span>
                {confirming === 'current'
                  ? `Reset the ${TABS.find((t) => t.id === tab)?.label} editor to defaults?`
                  : 'Revert every editor to its state when this window opened?'}
              </span>
              <button
                type="button"
                className="prefs-toolbtn"
                data-testid="prefs-reset-confirm-yes"
                onClick={confirming === 'current' ? doResetCurrent : doResetAll}
              >
                {confirming === 'current' ? 'Reset' : 'Reset all'}
              </button>
              <button
                type="button"
                className="prefs-toolbtn"
                data-testid="prefs-reset-confirm-no"
                onClick={() => setConfirming(null)}
              >
                Cancel
              </button>
            </div>
          ) : null}
          <div
            className="prefs-tabpanel"
            role="tabpanel"
            data-testid={`prefs-panel-${tab}`}
            ref={panelRef}
            onScroll={(e) => {
              scrollTops.current[tab] = e.currentTarget.scrollTop;
            }}
          >
            {mode === 'json' ? (
              <JsonTab
                docId={
                  tab === 'settings'
                    ? { kind: 'settings' }
                    : tab === 'keybindings'
                      ? { kind: 'keybindings' }
                      : { kind: 'theme', name: activeName }
                }
              />
            ) : tab === 'settings' ? (
              <SettingsTab />
            ) : tab === 'keybindings' ? (
              <KeybindingsTab />
            ) : (
              <ThemesTab />
            )}
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}

export function PreferencesApp({ initialTab }: { initialTab: PreferencesTab }): ReactElement {
  return (
    <ConfigProvider>
      <PreferencesShell initialTab={initialTab} />
    </ConfigProvider>
  );
}
