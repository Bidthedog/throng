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

let daemon: TerminalDaemon;
let cwd: string;

beforeEach(async () => {
  daemon = await startTerminalDaemon();
  cwd = mkdtempSync(join(tmpdir(), 'throng-mirror-'));
});

afterEach(async () => {
  await daemon.stop();
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('mirrored terminal — one session, many views (FR-021)', () => {
  it('fans output out to every subscribed events socket, and input from any view reaches the one PTY', async () => {
    const viewA = await openEventsSocket(daemon.pipeName);
    const viewB = await openEventsSocket(daemon.pipeName);

    await rpcCall(daemon.pipeName, 'terminal.attach', {
      panelId: 'shared',
      projectId: 'proj',
      launch: { file: CMD, args: [], cwd },
      cols: 80,
      rows: 24,
    });

    // Input "from view A" → both views see the output (one session, mirrored).
    await rpcCall(daemon.pipeName, 'terminal.write', { panelId: 'shared', data: 'echo FROM_A_55\r\n' });
    const has = (view: typeof viewA, marker: string) =>
      view.notifications.some(
        (n) => n.method === 'terminal.output' && String(n.params.data).includes(marker),
      );
    expect(await waitFor(() => has(viewA, 'FROM_A_55'))).toBe(true);
    expect(await waitFor(() => has(viewB, 'FROM_A_55'))).toBe(true);

    // Input "from view B" reaches the same single PTY (its echo appears for both).
    await rpcCall(daemon.pipeName, 'terminal.write', { panelId: 'shared', data: 'echo FROM_B_77\r\n' });
    expect(await waitFor(() => has(viewA, 'FROM_B_77'))).toBe(true);
    expect(await waitFor(() => has(viewB, 'FROM_B_77'))).toBe(true);

    // Exactly one session exists for the panel (not one per view).
    const listed = await rpcCall(daemon.pipeName, 'terminal.list', {});
    expect(listed.result.sessions.filter((s: any) => s.panelId === 'shared')).toHaveLength(1);

    await rpcCall(daemon.pipeName, 'terminal.kill', { panelId: 'shared' });
    // Wait for the session to fully close (PTY exit + root lock released) so the
    // temp cwd is no longer held when afterEach deletes it.
    await waitFor(() => !daemon.lockManager.hasOpenTerminals('proj'));
    viewA.close();
    viewB.close();
  });
});
