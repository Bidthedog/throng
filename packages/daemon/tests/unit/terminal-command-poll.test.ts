import { describe, it, expect } from 'vitest';
import type { ChildProcess, IPtyHost, PtyExit, PtyHandle, PtyStartOptions } from '@throng/core';
import { TerminalService } from '../../src/terminal-service.js';
import { TerminalEvents } from '../../src/terminal-events.js';
import { TerminalLockManager } from '../../src/terminal-lock-manager.js';
import { RpcRouter } from '../../src/rpc-router.js';

/**
 * 025 FR-019 (T024) — the shared command observation's WIRING.
 *
 * `foregroundCommand` and `captureDecision` are unit-tested as pure rules, and the end-to-end
 * behaviour is covered by E2E. What neither reaches is the loop itself: that it publishes only on a
 * change, that it is suspended while nothing is listening, and that its interval comes from the
 * injected setting rather than a constant. Each of those is a place a defect hides silently — a
 * poll that never fires looks exactly like a terminal with nothing running.
 */

/**
 * A running command in the terminal, stamped when it is handed to the fake host.
 *
 * `startedAt` used to be the literal `10` — epoch ms, so 1 January 1970 — which was harmless while
 * nothing compared it to anything. #280 gave it a meaning: command capture now rejects a candidate
 * that started BEFORE its shell, because that is the signature of a recycled pid still named by
 * some unrelated process's stale `ParentProcessId`. A child stamped 1970 against a shell spawned
 * today is exactly that shape, so the fixture read as an impostor and these tests went red.
 *
 * The fixture was never realistic; it simply never had to be. Stamping it at the moment the test
 * hands it over keeps it after the shell `attach` just spawned, which is what a real observation
 * would report.
 */
const child = (): ChildProcess => ({
  pid: 2001,
  ppid: 1000,
  commandLine: 'npm run dev',
  startedAt: Date.now(),
});

class FakeHost implements IPtyHost {
  /** What the next observation will report. Mutated by the tests. */
  children: ChildProcess[] = [];
  private nextPid = 1000;
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
  private exitHandlers: ((e: PtyExit) => void)[] = [];
  onExit(_handle: PtyHandle, cb: (e: PtyExit) => void): () => void {
    this.exitHandlers.push(cb);
    return () => {};
  }
  /** The shell ended — every session this host started hears it. */
  fireExit(): void {
    for (const h of this.exitHandlers.splice(0)) h({ code: 0 });
  }
  async probeChildPids(): Promise<number[]> {
    return this.children.map((c) => c.pid);
  }
  listChildProcesses(): Promise<ChildProcess[]> {
    return Promise.resolve(this.children);
  }
}

const noopLock = { acquire: async () => ({ path: 'x' }), release: async () => {} };
const launch = { file: 'C:/cmd.exe', args: [], cwd: 'C:/proj' };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeService(pollMs: number) {
  const host = new FakeHost();
  const events = new TerminalEvents();
  const locks = new TerminalLockManager(noopLock);
  const service = new TerminalService(
    host,
    events,
    locks,
    { isElevated: () => false },
    undefined,
    false,
    0,
    undefined,
    pollMs,
  );
  const router = new RpcRouter();
  service.register(router);
  const published: Array<{ panelId: string; command: string | null }> = [];
  /** A sink makes the service "observed"; without one the poll must stay asleep. */
  const sink = {
    write: (frame: string): void => {
      const msg = JSON.parse(frame) as { method: string; params: { panelId: string; command: string | null } };
      if (msg.method === 'terminal.command') published.push(msg.params);
    },
  };
  return {
    host,
    events,
    published,
    sink,
    attach: (params: object) => router.handle({ jsonrpc: '2.0', id: 1, method: 'terminal.attach', params }),
  };
}

