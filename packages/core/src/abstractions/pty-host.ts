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
}

/** How a PTY process ended. */
export interface PtyExit {
  code: number | null;
  signal?: string;
}

export interface IPtyHost {
  /** Spawn a PTY; returns a handle with a positive pid. */
  start(opts: PtyStartOptions): PtyHandle;
  /** Write user input to the PTY (safe no-op after exit). */
  write(handle: PtyHandle, data: string): void;
  /** Resize the PTY viewport (best-effort). */
  resize(handle: PtyHandle, cols: number, rows: number): void;
  /** Terminate the PTY process. */
  kill(handle: PtyHandle): void;
  /** Subscribe to output chunks; returns an unsubscribe function. */
  onData(handle: PtyHandle, cb: (chunk: string) => void): () => void;
  /** Subscribe to process exit; returns an unsubscribe function. */
  onExit(handle: PtyHandle, cb: (e: PtyExit) => void): () => void;
  /** Live non-shell descendant pids — drives idle/busy classification (FR-015b). */
  listChildPids(handle: PtyHandle): number[];
  /**
   * Live descendant processes **with their command lines** (025 FR-019/FR-022) — what a Panel's
   * command memory captures.
   *
   * Deliberately **async**, unlike {@link listChildPids}: this runs on a repeating observation
   * and must never block the daemon's single event loop (FR-019b). The existing synchronous
   * call is left exactly as it is; untangling that is tracked separately (issue 190).
   *
   * Never rejects — an unavailable snapshot resolves to `[]`, so a failed observation leaves the
   * last known value in place rather than clearing it (FR-019e).
   */
  listChildProcesses(handle: PtyHandle): Promise<ChildProcess[]>;
  /**
   * Release every live PTY this host owns and any OS resources behind them
   * (on Windows/ConPTY, the per-terminal `conhost.exe` host). Called on daemon
   * shutdown so terminating the process never orphans terminal hosts. Optional:
   * a proxy host (e.g. the de-elevated agent) may instead tear down out-of-band.
   */
  dispose?(): void;
}
