import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 051 R2/R5/R8 — `NodePtyHost` ends a terminal without stopping its caller (FR-010), with a definite
 * outcome (FR-005, FR-013), reaching the console host even when the end beats its identification
 * (FR-014), and escalates by individual pid (FR-015a).
 *
 * `node:child_process` is mocked and node-pty is a fake injected through the constructor, so every
 * OS answer is scripted: when `taskkill` returns, whether it was refused, what the process table
 * holds, which hosts exist. The real processes are the contract test's job (T010).
 */

const execFileSync = vi.fn();
const execFile = vi.fn();
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync, execFile };
});
// The host starts its processes through the off-loop runner (051 FR-010); here it hands them to the mock above.
vi.mock('../../src/off-loop-exec.js', () => ({
  execFileOffLoop: (file: string, args: string[], options: unknown, callback: unknown) =>
    (execFile as unknown as (...a: unknown[]) => unknown)(file, args, options, callback),
}));

type Callback = (err: (Error & { code?: unknown }) | null, stdout?: string, stderr?: string) => void;

interface FakeProc {
  pid: number;
  exit(): void;
}

function fakePty() {
  const procs = new Map<number, FakeProc>();
  let next = 100;
  const module = {
    spawn: () => {
      const pid = next;
      next += 100;
      const exitCbs: Array<(e: { exitCode: number }) => void> = [];
      const proc = {
        pid,
        write: () => {},
        resize: () => {},
        kill: () => {},
        onData: () => ({ dispose: () => {} }),
        onExit: (cb: (e: { exitCode: number }) => void) => {
          exitCbs.push(cb);
          return { dispose: () => {} };
        },
      };
      procs.set(pid, { pid, exit: () => exitCbs.forEach((cb) => cb({ exitCode: 1 })) });
      return proc;
    },
  };
  return { module, procs };
}

/** Which OS question an `execFile` call is asking. */
function kindOf(file: string, args: string[]): 'taskkill' | 'conhosts' | 'pidtable' | 'alive' | 'other' {
  if (file === 'taskkill') return 'taskkill';
  const script = args.join(' ');
  if (script.includes('conhost.exe')) return 'conhosts';
  if (script.includes('Get-Process')) return 'alive';
  if (script.includes('ParentProcessId')) return 'pidtable';
  return 'other';
}

interface Script {
  taskkill?: (args: string[], cb: Callback) => void;
  conhosts?: string;
  pidtable?: string;
  alive?: string;
}

function scriptOs(script: Script) {
  execFile.mockImplementation((file: string, args: string[], _opts: unknown, cb: Callback) => {
    switch (kindOf(file, args)) {
      case 'taskkill':
        return (script.taskkill ?? ((_a, done) => done(null)))(args, cb);
      case 'conhosts':
        return cb(null, script.conhosts ?? '');
      case 'pidtable':
        return cb(null, script.pidtable ?? '4,0');
      case 'alive':
        return cb(null, script.alive ?? '');
      default:
        return cb(null, '');
    }
  });
}

const taskkillCalls = () =>
  execFile.mock.calls.filter(([file]) => file === 'taskkill').map(([, args]) => (args as string[]).join(' '));

async function newHost() {
  vi.resetModules();
  const { NodePtyHost } = await import('../../src/node-pty-host.js');
  const pty = fakePty();
  const host = new NodePtyHost(undefined, undefined, { pty: pty.module as never });
  const start = () => host.start({ file: 'cmd.exe', args: [], cwd: '.', cols: 80, rows: 24 });
  return { host, pty, start };
}

/** A conhost read answer: each pid created now, so it is never older than the session it serves. */
const hosts = (...pids: number[]) => pids.map((p) => `${p} ${Date.now() + 60_000}`).join('\r\n');

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  execFileSync.mockReset();
  execFile.mockReset();
});

