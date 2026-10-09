import { createRequire } from 'node:module';
import { execFileOffLoop } from './off-loop-exec.js';
import process from 'node:process';
import {
  TERMINAL_END_TIMEOUT_MS,
  assignConhosts,
  escalationTargets,
  passthroughDeElevator,
  sanitizeSpawnEnv,
  shouldDeElevate,
  type IDeElevator,
  type IElevationState,
  type ChildProcess,
  type IPtyHost,
  type ProcessSurvivor,
  type PtyHandle,
  type PtyStartOptions,
} from '@throng/core';
import { dropInheritedModulePath } from './spawn-env-windows.js';
import { descendantsOf, type ProcessTreeRow } from './process-tree.js';
import { ATTACHED_HELPER_SOURCE, readAttachedProcesses } from './attached-processes.js';
import { createExecutableArchReader } from './executable-arch.js';

/**
 * Windows `IPtyHost` (005 Phase C) over node-pty/ConPTY, owned by the **daemon**.
 *
 * IMPORTANT: node-pty (a native module built for plain host Node) is required
 * **lazily in the constructor**, never at module top level — so importing this
 * package's barrel into the Electron main process does NOT load the native
 * binary (which would mismatch Electron's ABI). Only the daemon, which constructs
 * `NodePtyHost`, loads node-pty.
 */

interface NodePty {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

export interface NodePtyModule {
  spawn(
    file: string,
    args: string[] | string,
    options: {
      cwd: string;
      cols: number;
      rows: number;
      env?: NodeJS.ProcessEnv;
      name?: string;
      /** #298 — use the conpty.dll node-pty ships rather than the host Windows build's. */
      useConptyDll?: boolean;
    },
  ): NodePty;
}

/** A live PTY the host owns, plus the metadata needed to reap its OS resources. */
interface Session {
  readonly proc: NodePty;
  /** Spawn order — lets us attribute conhosts positionally (created in spawn order). */
  readonly seq: number;
  /** Epoch ms read just before the spawn: no host created earlier can be this session's (051 R5). */
  readonly spawnedAt: number;
  /**
   * The OS pid of this terminal's `conhost.exe` host (a child of THIS process, a
   * sibling of the shell). Discovered shortly after spawn. Needed because when a
   * shell exits on its own, node-pty 1.1.0 never closes the pseudoconsole and the
   * conhost can no longer be reaped via node-pty — so we taskkill it by pid.
   */
  conhostPid: number | null;
  /** Settles once an attribution pass that started AFTER this spawn has run (051 FR-014). */
  conhostReady: Promise<void>;
  /** Resolves when the shell's exit is observed. */
  readonly exited: Promise<void>;
  /** Resolves once, after the exit, the host has been reaped. */
  reaped: Promise<void>;
  /** The in-flight end, so a second request returns the same outcome. */
  ending: Promise<void> | null;
}

/** What `NodePtyHost` can be handed instead of the real thing — node-pty itself, and the limit. */
export interface NodePtyHostDeps {
  /** node-pty, or a stand-in for tests. Loaded lazily from `node-pty` when absent. */
  pty?: NodePtyModule;
  /** The limit for every OS request this host makes on its own behalf (051 FR-013a). */
  timeoutMs?: number;
}

/** Resolve `true` if `promise` settles within `ms`, `false` otherwise; never rejects. */
function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  if (ms <= 0) return Promise.race([promise.then(() => true, () => true), Promise.resolve(false)]);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

const inSeconds = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s === 1 ? '1 second' : `${s} seconds`;
};

export class NodePtyHost implements IPtyHost {
  private readonly pty: NodePtyModule;
  private readonly limitMs: number;
  private readonly sessions = new Map<number, Session>();
  private seqCounter = 0;
  /** Hosts of exited sessions whose reap is still running — never candidates for a new session. */
  private readonly reaping = new Set<number>();
  /** Attribution passes run one at a time, each on a fresh snapshot (051 R5). */
  private attribution: Promise<void> = Promise.resolve();
  private readonly archReader = createExecutableArchReader();

