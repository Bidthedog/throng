import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { planRevertAll, type OnEntrySnapshot } from '@throng/core';
import {
  ConfigProvider,
  useActiveTheme,
  useAppSettings,
  useConfigLoaded,
  useKeybindings,
  writeConfig,
  writeConfigPatch,
} from '../config/config-store.js';
import { ContextMenuProvider } from '../context-menu-provider.js';
import { useNoDropNavigation } from '../composition-root.js';
import { ConfirmProvider, useConfirm } from '../confirm-dialog.js';
// `useNotify` is gone from this file with the toast it raised: an invalid JSON document is reported
// by the editor that holds it, once, and not by every caller that bounced off it (032).
import { NotificationProvider } from '../common/notification.js';
import { useConfigWriteFailureNotices } from '../config/config-write-notices.js';
import { ThemeProvider } from '../theme/theme-provider.js';
import { windowTitle } from '../common/window-title.js';
import { HoverSuppression } from '../common/use-hover-suppression.js';
import { TitleBar } from '../title-bar/title-bar.js';
import { ResetNoticeProvider, useResetNotice, type ResetOutcome } from './reset-notice.js';
import { OnEntryProvider, type OnEntryConfig } from './on-entry.js';
import { SettingsTab } from './settings-tab.js';
import { KeybindingsTab } from './keybindings-tab.js';
import { ThemesTab } from './themes-tab.js';
import { JsonTab } from './json-tab.js';
import { JsonEditGateProvider, useJsonEditGate } from './json-edit-gate.js';
import {
  PreferencesToolbar,
  editorLabel,
  type PreferencesTab as Tab,
} from './preferences-toolbar.js';
import './preferences.css';

/**
 * The preferences window app (007, US1 shell — FR-010/011/012). A single shared
 * frameless window with three tabs (Settings / Key Bindings / Themes), the custom
 * title bar (identity + window controls, no cog), tab switching, and always-visible
 * placeholders for the global UI/JSON mode toggle (US5) and the reset controls
 * (US6). The per-tab editors are filled by later phases; this shell ships the
 * empty tabs so the entry point and window behaviour are independently testable.
 */
/*
 * The tab vocabulary and the tab bar itself live in `preferences-toolbar.tsx` (034 FR-045) — see its
 * header for why. Re-exported here so `main.tsx` and everything else that already imports them from
 * this module keeps working: the extraction is a test-reachability change, not an API change.
 */
export type { PreferencesTab } from './preferences-toolbar.js';
export { isPreferencesTab } from './preferences-toolbar.js';

