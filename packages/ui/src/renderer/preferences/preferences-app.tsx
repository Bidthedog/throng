import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { revertAll, type OnEntrySnapshot } from '@throng/core';
import {
  ConfigProvider,
  useActiveTheme,
  useAppSettings,
  useConfigLoaded,
  useKeybindings,
  writeConfig,
} from '../config/config-store.js';
import { ThemeProvider } from '../theme/theme-provider.js';
import { IconButton } from '../common/icon-button.js';
import { TitleBar } from '../title-bar/title-bar.js';
import { ResetNoticeProvider, useResetNotice, type ResetOutcome } from './reset-notice.js';
import { OnEntryProvider, type OnEntryConfig } from './on-entry.js';
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

function PreferencesShell({ initialTab }: { initialTab: PreferencesTab }): ReactElement {
  const [tab, setTab] = useState<PreferencesTab>(initialTab);
  const [mode, setMode] = useState<'ui' | 'json'>('ui'); // global UI⇄JSON toggle (FR-020)
  // `revert` = feature 007's session undo; `preferences` = feature 015's reset to shipped.
  const [confirming, setConfirming] = useState<null | 'current' | 'revert' | 'preferences'>(null);
  // A reset that could not be written must never fail silently (FR-006a) — including one
  // fired from a row inside a tab, which is why the reporter is shared through context.
  const { notice, report, dismiss } = useResetNotice();

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
  /**
   * The same on-entry config, as documents rather than JSON text, published to the rows so each
   * one can offer its own revert (FR-016). One snapshot, two scopes: "Revert All Preferences"
   * restores from the ref above (the write path wants text), a single row compares one leaf
   * against this (a row wants a document). A second snapshot taken per-tab would drift from this
   * one the moment its capture timing differed by a render.
   */
  const [onEntry, setOnEntry] = useState<OnEntryConfig>({ settings, keybindings });

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
      setOnEntry({ settings, keybindings });
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

  // The per-tab reset is HIDDEN on the Themes tab (015, FR-011): feature 014 already offers a
  // restore-to-shipped affordance on every built-in theme row, so a per-tab reset there would be
  // a second control performing an identical write.
  const showResetCurrent = tab !== 'themes';
  const currentEditorLabel = TABS.find((t) => t.id === tab)?.label ?? '';

  /**
   * Run a reset and report it if it fails. `Promise.resolve` matters: optional chaining
   * short-circuits the WHOLE chain when the bridge is absent, and a throw inside the handler
   * would surface as an unhandled rejection — both are the silent failure FR-006a forbids.
   */
  const run = (operation: string, call: (() => Promise<ResetOutcome>) | undefined): void => {
    void Promise.resolve(call?.()).then(
      (r) => report(operation, r),
      () => report(operation, undefined),
    );
  };

  const doResetCurrent = (): void => {
    // Restored in MAIN, from feature 010's record (FR-011/FR-011b). This used to compute the
    // defaults document in the renderer from a SECOND set of constants — which had already
    // drifted from the record once. The app now has exactly one notion of "shipped".
    const config = window.throng?.config;
    if (tab === 'settings') run('Resetting the Settings editor', config?.resetSettings?.bind(config));
    else if (tab === 'keybindings')
      run('Resetting the Key Bindings editor', config?.resetKeybindings?.bind(config));
    setConfirming(null);
  };

  /** Feature 007's session undo — back to how the window opened. NOT a defaults reset. */
  const doRevertAll = (): void => {
    for (const entry of revertAll(snapshotRef.current)) void writeConfig(entry.id, entry.json);
    setConfirming(null);
  };

  /** Feature 015's global reset — settings + key bindings + built-in themes, atomically. */
  const doResetPreferences = (): void => {
    const config = window.throng?.config;
    run('Resetting all preferences', config?.resetPreferences?.bind(config));
    setConfirming(null);
  };

  return (
    <ThemeProvider theme={theme}>
      <OnEntryProvider value={onEntry}>
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
            {/* Always-visible toolbar affordances (FR-019/008 — survive min size), every one a
                themeable icon with a hover title (constitution v3.12.0). Their names state exactly
                what they touch: nothing is called "configuration", because projects, window layout
                and workspace state are never reset (015, FR-012a). */}
            <IconButton
              token={mode === 'ui' ? 'editJson' : 'editVisual'}
              className="prefs-toolbtn prefs-toolbtn--icon"
              testId="prefs-mode-toggle"
              title={mode === 'ui' ? 'Switch to JSON editing' : 'Switch to the visual editor'}
              onClick={() => setMode((m) => (m === 'ui' ? 'json' : 'ui'))}
            />
            {showResetCurrent ? (
              <IconButton
                token="retry"
                className="prefs-toolbtn prefs-toolbtn--icon"
                testId="prefs-reset-current"
                title={`Reset the ${currentEditorLabel} editor to its defaults`}
                onClick={() => setConfirming('current')}
              />
            ) : null}
            <IconButton
              token="restoreAll"
              className="prefs-toolbtn prefs-toolbtn--icon"
              testId="prefs-reset-preferences"
              title="Reset All Preferences"
              onClick={() => setConfirming('preferences')}
            />
            <IconButton
              token="retry"
              className="prefs-toolbtn prefs-toolbtn--icon prefs-toolbtn--revert"
              testId="prefs-revert-all"
              title="Revert All Preferences"
              onClick={() => setConfirming('revert')}
            />
          </div>

          {confirming ? (
            <div className="prefs-confirm" data-testid="prefs-reset-confirm">
              <span>
                {confirming === 'current'
                  ? `Reset the ${currentEditorLabel} editor to its shipped defaults?`
                  : confirming === 'revert'
                    ? 'Revert every editor to its state when this window opened?'
                    : // Both halves of the blast radius, so the user is neither misled about what
                      // goes nor left fearing for work that was never at risk (FR-005b/FR-006).
                      'Reset all preferences — settings, key bindings and the built-in themes — to their shipped defaults? Your projects, window layout, workspace state and custom themes are not affected.'}
              </span>
              <button
                type="button"
                className="prefs-toolbtn"
                data-testid="prefs-reset-confirm-yes"
                onClick={
                  confirming === 'current'
                    ? doResetCurrent
                    : confirming === 'revert'
                      ? doRevertAll
                      : doResetPreferences
                }
              >
                {confirming === 'current' ? 'Reset' : confirming === 'revert' ? 'Revert all' : 'Reset all preferences'}
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

          {notice ? (
            <div className="prefs-notice" data-testid="prefs-notice" role="alert">
              <span>{notice}</span>
              <IconButton
                token="dismiss"
                className="prefs-toolbtn prefs-toolbtn--icon"
                testId="prefs-notice-dismiss"
                title="Dismiss this message"
                onClick={dismiss}
              />
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
      </OnEntryProvider>
    </ThemeProvider>
  );
}

export function PreferencesApp({ initialTab }: { initialTab: PreferencesTab }): ReactElement {
  return (
    <ConfigProvider>
      <ResetNoticeProvider>
        <PreferencesShell initialTab={initialTab} />
      </ResetNoticeProvider>
    </ConfigProvider>
  );
}