  /**
   * @param elevation reports whether the daemon itself is elevated (FR-025a).
   * @param deElevator OS mechanism that rewrites a launch to run de-elevated
   *   (FR-025c mixed mode). Defaults to the no-op passthrough — in which case an
   *   elevated daemon spawns every terminal elevated (the pre-mixed-mode behaviour).
   * @param deps node-pty and the request limit; production passes neither.
   */
  constructor(
    private readonly elevation?: IElevationState,
    private readonly deElevator: IDeElevator = passthroughDeElevator,
    deps: NodePtyHostDeps = {},
  ) {
    this.limitMs = deps.timeoutMs ?? TERMINAL_END_TIMEOUT_MS;
    if (deps.pty) {
      this.pty = deps.pty;
    } else {
      const require = createRequire(import.meta.url);
      this.pty = require('node-pty') as NodePtyModule;
    }
  }

  start(opts: PtyStartOptions): PtyHandle {
    // Mixed mode (FR-025c): in an ELEVATED daemon a terminal NOT requested "as
    // admin" must run de-elevated (medium integrity). node-pty always spawns with
    // the daemon's own token, so we rewrite the launch through the OS de-elevator
    // (a shell-token CreateProcessWithTokenW shim on Windows) — node-pty then spawns
    // that wrapped spec normally. A `runAsAdmin` terminal, or a non-elevated daemon,
    // spawns unchanged.
    const hostElevated = this.elevation?.isElevated() === true;
    let file = opts.file;
    let args = opts.args;
    if (shouldDeElevate(opts.runAsAdmin === true, hostElevated) && this.deElevator.isAvailable()) {
      ({ file, args } = this.deElevator.wrap({ file, args }));
    }
    // node-pty appends a STRING args verbatim after the quoted executable, which is the only way
    // to give cmd the user's own quoting intact (it never un-escapes a quoted argv entry).
    const spawnArgs: string[] | string =
      opts.commandLine !== undefined && file === opts.file ? opts.commandLine : args;
    const spawnedAt = Date.now();
    const proc = this.pty.spawn(file, spawnArgs, {
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      // Strip THRONG_* so a spawned shell — and anything it launches (`npm start`) — never
      // inherits THIS daemon's pipe/db/config identity. Otherwise a dev build launched from a
      // terminal inside another throng would target that throng's daemon and retire it. Any
      // explicit per-launch env still layers on top.
      /*
       * The BASE is the launcher's environment when one was sent, not this process's (#209).
       *
       * `process.env` here is the DAEMON's, frozen when it was spawned and outliving every UI that
       * has since adopted it. Preferring the environment UI main captured at attach time is what
       * stops a variable from a session that ended days ago reaching a shell started today.
       *
       * Still sanitised either way: `THRONG_*` must not reach a user's shell whichever process the
       * environment came from (#172).
       */
      /*
       * `dropInheritedModulePath` is the Windows half of the same rule (#367). PowerShell 7 exports
       * its own PSModulePath to everything it spawns, so throng launched from a `pwsh` session
       * would otherwise hand every terminal a module path whose first entries are PS7's — and a
       * `powershell.exe` panel then silently loses PSReadLine: no history, no completion, no
       * syntax colouring, and no error saying why.
       *
       * It lives here rather than in `sanitizeSpawnEnv` because it names a Windows concept and
       * core is platform-abstracted (Principle II). Applied AFTER, so an explicit per-launch
       * `opts.env` can still set one deliberately.
       */
      env: {
        ...dropInheritedModulePath(sanitizeSpawnEnv(opts.baseEnv ?? process.env)),
        ...(opts.env ?? {}),
      },
      name: 'xterm-256color',
      /*
       * #298 — `useConptyDll` WAS TRIED HERE AND REJECTED. Do not re-enable it without reading this.
       *
       * node-pty defaults it to false, so throng uses the SYSTEM ConPTY and a terminal's behaviour
       * tracks the host Windows build. That is a real defect and it has a real cost. Measured, same
       * commit and fixture, from the terminal diagnostics captured on a CI failure:
       *
       *   Windows 11 (26200)     private modes observed: 9001, 1004, 25, 1049   altBuffer=true
       *   windows-2022 (20348)   private modes observed: 25                     altBuffer=false
       *
       * The application's alternate-screen switch never arrives on the older host — that ConPTY
       * manages the alt screen itself and synthesises its own output. throng reads that switch to
       * decide who owns the keyboard (`use-terminal.ts`), so on such a host a full-screen program
       * that negotiates nothing loses Ctrl+End and Ctrl+Home to throng's scrollback. Mode 25 is
       * ConPTY's own cursor-visibility, not the program's, which is why this is not "modes are
       * stripped" and why the kitty negotiation (a CSI > u sequence) still gets through.
       *
       * Switching to the bundled conpty 1.23.251008001 fixes that and BREAKS MORE THAN IT FIXES.
       * A/B on `panel-auto-naming.e2e.ts`, one worker, no retries, run in BOTH orders to rule out
       * cold cache:
       *
       *   useConptyDll: false    5 passed (20.4s)
       *   useConptyDll: true     4 failed, 1 passed (1.3 min)
       *
       * Terminal auto-naming and reattach go with it, and the whole file slows by roughly 4x. The
       * OSC title itself still arrives (probed directly: `C:\WINDOWS\system32\cmd.exe` at rest,
       * and `title ZZPROBE` updates it live), so the failures are timing, not a lost signal — but
       * they are failures either way, and they would hit EVERY user, where the bug they fix only
       * bites on older hosts.
       *
       * If this is revisited: `conhostChildren` below and the two test-side copies already match
       * `OpenConsole.exe` as well as `conhost.exe`, which the bundled host needs — without that the
       * reaper leaks one host process per terminal, and `terminal-no-orphans` catches it at three
       * @core tests.
       */
    });
    let observeExit!: () => void;
    const session: Session = {
      proc,
      seq: this.seqCounter++,
      spawnedAt,
      conhostPid: null,
      conhostReady: Promise.resolve(),
      exited: new Promise<void>((resolve) => (observeExit = resolve)),
      reaped: Promise.resolve(),
      ending: null,
    };
    this.sessions.set(proc.pid, session);
    proc.onExit(() => {
      observeExit();
      // The shell exited — on its own, or because `end` asked. node-pty 1.1.0 never closes the
      // pseudoconsole for an exited shell, so its conhost.exe host would leak: reap it by the pid
      // attributed at spawn, once that attribution has run (051 FR-014).
      session.reaped = this.reapAfterExit(proc.pid, session);
    });
    // Discover this terminal's conhost pid now, while it is unambiguous — but on an ASYNC snapshot
    // (051 R5): the synchronous scan this replaced stopped every terminal for ~0.6 s per start.
    session.conhostReady = this.queueAttribution();
    return { pid: proc.pid };
  }

