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
  type TerminalDaemon,
} from './terminal-harness.js';

/**
 * 008 FR-002 / FR-007 over the real named pipe + real node-pty. Two behaviours the unit
 * tests assert against a FakePtyHost, proven here end-to-end against a live daemon:
 *   (1) a mirror attach that resolves a DIFFERENT working directory reuses the running
 *       session and never kills the program — the data loss in User Story 1; and
 *   (2) `terminal.detach` carrying a viewId removes a view without killing the session,
 *       terminating a sub-workspace-owned (rootless) session only when its LAST view goes.
 */

let daemon: TerminalDaemon;
let cwdA: string;
let cwdB: string;

beforeEach(async () => {
  daemon = await startTerminalDaemon();
  cwdA = mkdtempSync(join(tmpdir(), 'throng-grid-a-'));
  cwdB = mkdtempSync(join(tmpdir(), 'throng-grid-b-'));
});

afterEach(async () => {
  await daemon.stop();
  for (const dir of [cwdA, cwdB]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const has = (view: { notifications: Array<{ method: string; params: any }> }, marker: string): boolean =>
  view.notifications.some(
    (n) => n.method === 'terminal.output' && String(n.params.data).includes(marker),
  );

describe('mirror survival + detach lifecycle (008 FR-002/FR-007)', () => {
  it('a mirror attach with a DIFFERENT cwd reuses the running program — it is never reaped', async () => {
    const viewA = await openEventsSocket(daemon.pipeName);
    const viewB = await openEventsSocket(daemon.pipeName);

    // View A cold-starts the panel in cwdA.
    await rpcCall(daemon.pipeName, 'terminal.attach', {
      panelId: 'shared',
      projectId: 'proj',
      launch: { file: CMD, args: [], cwd: cwdA },
      viewId: 'A',
      cols: 80,
      rows: 24,
    });

    // A running marker proves the ORIGINAL process is alive.
    await rpcCall(daemon.pipeName, 'terminal.write', { panelId: 'shared', data: 'echo BEFORE_MIRROR_11\r\n' });
    expect(await waitFor(() => has(viewA, 'BEFORE_MIRROR_11'))).toBe(true);

    // View B mirrors the SAME panel but resolves a DIFFERENT cwd (a sub-workspace). Under
    // the old cwd-in-launchKey design this reaped the running program. It must now reuse.
    const mirror = await rpcCall(daemon.pipeName, 'terminal.attach', {
      panelId: 'shared',
      projectId: 'proj',
      launch: { file: CMD, args: [], cwd: cwdB },
      viewId: 'B',
      cols: 100,
      rows: 30,
    });
    expect(mirror.result.status).toBe('running');

    // Exactly ONE session for the panel (not reaped-and-replaced).
    const listed = await rpcCall(daemon.pipeName, 'terminal.list', {});
    expect(listed.result.sessions.filter((s: any) => s.panelId === 'shared')).toHaveLength(1);

    // The SAME process is still alive after the mirror: a new marker still echoes, to BOTH views.
    await rpcCall(daemon.pipeName, 'terminal.write', { panelId: 'shared', data: 'echo AFTER_MIRROR_22\r\n' });
    expect(await waitFor(() => has(viewA, 'AFTER_MIRROR_22'))).toBe(true);
    expect(await waitFor(() => has(viewB, 'AFTER_MIRROR_22'))).toBe(true);

    await rpcCall(daemon.pipeName, 'terminal.kill', { panelId: 'shared' });
    await waitFor(() => !daemon.lockManager.hasOpenTerminals('proj'));
    viewA.close();
    viewB.close();
  });

  it('detach removes a view without killing the session; the last view of a rootless panel terminates it', async () => {
    const view = await openEventsSocket(daemon.pipeName);

    // A sub-workspace-owned (rootless) panel with two views.
    await rpcCall(daemon.pipeName, 'terminal.attach', {
      panelId: 'sw',
      projectId: 'sw-synthetic',
      launch: { file: CMD, args: [], cwd: cwdA },
      rootless: true,
      viewId: 'A',
      cols: 80,
      rows: 24,
    });
    await rpcCall(daemon.pipeName, 'terminal.attach', {
      panelId: 'sw',
      projectId: 'sw-synthetic',
      launch: { file: CMD, args: [], cwd: cwdA },
      rootless: true,
      viewId: 'B',
      cols: 90,
      rows: 28,
    });

    // Detaching the first view is NOT a kill — the session keeps running for view B.
    await rpcCall(daemon.pipeName, 'terminal.detach', { panelId: 'sw', viewId: 'A' });
    let listed = await rpcCall(daemon.pipeName, 'terminal.list', {});
    expect(listed.result.sessions.find((s: any) => s.panelId === 'sw')?.status).toBe('running');

    // Detaching the LAST view of a rootless panel terminates it (nothing owns it).
    await rpcCall(daemon.pipeName, 'terminal.detach', { panelId: 'sw', viewId: 'B' });
    let gone = false;
    for (let i = 0; i < 40 && !gone; i += 1) {
      listed = await rpcCall(daemon.pipeName, 'terminal.list', {});
      gone = !listed.result.sessions.some((s: any) => s.panelId === 'sw');
      if (!gone) await new Promise((r) => setTimeout(r, 25));
    }
    expect(gone).toBe(true);

    view.close();
  });
});