function PreferencesShell({ initialTab }: { initialTab: Tab }): ReactElement {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [mode, setMode] = useState<'ui' | 'json'>('ui'); // global UI⇄JSON toggle (FR-020)
  // A reset that could not be written must never fail silently (FR-006a) — including one
  // fired from a row inside a tab, which is why the reporter is shared through context.
  const { report } = useResetNotice();
  // #102 — a write that could not land is reported wherever it came from, including the debounced
  // paths no call site can hold a promise for. Subscribed once, here, inside the provider.
  useConfigWriteFailureNotices();
  const confirm = useConfirm();
  const jsonGate = useJsonEditGate();

  /**
   * Leave the JSON editor, or refuse (032, FR-017/FR-018).
   *
   * Every way out funnels through here — the three tab buttons, the UI⇄JSON toggle, and main's
   * close request. That is the point: FR-018 names three exits, and a rule enforced at two of them
   * is a rule the user learns to distrust.
   *
   * Leaving is also what APPLIES the buffer (FR-017), so this is the commit point as well as the
   * gate. The two cannot be separated without reintroducing a write the user did not ask for.
   *
   * **It says nothing when it refuses**, and that is the fix for a real complaint. It used to raise
   * a toast, while the close path raised a strip of its own and the editor already showed a banner —
   * three messages for one condition, two of them insisting the user could not leave when a Discard
   * button was sitting a few pixels away. The gate now flashes the editor's own notice instead.
   */
  const leaveJson = (): boolean => jsonGate.tryLeave();

  // Per-tab scroll position. The three editors share ONE scrolling element (the tab panel is a
  // single DOM node whose children swap), so without this the browser carries one tab's scroll
  // offset over to the next — scrolled deep into Settings, you land mid-way down Themes. Each
  // editor now keeps its own offset, restored when you switch back to it.
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollTops = useRef<Record<Tab, number>>({
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

  /**
   * Answer main's "may I close?" (032, FR-018/FR-018a).
   *
   * Registered once, with no dependency on `mode` or on any other state, and that is deliberate: it
   * reads everything it needs through `jsonGate`, whose callbacks read refs. An effect that depended
   * on `mode` would re-subscribe on every toggle, and one that CAPTURED it would answer with
   * whatever was true at mount — which is the classic stale-closure bug, and here it would either
   * lose the user's buffer or make the window unclosable.
   *
   * A refusal shows the same notice as a blocked tab switch, with one addition: the escape. Without
   * it FR-018 turns a window the user typed a stray comma into a window they have to kill.
   */
  useEffect(() => {
    const off = window.throng?.onPreferencesCloseRequest?.(({ requestId }) => {
      // A refusal flashes the editor's notice — which carries *Discard and close*, so FR-018a's
      // escape is on screen and pressable the whole time rather than appearing only once a close
      // has already been rejected.
      const allow = jsonGate.tryLeave();
      window.throng?.replyPreferencesClose?.({ requestId, allow });
    });
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * The label the confirm message names, taken from the same function the button's title uses
   * (`preferences-toolbar.tsx`). Two copies of that derivation is exactly how a button reading
   * "Reset the Settings editor" ends up raising a dialog that names a different one.
   *
   * Whether the control is offered at all — FR-011's "not on Themes" — is decided where it is
   * drawn, so it is no longer restated here.
   */
  const currentEditorLabel = editorLabel(tab);

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
        /*
         * A MIXED write plan, deliberately (032, FR-001a).
         *
         * This used to be `for (const entry of revertAll(...)) writeConfig(entry.id, entry.json)` —
         * restore all three documents wholesale. For keybindings and themes that is still exactly
         * right, and they still go that way. For SETTINGS it was wrong, and the reason is easy to
         * miss because it does not look like a race: `settings.json` is not only the preferences
         * editor's document. The project list writes `newProject.lastProjectFolder` into it, from
         * the other window, while Preferences is open. Restoring the captured file therefore threw
         * away a folder the user chose AFTER opening Preferences — not what "revert my preference
         * edits" means, and not something the confirmation warned about.
         *
         * `planRevertAll` reverts the descriptor-carrying leaves and leaves the rest of the document
         * alone. The key set comes from `SETTINGS_METADATA`, so a setting added tomorrow is reverted
         * because it declared a descriptor, not because anyone remembered this call site.
         */
        const plan = planRevertAll(snapshotRef.current);
        if (plan.settingsChanges.length > 0) {
          void writeConfigPatch({ kind: 'settings' }, plan.settingsChanges);
        }
        for (const entry of plan.documents) void writeConfig(entry.id, entry.json);
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
          <PreferencesToolbar
            tab={tab}
            mode={mode}
            onSelectTab={(next) => {
              // FR-018: switching tab is one of the three exits blocked while the JSON buffer
              // is invalid — and, when it is valid, the moment the buffer is applied (FR-017).
              if (mode === 'json' && !leaveJson()) return;
              setTab(next);
            }}
            onToggleMode={() => {
              // Leaving the JSON view is the other blocked exit (FR-018), and the commit trigger
              // named first in the clarification: "closing the JSON view".
              if (mode === 'json' && !leaveJson()) return;
              setMode((m) => (m === 'ui' ? 'json' : 'ui'));
            }}
            onResetCurrent={doResetCurrent}
            onResetPreferences={doResetPreferences}
            onRevertAll={doRevertAll}
          />

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
          {/*
            The close-blocked strip that used to live here is GONE (032). It was the third message
            for one condition, and the JSON tab's own notice — which carries Discard and
            "Discard and close" — is the only one now.
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
            {/*
              Nothing is editable until the configuration has actually loaded (#341).

              The window renders from the SHIPPED DEFAULTS while `config.get()` is in flight, and
              that read is a genuine round trip — it re-reads three documents and enumerates the
              icon-pack directory — so the gap is not theoretical. Two things went wrong inside it,
              and neither is recoverable afterwards:

              - **The on-entry snapshot is captured on the render where `loaded` first turns true.**
                An edit made before then is already in the payload that resolves the load, so the
                snapshot records the EDITED value and "revert to how this window opened" restores
                the very thing the user was discarding. `preferences-reset.e2e.ts:217` fails exactly
                this way — a poll for `false` that reads `true` for its whole budget.
              - **The Key Bindings tab composes WHOLE documents from what it currently holds.** Held
                before the load, that is the shipped defaults, so one edit would write the default
                keybindings over the user's real ones.

              The window cannot repair either after the fact: it never saw the state it would have
              to revert to. So it must not accept the edit in the first place, which is what this
              gate does. In practice the read resolves in a few milliseconds and nothing is visible;
              what it removes is the window between the frame being interactive and it being right.
            */}
            {!loaded ? null : mode === 'json' ? (
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

export function PreferencesApp({ initialTab }: { initialTab: Tab }): ReactElement {
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
              {/* 032 FR-017/FR-018 — the shell and the JSON tab have to agree about one thing:
                  whether the buffer may be left. The gate is where they meet. */}
              <JsonEditGateProvider>
                <PreferencesShell initialTab={initialTab} />
              </JsonEditGateProvider>
            </ResetNoticeProvider>
          </ContextMenuProvider>
        </ConfirmProvider>
      </NotificationProvider>
    </ConfigProvider>
  );
}
