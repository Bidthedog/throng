import { useEffect, useState, type ReactElement } from 'react';

/**
 * The custom title bar's window controls (007, FR-002/004): minimise,
 * maximise/restore, and close, drawn in the renderer (frameless windows) and
 * relayed to the sender's BrowserWindow via the preload `window.*` bridge. The
 * maximise glyph swaps to a restore glyph while the window is maximised, driven
 * by the `onMaximizeChange` push. Buttons are `no-drag` (title-bar.css) so they
 * remain clickable within the draggable bar.
 */

function MinimiseGlyph(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden focusable="false">
      <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MaximiseGlyph(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden focusable="false">
      <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function RestoreGlyph(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden focusable="false">
      <rect x="1.5" y="3" width="5.5" height="5.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M3 3 V1.5 H8.5 V7 H7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CloseGlyph(): ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden focusable="false">
      <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
      <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function WindowControls(): ReactElement {
  const [maximized, setMaximized] = useState(false);
  const controls = window.throng?.window;

  useEffect(() => {
    let active = true;
    void controls?.isMaximized?.().then((m) => {
      if (active) setMaximized(m);
    });
    const off = controls?.onMaximizeChange?.((m) => setMaximized(m));
    return () => {
      active = false;
      off?.();
    };
  }, [controls]);

  return (
    <div className="window-controls" data-testid="window-controls">
      <button
        type="button"
        className="window-control"
        data-testid="window-min"
        title="Minimise"
        aria-label="Minimise"
        onClick={() => controls?.minimize?.()}
      >
        <MinimiseGlyph />
      </button>
      <button
        type="button"
        className="window-control"
        data-testid="window-max"
        title={maximized ? 'Restore' : 'Maximise'}
        aria-label={maximized ? 'Restore' : 'Maximise'}
        onClick={() => controls?.maximize?.()}
      >
        {maximized ? <RestoreGlyph /> : <MaximiseGlyph />}
      </button>
      <button
        type="button"
        className="window-control window-control--close"
        data-testid="window-close"
        title="Close"
        aria-label="Close"
        onClick={() => controls?.close?.()}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
