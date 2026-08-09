/**
 * 029 / #182 — whether the daemon is usable.
 *
 * A pure state machine, deliberately, so the hard part is testable without a socket, a daemon or a
 * clock. The only interesting decision it encodes is that **a dropped connection is not yet death**.
 */

export type DaemonStatus = 'running' | 'reconnecting' | 'stopped' | 'restarting';

export interface DaemonState {
  status: DaemonStatus;
  /** When it entered this status. Supplied by the caller so this stays pure and testable. */
  since: number;
}

export type DaemonEvent =
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'grace-expired' }
  | { type: 'restart-requested' }
  | { type: 'restart-failed' };

/**
 * How long a dropped connection stays `reconnecting` before it counts as `stopped`.
 *
 * Chosen against SC-002's 2-second ceiling and the existing reconnect: `daemon-events.ts` retries
 * 500ms after a close, so 1200ms clears one full attempt with margin and still leaves ~800ms for the
 * notice and the status bar to render inside the budget.
 *
 * It is a STATED constant so a test can assert it rather than sleep past it, and it is deliberately
 * NOT a setting: its value is a consequence of the reconnect interval, and the two must move
 * together or this machine is wrong. Exposing it would let a grace shorter than one retry
 * manufacture exactly the false alarm `reconnecting` exists to prevent. (Recorded as a Principle X
 * exemption in the plan's Complexity Tracking; the precedent is `AUTO_DISMISS_MS`.)
 */
export const DAEMON_GRACE_MS = 1200;

export function initialDaemonState(now: number): DaemonState {
  return { status: 'running', since: now };
}

/**
 * The transition. Unknown pairs return the state unchanged rather than throwing — a socket can
 * legitimately report `connected` twice, and a supervisor that crashed on a duplicate event would be
 * a worse failure than the one being reported.
 */
export function nextDaemonState(state: DaemonState, event: DaemonEvent, now: number): DaemonState {
  switch (event.type) {
    /*
     * A close is NOT death. The events socket also closes when a daemon is legitimately replaced —
     * a new build retiring the old one is ordinary — and `daemon-events.ts` already reconnects. Going
     * straight to `stopped` would raise a false alarm every time a developer rebuilds, which is the
     * fastest way to teach someone to ignore this notice.
     */
    case 'disconnected':
      /*
       * `stopped` ABSORBS further closes, and that is not a tidy-up.
       *
       * `daemon-events.ts` retries every 500ms forever, and each failed attempt emits its own close.
       * Sending a stopped daemon back to `reconnecting` therefore restarts the whole cycle roughly
       * every 1.7 seconds, for as long as the app is open, with two visible consequences: the status
       * bar alternates between "Daemon reconnecting…" and "Daemon stopped — click to restart", and
       * every re-entry into `stopped` re-raises the notice. Cause-keyed suppression hides the second
       * one only while the first notice is live — so the moment the user DISMISSES it, meaning "I
       * have dealt with this", it returns a second later, and again, and again.
       *
       * Nothing has changed on the fourth close that was not true on the first. We already know.
       *
       * `restarting` absorbs it for the same reason, and leaving THAT out broke FR-009b. The retry
       * loop keeps closing while a restart is in flight, so ~500ms after the user clicked the
       * control the state fell out of `restarting`. Two things followed: the label stopped saying a
       * restart was under way, and — because the indicator's `disabled` and `requestRestart`'s own
       * guard both test for `restarting` — a second click could spawn a CONCURRENT `ensureDaemon`
       * while the first was still running.
       *
       * A restart owns the state until it resolves: `connected` ends it, `restart-failed` returns it
       * to `stopped` so the control re-arms.
       */
      return state.status === 'reconnecting' ||
        state.status === 'stopped' ||
        state.status === 'restarting'
        ? state
        : { status: 'reconnecting', since: now };

    /* The grace is what turns a close into a death. */
    case 'grace-expired':
      return state.status === 'reconnecting' ? { status: 'stopped', since: now } : state;

    /* Any successful connection clears everything — including a restart that worked. */
    case 'connected':
      return state.status === 'running' ? state : { status: 'running', since: now };

    case 'restart-requested':
      return state.status === 'restarting' ? state : { status: 'restarting', since: now };

    /*
     * A failed restart returns to stopped so the control re-arms and can be tried again — UNLESS the
     * daemon is demonstrably running.
     *
     * `requestRestart` reports failure when its spawn-and-ping returns false, and that ping can fail
     * transiently AFTER the events socket has already reconnected. Applying `stopped` unconditionally
     * would then paint "Daemon stopped — click to restart" over a daemon that is serving, with no
     * further `connected` event coming to correct it. A live connection outranks a failed probe.
     */
    case 'restart-failed':
      return state.status === 'running' ? state : { status: 'stopped', since: now };
  }
}
