import { useEffect, useState, type ReactElement } from 'react';
import type { AppCloseTerminal } from './global.js';

type CloseState =
  | { phase: 'ask'; count: number | null; terminals: AppCloseTerminal[] }
  | { phase: 'busy'; message: string }
  | null;

const PREPARING_MSG = 'Preparing to close…';
const LEAVE_MSG = 'Leaving your terminals running in the background…';
const TERMINATE_MSG = 'Closing your terminals…';

/**
 * App-close experience when terminals may be running (005 / FR-015). The main
 * process intercepts the window close and drives this:
 *
 *  - **busy** — a full-screen blocking overlay (spinner + wait cursor) that disables
 *    the app and states what is happening. Shown IMMEDIATELY on close for instant
 *    feedback ("Preparing to close…"), and again while the app quits after a choice
 *    or for a plain close. Kept until the window goes away.
 *  - **ask** — terminals are running: offer three choices. Leave running quits the
 *    UI while the detached daemon keeps the sessions (Principle III); Terminate all
 *    kills them first; Cancel stays open.
 */
export function AppClosePrompt(): ReactElement | null {
  const [state, setState] = useState<CloseState>(null);

  useEffect(() => {
    const offBegin = window.throng?.onAppCloseBegin?.(() =>
      setState({ phase: 'busy', message: PREPARING_MSG }),
    );
    const offPrompt = window.throng?.onAppClosePrompt?.((info) =>
      setState({ phase: 'ask', count: info.count, terminals: info.terminals ?? [] }),
    );
    const offClosing = window.throng?.onAppCloseClosing?.((info) =>
      setState({ phase: 'busy', message: info.message }),
    );
    return () => {
      offBegin?.();
      offPrompt?.();
      offClosing?.();
    };
  }, []);

  if (state === null) return null;

  if (state.phase === 'busy') {
    return (
      <div className="modal-overlay app-closing" data-testid="app-closing-overlay">
        <div className="app-closing__card" role="status" aria-live="polite" data-testid="app-closing">
          <div className="app-closing__spinner" aria-hidden />
          <p className="app-closing__message" data-testid="app-closing-message">
            {state.message}
          </p>
        </div>
      </div>
    );
  }

  const n = state.count;
  const terminals = state.terminals;
  const choose = (choice: 'leave' | 'terminate' | 'cancel'): void => {
    if (choice === 'cancel') setState(null);
    else setState({ phase: 'busy', message: choice === 'leave' ? LEAVE_MSG : TERMINATE_MSG });
    window.throng?.appCloseChoice?.(choice);
  };

  const dash = (s?: string): string => (s && s.length > 0 ? s : '—');

  return (
    <div className="modal-overlay" data-testid="app-close-overlay" onClick={() => choose('cancel')}>
      <div
        className={`modal${terminals.length > 0 ? ' modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        data-testid="app-close-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal__title">Close throng?</h3>
        <p className="modal__message" data-testid="app-close-message">
          {n === null
            ? 'Terminals may still be running.'
            : `${n} terminal${n === 1 ? ' is' : 's are'} still running.`}{' '}
          Leave them running in the background, or terminate them before closing?
        </p>
        {terminals.length > 0 ? (
          <details className="app-close-details" data-testid="app-close-details">
            <summary>Show terminal details</summary>
            <div className="app-close-details__scroll">
            <table className="app-close-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Tab</th>
                  <th>Panel</th>
                  <th>Type</th>
                  <th>Flavour</th>
                </tr>
              </thead>
              <tbody>
                {terminals.map((t) => (
                  <tr key={t.panelId} data-testid="app-close-term-row">
                    <td>{dash(t.meta?.projectName)}</td>
                    <td>{dash(t.meta?.tabName)}</td>
                    <td>{dash(t.meta?.panelName)}</td>
                    <td>Terminal</td>
                    <td>{dash(t.meta?.flavourLabel)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </details>
        ) : null}
        <div className="modal__buttons">
          <button type="button" data-testid="app-close-cancel" onClick={() => choose('cancel')}>
            Cancel
          </button>
          <button
            type="button"
            className="modal__confirm modal__confirm--danger"
            data-testid="app-close-terminate"
            onClick={() => choose('terminate')}
          >
            Terminate all
          </button>
          <button
            type="button"
            className="modal__confirm"
            data-testid="app-close-leave"
            onClick={() => choose('leave')}
          >
            Leave running
          </button>
        </div>
      </div>
    </div>
  );
}
