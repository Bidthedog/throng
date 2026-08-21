import { createRequire } from 'node:module';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import {
  passthroughDeElevator,
  sanitizeSpawnEnv,
  shouldDeElevate,
  type IDeElevator,
  type IElevationState,
  type ChildProcess,
  type IPtyHost,
  type PtyHandle,
  type PtyStartOptions,
} from '@throng/core';

const execFileAsync = promisify(execFile);

/**
 * Windows `IPtyHost` (005 Phase C) over node-pty/ConPTY, owned by the **daemon**.
 *
 * IMPORTANT: node-pty (a native module built for plain Node 20) is required
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

interface NodePtyModule {
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
  /**
   * The OS pid of this terminal's `conhost.exe` host (a child of THIS process, a
   * sibling of the shell). Discovered shortly after spawn. Needed because when a
   * shell exits on its own, node-pty 1.1.0 never closes the pseudoconsole and the
   * conhost can no longer be reaped via node-pty — so we taskkill it by pid.
   */
  conhostPid: number | null;
}

export class NodePtyHost implements IPtyHost {
  private readonly pty: NodePtyModule;
  private readonly sessions = new Map<number, Session>();
  private seqCounter = 0;

  /**
   * @param elevation reports whether the daemon itself is elevated (FR-025a).
   * @param deElevator OS mechanism that rewrites a launch to run de-elevated
   *   (FR-025c mixed mode). Defaults to the no-op passthrough — in which case an
   *   elevated daemon spawns every terminal elevated (the pre-mixed-mode behaviour).
   */
  constructor(
    private readonly elevation?: IElevationState,
    private readonly deElevator: IDeElevator = passthroughDeElevator,
  ) {
    const require = createRequire(import.meta.url);
    this.pty = require('node-pty') as NodePtyModule;
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
      env: {
        ...sanitizeSpawnEnv(opts.baseEnv ?? process.env),
        ...(opts.env ?? {}),
      },
      name: 'xterm-256color',
      /*
       * #298 — the ConPTY throng SHIPS, not the one the OS happens to have.
       *
       * Without this, node-pty uses the system ConPTY, so a terminal's behaviour is whatever the
       * host Windows build shipped. Measured, same commit and same fixture: on Windows 11
       * (26200) the renderer observes DEC private modes 9001, 1004, 25 and 1049; on
       * windows-2022 (20348) it observes ONLY 25. The application's alternate-screen switch
       * never arrives, because that ConPTY handles the alt screen itself and synthesises its
       * own output rather than forwarding the app's.
       *
       * throng reads that switch to decide who owns the keyboard
       * (`use-terminal.ts`: `programOwnsKeyboard = kittyKeyboardActive(kitty) || altBuffer`), so on
       * an older host a full-screen program that negotiates nothing silently loses Ctrl+End and
       * Ctrl+Home to throng's scrollback. That is a USER-FACING gap on those machines, not merely
       * a CI one — CI is just the only place we had a machine old enough to show it.
       *
       * node-pty bundles conpty 1.23.251008001 and electron-builder already ships and signs it, so
       * this makes the packaged app's terminals behave the same everywhere instead of tracking the
       * OS. node-pty marks the option EXPERIMENTAL and defaults it to false; the divergence it
       * removes is worse than the risk it carries, and `conhostChildren` below is widened in the
       * same change because the bundled host is named differently.
       */
      useConptyDll: true,
    });
    const session: Session = { proc, seq: this.seqCounter++, conhostPid: null };
    this.sessions.set(proc.pid, session);
    // Discover this terminal's conhost pid NOW, at spawn, while it is unambiguous and
    // before the terminal can be killed/exited. The ConPTY host exists by the time
    // spawn() returns, so this resolves it in one pass. Doing it here (not in the
    // exit/kill hot path) keeps process termination — and its notifications — prompt.
    this.attributeConhosts();
    proc.onExit(() => {
      // The shell exited on its OWN. taskkill of the shell is what triggers this, but
      // node-pty 1.1.0 never closes the pseudoconsole for a self-exited shell — so its
      // conhost.exe host would leak. Reap it by the pid we tracked at spawn.
      const s = this.sessions.get(proc.pid);
      this.sessions.delete(proc.pid);
      if (s?.conhostPid) this.taskkill(s.conhostPid);
    });
    return { pid: proc.pid };
  }

  /**
   * Attribute this process's not-yet-known `conhost.exe` hosts to pending sessions.
   * node-pty creates each terminal's conhost during spawn, so any conhost a session
   * owns is NEWER than one left orphaned by an earlier terminal — we therefore assign
   * the NEWEST unclaimed conhosts (by creation order) to the pending sessions (in spawn
   * order). Robust against a lingering orphan and against several terminals starting
   * close together, and it never mis-attributes (hence never taskkills) a live host.
   */
  private attributeConhosts(): void {
    const pending = [...this.sessions.values()]
      .filter((s) => s.conhostPid === null)
      .sort((a, b) => a.seq - b.seq);
    if (pending.length === 0) return;
    const claimed = new Set(
      [...this.sessions.values()].map((s) => s.conhostPid).filter((p): p is number => p !== null),
    );
    const free = conhostChildren(process.pid).filter((pid) => !claimed.has(pid)); // creation order
    const mine = free.slice(Math.max(0, free.length - pending.length)); // the newest N
    for (let i = 0; i < Math.min(mine.length, pending.length); i += 1) {
      pending[i].conhostPid = mine[i];
    }
  }

  private taskkill(pid: number): void {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
        stdio: 'ignore',
      });
    } catch {
      /* already gone */
    }
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

  kill(handle: PtyHandle): void {
    const session = this.sessions.get(handle.pid);
    if (!session) return;
    this.sessions.delete(handle.pid);
    // 1) Kill the shell tree with a HIDDEN taskkill (shell + its running command,
    //    FR-018). node-pty observes the shell's exit and emits its `exit` event, so
    //    the daemon releases the root lock and notifies the UI. We avoid node-pty's
    //    own kill() (it forks a console-list helper that flashes a console per kill).
    this.taskkill(handle.pid);
    // 2) Reap this terminal's conhost.exe host. taskkill of the shell does NOT — the
    //    conhost is a sibling under THIS process, not a child of the shell — and
    //    node-pty never closes the pseudoconsole for an already-exited shell. Reap by
    //    tracked pid. (If killed within ~200ms of spawn, before attribution, the conhost
    //    lingers until the daemon-shutdown dispose() sweep — a negligible window.)
    if (session.conhostPid) this.taskkill(session.conhostPid);
  }

  /**
   * Release every live PTY (daemon shutdown). Reaps each terminal's `conhost.exe` so
   * exiting the daemon process never leaves orphaned pseudoconsole hosts behind.
   */
  dispose(): void {
    for (const [pid, session] of [...this.sessions]) {
      this.taskkill(pid);
      if (session.conhostPid) this.taskkill(session.conhostPid);
    }
    this.sessions.clear();
    // Final safety net: reap any conhost.exe host of ours we never attributed to a
    // session (e.g. one spawned moments before shutdown).
    for (const pid of conhostChildren(process.pid)) this.taskkill(pid);
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

  listChildPids(handle: PtyHandle): number[] {
    return descendantPids(handle.pid);
  }

  /**
   * 025 FR-019/FR-022. Deliberately **async** — this runs on a repeating observation, and the
   * daemon is single-threaded, so it must never block the event loop (FR-019b). That is the one
   * thing separating it from `listChildPids` above, whose synchronous whole-table scan on the
   * close path is a known pre-existing defect tracked as issue 190 and deliberately untouched here.
   *
   * Resolves to `[]` on any failure so a bad snapshot leaves the last known command in place
   * rather than clearing it (FR-019e).
   */
  async listChildProcesses(handle: PtyHandle): Promise<ChildProcess[]> {
    return descendantProcesses(handle.pid);
  }
}

