import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPtyHost, ProjectService, PtyExit, PtyHandle, PtyStartOptions } from '@throng/core';
import { ProjectIpcService } from '../../src/project-service.js';
import { RpcRouter } from '../../src/rpc-router.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { TerminalService } from '../../src/terminal-service.js';

/**
 * 046 T056 / T124 — `terminal.closeIdle` and `terminal.killAll`, scoped to a project, as Unload calls
 * them (contracts/unload.md §3; FR-034, FR-034c, FR-037, FR-086; Principle III).
 *
 * Layer: unit — the claim is `sessionScope()` plus the `probeChildPids` classification in
 * `TerminalService`; both are pure over the host's answers, so a scripted host drives them exactly.
 * (Moved down from the integration layer, which used real shells and `ping -n 30` children. The real
 * busy-probe wiring is still proved by `terminal-reattach.integration.test.ts`.)
 *
 * Unload releases the MAIN window's view of a project. Two kinds of session in that project are not
 * the main window's to end: a panel a sub-workspace window holds (`exceptPanelIds`, FR-037) and a
 * `rootless` session (R7). Both are spared ONLY when `projectId` is given; app close sends
 * `killAll {}`, which must stay "every session, no exceptions".
 */

class ScriptedHost implements IPtyHost {
  /** Pids whose shell has a running child: the next probe reports them busy. */
  readonly busyPids = new Set<number>();
  private readonly exitCbs = new Map<number, (e: PtyExit) => void>();
  private nextPid = 1000;

  start(_opts: PtyStartOptions): PtyHandle {
    return { pid: this.nextPid++ };
  }
  write(): void {}
  resize(): void {}
  async end(handle: PtyHandle): Promise<void> {
    // A throng-initiated end: the process dies, the exit is observed, then the end resolves.
    const cb = this.exitCbs.get(handle.pid);
    this.exitCbs.delete(handle.pid);
    cb?.({ code: 0 });
  }
  async forceEnd(): Promise<{ survivors: never[] }> {
    return { survivors: [] };
  }
  onData(): () => void {
    return () => {};
  }
  onExit(handle: PtyHandle, cb: (e: PtyExit) => void): () => void {
    this.exitCbs.set(handle.pid, cb);
    return () => this.exitCbs.delete(handle.pid);
  }
  async probeChildPids(handle: PtyHandle): Promise<number[]> {
    return this.busyPids.has(handle.pid) ? [handle.pid + 5000] : [];
  }
  async listChildProcesses(): Promise<never[]> {
    return [];
  }
  /** The pid the n-th attached terminal got. */
  pidOf(n: number): number {
    return 1000 + n;
  }
}

const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };
const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

interface Attached {
  projectId?: string;
  rootless?: boolean;
  busy?: boolean;
}

function makeService() {
  const host = new ScriptedHost();
  const locks = new TerminalLockManager(noopLock);
  const service = new TerminalService(host, new TerminalEvents(), locks, { isElevated: () => false });
  const router = new RpcRouter();
  service.register(router);
  let id = 0;
  let attached = 0;
  const call = async (method: string, params: object = {}): Promise<any> =>
    ((await router.handle({ jsonrpc: '2.0', id: ++id, method, params })) as { result: any; error?: unknown }).result;
  /** Attach panels in order; busy ones get a running child on the pid they are given. */
  const attach = async (panelId: string, opts: Attached = {}): Promise<void> => {
    const pid = host.pidOf(attached++);
    if (opts.busy) host.busyPids.add(pid);
    await call('terminal.attach', {
      panelId,
      projectId: opts.projectId ?? 'proj',
      launch,
      cols: 80,
      rows: 24,
      ...(opts.rootless ? { rootless: true } : {}),
    });
  };
  const running = async (): Promise<string[]> =>
    (await call('terminal.list', {})).sessions.filter((s: any) => s.status === 'running').map((s: any) => s.panelId);
  return { host, service, router, locks, call, attach, running };
}

let live: Array<{ service: TerminalService }> = [];
function fresh() {
  const h = makeService();
  live.push(h);
  return h;
}
afterEach(async () => {
  for (const h of live.splice(0)) await h.service.shutdown();
  live = [];
});

describe('closeIdle {projectId, exceptPanelIds} (FR-034c, FR-037)', () => {
  it('closes the idle session, and spares the busy one and the excepted one', async () => {
    const h = fresh();
    await h.attach('idle1');
    await h.attach('busy1', { busy: true });
    await h.attach('spare1'); // idle — the exception is the ONLY thing that can save it
    await h.attach('other1', { projectId: 'other' });

    const res = await h.call('terminal.closeIdle', { projectId: 'proj', exceptPanelIds: ['spare1'] });
    await flush();

    expect(res.closed).toEqual(['idle1']);
    const running = await h.running();
    expect(running).toContain('busy1');
    expect(running).toContain('spare1');
    expect(running).toContain('other1'); // another project is never in scope
    expect(running).not.toContain('idle1');
  });

  it('an empty exceptPanelIds behaves as before: every idle session of the project closes', async () => {
    const h = fresh();
    await h.attach('idleA');
    await h.attach('idleB');
    const res = await h.call('terminal.closeIdle', { projectId: 'proj', exceptPanelIds: [] });
    expect([...res.closed].sort()).toEqual(['idleA', 'idleB']);
  });
});

