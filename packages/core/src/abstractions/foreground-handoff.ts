/**
 * IForegroundHandoff (Principle II, #199, 044 FR-119). OS seam for letting a window the user's own
 * action opened come to the FRONT, instead of appearing behind throng.
 *
 * The problem it exists for, in the two shapes it has been met in:
 * - **A command running in a terminal.** `az login` (and anything else that opens a window — a
 *   browser-based auth flow, a GUI editor, `explorer.exe`, a credential prompt) opens its window
 *   BEHIND throng. Nothing says it is there, so the terminal looks like it has hung waiting for
 *   input the user cannot see.
 * - **A followed link.** A web or `mailto:` link Ctrl+clicked in a preview, a terminal or About
 *   reaches the OS default handler; when that handler is ALREADY RUNNING the request goes to an
 *   existing process, which the OS will not let raise itself. The browser flashes and throng stays
 *   in front (044 FR-119).
 *
 * Why an OS seam rather than a fix: Windows only lets the process that already OWNS the foreground
 * hand it on, and in neither shape is the window's process the owner. From a terminal it is created
 * several processes away — throng's UI → daemon → (optionally the de-elevated PTY agent) → conhost →
 * the shell → the command → its window; from a link it belongs to a browser throng did not start.
 * throng is the foreground owner in both. So the permission can only come from throng, and only
 * through a platform-specific call.
 *
 * The contract is deliberately narrow: a REQUEST, not a promise. An implementation that cannot
 * obtain the permission, or a platform with no such concept, does nothing and says so by returning
 * false. No caller may treat a `true` as "the window will be raised" — the OS decides that, later,
 * and may still refuse.
 */
export interface IForegroundHandoff {
  /**
   * Ask the OS to let another process raise its own window over throng's.
   *
   * Called at the moment of the user's own action — a SUBMITTED command, or a FOLLOWED link —
   * because that is the only moment throng can honestly attribute a window to them, and because on
   * Windows the permission decays with the next user input rather than persisting.
   *
   * Returns whether the permission was granted — false when unsupported, unavailable, or refused.
   * Never throws: a terminal keystroke, or a link the user clicked, must not fail because a
   * window-manager hint did.
   */
  allow(): boolean;
}

/**
 * The no-op seam: every platform where this concept does not exist, and every context where the
 * grant must not be attempted (tests, a headless run). Present so no caller needs to know whether
 * it is on Windows — Principle II's point.
 */
export class NoForegroundHandoff implements IForegroundHandoff {
  allow(): boolean {
    return false;
  }
}

/**
 * Whether a chunk of terminal input SUBMITS a command, and so is the moment to ask for the handoff.
 *
 * Pure, and separate from the seam, because the *policy* is the part worth testing without an OS:
 * the grant is deliberately not made on every keystroke. Windows keeps the permission alive only
 * until the user's next input, so re-granting per character would hold it open for as long as
 * someone is typing — the open-ended window that scoping it to a submit exists to avoid — and every
 * character of a pasted block would re-arm it too.
 *
 * `\r` is what xterm sends for Enter. `\n` counts as well, because a bracketed paste or a program
 * writing on the user's behalf can carry one, and a multi-line paste that runs a command is still
 * the user asking for it to run.
 */
export function submitsCommand(data: string): boolean {
  return data.includes('\r') || data.includes('\n');
}
