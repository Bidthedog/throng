import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import {
  TERMINAL_END_TIMEOUT_MS,
  descendantsOf,
  escalationTargets,
  sanitizeSpawnEnv,
  type ChildProcess,
  type IPtyHost,
  type ProcessSurvivor,
  type PtyHandle,
  type PtyRosterEntry,
  type PtyStartOptions,
} from '@throng/core';
import { isLiveRow, readCommandLine, readExecutablePath, readProcRow, readProcTable, trySignal, type ProcRow } from './proc-table.js';

/** What this host uses of node-pty. */
interface NodePty {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

export interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: { cwd: string; cols: number; rows: number; env?: NodeJS.ProcessEnv; name?: string },
  ): NodePty;
}

interface Session {
  readonly proc: NodePty;
  readonly spawnedAt: number;
  readonly exited: Promise<void>;
  ending: Promise<void> | null;
  /** The shell's start time from `/proc`, once read. It cannot change for the life of the process. */
  shellStartedAt?: number;
}

export interface LinuxPtyHostDeps {
  readonly pty?: NodePtyModule;
  readonly timeoutMs?: number;
  /** How long a polite hang-up gets before the tree is killed outright. */
  readonly graceMs?: number;
}

const DEFAULT_GRACE_MS = 400;
const SURVIVOR_POLL_MS = 20;
/** Probes asked within this window share one read of `/proc` (051 FR-011). */
const TABLE_SHARE_MS = 100;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(0, ms));
    void promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

const inSeconds = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s === 1 ? '1 second' : `${s} seconds`;
};

/**
 * `IPtyHost` over node-pty on Linux (062 FR-010, FR-018).
 *
 * node-pty starts each shell in a session of its own, so the shell's pid is also its process group. That is not
 * enough to end a terminal: an interactive shell puts each job in a group of its own, so the group holds only the
 * shell. Ending therefore reads the tree from `/proc` BEFORE signalling, since a child reparents as soon as its shell
 * exits and can no longer be found through it afterwards. Start times are checked before every signal, so a pid the
 * kernel has reused for a stranger is never touched.
 */
export class LinuxPtyHost implements IPtyHost {
  private readonly pty: NodePtyModule;
  private readonly limitMs: number;
  private readonly graceMs: number;
  private readonly sessions = new Map<number, Session>();
  private sharedTable: { at: number; rows: Promise<ProcRow[]> } | null = null;
  private nextFreshTable: Promise<ProcRow[]> | null = null;

  constructor(deps: LinuxPtyHostDeps = {}) {
    this.limitMs = deps.timeoutMs ?? TERMINAL_END_TIMEOUT_MS;
    this.graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
    this.pty = deps.pty ?? (createRequire(import.meta.url)('node-pty') as NodePtyModule);
  }

  start(opts: PtyStartOptions): PtyHandle {
    const spawnedAt = Date.now();
    const proc = this.pty.spawn(opts.file, opts.args, {
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: { ...sanitizeSpawnEnv(opts.baseEnv ?? process.env), ...(opts.env ?? {}) },
      name: 'xterm-256color',
    });
    let observeExit!: () => void;
    const session: Session = {
      proc,
      spawnedAt,
      exited: new Promise<void>((resolve) => (observeExit = resolve)),
      ending: null,
    };
    this.sessions.set(proc.pid, session);
    proc.onExit(() => {
      observeExit();
      if (this.sessions.get(proc.pid) === session) this.sessions.delete(proc.pid);
    });
    return { pid: proc.pid };
  }

  rosterEntries(): PtyRosterEntry[] {
    return [...this.sessions.keys()].map((pid) => ({ handlePid: pid, osPid: pid, conhostPid: null }));
  }

  /** Linux has no console host. The agent asks every host, so the answer is a stated absence (FR-008). */
  conhostOf(_pid: number): Promise<number | null> {
    return Promise.resolve(null);
  }

  write(handle: PtyHandle, data: string): void {
    this.sessions.get(handle.pid)?.proc.write(data);
  }

  resize(handle: PtyHandle, cols: number, rows: number): void {
    try {
      this.sessions.get(handle.pid)?.proc.resize(cols, rows);
    } catch {
      // The shell exited between the check and the call; its exit is on its way.
    }
  }

  end(handle: PtyHandle, timeoutMs: number): Promise<void> {
    const session = this.sessions.get(handle.pid);
    if (!session) return Promise.resolve();
    if (!session.ending) {
      const ending: Promise<void> = this.runEnd(handle.pid, session, timeoutMs).catch((error: unknown) => {
        if (session.ending === ending) session.ending = null;
        throw error;
      });
      session.ending = ending;
    }
    return session.ending;
  }