  /** Remove the exited session and end its host, after the session's attribution has run. */
  private async reapAfterExit(pid: number, session: Session): Promise<void> {
    await session.conhostReady;
    // The pass that should have found it may have failed (a timed-out table read); one more, while
    // the session is still listed as pending, so its host is not left behind (review finding 4).
    if (session.conhostPid === null) await this.queueAttribution();
    const host = session.conhostPid;
    if (host !== null) this.reaping.add(host);
    if (this.sessions.get(pid) === session) this.sessions.delete(pid);
    if (host === null) return;
    await this.taskkill(host, true, this.limitMs).catch(() => {});
    this.reaping.delete(host);
  }

  /**
   * Queue one attribution pass. Passes run one at a time and each reads a FRESH table started after
   * every spawn it serves — a table read before a spawn cannot contain that spawn's host.
   */
  private queueAttribution(): Promise<void> {
    const pass = this.attribution.then(() => this.attributeConhosts());
    this.attribution = pass.catch(() => {});
    return this.attribution;
  }

  /** Attribute this process's not-yet-known console hosts to pending sessions (`assignConhosts`). */
  private async attributeConhosts(): Promise<void> {
    if (![...this.sessions.values()].some((s) => s.conhostPid === null)) return;
    const hosts = await conhostChildren(process.pid, this.limitMs);
    // Listed AFTER the read, so a terminal that spawned during it is pending too: every host in the
    // table then belongs to a listed session or to none, which is what `assignConhosts` relies on.
    const pending = [...this.sessions.values()].filter((s) => s.conhostPid === null);
    const claimed = new Set([
      ...[...this.sessions.values()].map((s) => s.conhostPid).filter((p): p is number => p !== null),
      ...this.reaping,
    ]);
    const assigned = assignConhosts(pending, hosts, claimed);
    for (const session of pending) {
      const pid = assigned.get(session.seq);
      if (pid !== undefined) session.conhostPid = pid;
    }
  }

