/**
 * Terminal idle/busy classification + close/attach decisions (005 Phase C / US3,
 * research D12). Pure logic over the descendant-pid set the `IPtyHost` reports.
 *
 * A terminal is **busy** iff its shell has a live descendant process (a running
 * command); an idle shell sitting at its prompt has none. The safe default when
 * descendants cannot be determined is "busy" — the OS adapter decides that (it
 * never silently treats a possibly-running process as idle), so this pure layer
 * only sees the concrete pid set.
 */

/** Whether the terminal has a live (non-shell) descendant — i.e. is busy. */
export function isBusy(childPids: readonly number[]): boolean {
  return childPids.length > 0;
}

/**
 * On project/app close: a **busy** terminal keeps running in the background and is
 * re-attached later (Principle III), so it is NOT closed; an **idle** shell is
 * closed and cold-respawned on reopen. Returns `true` when the terminal should be
 * closed now.
 */
export function shouldCloseOnOwnerClose(childPids: readonly number[]): boolean {
  return !isBusy(childPids);
}

/**
 * On (re)open of a Terminal Panel: if the daemon still holds a live session for
 * the panel, re-attach to it (replay scrollback + resume streaming); otherwise
 * cold-start a fresh terminal from the persisted config.
 */
export function attachDecision(hasLiveSession: boolean): 'reattach' | 'cold-start' {
  return hasLiveSession ? 'reattach' : 'cold-start';
}

/**
 * Whether a terminal's end deserves a notice (025 follow-up).
 *
 * The discriminator is the EXIT CODE, not the daemon's `unexpected` flag. That flag means "throng
 * did not kill this" (`unexpected = !userKilled`), so typing `exit` in the shell — the most
 * deliberate end there is — arrives marked unexpected. Gating on it therefore told the user
 * "Terminal exited (code 0)" for something they had just asked for, which reports back their own
 * action and trains them to dismiss notices unread. That is precisely when a real failure is missed.
 *
 * A shell that exits 0 ended cleanly, whoever asked. Anything else — a non-zero code, a signal, or
 * a code we could not read — is a genuine failure and still surfaces with its code, which is what
 * constitutional Principle III requires.
 */
export function shouldSurfaceExit(code: number | null | undefined): boolean {
  return code !== 0;
}
