/**
 * How a startup refusal reaches the user (062 FR-019; 070 FR-007, research R15).
 *
 * A real refusal — running as root, or a copy macOS translocated — shows the system error dialog before throng exits,
 * because the user launched it and is looking for an answer. `THRONG_TEST_EXEC_PATH` exists only for the package
 * check (`verify-macos-package.mjs`) to launch the installed app as if translocated; no user sets it, macOS's dialog
 * is modal, and nobody is there to dismiss it, so that refusal is logged instead and the process exits at once.
 */
export function refusalPresentation(env: Readonly<Record<string, string | undefined>>): 'dialog' | 'log' {
  return env.THRONG_TEST_EXEC_PATH ? 'log' : 'dialog';
}