  /**
   * `taskkill /F` one pid — with its tree by default. Resolves when the OS has carried it out or the
   * process was already gone (exit 128); rejects with the OS's own words otherwise (051 FR-013).
   */
  private taskkill(pid: number, tree: boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      execFileOffLoop(
        'taskkill',
        ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'],
        { windowsHide: true, timeout: Math.max(1, timeoutMs), encoding: 'utf8' },
        (error, _stdout, stderr) => {
          if (!error) return resolve();
          if ((error as { code?: unknown }).code === 128) return resolve(); // not found: already gone
          reject(new Error(String(stderr || error.message).trim() || 'the operating system refused to end it'));
        },
      );
    });
  }

  write(handle: PtyHandle, data: string): void {
    this.sessions.get(handle.pid)?.proc.write(data);
  }

  resize(handle: PtyHandle, cols: number, rows: number): void {
    try {
      this.sessions.get(handle.pid)?.proc.resize(cols, rows);
    } catch {
      /* a dead/closing pty rejects resize — safe to ignore */
    }
  }

  /**
   * End the terminal (051 R2): a HIDDEN `taskkill /T` of the shell takes the shell and its running
   * command (FR-018) — node-pty's own kill() forks a console-list helper that flashes a console per
   * kill. node-pty then observes the exit, and the host reaps the conhost: `taskkill` of the shell
   * does not reach it, because the conhost is a sibling under THIS process, not a child of the shell.
   *
   * Nothing here blocks: the outcome arrives as the promise settling, within `timeoutMs`.
   */
  end(handle: PtyHandle, timeoutMs: number): Promise<void> {
    const session = this.sessions.get(handle.pid);
    if (!session) return Promise.resolve();
    if (!session.ending) {
      const ending: Promise<void> = this.runEnd(handle.pid, session, timeoutMs).catch((error: unknown) => {
        // Only an end in flight is shared. A failed one must not answer every later request with the
        // same old refusal and no taskkill (review finding 2).
        if (session.ending === ending) session.ending = null;
        throw error;
      });
      session.ending = ending;
    }
    return session.ending;
  }

  private async runEnd(pid: number, session: Session, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let refusal: Error | null = null;
    // FR-014 / Principle III: a command its shell started through a launcher that has already exited
    // is attached to the terminal's console but outside the shell's tree, so `taskkill /T` of the
    // shell never reaches it — and it outlived every end (found by command-memory-attached). Asked
    // BEFORE the shell goes, because the console can only be named through a living process.
    const attached = await attachedPids(pid, Math.min(ATTACHED_READ_LIMIT_MS, timeoutMs / 2));
    // Not awaited on its own: a taskkill that never returns must not outlast the limit.
    void this.taskkill(pid, true, Math.max(1, deadline - Date.now())).catch((error: Error) => {
      refusal = error;
    });
    for (const other of attached) {
      if (other === pid || other === session.conhostPid || other === process.pid) continue;
      void this.taskkill(other, true, Math.max(1, deadline - Date.now())).catch(() => {});
    }
    // A refusal is only final if the shell is still there: taskkill /T also reports children it
    // could not reach, while the shell itself is gone.
    if (!(await within(session.exited, deadline - Date.now()))) {
      throw refusal ?? new Error(`did not end within ${inSeconds(timeoutMs)}`);
    }
    // FR-014: the host is ended after the exit, once identified — even if the end beat the
    // identification. Bounded by the same limit; past it, the exit handler still reaps the host.
    await within(session.reaped, deadline - Date.now());
  }

  /**
   * Escalation (051 FR-015a). Reads ONE fresh process table, ends every target individually and
   * forcibly — no `/T`: the targets already ARE the tree, walked by parent pid so a shell that has
   * already exited does not hide its descendants — then asks which of them is still alive.
   */
  async forceEnd(handle: PtyHandle, timeoutMs: number): Promise<{ survivors: ProcessSurvivor[] }> {
    const session = this.sessions.get(handle.pid);
    // Without the session, the pid is not known to be this host's shell any more — it may have been
    // recycled — so nothing is walked from it (review finding 3). Its exit has already been reaped.
    if (!session) return { survivors: [] };
    let rows: ProcessTreeRow[] = [];
    try {
      rows = [...(await readPidTable(timeoutMs)).values()].flat();
    } catch (error) {
      console.warn(`[terminal] forced end of ${handle.pid}: the process table could not be read (${String(error)})`);
    }
    const targets = escalationTargets(rows, handle.pid, session.conhostPid, process.pid, session.spawnedAt);
    await Promise.all(targets.map((pid) => this.taskkill(pid, false, timeoutMs).catch(() => {})));
    return { survivors: await aliveAmong(targets, timeoutMs) };
  }

  /**
   * Release every live PTY (shutdown, 051 FR-015a): end each, escalate any end that fails, log what
   * survives. Then reap any conhost.exe host of ours never attributed to a session (e.g. one spawned
   * moments before shutdown), so exiting never leaves an orphaned pseudoconsole host behind.
   */
  async dispose(): Promise<void> {
    await Promise.all(
      [...this.sessions.keys()].map(async (pid) => {
        try {
          await this.end({ pid }, this.limitMs);
        } catch {
          const { survivors } = await this.forceEnd({ pid }, this.limitMs);
          logSurvivors(survivors);
        }
      }),
    );
    this.sessions.clear();
    const hosts = await conhostChildren(process.pid, this.limitMs);
    await Promise.all(hosts.map(({ pid }) => this.taskkill(pid, true, this.limitMs).catch(() => {})));
  }

  onData(handle: PtyHandle, cb: (chunk: string) => void): () => void {
    const session = this.sessions.get(handle.pid);
    if (!session) return () => {};
    const sub = session.proc.onData(cb);
    return () => sub.dispose();
  }

  onExit(handle: PtyHandle, cb: (e: { code: number | null; signal?: string }) => void): () => void {
    const session = this.sessions.get(handle.pid);
    if (!session) return () => {};
    const sub = session.proc.onExit((e) =>
      cb({ code: e.exitCode, signal: e.signal !== undefined ? String(e.signal) : undefined }),
    );
    return () => sub.dispose();
  }

  /**
   * 046 (Unload), 051 FR-011 — descendant pids from an ASYNC snapshot shared by every terminal asked
   * about together, REJECTING when the table cannot be read.
   *
   * A snapshot costs 0.55–0.7 s (`Get-CimInstance Win32_Process`, five cold runs); the synchronous
   * per-terminal scan this replaced froze the daemon's one event loop — every terminal's output —
   * for ~2 s with three terminals. A failure is never `[]`: that is what an idle shell looks like,
   * and Unload would end a running process on it.
   */
  probeChildPids(handle: PtyHandle): Promise<number[]> {
    return pidTableSnapshot().then((byParent) => descendantsOf(byParent, handle.pid).map((row) => row.pid));
  }

  /**
   * 025 FR-019/FR-022. Async — this runs on a repeating observation, and the daemon is
   * single-threaded, so it must never block the event loop (FR-019b).
   *
   * Resolves to `[]` on any failure so a bad snapshot leaves the last known command in place
   * rather than clearing it (FR-019e).
   */
  async listChildProcesses(handle: PtyHandle): Promise<ChildProcess[]> {
    return descendantProcesses(handle.pid);
  }

  /** 051 FR-040/FR-041 — one hidden helper run for every handle (`attached-processes.ts`). */
  listAttachedProcesses(handles: readonly PtyHandle[]): Promise<Map<number, ChildProcess[]>> {
    return readAttachedProcesses(
      handles.map((h) => h.pid),
      runAttachedHelper,
      async () => {
        const byPid = new Map<number, ChildProcess>();
        for (const rows of (await processSnapshot(Date.now())).values()) for (const r of rows) byPid.set(r.pid, r);
        return byPid;
      },
    );
  }

  /** 053 `{arch}` — the PE header's machine field, cached by path for this host's life. */
  executableArch(path: string): Promise<string | null> {
    return this.archReader(path);
  }
}

