import { useEffect, useRef, useState, type ReactElement } from 'react';

import { useChoose } from './confirm-dialog.js';
import { BusyGlyph } from './common/busy-glyph.js';
import { useFocusTrap } from './common/focus-trap.js';
import { formatGrouped, shutdownTaskSummary, type ShutdownTaskState, type ShutdownView } from '@throng/core';
import { markAppTerminating, unmarkAppTerminating } from './terminal/app-terminating.js';
import type { AppCloseTerminal } from './global.js';

type CloseState =
  | { phase: 'ask'; count: number | null; terminals: AppCloseTerminal[] }
  | { phase: 'busy'; message: string }
  | null;

const PREPARING_MSG = 'Preparing to close…';
const LEAVE_MSG = 'Leaving your terminals running in the background…';
const TERMINATE_MSG = 'Closing your terminals…';
const CLOSING_MSG = 'Closing throng…';
const CANCELLING_MSG = 'Cancelling… finishing the step in progress.';

/** Where a task stands, in words (FR-040 gives the blocks their fill; a screen reader gets this). */
const STATE_WORDS: Record<ShutdownTaskState, string> = {
  done: 'done',
  current: 'in progress',
  pending: 'waiting',
  cancelled: 'cancelled',
};

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
 * 067 US4 — the busy overlay now shows how far the close has got and lets the user stop it (FR-037):
 * one block per shutdown task, a summary on hover and focus, the estimated time remaining, and a
 * Cancel that stays enabled throughout. UI main drives the shutdown and pushes a `ShutdownView` on every
 * change; this only draws it. After Cancel main reports the cancel finished and the overlay closes,
 * with "terminating" undone so terminals exiting later are the user's own again.
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
  const [view, setView] = useState<ShutdownView | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

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
    const offProgress = window.throng?.onAppCloseProgress?.((next) => {
      setView(next);
      // A progress view means the close is under way, whatever the overlay was showing.
      setState((cur) => (cur?.phase === 'busy' ? cur : { phase: 'busy', message: CLOSING_MSG }));
    });
    const offCancelled = window.throng?.onAppCloseCancelled?.(() => {
      setView(null);
      setState(null);
      setHovered(null);
      setFocused(null);
      unmarkAppTerminating();
    });
    return () => {
      offBegin?.();
      offPrompt?.();
      offClosing?.();
      offProgress?.();
      offCancelled?.();
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
      if (choice === 'terminate') markAppTerminating();
      window.throng?.appCloseChoice?.(choice);
    });
  }, [state, choose]);

  // Cancel has the keyboard from the first frame it can: this overlay blocks everything else.
  const showingProgress = state?.phase === 'busy' && view !== null;
  // The keyboard stays on the overlay's blocks and Cancel: it blocks the application behind it.
  const trap = useFocusTrap<HTMLDivElement>(showingProgress);
  useEffect(() => {
    if (showingProgress) cancelRef.current?.focus();
  }, [showingProgress]);

  if (state?.phase !== 'busy') return null;

  return (
    <div className="modal-overlay app-closing" data-testid="app-closing-overlay">
      <div
        className="app-closing__card"
        role="status"
        aria-live="polite"
        data-testid="app-closing"
        ref={trap.ref}
        tabIndex={-1}
        onKeyDown={(e) => {
          trap.onKeyDown(e);
          if (e.key === 'Escape' && view !== null && e.target !== cancelRef.current) window.throng?.appCloseCancel?.();
        }}
      >
        <BusyGlyph />
        <p className="app-closing__message" data-testid="app-closing-message">
          {view?.cancelling ? CANCELLING_MSG : state.message}
        </p>
        {view !== null ? (
          <>
            <div className="app-closing__blocks" data-testid="app-closing-blocks">
              {view.tasks.map((task) => (
                <div
                  key={task.id}
                  className={`app-closing__block app-closing__block--${task.state}`}
                  data-testid={`app-closing-block-${task.id}`}
                  data-state={task.state}
                  data-filled={task.state === 'done' ? 'true' : 'false'}
                  data-overrunning={task.state === 'current' && view.overrunning ? 'true' : undefined}
                  aria-current={task.state === 'current' ? 'step' : undefined}
                  aria-label={`${shutdownTaskSummary(task)}, ${STATE_WORDS[task.state]}`}
                  tabIndex={0}
                  onMouseEnter={() => setHovered(task.id)}
                  onMouseLeave={() => setHovered((cur) => (cur === task.id ? null : cur))}
                  onFocus={() => setFocused(task.id)}
                  onBlur={() => setFocused((cur) => (cur === task.id ? null : cur))}
                >
                  <span className="app-closing__fill" aria-hidden="true" />
                </div>
              ))}
            </div>
            <p className="app-closing__summary" data-testid={hovered ?? focused ? 'app-closing-summary' : undefined} aria-live="off">
              {((task) => (task ? shutdownTaskSummary(task) : ' '))(view.tasks.find((t) => t.id === (hovered ?? focused)))}
            </p>
            <p className="app-closing__remaining" data-testid="app-closing-remaining">
              about {formatGrouped(Math.ceil(Math.max(view.remainingMs, 0) / 1000))} s remaining
            </p>
            {view.overrunning && !view.cancelling ? (
              <p className="app-closing__overrun" data-testid="app-closing-overrun" role="status">
                {((task) => (task ? shutdownTaskSummary(task) : 'A step'))(view.tasks.find((t) => t.state === 'current'))} is taking longer than expected.
              </p>
            ) : null}
            <button
              type="button"
              ref={cancelRef}
              className="app-closing__cancel"
              data-testid="app-closing-cancel"
              onClick={() => window.throng?.appCloseCancel?.()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') window.throng?.appCloseCancel?.();
              }}
            >
              Cancel
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
