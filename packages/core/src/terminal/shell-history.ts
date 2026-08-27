/**
 * Shell-history suppression for shells throng launches **under test** (#339).
 *
 * ## Why this exists
 *
 * The E2E suite types real commands into real shells, and a shell's history is a single per-user
 * file shared with every shell the developer runs by hand. PowerShell is the case that forced
 * this: PSReadLine defaults to `SaveIncrementally`, flushing each command as it is typed to
 * `%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`, and capping that
 * file at `MaximumHistoryCount` (4096). So a suite run does not merely ADD noise — it EVICTS the
 * developer's own commands, permanently. Measured on a working machine mid-development: 1,853 of
 * 7,398 lines were E2E probes (`READYOK`, `SCROLLMARK118`, `LINKFENCE4`).
 *
 * This is precisely the hazard `MemoryClipboard` was introduced for (016 FR-013a), one seam
 * further out. The reasoning there applies verbatim: the OS clipboard is ONE global resource, and
 * so is the history file. A test must prove the FEATURE, not write to the developer's machine.
 *
 * ## Why a snippet for PowerShell and an environment variable for bash
 *
 * Not a stylistic split — it is what each shell actually offers, and both were measured before
 * being chosen:
 *
 *  - **PowerShell has no environment lever at all.** The obvious candidate, redirecting `APPDATA`,
 *    DOES NOT WORK: PSReadLine resolves its history path through the known-folder API, not the
 *    environment. Verified — `APPDATA='C:\Temp\x' powershell -NoProfile -Command
 *    "(Get-PSReadLineOption).HistorySavePath"` still reports the real profile path. So the only
 *    lever is an in-session statement, which rides in on the same `-Command` recipe that already
 *    carries shell integration.
 *  - **bash-family shells have nothing else.** `HISTFILE` is read by the shell itself before any
 *    rc file runs, and nothing parses an environment variable on the way in — the same reason
 *    `BUILTIN_SHELL_INTEGRATION_ENV` prefers env over argv for git-bash, where an argv snippet had
 *    its backslash escapes eaten in transit.
 *
 * `cmd` is deliberately absent: it keeps no persistent history, so there is nothing to suppress.
 * That is also why the daemon's own integration tests, which launch `ComSpec`, never contributed
 * to this bug.
 *
 * ## This is OFF unless a test asks for it
 *
 * A real terminal recording history is correct, intended behaviour that users rely on — recall,
 * Ctrl+R and arrow-up are the point of a shell. Suppression is therefore opt-in, gated by
 * {@link THRONG_TEST_SHELL_HISTORY}, and the shipped path is byte-for-byte unchanged.
 */

/**
 * The environment variable a test harness sets to ask every shell throng launches to keep no
 * history. Set to `off` by the E2E harness; never set in a shipped app.
 */
export const THRONG_TEST_SHELL_HISTORY = 'THRONG_TEST_SHELL_HISTORY';

/**
 * In-session statements that stop a shell persisting its history, keyed by flavour id.
 *
 * `SaveNothing` is PSReadLine's own term for "keep history in memory for this session, write none
 * of it to disk" — so recall still works inside the session under test, which matters because
 * specs drive arrow-up and Ctrl+R. It is set from the `-Command` payload, which PowerShell runs
 * AFTER the user's profile, so a profile that sets its own PSReadLine options cannot re-enable
 * saving behind us.
 */
export const SHELL_HISTORY_OFF_SNIPPET: Record<string, string> = {
  'windows-powershell': 'Set-PSReadLineOption -HistorySaveStyle SaveNothing',
  pwsh: 'Set-PSReadLineOption -HistorySaveStyle SaveNothing',
};

/**
 * Environment that stops a shell persisting its history, keyed by flavour id.
 *
 * All three keys are needed, not just `HISTFILE`: bash writes to `HISTFILE` on exit, `HISTSIZE`
 * bounds the in-memory list and `HISTFILESIZE` bounds the file, and a user's rc file commonly sets
 * the latter two. `/dev/null` is a real, writable sink under MSYS as well as POSIX.
 */
export const SHELL_HISTORY_OFF_ENV: Record<string, Record<string, string>> = {
  'git-bash': { HISTFILE: '/dev/null', HISTSIZE: '0', HISTFILESIZE: '0' },
};

/** How a flavour is asked to keep no history — a snippet, an environment, or neither. */
export interface ShellHistorySuppression {
  /** A statement to run in-session, composed ahead of everything else through the command recipe. */
  snippet?: string;
  /** Environment applied at launch. */
  env?: Record<string, string>;
}

/**
 * What a flavour needs in order to keep no history, or `{}` when suppression is off or the shell
 * keeps none anyway.
 *
 * Mirrors `resolveShellIntegration` / `resolveShellIntegrationEnv` deliberately: the two travel the
 * same two carriers to the same shell, and a reader who understands one understands this.
 */
export function resolveShellHistorySuppression(
  id: string,
  enabled: boolean,
): ShellHistorySuppression {
  if (!enabled) return {};
  const snippet = SHELL_HISTORY_OFF_SNIPPET[id];
  const env = SHELL_HISTORY_OFF_ENV[id];
  return { ...(snippet ? { snippet } : {}), ...(env ? { env } : {}) };
}

/**
 * Whether this process was told to launch shells that keep no history.
 *
 * Read from the environment at the point a terminal is launched rather than cached, so a harness
 * that sets it after start-up is still honoured. Only the exact value `off` counts — a stray
 * truthy value must not silently disable a real user's history.
 */
export function shellHistoryOff(env: Record<string, string | undefined>): boolean {
  return env[THRONG_TEST_SHELL_HISTORY] === 'off';
}
