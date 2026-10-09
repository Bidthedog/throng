import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPtyHost, PtyExit, PtyHandle, PtyStartOptions, ProcessSurvivor } from '@throng/core';
import { END_SETTLE_GRACE_MS, TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 051 — what the terminal service does with an end's OUTCOME (data-model.md "States").
 *
 *   running ─end─▶ ending ─exit─▶ exited (user-initiated)               FR-003, 005 FR-017
 *                    ├─fails, not superseded, not shutdown ─▶ running    FR-005
 *                    ├─fails, superseded ─▶ escalated                    R4
 *                    └─fails, shutdown / Terminate all ─▶ escalated      FR-015a
 *
 * The host is scripted: every `end` is a deferred the test settles, so each transition is driven
 * deliberately rather than raced.
 */

interface Deferred {
  resolve(): void;
  reject(reason: Error): void;
}

class ScriptedHost implements IPtyHost {
  readonly started: PtyHandle[] = [];
  readonly ends = new Map<number, Deferred>();
  readonly endCalls: number[] = [];
  readonly forceEnds: number[] = [];
  readonly probes: number[] = [];
  survivors: ProcessSurvivor[] = [];
  private readonly exitCbs = new Map<number, (e: PtyExit) => void>();
  private nextPid = 1000;

  start(_opts: PtyStartOptions): PtyHandle {
    const handle = { pid: this.nextPid++ };
    this.started.push(handle);
    return handle;
  }
  write(): void {}
  resize(): void {}
  end(handle: PtyHandle): Promise<void> {
    this.endCalls.push(handle.pid);
    return new Promise<void>((resolve, reject) => this.ends.set(handle.pid, { resolve, reject }));
  }
  async forceEnd(handle: PtyHandle): Promise<{ survivors: ProcessSurvivor[] }> {
    this.forceEnds.push(handle.pid);
    return { survivors: this.survivors };
  }
  onData(): () => void {
    return () => {};
  }
  onExit(handle: PtyHandle, cb: (e: PtyExit) => void): () => void {
    this.exitCbs.set(handle.pid, cb);
    return () => this.exitCbs.delete(handle.pid);
  }
  async probeChildPids(handle: PtyHandle): Promise<number[]> {
    this.probes.push(handle.pid);
    return [];
  }
  async listChildProcesses(): Promise<never[]> {
    return [];
  }
  /** The shell exits — as the OS reports it after a successful end, or on its own. */
  exit(pid: number, code = 0): void {
    this.exitCbs.get(pid)?.({ code });
  }
  /** Settle `pid`'s end: success means the exit was observed first, as the real host guarantees. */
  succeed(pid: number): void {
    this.exit(pid);
    this.ends.get(pid)!.resolve();
  }
  fail(pid: number, reason = 'did not end within 5 seconds'): void {
    this.ends.get(pid)!.reject(new Error(reason));
  }
}

const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };
const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function makeService() {
  const host = new ScriptedHost();
  const events = new TerminalEvents();
  const exits: Array<{ panelId: string; unexpected: boolean }> = [];
  vi.spyOn(events, 'publishExit').mockImplementation((panelId, _code, _signal, unexpected) => {
    exits.push({ panelId, unexpected: unexpected === true });
  });
  const service = new TerminalService(host, events, new TerminalLockManager(noopLock), { isElevated: () => false });
  const router = new RpcRouter();
  service.register(router);
  const call = async (method: string, params: object): Promise<any> =>
    ((await router.handle({ jsonrpc: '2.0', id: 1, method, params })) as { result: unknown }).result;
  const attach = (panelId: string, projectId = 'proj') =>
    call('terminal.attach', { panelId, projectId, launch, cols: 80, rows: 24 });
  const sessions = async (): Promise<Array<{ panelId: string; status: string; busy: boolean }>> =>
    (await call('terminal.list', {})).sessions;
  return { host, service, call, attach, sessions, exits };
}

afterEach(() => vi.restoreAllMocks());

describe('051 FR-003 / FR-005 — terminal.kill', () => {
  it('acknowledges before the end settles, then reports a successful end as user-initiated', async () => {
    const { host, call, attach, exits } = makeService();
    await attach('p1');
    const pid = host.started[0]!.pid;
    await expect(call('terminal.kill', { panelId: 'p1' })).resolves.toEqual({ ok: true });
    expect(host.endCalls).toEqual([pid]);
    host.succeed(pid);
    await flush();
    expect(exits).toEqual([{ panelId: 'p1', unexpected: false }]);
  });

  it('a failed end of a panel the user destroyed is escalated: nothing could ever reattach it', async () => {
    // Review finding 1: `terminal.kill` is what a destroyed panel sends, so FR-005's "stays running,
    // reattaches" has nowhere to reattach to — and the terminal was orphaned.
    const { host, call, attach } = makeService();
    await attach('p1');
    const pid = host.started[0]!.pid;
    await call('terminal.kill', { panelId: 'p1' });
    host.fail(pid);
    await flush();
    expect(host.forceEnds).toEqual([pid]);
  });
});

