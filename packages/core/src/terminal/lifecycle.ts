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
