/**
 * IProcessCwd (Principle II, 012 revision). OS seam that reads the **current
 * working directory** of running processes by pid — used by the daemon to show a
 * terminal's live cwd in its panel title even when a full-screen program hides the
 * prompt. The Windows implementation `WindowsProcessCwd` (in
 * `@throng/platform-windows`) reads each process's PEB; a process whose cwd cannot
 * be read (gone, access denied, wrong architecture) is simply absent from the
 * result. No OS calls here — the contract only.
 */
export interface IProcessCwd {
  /**
   * Read the current working directory of each pid. Returns a map from pid to its
   * absolute cwd; a pid whose cwd is unavailable is omitted (never throws). Batched
   * so a poller reads every terminal in one call.
   */
  read(pids: readonly number[]): Promise<Map<number, string>>;
}
