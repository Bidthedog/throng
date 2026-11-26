import './configure-host.js';
import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { parseWindowIdentity } from './window-identity.js';
import { settleConfigWrites } from './config/write-config.js';
import { settleLayoutSaves } from './state/layout-saves.js';
import { installWindowErrorListeners, rootErrorOptions } from './error-hooks.js';
import { installNoMiddlePaste } from './common/no-middle-paste.js';
import { WindowPopups } from './common/window-popups.js';
import './theme.css';
import { logCaught } from '@throng/core';

/**
 * The shutdown drain (019 / FR-010, issue #86).
 *
 * A close used to race the writes it was closing over: the layout blob — split structure AND
 * per-panel zoom — sits behind a 400ms debounce, and the ordinary close fired on a 250ms
 * timer, so the write the user had just watched the app accept died with the renderer.
 * Terminate All survived only because its prompt detained the user past the debounce: the
 * person reading the dialog WAS the drain. Main now asks, and waits for the answer.
 *
 * Registered HERE, at the entry point every window kind shares, and UNCONDITIONALLY:
 *
 *  - it names no window. Main window, sub-workspace (C6) and preferences all answer the same
 *    question, and a window with nothing pending answers it immediately — correct, not a
 *    special case. Every earlier attempt gated this on a window or enumerated the writers,
 *    and each one silently omitted somebody.
 *  - it names no writer. `settleConfigWrites` settles the write MODULE every config write
 *    goes through; `settleLayoutSaves` settles the layout store's.
 *
 * Failures are swallowed and the ack is still sent: a write that cannot land must not wedge
 * the close.
 */
function registerShutdownDrain(): void {
  window.throng?.onAppCloseDrain?.(({ requestId }) => {
    void Promise.all([settleLayoutSaves(), settleConfigWrites()])
      .catch((error: unknown) => logCaught('main: settle pending writes before the app closes', error))
      .then(() => window.throng?.appCloseDrained?.({ requestId }));
  });
}

// Renderer entry (research D2): mount the two-Pane docking shell through the
// renderer composition root (#3). A window launched with `?sw=<id>` is a detached
// sub-workspace window (US7) and mounts the sub-workspace shell; a window launched
// with `?prefs=<tab>` is the shared preferences window (007) and mounts its own app.
const container = document.getElementById('root');
if (!container) throw new Error('Renderer root element #root not found');

const search = new URLSearchParams(window.location.search);
const prefsTab = search.get('prefs');
const aboutParam = search.get('about');
// 075 — the Print Preview window, for the job main opened it with.
const printJob = search.get('printPreview');
const monitorParam = search.has('monitor');
const helpParam = search.has('help');
const identity = parseWindowIdentity(window.location.search);

// The drain applies to EVERY window — that is the whole point of it (C22/C23).
registerShutdownDrain();

// 066 FR-009: this entry point serves every window kind, so the failure hooks are installed once here —
// the window listeners for what no boundary sees, the root callbacks for what React tore down.
installWindowErrorListeners();

// 073 FR-008g: the middle mouse button never pastes, in any window this entry serves.
installNoMiddlePaste(window);

/**
 * Each window kind's app, loaded by dynamic import so a window evaluates only its own (055 SC-002).
 *
 * This entry serves every window. Imported statically, every app came with every window: the Resource
 * Monitor, which must be shown with its loading state within a second of the click, first loaded and ran
 * the whole workspace — xterm, CodeMirror, the panels, ~2.3 MB — that it never draws. That was nine tenths
 * of its cold open on Linux, and on a hosted macOS runner enough to cross the second. The branch is
 * decided from the URL before anything loads, so each window still mounts exactly one app.
 */
function loadWindowApp(): Promise<ReactElement> {
  if (prefsTab !== null) {
    return import('./preferences/preferences-app.js').then(({ PreferencesApp, isPreferencesTab }) => (
      <PreferencesApp
        initialTab={isPreferencesTab(prefsTab) ? prefsTab : 'settings'}
        initialSection={search.get('section') ?? undefined}
      />
    ));
  }
  if (monitorParam) return import('./resources/monitor-app.js').then(({ MonitorApp }) => <MonitorApp />);
  if (aboutParam !== null) return import('./about/about-app.js').then(({ AboutApp }) => <AboutApp />);
  // 080 FR-048 — the Help window's title bar and toolbar; main draws the guide below them.
  if (helpParam) return import('./help/help-app.js').then(({ HelpApp }) => <HelpApp />);
  // 080 FR-063 — the prompt an external link shows before it opens.
  if (printJob !== null) {
    const jobId = printJob;
    return import('./print-preview/print-preview-app.js').then(({ PrintPreviewApp }) => <PrintPreviewApp jobId={jobId} />);
  }
  if (identity.kind === 'subworkspace') {
    const { id } = identity;
    return import('./composition-root.js').then(({ SubWorkspaceCompositionRoot }) => <SubWorkspaceCompositionRoot id={id} />);
  }
  return import('./composition-root.js').then(({ CompositionRoot }) => <CompositionRoot />);
}

const root = createRoot(container, rootErrorOptions);
loadWindowApp().then(
  (app) =>
    root.render(
      <StrictMode>
        {app}
        {/* The title tooltip — one in every window kind. */}
        <WindowPopups />
      </StrictMode>,
    ),
  (error: unknown) => {
    // A window whose app cannot load has nothing to show; say why in the log rather than paint nothing silently.
    logCaught('main: load this window’s app', error);
    throw error;
  },
);