describe('killAll {projectId, exceptPanelIds} (FR-034, FR-037)', () => {
  it('ends every session of the project, busy or idle, except the excepted panel', async () => {
    const h = fresh();
    await h.attach('idle1');
    await h.attach('busy1', { busy: true });
    await h.attach('spare1');
    await h.attach('other1', { projectId: 'other' });

    const res = await h.call('terminal.killAll', { projectId: 'proj', exceptPanelIds: ['spare1'] });

    expect([...res.killed].sort()).toEqual(['busy1', 'idle1']);
    const running = await h.running();
    expect(running).toContain('spare1');
    expect(running).toContain('other1');
    expect(running).not.toContain('idle1');
    expect(running).not.toContain('busy1');
  });

  it('a busy excepted panel survives too — the exception is not an idleness test', async () => {
    const h = fresh();
    await h.attach('busySpare', { busy: true });
    await h.attach('idle1');

    const res = await h.call('terminal.killAll', { projectId: 'proj', exceptPanelIds: ['busySpare'] });

    expect(res.killed).toEqual(['idle1']);
    expect(await h.running()).toContain('busySpare');
  });
});

describe('rootless sessions are skipped when scoped to a project (R7, [derived])', () => {
  it('closeIdle {projectId} leaves an idle rootless session running', async () => {
    const h = fresh();
    await h.attach('rootless1', { rootless: true });
    await h.attach('idle1');

    const res = await h.call('terminal.closeIdle', { projectId: 'proj' });

    expect(res.closed).toEqual(['idle1']);
    expect(await h.running()).toContain('rootless1');
  });

  it('killAll {projectId} leaves a rootless session running', async () => {
    const h = fresh();
    await h.attach('rootless1', { rootless: true });
    await h.attach('idle1');

    const res = await h.call('terminal.killAll', { projectId: 'proj' });

    expect(res.killed).toEqual(['idle1']);
    expect(await h.running()).toContain('rootless1');
  });
});

describe('terminal.list names rootless sessions, so Unload neither counts nor names them (review #3)', () => {
  it('reports rootless: true for a rootless session and not for a project one', async () => {
    const h = fresh();
    await h.attach('rootless1', { rootless: true });
    await h.attach('idle1');

    const l = await h.call('terminal.list', { projectId: 'proj', includeBusy: true });
    const byId = new Map(l.sessions.map((s: any) => [s.panelId, s]));

    expect((byId.get('rootless1') as any)?.rootless).toBe(true);
    expect((byId.get('idle1') as any)?.rootless).toBeFalsy();
  });
});

describe('killAll {} — app close — is unchanged', () => {
  it('ends every running session: every project, rootless included', async () => {
    const h = fresh();
    await h.attach('a1');
    await h.attach('rootless1', { rootless: true });
    await h.attach('other1', { projectId: 'other' });

    const res = await h.call('terminal.killAll', {});

    expect([...res.killed].sort()).toEqual(['a1', 'other1', 'rootless1']);
    expect(h.locks.hasOpenTerminals('proj')).toBe(false);
    expect(h.locks.hasOpenTerminals('other')).toBe(false);
    expect(await h.running()).toEqual([]);
  });
});

describe('the Principle III guard: a kept session still ends (046 FR-086)', () => {
  it('when its project is deleted (projects.delete → killForProject)', async () => {
    const h = fresh();
    const projects = { delete: vi.fn(() => ({ ok: true })) } as unknown as ProjectService;
    new ProjectIpcService(projects, undefined, undefined, (projectId) => h.service.killForProject(projectId)).register(
      h.router,
    );
    await h.attach('idle1');
    await h.attach('busy1', { busy: true });
    await h.call('terminal.detach', { panelId: 'idle1' });
    await h.call('terminal.detach', { panelId: 'busy1' });
    expect(await h.running()).toEqual(['idle1', 'busy1']);

    await h.call('projects.delete', { id: 'proj' });
    await flush();

    expect(await h.running()).toEqual([]);
    expect(h.locks.hasOpenTerminals('proj')).toBe(false);
  });

  it('under "terminate all" at app close (killAll {}) after the view detached', async () => {
    const h = fresh();
    await h.attach('idle1');
    await h.call('terminal.detach', { panelId: 'idle1' });
    expect(await h.running()).toEqual(['idle1']);

    const res = await h.call('terminal.killAll', {});

    expect(res.killed).toContain('idle1');
    expect(await h.running()).toEqual([]);
    expect(h.locks.hasOpenTerminals('proj')).toBe(false);
  });
});