describe('the shared command observation (025 FR-019 / T024)', () => {
  it('publishes a change, and does NOT publish the same value again', async () => {
    const s = makeService(30);
    s.events.addSink(s.sink);
    await s.attach({ panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 });

    s.host.children = [child()];
    await sleep(200);
    expect(s.published.filter((p) => p.command === 'npm run dev').length).toBe(1);

    // Several more intervals with the SAME command must add nothing: a notification per poll would
    // make every consumer re-render, and re-persist, once a second forever.
    await sleep(200);
    expect(s.published.filter((p) => p.command === 'npm run dev').length).toBe(1);
  });

  it('053 manual test — a view re-attaching to a running session is told its command again', async () => {
    // Switching projects remounts a terminal's view over its still-running session, and a mounting
    // view drops the command its panel showed. If the daemon only ever publishes a CHANGE, the same
    // command still running is never sent again, and the panel's name loses it — and the title with it.
    const s = makeService(30);
    s.events.addSink(s.sink);
    await s.attach({ panelId: 'p1', projectId: 'proj', viewId: 'A', launch, cols: 80, rows: 24 });
    s.host.children = [child()];
    await sleep(200);
    expect(s.published.filter((p) => p.command === 'npm run dev').length).toBe(1);

    const res = (await s.attach({ panelId: 'p1', projectId: 'proj', viewId: 'B', launch, cols: 80, rows: 24 })) as {
      result: { command?: string | null };
    };

    // In the answer itself, not at the next observation up to an interval later: the name is right on
    // the view's first frame (the delay on every project switch).
    expect(res.result.command).toBe('npm run dev');
  });

  it('053 manual test — a terminal started afresh in a panel publishes its command, though the last one ran the same', async () => {
    // Unload with End Terminals then load, or close throng ending every terminal and reopen: the
    // panel's new terminal relaunches the remembered command. Its first observation is the same
    // command the ended terminal last published, and the panel's name stayed without it.
    const s = makeService(30);
    s.events.addSink(s.sink);
    await s.attach({ panelId: 'p1', projectId: 'proj', viewId: 'A', launch, cols: 80, rows: 24 });
    s.host.children = [child()];
    await sleep(200);
    expect(s.published.filter((p) => p.command === 'npm run dev').length).toBe(1);

    s.host.fireExit(); // the terminal ends
    await sleep(50);
    s.host.children = [];
    await s.attach({ panelId: 'p1', projectId: 'proj', viewId: 'B', launch, cols: 80, rows: 24 });
    s.host.children = [{ ...child(), pid: 2002, ppid: 1001, startedAt: Date.now() }];
    await sleep(200);

    expect(s.published.filter((p) => p.command === 'npm run dev').length).toBe(2);
  });

  it('publishes null when the command goes away, so "idle" is distinguishable from "unseen"', async () => {
    const s = makeService(30);
    s.events.addSink(s.sink);
    await s.attach({ panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 });

    s.host.children = [child()];
    await sleep(200);
    s.host.children = [];
    await sleep(200);

    expect(s.published.at(-1)?.command).toBeNull();
  });

  it('stays asleep while nothing is listening, and resumes when something is (FR-019f)', async () => {
    const s = makeService(30);
    // No sink yet — deliberately.
    await s.attach({ panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 });
    s.host.children = [child()];
    await sleep(200);
    expect(s.published).toHaveLength(0);

    s.events.addSink(s.sink);
    await sleep(200);
    expect(s.published.at(-1)?.command).toBe('npm run dev');
  });

  it('passes the shell’s spawn time to capture, so a pre-dating process is never published (#280)', async () => {
    /*
     * A WIRING test, not a rule test. `foregroundCommand`'s guard has its own unit tests in
     * `command-capture-pid-reuse.test.ts`; what those cannot see is whether the real call path
     * actually SUPPLIES the spawn time. `shellStartedAt` is optional — deliberately, so a caller
     * that cannot know it keeps capture instead of losing it — and that means dropping the
     * argument reintroduces #280 in full while every rule test stays green.
     *
     * This is the assertion that goes red if it is ever dropped: a child stamped before the shell
     * reaches the service through the ordinary observation, and nothing is published.
     */
    const s = makeService(30);
    s.events.addSink(s.sink);
    await s.attach({ panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 });

    // The signature of a recycled pid: a live process naming this shell as its parent, which
    // started long before the shell existed. It is not this terminal's command.
    s.host.children = [{ ...child(), startedAt: Date.now() - 600_000 }];
    await sleep(200);

    expect(s.published.filter((p) => p.command !== null)).toHaveLength(0);
  });

  it('uses the INJECTED interval, not a constant — a slow one has not fired yet', async () => {
    // If the interval were hardcoded at 1000ms this test would be indistinguishable from the one
    // above; the point is that the value passed in is the value used.
    const slow = makeService(5000);
    slow.events.addSink(slow.sink);
    await slow.attach({ panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 });
    slow.host.children = [child()];
    await sleep(300);
    expect(slow.published).toHaveLength(0);
  });
});

