import { describe, it, expect, vi } from 'vitest';
import type { ChildProcess, IPtyHost, LockHandle, PtyHandle, PtyStartOptions } from '@throng/core';
import { RESOURCES_ROSTER_METHOD, type DaemonRoster } from '@throng/ipc-contract';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { ResourceRosterService } from '../../src/resource-roster-service.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 055 T026 — the daemon's roster: who is who, from what the daemon already holds in memory. The
 * roster is read on every tick of the collector, so it MUST make no OS query of its own (R5).
 */

class FakeHost implements IPtyHost {
  private nextPid = 1000;
  attached = new Map<number, ChildProcess[]>();
  start(_opts: PtyStartOptions): PtyHandle {
    return { pid: this.nextPid++ };
  }
  write(): void {}
  resize(): void {}
  async end(): Promise<void> {}
  async forceEnd(): Promise<{ survivors: never[] }> {
    return { survivors: [] };
  }
  onData(): () => void {
    return () => {};
  }
  onExit(): () => void {
    return () => {};
  }
  probeChildPids = vi.fn(async (): Promise<number[]> => []);
  listChildProcesses = vi.fn(async (): Promise<ChildProcess[]> => []);
  listAttachedProcesses = vi.fn(async (handles: readonly PtyHandle[]) => {
    const out = new Map<number, ChildProcess[]>();
    for (const h of handles) out.set(h.pid, this.attached.get(h.pid) ?? []);
    return out;
  });
  rosterEntries = () => [
    { handlePid: 1000, osPid: 1000, conhostPid: 5000 },
    { handlePid: 1001, osPid: 1001, conhostPid: null },
  ];
}

const dirLock = {
  acquire: async (path: string): Promise<LockHandle> => ({ path }),
  release: async () => {},
  heldPids: () => [{ path: 'C:/proj', pid: 7000 }],
};
const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function make() {
  const host = new FakeHost();
  const events = new TerminalEvents();
  const locks = new TerminalLockManager(dirLock);
  const terminals = new TerminalService(host, events, locks, { isElevated: () => false }, undefined, false, 0, undefined, 20);
  const router = new RpcRouter();
  terminals.register(router);
  new ResourceRosterService(terminals, locks, () => 4242).register(router);
  const call = (method: string, params: object = {}) => router.handle({ jsonrpc: '2.0', id: 1, method, params });
  await call('terminal.attach', { panelId: 'n1', projectId: 'proj', launch, cols: 80, rows: 24 });
  await call('terminal.attach', { panelId: 'n2', projectId: 'proj', launch, cols: 80, rows: 24 });
  return { host, events, terminals, call };
}

describe('resources.roster (055 R5, T026)', () => {
  it("names every terminal's shell and console host, the lock helper with its panels, the daemon and the agent", async () => {
    const s = await make();
    const res = (await s.call(RESOURCES_ROSTER_METHOD)) as { result: DaemonRoster };
    expect(res.result.daemonPid).toBe(process.pid);
    expect(res.result.agentPid).toBe(4242);
    expect(res.result.terminals).toEqual([
      { panelId: 'n1', projectId: 'proj', osPid: 1000, conhostPid: 5000, attached: [], scrollbackChars: 0 },
      { panelId: 'n2', projectId: 'proj', osPid: 1001, conhostPid: null, attached: [], scrollbackChars: 0 },
    ]);
    expect(res.result.locks).toEqual([{ path: 'C:/proj', projectId: 'proj', pid: 7000, panelIds: ['n1', 'n2'] }]);
  });

  it("keeps each terminal's latest console-attached pids from the command poll", async () => {
    const s = await make();
    s.events.addSink({ write: () => {} }); // the poll runs only while something listens
    s.host.attached.set(1000, [{ pid: 3001, ppid: 1, commandLine: 'node x', startedAt: 1_700_000_000_000 }]);
    await sleep(120);
    const res = (await s.call(RESOURCES_ROSTER_METHOD)) as { result: DaemonRoster };
    expect(res.result.terminals.find((t) => t.panelId === 'n1')!.attached).toEqual([{ pid: 3001, startedAt: 1_700_000_000_000 }]);
  });

  it('makes no OS query of its own', async () => {
    const s = await make();
    s.host.probeChildPids.mockClear();
    s.host.listChildProcesses.mockClear();
    s.host.listAttachedProcesses.mockClear();
    await s.call(RESOURCES_ROSTER_METHOD);
    expect(s.host.probeChildPids).not.toHaveBeenCalled();
    expect(s.host.listChildProcesses).not.toHaveBeenCalled();
    expect(s.host.listAttachedProcesses).not.toHaveBeenCalled();
  });

  it("reports a terminal whose host cannot name its OS pid yet as null — never the handle's key", async () => {
    const s = await make();
    s.host.rosterEntries = () => [];
    const res = (await s.call(RESOURCES_ROSTER_METHOD)) as { result: DaemonRoster };
    expect(res.result.terminals.map((t) => t.osPid)).toEqual([null, null]);
  });
});
