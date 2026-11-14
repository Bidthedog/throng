import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type {
  ChildProcess,
  ClaudeSessionMiss,
  ClaudeSessionProcess,
  IClaudeSessionResolver,
  IPtyHost,
  PtyExit,
  PtyHandle,
  PtyStartOptions,
} from '@throng/core';
import { TERMINAL_WRITE_METHOD } from '@throng/ipc-contract';
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
// The poll runs on timers, and the fake host answers from memory, so a fake clock walks the same
// intervals in microseconds. `Date` stays real: capture compares a child's start against the shell's.
const sleep = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
});

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

/**
 * 025 FR-019i — a terminal with no input and no output is observed one interval in ten.
 *
 * ANTI-VACUITY CONTROL: restore the plain `running` list in `pollCommands` and "backs off" fails; drop
 * the `lastActivityAt` stamp from either the output or the input path and its "wakes" test fails.
 */
describe('observation backs off while a terminal is quiet (025 FR-019i)', () => {
  const POLL = 100; // active window 500 ms, idle pass every 1000 ms

  class DrivenHost extends FakeHost {
    observations = 0;
    private data: ((chunk: string) => void)[] = [];
    override onData(_h: PtyHandle, cb?: (chunk: string) => void): () => void {
      if (cb) this.data.push(cb);
      return () => {};
    }
    emit(chunk: string): void {
      for (const cb of this.data) cb(chunk);
    }
    override listChildProcesses(): Promise<ChildProcess[]> {
      this.observations += 1;
      return super.listChildProcesses();
    }
  }

  async function quietService() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const host = new DrivenHost();
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
      POLL,
    );
    const router = new RpcRouter();
    service.register(router);
    const sink = { write: (): void => {} };
    events.addSink(sink);
    await router.handle({ jsonrpc: '2.0', id: 1, method: 'terminal.attach', params: { panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 } });
    return { host, events, sink, router };
  }

  /** How many observations happen over `ms`, from now. */
  async function observationsOver(host: DrivenHost, ms: number): Promise<number> {
    const before = host.observations;
    await sleep(ms);
    return host.observations - before;
  }

  it('observes every interval just after starting, then backs off to one interval in ten', async () => {
    const { host } = await quietService();
    expect(await observationsOver(host, 400)).toBe(4);
    await sleep(1000); // past the active window
    expect(await observationsOver(host, 3000)).toBe(3);
  });

  it('wakes on output, and observes every interval again', async () => {
    const { host } = await quietService();
    await sleep(2000);
    host.emit('hello');
    expect(await observationsOver(host, 400)).toBe(4);
  });

  it('wakes on input, so a silent command typed by the user is seen within one interval', async () => {
    const { host, router } = await quietService();
    await sleep(2000);
    await router.handle({ jsonrpc: '2.0', id: 2, method: TERMINAL_WRITE_METHOD, params: { panelId: 'p1', data: 'sleep 100\r' } });
    expect(await observationsOver(host, 400)).toBe(4);
  });

  it('does not treat a report xterm wrote by itself as the user being active', async () => {
    const { host, router } = await quietService();
    await sleep(2000);
    await router.handle({ jsonrpc: '2.0', id: 2, method: TERMINAL_WRITE_METHOD, params: { panelId: 'p1', data: '\x1b[I' } });
    expect(await observationsOver(host, 400)).toBeLessThanOrEqual(1);
  });

  it('observes at the next pass when a view attaches after none was listening (FR-019f)', async () => {
    const { host, events, sink } = await quietService();
    await sleep(2000);
    // Just after an idle pass, so the next is not due by itself for the whole of this test.
    while ((await observationsOver(host, POLL)) === 0);
    events.removeSink(sink);
    await sleep(POLL);
    events.addSink(sink);
    expect(await observationsOver(host, POLL)).toBe(1);
  });
});

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

  describe('a host that reports its shell’s start on its own clock (IPtyHost.shellStartedAt)', () => {
    /** Linux's clock, which here reads a second behind the wall clock. */
    const SKEW_MS = 1000;
    class SkewedHost extends FakeHost {
      shellStart: number | undefined;
      shellStartedAt(): Promise<number | undefined> {
        return Promise.resolve(this.shellStart);
      }
    }
    function makeSkewed(host: SkewedHost): { published: Array<string | null>; attach: () => Promise<unknown> } {
      const events = new TerminalEvents();
      const published: Array<string | null> = [];
      events.addSink({
        write: (frame: string): void => {
          const msg = JSON.parse(frame) as { method: string; params: { command: string | null } };
          if (msg.method === 'terminal.command') published.push(msg.params.command);
        },
      });
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
      const params = { panelId: 'p1', projectId: 'proj', launch, cols: 80, rows: 24 };
      return { published, attach: () => router.handle({ jsonrpc: '2.0', id: 1, method: 'terminal.attach', params }) };
    }

    it('compares against that start, so a child started with the shell is published', async () => {
      const host = new SkewedHost();
      const s = makeSkewed(host);
      await s.attach();
      host.shellStart = Date.now() - SKEW_MS;
      host.children = [{ ...child(), startedAt: host.shellStart }];
      await sleep(200);
      expect(s.published.at(-1)).toBe('npm run dev');
    });

    it('still refuses a process older than that start (#280)', async () => {
      const host = new SkewedHost();
      const s = makeSkewed(host);
      await s.attach();
      host.shellStart = Date.now() - SKEW_MS;
      host.children = [{ ...child(), startedAt: host.shellStart - 1 }];
      await sleep(200);
      expect(s.published.filter((command) => command !== null)).toHaveLength(0);
    });

    it('falls back to the wall clock when the host cannot say', async () => {
      const host = new SkewedHost();
      const s = makeSkewed(host);
      await s.attach();
      host.children = [{ ...child(), startedAt: Date.now() - SKEW_MS }];
      await sleep(200);
      expect(s.published.filter((command) => command !== null)).toHaveLength(0);
    });
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

/**
 * 068 FR-040 to FR-055 — the daemon names a running Claude Code session so a terminal can resume it.
 *
 * Layer: unit — the claim is the observation's wiring around an injected resolver; the resolver
 * itself is proven against a real process in claude-session-resolver.integration.test.ts.
 */
describe('068 Claude Code session resume — memoryCommand on the shared observation', () => {
  const SESSION_A = '11111111-2222-3333-4444-555555555555';
  const SESSION_B = '99999999-2222-3333-4444-555555555555';
  type Outcome = { sessionId: string; argv: readonly string[] } | { none: ClaudeSessionMiss };

  class FakeResolver implements IClaudeSessionResolver {
    answers = new Map<number, Outcome>();
    calls: number[] = [];
    resolve(foreground: ClaudeSessionProcess): Promise<Outcome> {
      this.calls.push(foreground.pid);
      return Promise.resolve(this.answers.get(foreground.pid) ?? { none: 'no-record' });
    }
  }

  const claude = (pid: number, commandLine = 'claude --model opus'): ChildProcess => ({
    pid,
    ppid: 1000,
    commandLine,
    startedAt: Date.now(),
  });

  type Published = { panelId: string; command: string | null; memoryCommand?: string };

  function resumeService() {
    const host = new FakeHost();
    const events = new TerminalEvents();
    const resolver = new FakeResolver();
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
      undefined,
      undefined,
      resolver,
    );
    const router = new RpcRouter();
    service.register(router);
    const published: Published[] = [];
    const frames: string[] = [];
    events.addSink({
      write: (frame: string): void => {
        frames.push(frame);
        const msg = JSON.parse(frame) as { method: string; params: Published };
        if (msg.method === 'terminal.command') published.push(msg.params);
      },
    });
    const attach = (panelId: string) =>
      router.handle({ jsonrpc: '2.0', id: 1, method: 'terminal.attach', params: { panelId, projectId: 'proj', launch, cols: 80, rows: 24 } });
    return { host, resolver, published, frames, attach };
  }

  const debugLines = (spy: ReturnType<typeof vi.spyOn>): string[] =>
    spy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('[068:resume]'));

  it('publishes the resume command beside the plain command, and republishes on a session switch (FR-041, FR-044)', async () => {
    const s = resumeService();
    await s.attach('p1');
    s.host.children = [claude(2001)];
    s.resolver.answers.set(2001, { sessionId: SESSION_A, argv: ['claude', '--model', 'opus'] });
    await sleep(200);

    expect(s.published).toEqual([
      expect.objectContaining({ command: 'claude --model opus', memoryCommand: `claude --model opus --resume ${SESSION_A}` }),
    ]);

    // Same command, the record rewritten in place: a new session.
    s.resolver.answers.set(2001, { sessionId: SESSION_B, argv: ['claude', '--model', 'opus', '--resume', SESSION_A] });
    await sleep(200);

    expect(s.published).toHaveLength(2);
    expect(s.published[1]).toMatchObject({ command: 'claude --model opus', memoryCommand: `claude --model opus --resume ${SESSION_B}` });
  });

  it('a miss publishes no memoryCommand and writes one debug line, no notice (FR-047, FR-050, FR-055)', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const s = resumeService();
    await s.attach('p1');
    s.host.children = [claude(2001)];
    s.resolver.answers.set(2001, { none: 'no-record' });
    await sleep(300); // several polls, one line

    expect(s.published).toHaveLength(1);
    expect(s.published[0]).not.toHaveProperty('memoryCommand');
    expect(debugLines(debug)).toHaveLength(1);
    expect(debugLines(debug)[0]).toContain('panel=p1 reason=no-record');
    expect(s.frames.filter((f) => /notice|notification\./.test((JSON.parse(f) as { method: string }).method))).toEqual([]);
    debug.mockRestore();
  });

  it('a later miss for the SAME process keeps the resume command; another process or session replaces it', async () => {
    const s = resumeService();
    await s.attach('p1');
    const proc = claude(2001);
    s.host.children = [proc];
    s.resolver.answers.set(2001, { sessionId: SESSION_A, argv: ['claude', '--model', 'opus'] });
    await sleep(100);
    expect(s.published).toHaveLength(1);

    // The record is mid-rewrite, or the read timed out: no answer this pass.
    s.resolver.answers.set(2001, { none: 'unreadable' });
    await sleep(200);
    expect(s.published, 'a failed read published a command without the resume one').toHaveLength(1);

    // A different process (new pid) with no record: the old session is not this one's.
    s.host.children = [claude(2002)];
    await sleep(200);
    expect(s.published.at(-1)).not.toHaveProperty('memoryCommand');
  });

  it('a different shell image is quoted for its own shell (FR-041a)', async () => {
    const s = resumeService();
    await s.attach('p1');
    s.host.children = [claude(2001, 'claude --append-system-prompt "x"')];
    s.resolver.answers.set(2001, { sessionId: SESSION_A, argv: ['claude', '--append-system-prompt', 'two words'] });
    await sleep(100);

    // The fake host starts every terminal as `C:/cmd.exe`: cmd quoting.
    expect(s.published[0]?.memoryCommand).toBe(`claude --append-system-prompt "two words" --resume ${SESSION_A}`);
  });

  it('two panels in one folder each publish their own session (FR-042)', async () => {
    const s = resumeService();
    await s.attach('p1');
    await s.attach('p2');
    // The fake host hands out shell pids 1000 and 1001; each Claude is a direct child of its own shell.
    s.host.children = [claude(2001), { ...claude(2002), ppid: 1001 }];
    s.resolver.answers.set(2001, { sessionId: SESSION_A, argv: ['claude'] });
    s.resolver.answers.set(2002, { sessionId: SESSION_B, argv: ['claude'] });
    await sleep(200);
    expect(s.published.find((p) => p.panelId === 'p1')?.memoryCommand).toBe(`claude --resume ${SESSION_A}`);
    expect(s.published.find((p) => p.panelId === 'p2')?.memoryCommand).toBe(`claude --resume ${SESSION_B}`);
  });

  it('keeps the plain command for the notification and a non-Claude agent CLI gets no memoryCommand (FR-053)', async () => {
    const s = resumeService();
    await s.attach('p1');
    for (const line of ['codex --full-auto', 'aider --model x']) {
      s.host.children = [claude(2001, line)];
      await sleep(100);
    }

    expect(s.published.map((p) => p.command)).toEqual(['codex --full-auto', 'aider --model x']);
    expect(s.published.every((p) => p.memoryCommand === undefined)).toBe(true);
    expect(s.resolver.calls).toEqual([]);
  });

  it('a Claude process that ends publishes null, with the plain command what the finish signal carried (FR-050)', async () => {
    const s = resumeService();
    await s.attach('p1');
    s.host.children = [claude(2001)];
    s.resolver.answers.set(2001, { sessionId: SESSION_A, argv: ['claude', '--model', 'opus'] });
    await sleep(200);
    s.host.children = [];
    await sleep(200);

    expect(s.published.at(-1)).toMatchObject({ command: null });
    expect(s.published.at(-1)).not.toHaveProperty('memoryCommand');
    const attention = s.frames.map((f) => JSON.parse(f) as { method: string; params: { detail?: string | null } }).filter((m) => m.method === 'terminal.attention');
    expect(attention.every((m) => !String(m.params.detail ?? '').includes('--resume'))).toBe(true);
  });
});