describe('051 FR-040/FR-041 — attached processes on the shared observation', () => {
  /** A host that can also say what is attached; counts how often it is asked. */
  class AttachedHost extends FakeHost {
    attachedCalls: number[][] = [];
    attached: ChildProcess[] | 'fail' = [];
    listAttachedProcesses(handles: readonly PtyHandle[]): Promise<Map<number, ChildProcess[]>> {
      this.attachedCalls.push(handles.map((h) => h.pid));
      if (this.attached === 'fail') return Promise.reject(new Error('helper failed'));
      const list = this.attached;
      return Promise.resolve(new Map(handles.map((h) => [h.pid, list])));
    }
  }

  function makeAttached(pollMs: number) {
    const host = new AttachedHost();
    const events = new TerminalEvents();
    const service = new TerminalService(
      host,
      events,
      new TerminalLockManager(noopLock),
      { isElevated: () => false },
      undefined,
      false,
      0,
      undefined,
      pollMs,
    );
    const router = new RpcRouter();
    service.register(router);
    const published: Array<{ panelId: string; command: string | null }> = [];
    events.addSink({
      write: (frame: string): void => {
        const msg = JSON.parse(frame) as { method: string; params: { panelId: string; command: string | null } };
        if (msg.method === 'terminal.command') published.push(msg.params);
      },
    });
    const attach = (panelId: string) =>
      router.handle({ jsonrpc: '2.0', id: 1, method: 'terminal.attach', params: { panelId, projectId: 'proj', launch, cols: 80, rows: 24 } });
    return { host, published, attach };
  }

  const reparented = (): ChildProcess => ({
    pid: 3001,
    ppid: 2999, // an exited launcher: no direct child of the shell
    commandLine: 'docker run --rm alpine sleep 600',
    startedAt: Date.now() + 1000,
  });

  it('asks once per pass for every terminal on the host, however many there are', async () => {
    const s = makeAttached(30);
    await s.attach('a');
    await s.attach('b');
    await s.attach('c');
    await sleep(100);
    expect(s.host.attachedCalls.length).toBeGreaterThan(0);
    for (const call of s.host.attachedCalls) expect(call).toHaveLength(3);
  });

  it('reports a re-parented command the direct children cannot see', async () => {
    const s = makeAttached(30);
    await s.attach('a');
    s.host.attached = [reparented()];
    await sleep(150);
    expect(s.published.at(-1)?.command).toBe('docker run --rm alpine sleep 600');
  });

  it('a failed pass leaves the last value in place (025 FR-019e)', async () => {
    const s = makeAttached(30);
    await s.attach('a');
    s.host.attached = [reparented()];
    await sleep(150);
    s.host.attached = 'fail';
    await sleep(150);
    expect(s.published.at(-1)?.command).toBe('docker run --rm alpine sleep 600');
  });
});