  /** Hang up politely, then kill what is left. "Close" means gone, including for a program that ignores signals. */
  private async runEnd(pid: number, session: Session, timeoutMs: number): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    const targets = await this.treeOf(pid, session);
    for (const row of targets) {
      await this.signalIfSame(row, 'SIGHUP');
      await this.signalIfSame(row, 'SIGCONT');
    }
    await this.goneWithin(targets, session, Math.min(this.graceMs, deadline - performance.now()));
    for (const row of await this.stillLive(targets)) await this.signalIfSame(row, 'SIGKILL');
    if (!(await this.goneWithin(targets, session, deadline - performance.now()))) {
      throw new Error(`did not end within ${inSeconds(timeoutMs)}`);
    }
  }

  async forceEnd(handle: PtyHandle, timeoutMs: number): Promise<{ survivors: ProcessSurvivor[] }> {
    const session = this.sessions.get(handle.pid);
    if (!session) return { survivors: [] };
    const targets = await this.treeOf(handle.pid, session);
    for (const row of targets) await this.signalIfSame(row, 'SIGKILL');
    await this.goneWithin(targets, session, timeoutMs);
    const survivors = await this.stillLive(targets);
    return { survivors: survivors.map((row) => ({ pid: row.pid, name: row.comm })) };
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.sessions.keys()].map(async (pid) => {
        try {
          await this.end({ pid }, this.limitMs);
        } catch {
          const { survivors } = await this.forceEnd({ pid }, this.limitMs);
          for (const s of survivors) console.warn(`[terminal] could not end process ${s.pid} (${s.name})`);
        }
      }),
    );
    this.sessions.clear();
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
      cb({ code: e.exitCode, signal: e.signal ? String(e.signal) : undefined }),
    );
    return () => sub.dispose();
  }

  async probeChildPids(handle: PtyHandle): Promise<number[]> {
    return (await this.descendants(handle.pid)).map((row) => row.pid);
  }

  async listChildProcesses(handle: PtyHandle): Promise<ChildProcess[]> {
    const rows = await this.descendants(handle.pid).catch(() => []);
    return Promise.all(
      rows.map(async (row) => ({
        pid: row.pid,
        ppid: row.ppid,
        commandLine: (await readCommandLine(row.pid)) || row.comm,
        startedAt: row.startedAt,
        executablePath: await readExecutablePath(row.pid),
      })),
    );
  }

  async shellStartedAt(handle: PtyHandle): Promise<number | undefined> {
    const session = this.sessions.get(handle.pid);
    if (!session) return undefined;
    session.shellStartedAt ??= (await readProcRow(handle.pid))?.startedAt;
    return session.shellStartedAt;
  }

  private table(): Promise<ProcRow[]> {
    const now = Date.now();
    if (this.sharedTable && now - this.sharedTable.at < TABLE_SHARE_MS) return this.sharedTable.rows;
    const rows = readProcTable();
    this.sharedTable = { at: now, rows };
    return rows;
  }

  /**
   * A table read that starts after this call, shared by every caller up to the moment it starts. Ten terminals ending
   * together would otherwise read all of /proc ten times and hold the daemon's loop past its bound (051 FR-021).
   */
  private freshTable(): Promise<ProcRow[]> {
    this.nextFreshTable ??= new Promise((resolve, reject) => {
      setImmediate(() => {
        this.nextFreshTable = null;
        readProcTable().then(resolve, reject);
      });
    });
    return this.nextFreshTable;
  }

  private async descendants(pid: number): Promise<ProcRow[]> {
    const byParent = new Map<number, ProcRow[]>();
    for (const row of await this.table()) {
      if (!isLiveRow(row)) continue;
      const siblings = byParent.get(row.ppid);
      if (siblings) siblings.push(row);
      else byParent.set(row.ppid, [row]);
    }
    return descendantsOf(byParent, pid);
  }

  /** The shell and everything below it now, read fresh. The daemon itself is never in the list. */
  private async treeOf(pid: number, session: Session): Promise<ProcRow[]> {
    const rows = await this.freshTable().catch((): ProcRow[] => []);
    // The shell's own row when it has one: the same clock as its children's, which a wall clock step cannot separate.
    const shellStart = rows.find((row) => row.pid === pid)?.startedAt ?? session.spawnedAt - 1000;
    const targets = new Set(escalationTargets(rows, pid, null, process.pid, shellStart));
    const found = rows.filter((row) => targets.has(row.pid));
    return found.some((row) => row.pid === pid) ? found : [...found, ...(await this.selfRow(pid))];
  }

  private async selfRow(pid: number): Promise<ProcRow[]> {
    const row = await readProcRow(pid);
    return row ? [row] : [];
  }

  /** Signal only if `pid` still names the process that was read: a reused pid is a stranger (FR-018). */
  private async signalIfSame(row: ProcRow, signal: NodeJS.Signals): Promise<void> {
    const now = await readProcRow(row.pid);
    if (now !== null && now.startedAt === row.startedAt) trySignal(row.pid, signal);
  }

  private async stillLive(rows: readonly ProcRow[]): Promise<ProcRow[]> {
    const checked = await Promise.all(
      rows.map(async (row) => {
        const now = await readProcRow(row.pid);
        return now !== null && now.startedAt === row.startedAt && isLiveRow(now) ? row : null;
      }),
    );
    return checked.filter((r): r is ProcRow => r !== null);
  }

  /** Whether the shell and `rows` all went within `ms`. The watching stops at the limit, even for a process that never goes. */
  private async goneWithin(rows: readonly ProcRow[], session: Session, ms: number): Promise<boolean> {
    const until = performance.now() + ms;
    if (!(await within(session.exited, ms))) return false;
    while ((await this.stillLive(rows)).length > 0) {
      if (performance.now() >= until) return false;
      await sleep(SURVIVOR_POLL_MS);
    }
    return true;
  }
}