/** How long an end waits to learn what is attached before it ends the shell anyway. */
const ATTACHED_READ_LIMIT_MS = 1000;

/**
 * The pids attached to one shell's console, for an end (FR-014). `[]` when the helper fails or is
 * slower than `limitMs`: an end never waits on this past its bound, it only ends less.
 */
async function attachedPids(shellPid: number, limitMs: number): Promise<number[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<number[]>((resolve) => {
    timer = setTimeout(() => resolve([]), limitMs);
  });
  const read = runAttachedHelper([shellPid])
    .then((out) => {
      const pids = (JSON.parse(out) as Record<string, number[] | null>)[String(shellPid)];
      return Array.isArray(pids) ? pids : [];
    })
    .catch(() => []);
  const pids = await Promise.race([read, late]);
  clearTimeout(timer);
  return pids;
}

/** The attached-process helper, as a hidden node process off this event loop (051 FR-010). */
function runAttachedHelper(shellPids: readonly number[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let koffiPath: string;
    try {
      koffiPath = createRequire(import.meta.url).resolve('koffi');
    } catch (error) {
      reject(error);
      return;
    }
    execFileOffLoop(
      process.execPath,
      ['-e', ATTACHED_HELPER_SOURCE, koffiPath, ...shellPids.map(String)],
      {
        encoding: 'utf8',
        timeout: TERMINAL_END_TIMEOUT_MS,
        windowsHide: true,
        // Sanitised like every environment this host hands a child (#172); run as plain node.
        env: { ...sanitizeSpawnEnv(process.env), ELECTRON_RUN_AS_NODE: '1' },
      },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout))),
    );
  });
}