describe('053 `{arch}` — the observation carries the chosen program\'s architecture', () => {
  /** A host that can read an executable's architecture; `arches` maps path → answer. */
  class ArchHost extends FakeHost {
    arches = new Map<string, string | null>();
    archCalls: string[] = [];
    /** When set, every read hangs — a stalled disk or network path. */
    hang = false;
    executableArch(path: string): Promise<string | null> {
      this.archCalls.push(path);
      if (this.hang) return new Promise(() => {});
      return Promise.resolve(this.arches.get(path) ?? null);
    }
  }

  type Published = { panelId: string; command: string | null; arch?: string | null };

  function makeArch(host: FakeHost) {
    const events = new TerminalEvents();
    const service = new TerminalService(
      host,
      events,
      new TerminalLockManager(noopLock),
      { isElevated: () => false },
      undefined,
      false,
      0,
      undefined,
      30,
    );
    const router = new RpcRouter();
    service.register(router);
    const published: Published[] = [];
    events.addSink({
      write: (frame: string): void => {
        const msg = JSON.parse(frame) as { method: string; params: Published };
        if (msg.method === 'terminal.command') published.push(msg.params);
      },
    });
    const attach = () =>
      router.handle({ jsonrpc: '2.0', id: 1, method: 'terminal.attach', params: { panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 } });
    return { published, attach };
  }

  const ping = (): ChildProcess => ({ ...child(), commandLine: 'ping localhost -t', executablePath: 'C:/Windows/System32/PING.EXE' });

  it('publishes the arch of the process the command names', async () => {
    const host = new ArchHost();
    host.arches.set('C:/Windows/System32/PING.EXE', 'x64');
    const s = makeArch(host);
    await s.attach();
    host.children = [ping()];
    await sleep(200);
    expect(s.published.at(-1)).toEqual({ panelId: 'p1', command: 'ping localhost -t', arch: 'x64', observedAt: expect.any(Number) });
    expect(host.archCalls).toContain('C:/Windows/System32/PING.EXE');
  });

  it('republishes when only the arch changes, and not when nothing does', async () => {
    const host = new ArchHost();
    host.arches.set('C:/Windows/System32/PING.EXE', 'x86');
    const s = makeArch(host);
    await s.attach();
    host.children = [ping()];
    await sleep(200);
    host.arches.set('C:/Windows/System32/PING.EXE', 'arm64');
    await sleep(200);
    const forPing = s.published.filter((p) => p.command === 'ping localhost -t');
    expect(forPing.map((p) => p.arch)).toEqual(['x86', 'arm64']);
  });

  it('publishes arch: null when the terminal goes idle', async () => {
    const host = new ArchHost();
    host.arches.set('C:/Windows/System32/PING.EXE', 'x64');
    const s = makeArch(host);
    await s.attach();
    host.children = [ping()];
    await sleep(200);
    host.children = [];
    await sleep(200);
    expect(s.published.at(-1)).toEqual({ panelId: 'p1', command: null, arch: null, observedAt: expect.any(Number) });
  });

  it('a host without executableArch (the de-elevated agent) yields null', async () => {
    const host = new FakeHost();
    const s = makeArch(host);
    await s.attach();
    host.children = [ping()];
    await sleep(200);
    expect(s.published.at(-1)).toEqual({ panelId: 'p1', command: 'ping localhost -t', arch: null, observedAt: expect.any(Number) });
  });

  it('a process without an executable path is not read, and its arch is null', async () => {
    const host = new ArchHost();
    const s = makeArch(host);
    await s.attach();
    host.children = [child()];
    await sleep(200);
    expect(s.published.at(-1)).toEqual({ panelId: 'p1', command: 'npm run dev', arch: null, observedAt: expect.any(Number) });
    expect(host.archCalls).toHaveLength(0);
  });

  it('a read that never answers does not hold back the command (Principle XII)', async () => {
    const host = new ArchHost();
    host.hang = true;
    const s = makeArch(host);
    await s.attach();
    host.children = [ping()];
    await sleep(700);
    expect(s.published.at(-1)).toEqual({ panelId: 'p1', command: 'ping localhost -t', arch: null, observedAt: expect.any(Number) });
  });
});
