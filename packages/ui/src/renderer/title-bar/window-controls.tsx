import { useEffect, useState, type ReactElement } from 'react';

import { Icon } from '../common/icon.js';

/**
 * The custom title bar's window controls (007, FR-002/004): minimise,
 * maximise/restore, and close, drawn in the renderer (frameless windows) and
 * relayed to the sender's BrowserWindow via the preload `window.*` bridge. The
 * maximise glyph swaps to a restore glyph while the window is maximised, driven
 * by the `onMaximizeChange` push. Buttons are `no-drag` (title-bar.css) so they
 * remain clickable within the draggable bar.
 *
 * 018 / FR-014b — the four glyphs were HARD-CODED INLINE VECTORS and are now theme icon tokens.
 *
 * They were originally going to be deferred, on the reading that operating-system window chrome is
 * not an "action control" under the constitution's themeable-icon rule. That reading is defensible.
 * It also collides head-on with this feature's own SC-002, which claims that ZERO icons in the
 * application draw from an inline vector — so deferring them would have made a success criterion
 * false on the day it shipped, which is precisely the failure this feature exists to close.
 *
 * Icon tokens do not participate in the colour-distinctness metric, so the cost against FR-006 was
 * nothing. There was no good reason to leave them.
 */

export interface WindowControlsProps {
  /**
   * When true, render ONLY the close control — no minimise/maximise. Used by fixed-size dialog
   * windows (e.g. About, 020 FR-003) that cannot be minimised or maximised, so offering those
   * controls would be dead chrome.
   */
  closeOnly?: boolean;
  /** Render the minimise control (US9/FR-034). Preferences passes `false` — it is non-minimisable. */
  showMinimise?: boolean;
}

export function WindowControls({
  closeOnly = false,
  showMinimise = true,
}: WindowControlsProps): ReactElement {
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
      {/* About (closeOnly) shows only Close. Otherwise: Preferences passes showMinimise={false}
          — non-minimisable (US9/FR-034), so no minimise affordance; max is always offered. Main +
          sub-workspace keep both. */}
      {closeOnly ? null : (
        <>
          {showMinimise ? (
            <button
              type="button"
              className="window-control"
              data-testid="window-min"
              title="Minimise"
              aria-label="Minimise"
              onClick={() => controls?.minimize?.()}
            >
              <Icon token="windowMinimise" />
            </button>
          ) : null}
          <button
            type="button"
            className="window-control"
            data-testid="window-max"
            title={maximized ? 'Restore' : 'Maximise'}
            aria-label={maximized ? 'Restore' : 'Maximise'}
            onClick={() => controls?.maximize?.()}
          >
            {maximized ? <Icon token="windowRestore" /> : <Icon token="windowMaximise" />}
          </button>
        </>
      )}
      <button
        type="button"
        className="window-control window-control--close"
        data-testid="window-close"
        title="Close"
        aria-label="Close"
        onClick={() => controls?.close?.()}
      >
        <Icon token="windowClose" />
      </button>
    </div>
  );
}