/**
 * A process's stdout, as a promise — the only way this host asks the OS anything (051 FR-010). Like every process
 * this host starts, it is started on a worker thread (`off-loop-exec.ts`): a start is synchronous, measured at
 * 60-230 ms while terminals end, and on this loop it held every terminal's input and output.
 */
function run(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFileOffLoop(
      file,
      args,
      { encoding: 'utf8', timeout: Math.max(1, timeoutMs), windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout))),
    );
  });
}

/**
 * The `conhost.exe` / `OpenConsole.exe` `--headless` processes that are direct children of
 * `parentPid`, with their OS creation time in epoch ms. Each corresponds to one ConPTY the process
 * owns. A failed read is no hosts — attribution simply retries on the next pass.
 */
async function conhostChildren(
  parentPid: number,
  timeoutMs: number,
): Promise<Array<{ pid: number; createdAt: number }>> {
  try {
    const out = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'conhost.exe' -or $_.Name -eq 'OpenConsole.exe') -and $_.ParentProcessId -eq ${parentPid} -and $_.CommandLine -match '--headless' } | ForEach-Object { "$($_.ProcessId) $(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }`,
      ],
      timeoutMs,
    );
    return out
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/).map(Number))
      .filter(([pid, at]) => Number.isFinite(pid) && pid! > 0 && Number.isFinite(at))
      .map(([pid, at]) => ({ pid: pid!, createdAt: at! }));
  } catch {
    return [];
  }
}

/**
 * Which of `pids` is still running, with its image name (051 FR-015a's survivor report). An empty
 * answer on failure, with a warning: the caller has already done everything it can.
 */
async function aliveAmong(pids: number[], timeoutMs: number): Promise<ProcessSurvivor[]> {
  if (pids.length === 0) return [];
  try {
    const out = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        // `exit 0`: a pid that is already gone makes Get-Process exit 1 even when told to be silent,
        // and a mostly-ended tree is exactly when this runs — that is the answer, not a failure.
        `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id),$($_.ProcessName)" }; exit 0`,
      ],
      timeoutMs,
    );
    const survivors: ProcessSurvivor[] = [];
    for (const line of out.split(/\r?\n/)) {
      const comma = line.indexOf(',');
      const pid = Number(line.slice(0, comma));
      if (comma > 0 && Number.isFinite(pid)) survivors.push({ pid, name: line.slice(comma + 1).trim() });
    }
    return survivors;
  } catch (error) {
    console.warn(`[terminal] could not check what survived a forced end (${String(error)})`);
    return [];
  }
}

