/**
 * IPtyHost (Principle II, 005 Phase C) — spawns, streams, resizes, and kills
 * pseudo-terminals. The abstract contract only; the concrete `NodePtyHost`
 * (node-pty/ConPTY) lives in `@throng/platform-windows` and is owned by the
 * **daemon** (never the UI). No OS calls here.
 */

export interface PtyStartOptions {
  /** Executable path or command. */
  file: string;
  args: string[];
  /** Working directory the shell starts in (the project root, FR-013). */
  cwd: string;
  cols: number;
  rows: number;
  /** Extra environment overrides merged over the base environment. */
  env?: Record<string, string>;
  /**
   * The environment to build the shell FROM, replacing the daemon's own (#209).
   *
   * The daemon outlives the UI and is reused across launches, so its `process.env` is a snapshot of
   * whichever session first started it. Supplied by UI main, which the user launched just now.
   */
  baseEnv?: Record<string, string>;
  /**
   * Run the PTY elevated ("as administrator", FR-025). Only meaningful in an
   * elevated daemon: when true the child runs at high integrity; when false in an
   * elevated daemon the child is de-elevated to medium integrity (mixed mode).
   */
  runAsAdmin?: boolean;
  /** 025 follow-up: a verbatim command line for shells that do not un-escape argv (cmd). */
  commandLine?: string;
}

/** An opaque handle to a running PTY. */
export interface PtyHandle {
  readonly pid: number;
}

/**
 * A live descendant process of a terminal's shell (025). Carries what command memory needs to
 * decide which command "had control": who its parent is, what it is, and when it started.
 */
export interface ChildProcess {
  pid: number;
  /** Parent pid — a DIRECT child of the shell is the only capture candidate (FR-022a). */
  ppid: number;
  /** Full command line as the OS reports it; empty when it cannot be read. */
  commandLine: string;
  /** Epoch milliseconds the process started; picks the most recent (FR-022). */
  startedAt: number;
  /** 053 `{arch}`: the executable's path as the OS reports it; empty or absent when it cannot be read. */
  executablePath?: string;
}

/** How a PTY process ended. */
export interface PtyExit {
  code: number | null;
  signal?: string;
}

/** A process a forced end could not remove (051 FR-015a) — written to the log by the caller. */
export interface ProcessSurvivor {
  pid: number;
  /** Image name as the OS reports it; empty when it cannot be read. */
  name: string;
}

/**
 * Every member that asks the operating system about processes returns a promise and never blocks
 * the caller's event loop (051 FR-010): the daemon serves every terminal from one loop, so a
 * synchronous answer stops every terminal's input and output for as long as the OS takes.
 */
export interface IPtyHost {
  /** Spawn a PTY; returns a handle with a positive pid. */
  start(opts: PtyStartOptions): PtyHandle;
  /** Write user input to the PTY (safe no-op after exit). */
  write(handle: PtyHandle, data: string): void;
  /** Resize the PTY viewport (best-effort). */
  resize(handle: PtyHandle, cols: number, rows: number): void;
  /**
   * End the terminal: its shell, everything the shell runs, and the terminal's per-terminal host
   * process (005 FR-018, Principle III) — including a host not yet identified when the end arrives,
   * which is waited for within the limit (051 FR-014).
   *
   * Resolves once the shell's exit has been OBSERVED; a terminal already gone counts as ended.
   * Rejects with a user-readable `Error` when the OS refuses the end, or when `timeoutMs` passes
   * first (051 FR-013) — after a rejection the terminal may still be running. A second call for the
   * same handle returns the same promise.
   */
  end(handle: PtyHandle, timeoutMs: number): Promise<void>;
  /**
   * Escalation (051 FR-015a): end the shell, every descendant by parent pid, and the host process,
   * each individually and forcibly, then report whatever is still alive after at most `timeoutMs`.
   * Never rejects; an unreadable process table resolves with no survivors.
   */
  forceEnd(handle: PtyHandle, timeoutMs: number): Promise<{ survivors: ProcessSurvivor[] }>;
  /** Subscribe to output chunks; returns an unsubscribe function. */
  onData(handle: PtyHandle, cb: (chunk: string) => void): () => void;
  /** Subscribe to process exit; returns an unsubscribe function. */
  onExit(handle: PtyHandle, cb: (e: PtyExit) => void): () => void;
  /**
   * Live non-shell descendant pids — drives idle/busy classification (FR-015b, 046 Unload). An
   * AWAITED, current answer; concurrent calls share one OS read (051 FR-011).
   *
   * REJECTS when the answer is unknown (the table could not be read, or no reply arrived), never
   * resolves `[]` for it: an empty array means "no children" and nothing else, and the caller fails
   * safe by treating the terminal as busy (046, 051 FR-012).
   */
  probeChildPids(handle: PtyHandle): Promise<number[]>;
  /**
   * Live descendant processes **with their command lines** (025 FR-019/FR-022) — what a Panel's
   * command memory captures. Runs on a repeating observation (FR-019b).
   *
   * Never rejects — an unavailable snapshot resolves to `[]`, so a failed observation leaves the
   * last known value in place rather than clearing it (FR-019e).
   */
  listChildProcesses(handle: PtyHandle): Promise<ChildProcess[]>;
  /**
   * 051 FR-040/FR-041 — every process attached to each terminal's console, keyed by `handle.pid`,
   * for all the handles in ONE OS request. A terminal the OS could not answer for is absent from the
   * map (its command falls back to the direct children); the shell appears under its handle's pid.
   * REJECTS when the request itself failed, never resolving an empty map for it: an empty answer
   * would read as "nothing attached" and clear a remembered command (051 FR-042, 025 FR-019e).
   * Optional: a host that cannot ask leaves command memory on direct children.
   */
  listAttachedProcesses?(handles: readonly PtyHandle[]): Promise<Map<number, ChildProcess[]>>;
  /**
   * 053 `{arch}` — the architecture of the executable at `path` (`x64`, `x86`, `arm64`), read from the
   * file rather than the process, and only for the one process a terminal is running. Resolves `null`
   * when it cannot be read or is not recognised; never rejects. Optional: a host that cannot read it
   * leaves `{arch}` empty.
   */
  executableArch?(path: string): Promise<string | null>;
  /**
   * Release every live PTY this host owns and any OS resources behind them (on Windows/ConPTY, the
   * per-terminal `conhost.exe` host), escalating any end that fails (051 FR-015a). Called on
   * shutdown so terminating the process never orphans terminal hosts. Never rejects. Optional: a
   * proxy host (e.g. the de-elevated agent) may instead tear down out-of-band.
   */
  dispose?(): Promise<void>;
}
