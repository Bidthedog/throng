import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DAEMON_GRACE_MS, type DaemonState } from '@throng/core';

/**
 * 029 / #182 — the supervisor's TIMER, which is the only part of it a pure test cannot reach.
 *
 * `nextDaemonState` is pure and unit-tested; this class adds one thing to it, and that one thing was
 * where the bug lived.
 *
 * ══ THE BUG THIS EXISTS TO KEEP FIXED ══
 *
 * `DaemonEvents` retries a lost connection every 500ms, forever, and every failed attempt emits its
 * own `close`. The first version cleared and restarted the 1200ms grace on each one, so the retry
 * loop outran the grace and it NEVER expired: the daemon stayed `reconnecting` for as long as the
 * app was open and was never declared dead. Measured — the #182 spec reported "nothing on screen
 * said the daemon had stopped" while the supervisor rearmed its own timer twice a second.
 *
 * A pure state machine cannot catch that; the transitions were always right. It is a fact about WHEN
 * the event is delivered, so it is tested with a fake clock rather than by waiting.
 */

const broadcasts: DaemonState[] = [];

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../../src/main/broadcast.js', () => ({
  broadcastToWindows: (_windows: unknown, _channel: string, payload: DaemonState) => {
    broadcasts.push(payload);
  },
}));

const { DaemonSupervisor } = await import('../../src/main/daemon-supervisor.js');

describe('DaemonSupervisor (029 FR-006)', () => {
  beforeEach(() => {
    broadcasts.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats a close as RECONNECTING, not as death', () => {
    const s = new DaemonSupervisor(() => Date.now());
    s.onConnected();

    s.onDisconnected();

    // A daemon being legitimately replaced — a rebuild retiring the old one — closes this same
    // socket. Announcing death immediately would cry wolf on every rebuild, which is the fastest way
    // to teach someone to ignore the notice.
    expect(s.current().status).toBe('reconnecting');
  });

  it('declares it stopped once the grace expires', () => {
    const s = new DaemonSupervisor(() => Date.now());
    s.onConnected();
    s.onDisconnected();

    vi.advanceTimersByTime(DAEMON_GRACE_MS + 1);

    expect(s.current().status).toBe('stopped');
  });

  it('does NOT restart the grace on the retry loop’s repeated closes', () => {
    const s = new DaemonSupervisor(() => Date.now());
    s.onConnected();
    s.onDisconnected();

    // Exactly what `DaemonEvents` does: a failed reconnect every 500ms, each emitting a close. Three
    // of them straddle the 1200ms grace, so a timer that rearmed would never reach the end of it.
    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(500);
      s.onDisconnected();
    }

    // 1500ms of real time has passed since the FIRST close, which is what the window means: "how
    // long since we lost it", not "how long since the last failed attempt".
    expect(s.current().status).toBe('stopped');
  });

  it('cancels the grace when a reconnect beats it — no notice for a blip', () => {
    const s = new DaemonSupervisor(() => Date.now());
    s.onConnected();
    s.onDisconnected();

    vi.advanceTimersByTime(DAEMON_GRACE_MS - 200);
    s.onConnected();
    vi.advanceTimersByTime(DAEMON_GRACE_MS * 2);

    // The whole point of the grace. A dropped connection the user never noticed is not news, and a
    // stale timer firing afterwards would announce a daemon that is demonstrably running.
    expect(s.current().status).toBe('running');
    expect(broadcasts.some((b) => b.status === 'stopped')).toBe(false);
  });

  it('broadcasts each transition once, and not a duplicate event', () => {
    const s = new DaemonSupervisor(() => Date.now());
    s.onConnected();
    broadcasts.length = 0;

    s.onDisconnected();
    s.onDisconnected();
    s.onDisconnected();

    // Three closes, one transition. Re-broadcasting an unchanged state would re-render every
    // window's status bar twice a second for as long as the daemon stayed down.
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]?.status).toBe('reconnecting');
  });

  it('refuses a second restart while one is in flight (FR-009b)', async () => {
    const s = new DaemonSupervisor(() => Date.now());
    let release: (() => void) | undefined;
    s.setRestartHandler(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    s.onConnected();
    s.onDisconnected();
    vi.advanceTimersByTime(DAEMON_GRACE_MS + 1);

    const first = s.requestRestart();
    const second = await s.requestRestart();

    expect(second.ok).toBe(false);
    release?.();
    expect((await first).ok).toBe(true);
  });

  it('returns to stopped when the restart fails, so it can be tried again', async () => {
    const s = new DaemonSupervisor(() => Date.now());
    s.setRestartHandler(async () => false);
    s.onConnected();
    s.onDisconnected();
    vi.advanceTimersByTime(DAEMON_GRACE_MS + 1);

    const res = await s.requestRestart();

    expect(res.ok).toBe(false);
    // Not left in `restarting`: that state disables the control, so a failed restart that stayed
    // there would leave the user looking at a permanently greyed-out way back.
    expect(s.current().status).toBe('stopped');
  });

  it('does not claim success until the socket actually reconnects', async () => {
    const s = new DaemonSupervisor(() => Date.now());
    s.setRestartHandler(async () => true);
    s.onConnected();
    s.onDisconnected();
    vi.advanceTimersByTime(DAEMON_GRACE_MS + 1);

    await s.requestRestart();

    // A spawn that returned is not a daemon that is serving. Showing "running" here would put a
    // healthy status bar over a daemon that started and immediately died.
    expect(s.current().status).toBe('restarting');
    s.onConnected();
    expect(s.current().status).toBe('running');
  });
});
