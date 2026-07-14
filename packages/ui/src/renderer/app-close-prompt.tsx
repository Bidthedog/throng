import { useEffect, useRef, useState, type ReactElement } from 'react';

import { useChoose } from './confirm-dialog.js';
import type { AppCloseTerminal } from './global.js';

type CloseState =
  | { phase: 'ask'; count: number | null; terminals: AppCloseTerminal[] }
  | { phase: 'busy'; message: string }
  | null;

const PREPARING_MSG = 'Preparing to close…';
const LEAVE_MSG = 'Leaving your terminals running in the background…';
const TERMINATE_MSG = 'Closing your terminals…';

/**
 * App-close experience when terminals may be running (005 / FR-015). The main process intercepts the
 * window close and drives this:
 *
 *  - **busy** — a full-screen blocking overlay (spinner + wait cursor) that disables the app and
 *    states what is happening. Shown IMMEDIATELY on close for instant feedback, and again while the
 *    app quits after a choice. Kept until the window goes away.
 *  - **ask** — terminals are running: offer three choices. Leave running quits the UI while the
 *    detached daemon keeps the sessions (Principle III); Terminate all kills them first; Cancel
 *    stays open.
 *
 * 018 / FR-048a — THE ASK IS A CONFIRMATION, and it goes through the one confirmation model now.
 *
 * It is the widest of the three n-way modals the specification's count of five missed, and the one
 * that most obviously earned its `details` slot: the table of running terminals is exactly the
 * "extra context the user needs before consenting" that a confirmation sometimes has and a toast
 * never should. Modal, blocking, text-labelled buttons stating consequences — a confirmation, with
 * three answers instead of two.
 *
 * THE BUSY OVERLAY STAYS. It is not a notice: it does not report a failure, and it does not ask for
 * consent. It says "working, please wait", and it blocks. Folding it into either model would have
 * been unification for its own sake — the sweep is about the surfaces that say the same thing in
 * different ways, not about every full-screen element in the application.
 */
export function AppClosePrompt(): ReactElement | null {
  const [state, setState] = useState<CloseState>(null);
  const choose = useChoose();
  const asked = useRef<CloseState>(null);

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

  useEffect(() => {
    if (state?.phase !== 'ask' || asked.current === state) return;
    asked.current = state;

    const { count: n, terminals } = state;
    const dash = (s?: string): string => (s && s.length > 0 ? s : '—');

    void choose({
      title: 'Close throng?',
      message:
        (n === null
          ? 'Terminals may still be running.'
          : `${n} terminal${n === 1 ? ' is' : 's are'} still running.`) +
        ' Leave them running in the background, or terminate them before closing?',
      testIds: { overlay: 'app-close-overlay', dialog: 'app-close-dialog', message: 'app-close-message' },
      details:
        terminals.length > 0 ? (
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
        ) : undefined,
      choices: [
        { label: 'Cancel', value: 'cancel', testId: 'app-close-cancel' },
        { label: 'Terminate all', value: 'terminate', danger: true, testId: 'app-close-terminate' },
        { label: 'Leave running', value: 'leave', testId: 'app-close-leave' },
      ],
    }).then((v) => {
      // Dismissal is CANCEL. Reading it as anything else would let a stray Escape terminate someone's
      // running terminals.
      const choice = (v ?? 'cancel') as 'leave' | 'terminate' | 'cancel';
      if (choice === 'cancel') setState(null);
      else setState({ phase: 'busy', message: choice === 'leave' ? LEAVE_MSG : TERMINATE_MSG });
      window.throng?.appCloseChoice?.(choice);
    });
  }, [state, choose]);

  if (state?.phase !== 'busy') return null;

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