describe('051 R2 — end()', () => {
  it('makes no synchronous OS call to start or end a terminal (FR-010)', async () => {
    scriptOs({});
    const { host, pty, start } = await newHost();
    const handle = start();
    const ended = host.end(handle, 1000);
    pty.procs.get(handle.pid)!.exit();
    await ended;
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('resolves only once the shell has been seen to exit', async () => {
    scriptOs({});
    const { host, pty, start } = await newHost();
    const handle = start();
    let settled = false;
    const ended = host.end(handle, 1000).then(() => {
      settled = true;
    });
    await flush();
    await flush();
    expect(settled).toBe(false);
    pty.procs.get(handle.pid)!.exit();
    await ended;
    expect(settled).toBe(true);
    expect(taskkillCalls()).toContain(`/PID ${handle.pid} /T /F`);
  });

  it('treats "process not found" (taskkill exit 128) as already ended', async () => {
    const { host, pty, start } = await newHost();
    const handle = start();
    scriptOs({
      taskkill: (_a, cb) => {
        pty.procs.get(handle.pid)!.exit();
        cb(Object.assign(new Error('not found'), { code: 128 }), '', 'ERROR: The process "100" not found.');
      },
    });
    await expect(host.end(handle, 1000)).resolves.toBeUndefined();
  });

  it('rejects after the limit when taskkill never returns, while the event loop keeps running', async () => {
    scriptOs({ taskkill: () => {} }); // never calls back
    const { host, start } = await newHost();
    const handle = start();
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 10);
    const started = Date.now();
    await expect(host.end(handle, 200)).rejects.toThrow(/did not end within/);
    clearInterval(timer);
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
    expect(ticks).toBeGreaterThanOrEqual(10);
  });

  it('rejects with the OS refusal when the shell does not exit', async () => {
    scriptOs({ taskkill: (_a, cb) => cb(Object.assign(new Error('failed'), { code: 1 }), '', 'ERROR: Access is denied.') });
    const { host, start } = await newHost();
    const handle = start();
    await expect(host.end(handle, 150)).rejects.toThrow(/Access is denied/);
  });

  it('returns the same promise for a second end of the same terminal', async () => {
    scriptOs({});
    const { host, pty, start } = await newHost();
    const handle = start();
    const first = host.end(handle, 1000);
    expect(host.end(handle, 1000)).toBe(first);
    pty.procs.get(handle.pid)!.exit();
    await first;
  });

  it('resolves at once for a terminal it does not hold', async () => {
    scriptOs({});
    const { host } = await newHost();
    await expect(host.end({ pid: 424242 }, 1000)).resolves.toBeUndefined();
  });
});

describe('051 — review findings 2, 4, 5', () => {
  it('a failed end is not cached: the next end runs a fresh taskkill (finding 2)', async () => {
    let refuse = true;
    scriptOs({
      taskkill: (_args, done) => (refuse ? done(Object.assign(new Error('Access is denied.'), { code: 1 })) : done(null)),
    });
    const { host, pty, start } = await newHost();
    const handle = start();
    await expect(host.end(handle, 300)).rejects.toThrow();
    const before = taskkillCalls().filter((c) => c.startsWith(`/PID ${handle.pid} `)).length;
    refuse = false;
    const again = host.end(handle, 2000);
    await vi.waitFor(() =>
      expect(taskkillCalls().filter((c) => c.startsWith(`/PID ${handle.pid} `)).length).toBeGreaterThan(before),
    );
    pty.procs.get(handle.pid)!.exit();
    await expect(again).resolves.toBeUndefined();
  });

  it('a host the first identification missed is looked for again before the exit is reaped (finding 4)', async () => {
    const answers = ['', hosts(888)]; // the first read fails to see it; the retry finds it
    execFile.mockImplementation((file: string, args: string[], _o: unknown, cb: Callback) => {
      if (kindOf(file, args) === 'conhosts') return cb(null, answers.shift() ?? '');
      return cb(null, '');
    });
    const { pty, start } = await newHost();
    const handle = start();
    await flush();
    pty.procs.get(handle.pid)!.exit();
    await vi.waitFor(() => expect(taskkillCalls()).toContain('/PID 888 /T /F'));
  });

  it('a failed table read makes the attached request reject — unknown, never "nothing attached" (finding 5)', async () => {
    const { host, start } = await newHost();
    const handle = start();
    execFile.mockImplementation((_file: string, args: string[], _o: unknown, cb: Callback) => {
      if (args.includes('-e')) return cb(null, JSON.stringify({ [handle.pid]: [handle.pid, 900] }));
      if (args.join(' ').includes('ConvertTo-Json')) return cb(new Error('CIM refused'));
      return cb(null, '');
    });
    await expect(host.listAttachedProcesses([handle])).rejects.toThrow();
    // …while the child list for command memory still reads a failure as "none" (025 FR-019e).
    await expect(host.listChildProcesses(handle)).resolves.toEqual([]);
  });
});

describe('051 FR-014 — an end reaches what is attached, not only the shell tree', () => {
  it('ends a re-parented command attached to the console, never the console host or this process', async () => {
    const { host, pty, start } = await newHost();
    const handle = start();
    execFile.mockImplementation((file: string, args: string[], _o: unknown, cb: Callback) => {
      if (args.includes('-e')) return cb(null, JSON.stringify({ [handle.pid]: [handle.pid, 900, 555, process.pid] }));
      if (kindOf(file, args) === 'conhosts') return cb(null, hosts(555));
      return cb(null, '');
    });
    await vi.waitFor(() => expect(execFile.mock.calls.some(([, a]) => String(a).includes('conhost.exe'))).toBe(true));
    await flush();
    const ending = host.end(handle, 2000);
    await vi.waitFor(() => expect(taskkillCalls()).toContain('/PID 900 /T /F'));
    pty.procs.get(handle.pid)!.exit();
    await ending;
    expect(taskkillCalls()).toContain(`/PID ${handle.pid} /T /F`);
    expect(taskkillCalls().filter((c) => c.startsWith(`/PID ${process.pid} `))).toEqual([]);
    // The host is reaped after the exit, as always — not killed early as if it were a command.
    expect(taskkillCalls().indexOf('/PID 555 /T /F')).toBeGreaterThan(taskkillCalls().indexOf('/PID 900 /T /F'));
  });

  it('a helper that fails or hangs does not hold the end: the shell is ended anyway', async () => {
    const { host, pty, start } = await newHost();
    const handle = start();
    execFile.mockImplementation((_file: string, args: string[], _o: unknown, cb: Callback) => {
      if (args.includes('-e')) return; // never answers
      return cb(null, '');
    });
    const ending = host.end(handle, 4000);
    await vi.waitFor(() => expect(taskkillCalls()).toContain(`/PID ${handle.pid} /T /F`), { timeout: 2000 });
    pty.procs.get(handle.pid)!.exit();
    await expect(ending).resolves.toBeUndefined();
  });
});

describe('051 R5 — the console host is reached (FR-014)', () => {
  it('ends the attributed host after the shell exits', async () => {
    scriptOs({ conhosts: hosts(555) });
    const { host, pty, start } = await newHost();
    const handle = start();
    const ended = host.end(handle, 1000);
    pty.procs.get(handle.pid)!.exit();
    await ended;
    expect(taskkillCalls()).toContain('/PID 555 /T /F');
  });

  it('reaps the host of a shell that exits on its own', async () => {
    scriptOs({ conhosts: hosts(777) });
    const { pty, start } = await newHost();
    const handle = start();
    pty.procs.get(handle.pid)!.exit();
    await vi.waitFor(() => expect(taskkillCalls()).toContain('/PID 777 /T /F'));
  });

  it('identifies hosts from a snapshot taken after the spawn, never a reused earlier one', async () => {
    const answers = [hosts(10), hosts(10, 20)];
    execFile.mockImplementation((file: string, args: string[], _o: unknown, cb: Callback) => {
      if (kindOf(file, args) === 'conhosts') return cb(null, answers.shift() ?? '');
      return cb(null, '');
    });
    const { host, pty, start } = await newHost();
    const a = start();
    await flush();
    const b = start();
    const endA = host.end(a, 1000);
    const endB = host.end(b, 1000);
    pty.procs.get(a.pid)!.exit();
    pty.procs.get(b.pid)!.exit();
    await Promise.all([endA, endB]);
    expect(taskkillCalls()).toEqual(expect.arrayContaining(['/PID 10 /T /F', '/PID 20 /T /F']));
  });

  it("a terminal spawned while hosts are being read never gives an earlier one its host", async () => {
    // Terminal A's pass starts reading; B spawns before the read answers, and the answer holds both
    // hosts. Pairing the newest host with A made ending A end B's console.
    let answer!: (out: string) => void;
    execFile.mockImplementation((file: string, args: string[], _o: unknown, cb: Callback) => {
      if (kindOf(file, args) === 'conhosts') {
        if (!answer) answer = (out) => cb(null, out);
        else cb(null, hosts(10, 20));
        return;
      }
      return cb(null, '');
    });
    const { host, pty, start } = await newHost();
    const a = start();
    await vi.waitFor(() => expect(answer).toBeDefined());
    start();
    const now = Date.now();
    answer(`10 ${now}\r\n20 ${now + 5}`);
    const endA = host.end(a, 1000);
    pty.procs.get(a.pid)!.exit();
    await endA;
    expect(taskkillCalls()).toContain('/PID 10 /T /F');
    expect(taskkillCalls()).not.toContain('/PID 20 /T /F');
  });
});

describe('051 R8 — forceEnd()', () => {
  it('ends the whole tree by individual pid, reaching descendants of a shell that already exited', async () => {
    // Shell 100 has exited (absent from the table); its child 150 and grandchild 160 still run and
    // still name it. `taskkill /T /PID 100` finds nothing; the table walk reaches both. Conhost 555.
    // 170 is an unrelated program older than the shell whose stale ppid names it (#280): never a target.
    const later = Date.now() + 60_000;
    scriptOs({
      conhosts: hosts(555),
      pidtable: [`150,100,${later}`, `160,150,${later + 1}`, `999,1,${later}`, `170,100,1000`, `171,170,1100`].join('\r\n'),
    });
    const { host, start } = await newHost();
    const handle = start();
    await flush();
    await flush();
    const { survivors } = await host.forceEnd(handle, 1000);
    expect(taskkillCalls()).toEqual(
      expect.arrayContaining(['/PID 100 /F', '/PID 150 /F', '/PID 160 /F', '/PID 555 /F']),
    );
    for (const stranger of [999, 170, 171]) expect(taskkillCalls()).not.toContain(`/PID ${stranger} /F`);
    expect(survivors).toEqual([]);
  });

  it('walks nothing from a pid that is no longer a known shell — it may have been recycled', async () => {
    scriptOs({ pidtable: `150,4242,${Date.now() + 60_000}` });
    const { host } = await newHost();
    await expect(host.forceEnd({ pid: 4242 }, 1000)).resolves.toEqual({ survivors: [] });
    expect(taskkillCalls()).toEqual([]);
  });

  it('reports what is still alive afterwards, by pid and name', async () => {
    scriptOs({ pidtable: '100,1', alive: '100,cmd' });
    const { host, start } = await newHost();
    const handle = start();
    const { survivors } = await host.forceEnd(handle, 1000);
    expect(survivors).toEqual([{ pid: 100, name: 'cmd' }]);
  });

  it('never rejects when the process table cannot be read', async () => {
    execFile.mockImplementation((_f: string, _a: string[], _o: unknown, cb: Callback) => cb(new Error('CIM refused')));
    const { host, start } = await newHost();
    const handle = start();
    await expect(host.forceEnd(handle, 200)).resolves.toEqual({ survivors: [] });
  });
});