/** FR-015a — a process still running after escalation goes to the log by pid and name. */
export function logSurvivors(survivors: ProcessSurvivor[]): void {
  for (const { pid, name } of survivors) {
    console.warn(`[terminal] still running after a forced end: pid ${pid} (${name || 'unknown'})`);
  }
}

const PID_TABLE_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }',
];
/** A snapshot's own cap (051 FR-013a). One measured at 0.55–0.7 s; past this the answer is "unknown" (busy). */
const PID_TABLE_TIMEOUT_MS = TERMINAL_END_TIMEOUT_MS;

/** One FRESH pid table, never shared — escalation must see the tree as it is now. */
async function readPidTable(timeoutMs: number): Promise<Map<number, ProcessTreeRow[]>> {
  return parsePidTable(await run('powershell.exe', PID_TABLE_ARGS, timeoutMs));
}

/**
 * `pid,ppid` lines → a parent-indexed table. THROWS on a table with no rows: every live system has
 * processes, so an empty answer means the snapshot failed, and reading it as "no children" would
 * call a busy terminal idle (046 review #2).
 */
function parsePidTable(csv: string): Map<number, ProcessTreeRow[]> {
  const childrenByParent = new Map<number, ProcessTreeRow[]>();
  for (const line of csv.split(/\r?\n/)) {
    const [pidText, ppidText, startText] = line.trim().split(',');
    if (ppidText === undefined) continue;
    const pid = Number(pidText);
    const ppid = Number(ppidText);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    const started = Number(startText);
    const row = Number.isFinite(started) && started > 0 ? { pid, ppid, startedAt: started } : { pid, ppid };
    const list = childrenByParent.get(ppid);
    if (list) list.push(row);
    else childrenByParent.set(ppid, [row]);
  }
  if (childrenByParent.size === 0) throw new Error('the process table came back empty');
  return childrenByParent;
}

/**
 * The pid table shared by every {@link NodePtyHost.probeChildPids} call made together (046 review
 * #1). A call arriving while a snapshot is in flight, or within {@link PID_TABLE_SHARE_MS} of one
 * finishing, gets that snapshot; one arriving later takes a fresh one, so the sharing collapses ONE
 * `list` or `closeIdle` and never serves a stale table to the next. A failure is shared only with
 * the callers already waiting on it.
 */
const PID_TABLE_SHARE_MS = 250;
let pidTableInFlight: Promise<Map<number, ProcessTreeRow[]>> | null = null;
let pidTableSettledAt = 0;

function pidTableSnapshot(): Promise<Map<number, ProcessTreeRow[]>> {
  const fresh = pidTableSettledAt === 0 || Date.now() - pidTableSettledAt < PID_TABLE_SHARE_MS;
  if (pidTableInFlight && fresh) return pidTableInFlight;
  pidTableSettledAt = 0;
  const snapshot = new Promise<string>((resolve, reject) => {
    execFileOffLoop(
      'powershell.exe',
      PID_TABLE_ARGS,
      { encoding: 'utf8', timeout: PID_TABLE_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout))),
    );
  }).then(parsePidTable);
  pidTableInFlight = snapshot;
  snapshot.then(
    () => {
      if (pidTableInFlight === snapshot) pidTableSettledAt = Date.now();
    },
    () => {
      // A failure is shared only with the callers already waiting on it; the next call tries again.
      if (pidTableInFlight === snapshot) pidTableInFlight = null;
    },
  );
  return snapshot;
}

/**
 * All live descendant processes of `rootPid`, with their command lines and start times
 * (025 FR-022). Async and non-blocking by contract — see `listChildProcesses`.
 *
 * One snapshot serves the whole tree walk, and the caller batches by terminal, so cost does not
 * scale with the number of open terminals (FR-019a). `Get-CimInstance` is asked for the four
 * fields capture needs; `CommandLine` is null for processes this user cannot inspect, which is
 * reported as an empty string rather than dropping the row.
 */
/**
 * The last process snapshot, shared across terminals within one polling pass (025 FR-019a).
 *
 * Without this, the daemon's per-terminal fan-out spawns one `powershell.exe` PER TERMINAL PER
 * INTERVAL, each enumerating and JSON-serialising the entire system process table — ten terminals
 * meant ten PowerShell cold starts a second. FR-019a requires that ten terminals cost no more to
 * track than one, so concurrent and near-simultaneous callers share a single in-flight snapshot.
 *
 * The TTL is deliberately short: it exists to collapse ONE polling pass, not to cache across
 * passes, so the staleness the caller sees is still bounded by its own interval (FR-019d).
 */
