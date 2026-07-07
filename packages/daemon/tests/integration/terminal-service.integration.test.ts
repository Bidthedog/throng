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
  cwd = mkdtempSync(join(tmpdir(), 'throng-term-cwd-'));
  evt = await openEventsSocket(daemon.pipeName);
});

afterEach(async () => {
  evt.close();
  await daemon.stop();
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const launch = (file = CMD) => ({ panelId: 'p1', projectId: 'proj', launch: { file, args: [], cwd }, cols: 80, rows: 24 });

describe('terminal.capabilities (elevation gate, FR-025a)', () => {
  it('reports the daemon elevation to the UI (false by default)', async () => {
    const caps = await rpcCall(daemon.pipeName, 'terminal.capabilities', {});
    expect(caps.result).toEqual({ elevated: false });
  });

  it('reports elevated=true when the daemon runs elevated', async () => {
    const elevated = await startTerminalDaemon({ elevated: true });
    try {
      const caps = await rpcCall(elevated.pipeName, 'terminal.capabilities', {});
      expect(caps.result).toEqual({ elevated: true });
    } finally {
      await elevated.stop();
    }
  });
});

describe('terminal.* daemon IPC (Phase C·1)', () => {
  it('cold-starts, streams output, echoes input, then kills with an exit notification', async () => {
    const attached = await rpcCall(daemon.pipeName, 'terminal.attach', launch());
    expect(attached.result.status).toBe('running');
    expect(attached.result.scrollback).toBe('');

    await rpcCall(daemon.pipeName, 'terminal.write', { panelId: 'p1', data: 'echo HELLO_MARKER_42\r\n' });
    const sawOutput = await waitFor(() =>
      evt.notifications.some(
        (n) => n.method === 'terminal.output' && String(n.params.data).includes('HELLO_MARKER_42'),
      ),
    );
    expect(sawOutput).toBe(true);

    await rpcCall(daemon.pipeName, 'terminal.kill', { panelId: 'p1' });
    const sawExit = await waitFor(() =>
      evt.notifications.some((n) => n.method === 'terminal.exit' && n.params.panelId === 'p1'),
    );
    expect(sawExit).toBe(true);

    // A user-initiated kill is NOT an unexpected exit (FR-017).
    const exit = evt.notifications.find((n) => n.method === 'terminal.exit');
    expect(exit?.params.unexpected).toBe(false);

    // The session is gone from list after exit.
    const listed = await rpcCall(daemon.pipeName, 'terminal.list', {});
    expect(listed.result.sessions.find((s: any) => s.panelId === 'p1')).toBeUndefined();
  });

  it('returns a launch-failure error for a missing executable (FR-019)', async () => {
    const res = await rpcCall(daemon.pipeName, 'terminal.attach', {
      ...launch('C:/throng-no-such-shell-xyz.exe'),
      panelId: 'p2',
    });
    expect(res.error).toBeTruthy();
    expect(String(res.error.message)).toMatch(/launch/i);
  });
});
