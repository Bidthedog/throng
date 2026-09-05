import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CMD,
  openEventsSocket,
  rpcCall,
  startTerminalDaemon,
  waitFor,
  type EventsSocket,
  type TerminalDaemon,
} from './terminal-harness.js';

let daemon: TerminalDaemon;
let cwd: string;
let evt: EventsSocket;

beforeEach(async () => {
  daemon = await startTerminalDaemon();
  cwd = mkdtempSync(join(tmpdir(), 'throng-reattach-'));
  evt = await openEventsSocket(daemon.pipeName);
});

afterEach(async () => {
  // Kill any session still holding the temp cwd (a busy terminal survives on
  // purpose) so the directory is free to remove and no PTY is leaked.
  try {
    await rpcCall(daemon.pipeName, 'terminal.killAll', {});
  } catch {
    /* server may already be stopping */
  }
  evt.close();
  await daemon.stop();
  rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const attach = (panelId: string) =>
  rpcCall(daemon.pipeName, 'terminal.attach', {
    panelId,
    projectId: 'proj',
    launch: { file: CMD, args: [], cwd },
    cols: 80,
    rows: 24,
  });

describe('reattach + idle/busy close (US3)', () => {
  it('a second attach for the same panel replays scrollback and stays the one session', async () => {
    await attach('r1');
    await rpcCall(daemon.pipeName, 'terminal.write', { panelId: 'r1', data: 'echo REPLAY_MARKER_9\r\n' });
    await waitFor(() =>
      evt.notifications.some(
        (n) => n.method === 'terminal.output' && String(n.params.data).includes('REPLAY_MARKER_9'),
      ),
    );

    // Reattach: the daemon replays the buffered scrollback (FR-015a) — same session.
    const again = await attach('r1');
    expect(again.result.status).toBe('running');
    expect(String(again.result.scrollback)).toContain('REPLAY_MARKER_9');

    const listed = await rpcCall(daemon.pipeName, 'terminal.list', {});
    expect(listed.result.sessions.filter((s: any) => s.panelId === 'r1')).toHaveLength(1);

    await rpcCall(daemon.pipeName, 'terminal.kill', { panelId: 'r1' });
    await waitFor(() => !daemon.lockManager.hasOpenTerminals('proj'));
  });

  it('closeIdle closes an idle shell but keeps a busy one; killAll removes the rest', async () => {
    await attach('idle1');
    await attach('busy1');
    /*
     * Make busy1 busy with a multi-second child, then wait until the daemon actually CLASSIFIES it
     * busy — which needs the child's pid to become visible, and is the precondition every assertion
     * below depends on.
     *
     * ══ TWO THINGS WENT WRONG HERE, AND ONLY ONE WAS A NUMBER ══
     *
     * This used to be a hand-rolled `while (Date.now() < deadline && !busy)` loop that EXITED
     * SILENTLY on expiry. On a loaded, slower machine the daemon had not seen the child pid in time,
     * the loop gave up, the test carried on, and `closeIdle` then correctly closed a session the
     * daemon considered idle — producing
     *
     *     AssertionError: expected [ 'idle1', 'busy1' ] to not include 'busy1'
     *
     * which accuses `closeIdle` of closing a busy terminal. It did no such thing. `waitFor` now
     * throws on expiry, so the failure lands on the precondition, says what it was waiting for, and
     * points at the right file.
     *
     * ══ AND THE WINDOW IS NO LONGER COUPLED TO THE PROBE ══
     *
     * `ping -n 12` lives ~11 s, so an 8 s classification deadline left barely three seconds of
     * margin — and widening the deadline would have eaten into the very window it waits inside,
     * which is how a fix makes a test worse. `ping -n 30` decouples them: ~30 s of busy child, a
     * 15 s deadline, and no relationship between the two that a slower machine can invert. It costs
     * nothing — `killAll` below ends the child either way.
     */
    await rpcCall(daemon.pipeName, 'terminal.write', { panelId: 'busy1', data: 'ping -n 30 127.0.0.1\r\n' });
    const isBusyNow = async (): Promise<boolean> => {
      const l = await rpcCall(daemon.pipeName, 'terminal.list', { includeBusy: true });
      return l.result.sessions.find((s: any) => s.panelId === 'busy1')?.busy === true;
    };
    await waitFor(isBusyNow, 15_000, 'the daemon to classify busy1 as busy (its child pid to appear)');

    // A plain list (no includeBusy) must NOT probe child pids — busy stays false
    // even for the busy session — so a bare count (the app-close prompt) is cheap.
    const plain = await rpcCall(daemon.pipeName, 'terminal.list', {});
    expect(plain.result.sessions.find((s: any) => s.panelId === 'busy1')?.busy).toBe(false);

    const res = await rpcCall(daemon.pipeName, 'terminal.closeIdle', {});
    expect(res.result.closed).toContain('idle1');
    expect(res.result.closed).not.toContain('busy1');
    await waitFor(() =>
      evt.notifications.some((n) => n.method === 'terminal.exit' && n.params.panelId === 'idle1'),
    );

    const listed = await rpcCall(daemon.pipeName, 'terminal.list', {});
    expect(listed.result.sessions.map((s: any) => s.panelId)).toContain('busy1');
    expect(listed.result.sessions.map((s: any) => s.panelId)).not.toContain('idle1');

    await rpcCall(daemon.pipeName, 'terminal.killAll', {});
    await waitFor(() => !daemon.lockManager.hasOpenTerminals('proj'));
    const after = await rpcCall(daemon.pipeName, 'terminal.list', {});
    expect(after.result.sessions).toHaveLength(0);
  });
});
