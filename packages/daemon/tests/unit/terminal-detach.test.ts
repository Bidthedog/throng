import { describe, it, expect } from 'vitest';
import type { IPtyHost, PtyStartOptions, PtyHandle, PtyExit } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 008 FR-007/FR-010. `terminal.detach(panelId, viewId)` removes a view and recomputes
 * the grid across the survivors. A detach is NOT a kill: a session is terminated by a
 * detach ONLY when the LAST view of a sub-workspace-owned (rootless) panel closes. A
 * project-owned panel's session survives its sub-workspace views closing, because the
 * panel lives on in its project.
 */

interface Resized {
  pid: number;
  cols: number;
  rows: number;
}

class RecordingPtyHost implements IPtyHost {
  readonly started: Array<{ opts: PtyStartOptions; handle: PtyHandle }> = [];
  readonly resizes: Resized[] = [];
  readonly killed: number[] = [];
  private readonly exitCbs = new Map<number, (e: PtyExit) => void>();
  private nextPid = 1000;

  start(opts: PtyStartOptions): PtyHandle {
    const handle = { pid: this.nextPid++ };
    this.started.push({ opts, handle });
    return handle;
  }
  write(): void {}
  resize(handle: PtyHandle, cols: number, rows: number): void {
    this.resizes.push({ pid: handle.pid, cols, rows });
  }
  kill(handle: PtyHandle): void {
    this.killed.push(handle.pid);
  }
  onData(): () => void {
    return () => {};
  }
  onExit(handle: PtyHandle, cb: (e: PtyExit) => void): () => void {
    this.exitCbs.set(handle.pid, cb);
    return () => this.exitCbs.delete(handle.pid);
  }
  listChildPids(): number[] {
    return [];
  }
}

const noopLock = { acquire: () => ({ path: 'x' }), release: () => {} };

function makeService() {
  const host = new RecordingPtyHost();
  const events = new TerminalEvents();
  const locks = new TerminalLockManager(noopLock);
  const service = new TerminalService(host, events, locks, { isElevated: () => false });
  const router = new RpcRouter();
  service.register(router);
  const call = (method: string, params: object) =>
    router.handle({ jsonrpc: '2.0', id: 1, method, params });
  const statusOf = async (panelId: string): Promise<string | undefined> => {
    const res = (await call('terminal.list', {})) as {
      result: { sessions: Array<{ panelId: string; status: string }> };
    };
    return res.result.sessions.find((s) => s.panelId === panelId)?.status;
  };
  return {
    host,
    attach: (params: object) => call('terminal.attach', params),
    detach: (params: object) => call('terminal.detach', params),
    statusOf,
  };
}

const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };

describe('terminal.detach (008 FR-007/FR-010)', () => {
  it('recomputes the grid across the survivors when a view detaches', async () => {
    const { host, attach, detach } = makeService();
    const panel = { panelId: 'p1', projectId: 'proj', launch };
    await attach({ ...panel, viewId: 'A', cols: 100, rows: 30 });
    const pid = host.started[0].handle.pid;
    await attach({ ...panel, viewId: 'B', cols: 60, rows: 20 }); // grid → 60×20
    host.resizes.length = 0;

    // The smaller view goes away → the grid grows to the remaining (larger) view.
    await detach({ panelId: 'p1', viewId: 'B' });
    expect(host.resizes).toEqual([{ pid, cols: 100, rows: 30 }]);
  });

  it('does NOT terminate a project-owned session when its last (sub-workspace) view detaches', async () => {
    const { host, attach, detach, statusOf } = makeService();
    // rootless omitted / false ⇒ project-owned.
    await attach({ panelId: 'p1', projectId: 'proj', launch, viewId: 'A', cols: 80, rows: 24 });
    const pid = host.started[0].handle.pid;

    await detach({ panelId: 'p1', viewId: 'A' });

    expect(host.killed).not.toContain(pid); // the running program survives — the panel lives in its project
    expect(await statusOf('p1')).toBe('running');
  });

  it('terminates a sub-workspace-owned (rootless) session when its LAST view detaches', async () => {
    const { host, attach, detach, statusOf } = makeService();
    await attach({
      panelId: 'sw1',
      projectId: 'sw-synthetic',
      launch,
      rootless: true,
      viewId: 'A',
      cols: 80,
      rows: 24,
    });
    const pid = host.started[0].handle.pid;
    await attach({ panelId: 'sw1', projectId: 'sw-synthetic', launch, rootless: true, viewId: 'B', cols: 80, rows: 24 });

    // First view goes → not the last → session survives.
    await detach({ panelId: 'sw1', viewId: 'A' });
    expect(host.killed).not.toContain(pid);
    expect(await statusOf('sw1')).toBe('running');

    // Last view goes → nothing owns it → terminate.
    await detach({ panelId: 'sw1', viewId: 'B' });
    expect(host.killed).toContain(pid);
    expect(await statusOf('sw1')).toBeUndefined();
  });
});