describe('051 FR-005 — a failed Unload end leaves an ordinary running terminal', () => {
  it('nothing published, still running, and a later self-exit is unexpected', async () => {
    vi.useFakeTimers();
    try {
      const { host, call, attach, sessions, exits } = makeService();
      await attach('p1');
      const pid = host.started[0]!.pid;
      const done = call('terminal.killAll', { projectId: 'proj' });
      await vi.advanceTimersByTimeAsync(0);
      host.fail(pid);
      await done;
      expect(exits).toEqual([]);
      expect((await sessions())[0]).toMatchObject({ panelId: 'p1', status: 'running' });
      expect(host.forceEnds).toEqual([]);
      await vi.advanceTimersByTimeAsync(END_SETTLE_GRACE_MS + 10);
      host.exit(pid, 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(exits).toEqual([{ panelId: 'p1', unexpected: true }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a shell that dies just after its end timed out is still the end throng asked for (review finding 6)', async () => {
    vi.useFakeTimers();
    try {
      const { host, call, attach, exits } = makeService();
      await attach('p1');
      const pid = host.started[0]!.pid;
      const done = call('terminal.killAll', { projectId: 'proj' });
      await vi.advanceTimersByTimeAsync(0);
      host.fail(pid);
      await done;
      await vi.advanceTimersByTimeAsync(END_SETTLE_GRACE_MS / 2);
      host.exit(pid); // the taskkill that timed out lands after all
      await vi.advanceTimersByTimeAsync(0);
      expect(exits).toEqual([{ panelId: 'p1', unexpected: false }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('051 FR-002 / FR-005 — terminal.killAll reports outcomes', () => {
  it('ends concurrently and resolves with what failed, a subset of what was killed', async () => {
    const { host, call, attach } = makeService();
    await attach('a');
    await attach('b');
    await attach('c');
    const [a, b, c] = host.started.map((h) => h.pid);
    const result = call('terminal.killAll', { projectId: 'proj' });
    await flush();
    expect(host.endCalls.sort()).toEqual([a, b, c].sort()); // all three started before any settled
    host.succeed(a!);
    host.fail(b!);
    host.succeed(c!);
    await expect(result).resolves.toEqual({
      killed: ['a', 'b', 'c'],
      failed: [{ panelId: 'b', reason: 'did not end within 5 seconds' }],
    });
    expect(host.forceEnds).toEqual([]); // Unload does not escalate: b reattaches
  });

  it('with escalate (Terminate all), a failed end is forced, and only survivors are reported', async () => {
    const { host, call, attach } = makeService();
    await attach('a');
    await attach('b');
    const [a, b] = host.started.map((h) => h.pid);
    host.survivors = [];
    const result = call('terminal.killAll', { escalate: true });
    await flush();
    host.fail(a!);
    host.succeed(b!);
    await expect(result).resolves.toEqual({ killed: ['a', 'b'], failed: [] });
    expect(host.forceEnds).toEqual([a]);
  });

  it('with escalate, a survivor of the forced end is reported and logged', async () => {
    const { host, call, attach } = makeService();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await attach('a');
    const a = host.started[0]!.pid;
    host.survivors = [{ pid: 77, name: 'ping' }];
    const result = call('terminal.killAll', { escalate: true });
    await flush();
    host.fail(a);
    const outcome = await result;
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].panelId).toBe('a');
    expect(warn.mock.calls.flat().join(' ')).toMatch(/77.*ping/);
  });
});

describe('051 FR-004 — no reattach while ending', () => {
  it('an attach for an ending panel starts a fresh terminal; the old exit is not published', async () => {
    const { host, call, attach, exits } = makeService();
    await attach('p1');
    const old = host.started[0]!.pid;
    await call('terminal.kill', { panelId: 'p1' });
    await attach('p1');
    expect(host.started).toHaveLength(2);
    const fresh = host.started[1]!.pid;
    host.succeed(old);
    await flush();
    expect(exits).toEqual([]);
    // The fresh terminal is the panel's now, and keeps running.
    host.exit(fresh, 1);
    await flush();
    expect(exits).toEqual([{ panelId: 'p1', unexpected: true }]);
  });

  it('a superseded end that fails is escalated rather than left orphaned', async () => {
    const { host, call, attach } = makeService();
    await attach('p1');
    const old = host.started[0]!.pid;
    await call('terminal.kill', { panelId: 'p1' });
    await attach('p1');
    host.fail(old);
    await flush();
    expect(host.forceEnds).toEqual([old]);
  });
});

describe('051 R7 — an exit is reported after its lock is released', () => {
  it('handleExit publishes only once the release has settled', async () => {
    const order: string[] = [];
    let finishRelease!: () => void;
    const lock = {
      acquire: async () => ({ path: 'x' }),
      release: () =>
        new Promise<void>((resolve) => {
          order.push('release started');
          finishRelease = () => {
            order.push('released');
            resolve();
          };
        }),
    };
    const host = new ScriptedHost();
    const events = new TerminalEvents();
    vi.spyOn(events, 'publishExit').mockImplementation(() => void order.push('exit published'));
    const service = new TerminalService(host, events, new TerminalLockManager(lock), { isElevated: () => false });
    const router = new RpcRouter();
    service.register(router);
    await router.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'terminal.attach',
      params: { panelId: 'p', projectId: 'proj', launch, cols: 80, rows: 24 },
    });
    host.exit(host.started[0]!.pid);
    await flush();
    expect(order).toEqual(['release started']);
    finishRelease();
    await flush();
    expect(order).toEqual(['release started', 'released', 'exit published']);
  });

  it('MT-01: an exit names the session its attach returned, and a fresh terminal in the panel has a new one', async () => {
    const host = new ScriptedHost();
    const events = new TerminalEvents();
    const sessionIds: Array<number | undefined> = [];
    vi.spyOn(events, 'publishExit').mockImplementation((_p, _c, _s, _u, sessionId) => void sessionIds.push(sessionId));
    const service = new TerminalService(host, events, new TerminalLockManager(noopLock), { isElevated: () => false });
    const router = new RpcRouter();
    service.register(router);
    const attach = async (): Promise<{ sessionId?: number }> =>
      ((await router.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'terminal.attach',
        params: { panelId: 'p', projectId: 'proj', launch, cols: 80, rows: 24 },
      })) as { result: { sessionId?: number } }).result;

    const first = await attach();
    expect(await attach()).toMatchObject({ sessionId: first.sessionId }); // a reattach is the same session
    host.exit(host.started[0]!.pid, 1);
    await flush();
    const second = await attach();
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(sessionIds).toEqual([first.sessionId]);
  });

  it('MT-01: an exit still waiting on its release is never reported to the fresh terminal that reopened its panel', async () => {
    // Unload with End Terminals, then open the project again while the last terminal's release is
    // still polling the folder (up to 3 s, and the reopened terminals re-lock it meanwhile). The old
    // shell's exit — code 1, from taskkill — reached the panel's NEW terminal and closed it.
    const releases: Array<() => void> = [];
    const lock = {
      acquire: async () => ({ path: 'x' }),
      release: () => new Promise<void>((resolve) => releases.push(resolve)),
    };
    const host = new ScriptedHost();
    const events = new TerminalEvents();
    const exits: string[] = [];
    vi.spyOn(events, 'publishExit').mockImplementation((panelId) => void exits.push(panelId));
    const service = new TerminalService(host, events, new TerminalLockManager(lock), { isElevated: () => false });
    const router = new RpcRouter();
    service.register(router);
    const call = (method: string, params: object) => router.handle({ jsonrpc: '2.0', id: 1, method, params });
    const attach = (panelId: string) => call('terminal.attach', { panelId, projectId: 'proj', launch, cols: 80, rows: 24 });

    await attach('p1');
    await attach('p2');
    const [first, second] = host.started.map((h) => h.pid);
    const unloaded = call('terminal.killAll', { projectId: 'proj' });
    await flush();
    for (const pid of [first!, second!]) {
      host.exit(pid, 1);
      host.ends.get(pid)!.resolve();
    }
    await unloaded;
    // The project opens again before the last release has settled.
    await attach('p1');
    await attach('p2');
    expect(host.started).toHaveLength(4);
    exits.length = 0;
    for (const release of releases) release();
    await flush();

    expect(exits).toEqual([]);
  });
});

describe('051 FR-011 — busy decisions and ending sessions', () => {
  it('does not probe an ending session, and reports it not busy', async () => {
    const { host, call, attach } = makeService();
    await attach('a');
    await attach('b');
    const [a, b] = host.started.map((h) => h.pid);
    await call('terminal.kill', { panelId: 'a' });
    const listed = await call('terminal.list', { includeBusy: true });
    expect(host.probes).toEqual([b]);
    expect(listed.sessions.find((s: { panelId: string }) => s.panelId === 'a')).toMatchObject({ busy: false });
    host.succeed(a!);
  });
});

describe('051 FR-015 / FR-015a — shutdown', () => {
  it('ends every session concurrently, escalates any that fail, and never reattaches one', async () => {
    const { host, service, attach } = makeService();
    await attach('a');
    await attach('b');
    const [a, b] = host.started.map((h) => h.pid);
    const done = service.shutdown();
    await flush();
    expect(host.endCalls.sort()).toEqual([a, b].sort());
    host.succeed(a!);
    host.fail(b!);
    await done;
    expect(host.forceEnds).toEqual([b]);
  });

  it('escalates an end that was already in flight when shutdown began, if it then fails', async () => {
    const { host, service, call, attach } = makeService();
    await attach('a');
    const a = host.started[0]!.pid;
    await call('terminal.kill', { panelId: 'a' });
    const done = service.shutdown();
    await flush();
    host.fail(a);
    await done;
    expect(host.forceEnds).toEqual([a]);
  });
});
