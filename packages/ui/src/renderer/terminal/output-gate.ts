/**
 * Orders terminal output around the async attach that replays scrollback.
 *
 * `useTerminal` subscribes to live PTY output BEFORE `attach()` resolves, and the
 * replayed scrollback only arrives with that resolution — over a SEPARATE socket
 * from the live-output stream (the daemon's request/response pipe vs. its events
 * socket), so the two have no ordering guarantee. On a reattach or mirror to an
 * already-running, actively-producing session, a live chunk can therefore arrive
 * before the scrollback and, written straight to xterm, land ABOVE the older
 * backlog — visible corruption (recent lines, then the whole history below them).
 * Cold starts are unaffected: scrollback is empty and nothing is producing yet.
 *
 * The gate buffers live chunks until scrollback has been applied, then flushes them
 * in arrival order and passes everything through thereafter.
 */
export class TerminalOutputGate {
  private readonly pending: string[] = [];
  private open = false;

  /** True once scrollback has been applied and buffering has stopped. */
  get isOpen(): boolean {
    return this.open;
  }

  /**
   * A live output chunk arrived. Returns `true` if it should be written to the
   * terminal now (the gate is open), or `false` if it was buffered (still waiting
   * for scrollback to be applied).
   */
  accept(chunk: string): boolean {
    if (this.open) return true;
    this.pending.push(chunk);
    return false;
  }

  /**
   * Scrollback has been applied: open the gate and return the buffered chunks to
   * flush, in arrival order. Idempotent — a second call returns nothing.
   */
  release(): string[] {
    if (this.open) return [];
    this.open = true;
    return this.pending.splice(0);
  }
}
