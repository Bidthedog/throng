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
  /** Extra environment overrides merged over the daemon's environment. */
  env?: Record<string, string>;
  /**
   * Run the PTY elevated ("as administrator", FR-025). Only meaningful in an
   * elevated daemon: when true the child runs at high integrity; when false in an
   * elevated daemon the child is de-elevated to medium integrity (mixed mode).
   */
  runAsAdmin?: boolean;
}

/** An opaque handle to a running PTY. */
export interface PtyHandle {
  readonly pid: number;
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
   * Release every live PTY this host owns and any OS resources behind them
   * (on Windows/ConPTY, the per-terminal `conhost.exe` host). Called on daemon
   * shutdown so terminating the process never orphans terminal hosts. Optional:
   * a proxy host (e.g. the de-elevated agent) may instead tear down out-of-band.
   */
  dispose?(): void;
}
