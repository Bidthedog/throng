import { BrowserWindow } from 'electron';
import { DAEMON_GRACE_MS, initialDaemonState, nextDaemonState, type DaemonState } from '@throng/core';
import { broadcastToWindows } from './broadcast.js';

/**
 * 029 / #182 — knows whether the daemon is usable, and tells every window.
 *
 * ══ WHY THIS EXISTS ══
 *
 * When the daemon stopped, throng carried on as though nothing had happened. Terminals stayed on
 * screen accepting no input, layout changes silently failed to persist, and every project action
 * failed with whatever raw string the RPC produced — on Windows, `ENOENT`, because a named pipe that
 * no longer exists is a missing path. Nothing anywhere said the background service had gone.
 *
 * The mechanism for noticing already existed and had exactly one observer: a `setTimeout`.
 * `DaemonEvents` holds one long-lived subscribed socket and handles its `close` by retrying 500ms
 * later, forever, in silence. **That silent loop is why the app looks alive while being dead.** This
 * class is that loop, made observable.
 *
 * ══ WHY A CLOSE IS NOT YET A DEATH ══
 *
 * The same socket closes when a daemon is legitimately replaced — a new build retiring the old one
 * is ordinary during development. Going straight to `stopped` would raise a false alarm every time
 * someone rebuilds, which is the fastest way to teach a user to ignore this notice. So a close
 * enters `reconnecting` and only the GRACE expiring turns it into `stopped`.
 *
 * The transition rules are pure and live in core, so they are unit-testable without a socket, a
 * daemon or a clock. This class owns only the timer and the broadcast.
 */
export class DaemonSupervisor {
  private state: DaemonState;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private restart: (() => Promise<boolean>) | null = null;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.state = initialDaemonState(now());
  }

  private readonly now: () => number;

  /** How the supervisor restarts the daemon. Injected so this class needs no lifecycle knowledge. */
  setRestartHandler(handler: () => Promise<boolean>): void {
    this.restart = handler;
  }

  current(): DaemonState {
    return this.state;
  }

  /** The events socket connected — including a reconnect that beat the grace, and a restart. */
  onConnected(): void {
    this.clearGrace();
    this.apply({ type: 'connected' });
  }

  /**
   * The events socket closed.
   *
   * Starts the grace rather than declaring death: `DaemonEvents` will try again in 500ms, and a
   * successful retry cancels this before the user ever sees anything.
   */
  onDisconnected(): void {
    this.apply({ type: 'disconnected' });
    /*
     * The grace starts ONCE, on the first close — never restarted by the retries that follow.
     *
     * `DaemonEvents` reconnects every 500ms, and each failed attempt emits its own `close`. Clearing
     * and restarting a 1200ms grace on every one of those meant the retry loop outran it and the
     * grace NEVER expired: the daemon stayed `reconnecting` forever and was never declared dead.
     * Measured — the #182 spec reported "nothing on screen said the daemon had stopped" while the
     * supervisor cheerfully rearmed its own timer twice a second.
     *
     * The window is "how long since we LOST it", not "how long since the last failed attempt".
     */
    if (this.graceTimer) return;
    /*
     * Nothing left to time once we already know. The retry loop closes every 500ms for as long as
     * the daemon is down, and without this each one armed a fresh 1200ms timer whose expiry could
     * only be a no-op — an unbounded procession of pointless timers for the life of the session.
     * They are unref'd and harmless, which is exactly why nobody would ever notice.
     */
    if (this.state.status === 'stopped' || this.state.status === 'restarting') return;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.apply({ type: 'grace-expired' });
    }, DAEMON_GRACE_MS);
    // Never hold the app open just to time a grace out.
    this.graceTimer.unref?.();
  }

  /**
   * Attempt a restart on the user's behalf (FR-009).
   *
   * Reports the outcome by state, not by a return value the caller must remember to handle: a
   * failure returns to `stopped`, which re-arms the status-bar control so it can be tried again.
   */
  async requestRestart(): Promise<{ ok: boolean; error?: string }> {
    if (this.state.status === 'restarting') return { ok: false, error: 'A restart is already in progress.' };
    this.apply({ type: 'restart-requested' });
    try {
      const ok = await this.restart?.();
      if (ok) {
        // `connected` is not applied here — the events socket reconnecting is what proves the daemon
        // is actually serving, and asserting success before that would show "running" over a daemon
        // that spawned and immediately died.
        return { ok: true };
      }
      this.apply({ type: 'restart-failed' });
      return { ok: false, error: 'throng could not restart its daemon.' };
    } catch (error) {
      this.apply({ type: 'restart-failed' });
      return { ok: false, error: (error as Error).message };
    }
  }

  dispose(): void {
    this.clearGrace();
  }

  private clearGrace(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private apply(event: Parameters<typeof nextDaemonState>[1]): void {
    const next = nextDaemonState(this.state, event, this.now());
    // Identity means nothing changed — a duplicate event, which a socket can legitimately produce.
    // Broadcasting anyway would re-render every window's status bar for no reason.
    if (next === this.state) return;
    this.state = next;
    broadcastToWindows(BrowserWindow.getAllWindows(), 'throng:daemon:state', next);
  }
}
