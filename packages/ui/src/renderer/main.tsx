import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CompositionRoot, SubWorkspaceCompositionRoot } from './composition-root.js';
import { parseWindowIdentity } from './window-identity.js';
import './theme.css';

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

registerMouseZoom();

// Renderer entry (research D2): mount the two-Pane docking shell through the
// renderer composition root (#3). A window launched with `?sw=<id>` is a detached
// sub-workspace window (US7) and mounts the sub-workspace shell instead.
const container = document.getElementById('root');
if (!container) throw new Error('Renderer root element #root not found');

const identity = parseWindowIdentity(window.location.search);

createRoot(container).render(
  <StrictMode>
    {identity.kind === 'subworkspace' ? (
      <SubWorkspaceCompositionRoot id={identity.id} />
    ) : (
      <CompositionRoot />
    )}
  </StrictMode>,
);
