import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CompositionRoot, SubWorkspaceCompositionRoot } from './composition-root.js';
import { parseWindowIdentity } from './window-identity.js';
import { PreferencesApp, isPreferencesTab } from './preferences/preferences-app.js';
import { settleConfigWrites } from './config/write-config.js';
import { settleLayoutSaves } from './state/layout-saves.js';
import './theme.css';

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
      .catch(() => undefined)
      .then(() => window.throng?.appCloseDrained?.({ requestId }));
  });
}

// Mouse-driven zoom (FR-039): Ctrl+wheel zooms, Ctrl+middle-click resets. Wheel
// and button events aren't keyboard input, so they're relayed to the main
// process via the preload bridge (regression: this was lost when the bootstrap
// landing renderer was replaced by the React shell).
function registerMouseZoom(): void {
  const api = window.throng;
  if (!api) return;
  window.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault(); // suppress Chromium's built-in page zoom
      api.zoomBy?.(event.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );
  window.addEventListener('mousedown', (event) => {
    if (!event.ctrlKey || event.button !== 1) return;
    event.preventDefault(); // suppress middle-click autoscroll
    api.zoomReset?.();
  });
}

// Renderer entry (research D2): mount the two-Pane docking shell through the
// renderer composition root (#3). A window launched with `?sw=<id>` is a detached
// sub-workspace window (US7) and mounts the sub-workspace shell; a window launched
// with `?prefs=<tab>` is the shared preferences window (007) and mounts its own app.
const container = document.getElementById('root');
if (!container) throw new Error('Renderer root element #root not found');

const prefsTab = new URLSearchParams(window.location.search).get('prefs');
const identity = parseWindowIdentity(window.location.search);

// Mouse-driven zoom applies to the workspace windows, not the preferences window.
if (prefsTab === null) registerMouseZoom();

// The drain applies to EVERY window — that is the whole point of it (C22/C23).
registerShutdownDrain();

createRoot(container).render(
  <StrictMode>
    {prefsTab !== null ? (
      <PreferencesApp initialTab={isPreferencesTab(prefsTab) ? prefsTab : 'settings'} />
    ) : identity.kind === 'subworkspace' ? (
      <SubWorkspaceCompositionRoot id={identity.id} />
    ) : (
      <CompositionRoot />
    )}
  </StrictMode>,
);