const SNAPSHOT_TTL_MS = 250;
let snapshotAt = 0;
let snapshotInFlight: Promise<Map<number, ChildProcess[]>> | null = null;

/** One process table, indexed by parent pid. Shared; callers must not mutate it. */
async function processSnapshot(now: number): Promise<Map<number, ChildProcess[]>> {
  if (snapshotInFlight && now - snapshotAt < SNAPSHOT_TTL_MS) return snapshotInFlight;
  snapshotAt = now;
  snapshotInFlight = readProcessTable();
  return snapshotInFlight;
}

/**
 * Every C0 control character. Windows PowerShell's `ConvertTo-Json` leaves some of them raw — 0x1A
 * (SUB) for one — and a raw one inside a string is invalid JSON, so one command line ANYWHERE on the
 * machine (a Claude Code background session started with a multi-line prompt carries one) failed the
 * whole parse and every terminal's command read as nothing. The ones it does escape arrive as `\r` /
 * `\n` text and are untouched; between tokens a space is equivalent.
 */
const RAW_CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}]`, 'g');

async function readProcessTable(): Promise<Map<number, ChildProcess[]>> {
  let json: string;
  try {
    json = await new Promise<string>((resolve, reject) =>
      execFileOffLoop(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate,ExecutablePath | ConvertTo-Json -Compress",
        ],
        { timeout: TERMINAL_END_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    );
  } catch (error) {
    throw new Error('the process table could not be read', { cause: error });
  }
  return parseProcessTable(json);
}

/**
 * The `Get-CimInstance Win32_Process` snapshot, indexed by parent pid. Throws when it is not JSON.
 * `ExecutablePath` (053 `{arch}`), like `CommandLine`, is null for processes this user cannot
 * inspect; that is an empty string, never a dropped row.
 */
export function parseProcessTable(json: string): Map<number, ChildProcess[]> {
  const byParent = new Map<number, ChildProcess[]>();
  let rows: Array<{
    ProcessId?: number;
    ParentProcessId?: number;
    CommandLine?: string | null;
    CreationDate?: string | null;
    ExecutablePath?: string | null;
  }>;
  try {
    const parsed: unknown = JSON.parse(json.replace(RAW_CONTROL_CHARS, ' '));
    rows = Array.isArray(parsed) ? parsed : [parsed as never];
  } catch (error) {
    throw new Error('the process table could not be parsed', { cause: error });
  }

  for (const row of rows) {
    const pid = Number(row?.ProcessId);
    const ppid = Number(row?.ParentProcessId);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    const entry: ChildProcess = {
      pid,
      ppid,
      commandLine: typeof row.CommandLine === 'string' ? row.CommandLine : '',
      startedAt: parseCimDate(row.CreationDate),
      executablePath: typeof row.ExecutablePath === 'string' ? row.ExecutablePath : '',
    };
    const list = byParent.get(ppid);
    if (list) list.push(entry);
    else byParent.set(ppid, [entry]);
  }

  return byParent;
}

/** All live descendants of `rootPid`, walked from the shared snapshot. */
async function descendantProcesses(rootPid: number): Promise<ChildProcess[]> {
  // FR-019e: for command memory's child list a failed read is `[]`, which leaves the last known value
  // in place. The attached path takes the rejection instead (FR-042, review finding 5).
  const byParent = await processSnapshot(Date.now()).catch(() => new Map<number, ChildProcess[]>());
  return descendantsOf(byParent, rootPid);
}

/**
 * `ConvertTo-Json` renders a CIM datetime as `/Date(1699999999999)/`. Anything unparseable
 * yields 0, which simply loses the "most recently started" tiebreak for that row rather than
 * discarding a real running command.
 */
function parseCimDate(value: string | null | undefined): number {
  if (typeof value !== 'string') return 0;
  const epoch = /\/Date\((\d+)/.exec(value);
  if (epoch) return Number(epoch[1]);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
