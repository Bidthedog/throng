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
import { ContextMenuProvider } from '../context-menu-provider.js';
import { useNoDropNavigation } from '../composition-root.js';
import { ConfirmProvider, useConfirm } from '../confirm-dialog.js';
import { NotificationProvider } from '../common/notification.js';
import { ThemeProvider } from '../theme/theme-provider.js';
import { IconButton } from '../common/icon-button.js';
import { windowTitle } from '../common/window-title.js';
import { HoverSuppression } from '../common/use-hover-suppression.js';
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
  // A reset that could not be written must never fail silently (FR-006a) — including one
  // fired from a row inside a tab, which is why the reporter is shared through context.
  const { report } = useResetNotice();
  const confirm = useConfirm();

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

  // US9/FR-033 — drive the OS window title to the suffix form. The shared index.html carries
  // `<title>throng</title>`, which Electron uses as the window title; without this the Preferences
  // window's OS title (taskbar) would read a bare "throng" while its in-app titlebar reads correctly.
  useEffect(() => {
    document.title = windowTitle('Preferences');
  }, []);

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

  /**
   * Ask, on the SHARED confirmation model, keeping the identifiers the reset suite drives.
   *
   * FR-052: reset, revert and clear are THREE DIFFERENT QUESTIONS and stay described as such.
   * Reset asks "what does throng ship?"; revert asks "what did I open this window with?". Feature
   * 015 only just landed that distinction, and collapsing their strings into one would destroy it.
   */
  const ask = (message: string, confirmLabel: string): Promise<boolean> =>
    confirm({
      message,
      confirmLabel,
      testIds: { dialog: 'prefs-reset-confirm', message: 'prefs-reset-confirm-message' },
      choices: [
        { label: 'Cancel', value: 'cancel', testId: 'prefs-reset-confirm-no' },
        { label: confirmLabel, value: 'accept', testId: 'prefs-reset-confirm-yes' },
      ],
    }).then((v) => v === true);

  const doResetCurrent = (): void => {
    void ask(
      `Reset the ${currentEditorLabel} editor to its shipped defaults?`,
      'Reset',
    ).then((ok) => {
      if (!ok) return;
      // Restored in MAIN, from feature 010's record (FR-011/FR-011b). This used to compute the
      // defaults document in the renderer from a SECOND set of constants — which had already
      // drifted from the record once. The app now has exactly one notion of "shipped".
      const config = window.throng?.config;
      if (tab === 'settings')
        run('Resetting the Settings editor', config?.resetSettings?.bind(config));
      else if (tab === 'keybindings')
        run('Resetting the Key Bindings editor', config?.resetKeybindings?.bind(config));
    });
  };

  /** Feature 007's session undo — back to how the window opened. NOT a defaults reset. */
  const doRevertAll = (): void => {
    void ask('Revert every editor to its state when this window opened?', 'Revert all').then(
      (ok) => {
        if (!ok) return;
        for (const entry of revertAll(snapshotRef.current)) void writeConfig(entry.id, entry.json);
      },
    );
  };

  /** Feature 015's global reset — settings + key bindings + built-in themes, atomically. */
  const doResetPreferences = (): void => {
    void ask(
      // Both halves of the blast radius, so the user is neither misled about what goes nor left
      // fearing for work that was never at risk (FR-005b/FR-006).
      'Reset all preferences — settings, key bindings and the built-in themes — to their shipped defaults? Your projects, window layout, workspace state and custom themes are not affected.',
      'Reset all preferences',
    ).then((ok) => {
      if (!ok) return;
      const config = window.throng?.config;
      run('Resetting all preferences', config?.resetPreferences?.bind(config));
    });
  };

  return (
    <ThemeProvider theme={theme}>
      <OnEntryProvider value={onEntry}>
      <div className="prefs-root" data-testid="preferences-window">
        <HoverSuppression />
        <TitleBar identity={windowTitle('Preferences')} showCog={false} showMinimise={false} />
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
                onClick={doResetCurrent}
              />
            ) : null}
            <IconButton
              token="restoreAll"
              className="prefs-toolbtn prefs-toolbtn--icon"
              testId="prefs-reset-preferences"
              title="Reset All Preferences"
              onClick={doResetPreferences}
            />
            <IconButton
              token="retry"
              className="prefs-toolbtn prefs-toolbtn--icon prefs-toolbtn--revert"
              testId="prefs-revert-all"
              title="Revert All Preferences"
              onClick={doRevertAll}
            />
          </div>

          {/*
           * 018 / FR-051 — the inline confirm strip and the inline notice strip are GONE.
           *
           * They were two of the nine idioms. The strip pushed the layout down rather than sitting
           * over it, had no overlay, no Escape and no focus trap; and the notice strip's colour came
           * from `--danger`, a variable defined nowhere, so it rendered a literal #e5534b whatever
           * the theme was.
           *
           * Both are now the shared models — which this window can finally reach, because the
           * providers are mounted here (FR-054). The identifiers are preserved, so the suites that
           * drive them did not have to be rewritten.
           */}
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
  // 018 / FR-061a — the preferences window is a SEPARATE renderer realm with its own root, so it needs
  // the drop-navigation guard too. Without it, a file dropped anywhere on this window makes the engine
  // navigate to it, and the preferences session is simply replaced by a view of the dropped file. It has
  // no drop target of its own; that is exactly why every drop here lands on nothing and would navigate.
  useNoDropNavigation();
  return (
    <ConfigProvider>
      {/*
       * 018 / FR-018 — mount the SHARED menu provider here.
       *
       * The preferences window never mounted it, and that single omission is why the Key Bindings
       * editor grew a bespoke menu of its own: `useContextMenu()` throws outside a provider, so the
       * only way to have a menu here was to write another one.
       *
       * It costs one line. There is exactly one renderer bundle, routed by query string, so the
       * provider was always importable and its stylesheet was always loaded — everything it needs
       * (settings, theme, icon packs) is already in scope. The issue assumed this window was a
       * separate renderer that could not reach the shared provider. It is not.
       */}
      {/*
       * 018 / FR-054 — the CONFIRMATION model reaches the preferences window at last.
       *
       * It was never mounted here, and that single omission is the whole reason the themes surface
       * grew a RIVAL confirmation dialog: `useConfirm()` throws outside a provider, so the only way
       * to have a confirmation in this window was to write a second one.
       *
       * The notification model comes with it, so a failure in this window is reported exactly as a
       * failure in any other window is.
       */}
      <NotificationProvider>
        <ConfirmProvider>
          <ContextMenuProvider>
            {/* ResetNoticeProvider is a thin ADAPTER over the notification model now — it keeps the
                `report(operation, result)` shape its callers use, and turns a failed reset into an
                ordinary notice. It must sit inside the NotificationProvider it delegates to. */}
            <ResetNoticeProvider>
              <PreferencesShell initialTab={initialTab} />
            </ResetNoticeProvider>
          </ContextMenuProvider>
        </ConfirmProvider>
      </NotificationProvider>
    </ConfigProvider>
  );
}
