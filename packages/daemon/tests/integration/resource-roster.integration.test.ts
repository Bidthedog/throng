import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RESOURCES_ROSTER_METHOD, type DaemonRoster } from '@throng/ipc-contract';
import { WindowsProcessMetrics } from '@throng/platform-windows';
import { ResourceRosterService } from '../../src/resource-roster-service.js';
import { CMD, rpcCall, startTerminalDaemon, waitFor, type TerminalDaemon } from './terminal-harness.js';

/**
 * 055 T028 — `resources.roster` over the daemon's real pipe, naming real processes.
 *
 * Layer: integration — the claim is that the pids the roster names are the shells, console hosts and
 * lock helper Windows is actually running, which only real ConPTY terminals and a real lock can show.
 */

let daemon: TerminalDaemon | undefined;
let cwd: string | undefined;

afterEach(async () => {
  await daemon?.stop();
  if (cwd) rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('resources.roster against a real daemon (055 R5, T028)', () => {
  it("names both shells, their console hosts, and the project's lock helper with its panel", async () => {
    cwd = mkdtempSync(join(tmpdir(), 'throng-roster-'));
    daemon = await startTerminalDaemon();
    new ResourceRosterService(daemon.service, daemon.lockManager, () => null).register(daemon.router);
    const launch = { file: CMD, args: [], cwd };
    await rpcCall(daemon.pipeName, 'terminal.attach', { panelId: 'a', projectId: 'proj', launch, cols: 80, rows: 24 });
    await rpcCall(daemon.pipeName, 'terminal.attach', { panelId: 'b', projectId: 'proj', rootless: true, launch, cols: 80, rows: 24 });

    let roster: DaemonRoster | undefined;
    await waitFor(
      async () => {
        roster = ((await rpcCall(daemon!.pipeName, RESOURCES_ROSTER_METHOD, {})) as { result: DaemonRoster }).result;
        return roster.terminals.length === 2 && roster.terminals.every((t) => t.conhostPid !== null);
      },
      20_000,
      'both terminals with their console hosts',
    );

    const table = new Map((await new WindowsProcessMetrics().snapshot()).readings.map((r) => [r.pid, r]));
    const image = (pid: number | null) => (pid === null ? undefined : table.get(pid)?.imageName.toLowerCase());
    expect(roster!.daemonPid).toBe(process.pid);
    for (const t of roster!.terminals) {
      expect(image(t.osPid)).toBe('cmd.exe');
      expect(['conhost.exe', 'openconsole.exe']).toContain(image(t.conhostPid));
    }
    expect(roster!.terminals.find((t) => t.panelId === 'b')!.projectId).toBeNull();
    expect(roster!.locks).toHaveLength(1);
    expect(roster!.locks[0]).toMatchObject({ projectId: 'proj', path: cwd, panelIds: ['a'] });
    expect(image(roster!.locks[0]!.pid)).toBe('node.exe');
  });
});
