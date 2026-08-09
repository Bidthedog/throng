import { describe, it, expect } from 'vitest';
import { nextDaemonState, initialDaemonState, DAEMON_GRACE_MS, type DaemonState } from '@throng/core';

/**
 * 029 / #182 — daemon liveness transitions.
 *
 * The one decision that matters here is that **a dropped connection is not yet death**. Everything
 * else follows from it, and getting it wrong produces a false "your daemon has stopped" every time a
 * developer rebuilds — which is the fastest way to teach someone to ignore the notice.
 */

const T0 = 1_000_000;

function at(status: DaemonState['status'], since = T0): DaemonState {
  return { status, since };
}

describe('a dropped connection becomes reconnecting, NOT stopped', () => {
  it('running → disconnected → reconnecting', () => {
    expect(nextDaemonState(at('running'), { type: 'disconnected' }, T0 + 5)).toEqual({
      status: 'reconnecting',
      since: T0 + 5,
    });
  });

  it('a daemon legitimately replaced by a new build reconnects with no alarm raised', () => {
    let s = initialDaemonState(T0);
    s = nextDaemonState(s, { type: 'disconnected' }, T0 + 5);
    expect(s.status).toBe('reconnecting');
    s = nextDaemonState(s, { type: 'connected' }, T0 + 400); // inside the grace
    expect(s.status).toBe('running');
  });
});

describe('the grace is what turns a close into a death', () => {
  it('reconnecting → grace-expired → stopped', () => {
    expect(nextDaemonState(at('reconnecting'), { type: 'grace-expired' }, T0 + DAEMON_GRACE_MS)).toEqual({
      status: 'stopped',
      since: T0 + DAEMON_GRACE_MS,
    });
  });

  it('a grace expiring while RUNNING changes nothing — the reconnect already succeeded', () => {
    const s = at('running');
    expect(nextDaemonState(s, { type: 'grace-expired' }, T0 + 9)).toBe(s);
  });

  it('clears one full reconnect attempt with margin', () => {
    // `daemon-events.ts` retries 500ms after a close. A grace shorter than that would declare death
    // before the first attempt had even been made.
    expect(DAEMON_GRACE_MS).toBeGreaterThan(500);
    // …and stays inside SC-002's 2-second ceiling with room for the UI to render.
    expect(DAEMON_GRACE_MS).toBeLessThan(2000);
  });
});

describe('restart', () => {
  it('stopped → restart-requested → restarting', () => {
    expect(nextDaemonState(at('stopped'), { type: 'restart-requested' }, T0 + 10).status).toBe('restarting');
  });

  it('a successful restart returns to running', () => {
    expect(nextDaemonState(at('restarting'), { type: 'connected' }, T0 + 20).status).toBe('running');
  });

  it('a FAILED restart returns to stopped so the control re-arms and can be tried again', () => {
    expect(nextDaemonState(at('restarting'), { type: 'restart-failed' }, T0 + 20)).toEqual({
      status: 'stopped',
      since: T0 + 20,
    });
  });

  it('a second restart request while restarting is ignored — it cannot fire twice (FR-009b)', () => {
    const s = at('restarting');
    expect(nextDaemonState(s, { type: 'restart-requested' }, T0 + 30)).toBe(s);
  });
});

describe('duplicate events are absorbed, never thrown on', () => {
  /*
   * A socket can legitimately report the same thing twice. A supervisor that crashed on a duplicate
   * would be a worse failure than the one it exists to report — so identity is returned, which also
   * means `since` does not creep and the status bar does not re-render for nothing.
   */
  it('connected while running is identity', () => {
    const s = at('running');
    expect(nextDaemonState(s, { type: 'connected' }, T0 + 1)).toBe(s);
  });

  it('disconnected while reconnecting is identity — the grace is not restarted', () => {
    const s = at('reconnecting');
    expect(nextDaemonState(s, { type: 'disconnected' }, T0 + 1)).toBe(s);
  });

  it('disconnected while STOPPED is identity — a dead daemon does not die again', () => {
    /*
     * The reconnect loop closes every 500ms forever. Returning `reconnecting` here restarts the whole
     * cycle roughly every 1.7 seconds for as long as the app is open: the status bar alternates
     * between two labels, and each re-entry into `stopped` re-raises the notice — which, the moment
     * the user dismisses it, means it comes straight back. Nothing is different on the fourth close.
     */
    const s = at('stopped');
    expect(nextDaemonState(s, { type: 'disconnected' }, T0 + 1)).toBe(s);
  });
});