/**
 * The pids of `conhost.exe` / `OpenConsole.exe` `--headless` processes that are direct children of
 * `parentPid`, in creation order. Each corresponds to one ConPTY the process owns.
 */
function conhostChildren(parentPid: number): number[] {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'conhost.exe' -or $_.Name -eq 'OpenConsole.exe') -and $_.ParentProcessId -eq ${parentPid} -and $_.CommandLine -match '--headless' } | Sort-Object CreationDate | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
    return out
      .split(/\r?\n/)
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/** All live descendant pids of `rootPid`, via a single process snapshot. */
function descendantPids(rootPid: number): number[] {
  let csv: string;
  try {
    csv = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId)" }',
      ],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
  } catch {
    return [];
  }
  const childrenByParent = new Map<number, number[]>();
  for (const line of csv.split(/\r?\n/)) {
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const pid = Number(line.slice(0, comma));
    const ppid = Number(line.slice(comma + 1));
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    const list = childrenByParent.get(ppid);
    if (list) list.push(pid);
    else childrenByParent.set(ppid, [pid]);
  }
  const result: number[] = [];
  const stack = [...(childrenByParent.get(rootPid) ?? [])];
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    result.push(pid);
    const grandchildren = childrenByParent.get(pid);
    if (grandchildren) stack.push(...grandchildren);
  }
  return result;
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

async function readProcessTable(): Promise<Map<number, ChildProcess[]>> {
  const byParent = new Map<number, ChildProcess[]>();
  let json: string;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress",
      ],
      { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
    json = stdout;
  } catch {
    return byParent; // FR-019e: a failed observation keeps the last known value; it never clears it.
  }
  let rows: Array<{
    ProcessId?: number;
    ParentProcessId?: number;
    CommandLine?: string | null;
    CreationDate?: string | null;
  }>;
  try {
    const parsed: unknown = JSON.parse(json);
    rows = Array.isArray(parsed) ? parsed : [parsed as never];
  } catch {
    return byParent;
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
    };
    const list = byParent.get(ppid);
    if (list) list.push(entry);
    else byParent.set(ppid, [entry]);
  }

  return byParent;
}

/** All live descendants of `rootPid`, walked from the shared snapshot. */
async function descendantProcesses(rootPid: number): Promise<ChildProcess[]> {
  const byParent = await processSnapshot(Date.now());
  const result: ChildProcess[] = [];
  const stack = [...(byParent.get(rootPid) ?? [])];
  while (stack.length > 0) {
    const proc = stack.pop() as ChildProcess;
    result.push(proc);
    const grandchildren = byParent.get(proc.pid);
    if (grandchildren) stack.push(...grandchildren);
  }
  return result;
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
