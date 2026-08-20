/**
 * "Open the logs folder" (#123).
 *
 * A user must be able to REACH the diagnostics. They will not know the path, and telling them one
 * over a bug report is how "please send your logs" becomes an unanswered question. The folder opens
 * in the OS file manager; nothing is read, uploaded or displayed in throng — the issue rules out an
 * in-app viewer explicitly.
 *
 * ══ WHY THIS IS A FUNCTION AND NOT FOUR LINES IN `main.ts` ══
 *
 * Extracted by 035 (T056, FR-006). It was an inline `ipcMain.handle`, so the only thing that could
 * observe it was an E2E launching a real application — and what it observes is entirely wiring: that
 * the path handed to the OS is THIS run's log directory, and that a refusal is reported rather than
 * swallowed. Both are worth pinning and neither needs a window.
 *
 * `openPath` is a parameter for the same reason: `shell.openPath` really opens a window on the
 * developer's desktop, which steals focus — and throng closes menus on blur, so a stray Explorer
 * window can fail an unrelated test that had a menu open. The migrated E2E records exactly that,
 * having done it for a while before anyone noticed.
 */

export interface LogsFolder {
  /** Where this run writes its diagnostics. */
  readonly logDir: string;
  readonly log: { info(message: string): void };
}

export type OpenLogsResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * Ask the OS to open the run's log directory.
 *
 * Electron's `shell.openPath` resolves to an EMPTY STRING on success and to a message on failure —
 * it does not reject — so the empty string is the success signal and anything else is the error to
 * report. Getting that inverted is silent: every open would report failure while working, or every
 * failure would report success.
 */
export async function openLogsFolder(
  diagnostics: LogsFolder,
  openPath: (path: string) => Promise<string>,
): Promise<OpenLogsResult> {
  diagnostics.log.info('opening the logs folder at the user request');
  const error = await openPath(diagnostics.logDir);
  return error === '' ? { ok: true, path: diagnostics.logDir } : { ok: false, error };
}
