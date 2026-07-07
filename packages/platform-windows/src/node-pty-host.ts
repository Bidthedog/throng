import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import {
  passthroughDeElevator,
  shouldDeElevate,
  type IDeElevator,
  type IElevationState,
  type IPtyHost,
  type PtyHandle,
  type PtyStartOptions,
} from '@throng/core';

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
    args: string[],
    options: { cwd: string; cols: number; rows: number; env?: NodeJS.ProcessEnv; name?: string },
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
    const proc = this.pty.spawn(file, args, {
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: { ...process.env, ...(opts.env ?? {}) },
      name: 'xterm-256color',
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
}

/**
 * The pids of `conhost.exe --headless` processes that are direct children of
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
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'conhost.exe' -and $_.ParentProcessId -eq ${parentPid} -and $_.CommandLine -match '--headless' } | Sort-Object CreationDate | ForEach-Object { $_.ProcessId }`,
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
