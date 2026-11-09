import type { TerminalOutputNotification } from '@throng/ipc-contract';

export type TerminalOutputDelivery = TerminalOutputNotification;

/**
 * Orders terminal output around the async attach that replays what the terminal kept (061 FR-012).
 *
 * A view hears live output BEFORE `attach()` resolves, and the replay only arrives with that resolution, over a
 * SEPARATE socket from the live stream, so the two have no ordering guarantee. Written straight to xterm, a live
 * delivery could land ABOVE the older backlog.
 *
 * The gate holds deliveries until the replay has been applied. From then on, each delivery's position says whether the
 * replay already contained it, and its session says whether it belongs to this view at all: a panel id outlives its
 * sessions, and an ending session may still be publishing under it.
 *
 * What it returns is the chunks the delivery was made of. Screen-clear detection counts erases per chunk, so a batch
 * must reach it as the chunks it was built from (061 FR-022).
 */
export class TerminalOutputGate {
  private readonly pending: TerminalOutputDelivery[] = [];
  private open = false;
  private session: number | undefined;
  private written = 0;

  /** `onGap` is told of a delivery that starts beyond what has been written (061 FR-013). */
  constructor(private readonly onGap?: (expected: number, actual: number) => void) {}

  /** True once the replay has been applied and holding has stopped. */
  get isOpen(): boolean {
    return this.open;
  }

  /** A delivery arrived. Returns the chunks to write now: none while the gate is shut, or if it is not for this view. */
  accept(delivery: TerminalOutputDelivery): string[] {
    if (this.open) return this.pass(delivery);
    this.pending.push(delivery);
    return [];
  }

  /**
   * The replay has been applied: open the gate and return the chunks held back, in arrival order. `replayEnd` is the
   * position the replay reaches. Idempotent: a second call returns nothing.
   */
  release(session: number | undefined, replayEnd: number): string[] {
    if (this.open) return [];
    this.open = true;
    this.session = session;
    this.written = replayEnd;
    return this.pending.splice(0).flatMap((delivery) => this.pass(delivery));
  }

  private pass(delivery: TerminalOutputDelivery): string[] {
    if (delivery.sessionId !== this.session) return [];
    if (delivery.end <= this.written) return [];
    const start = delivery.end - delivery.data.length;
    if (start > this.written) this.onGap?.(this.written, start);
    this.written = delivery.end;
    return chunksOf(delivery);
  }
}

function chunksOf({ data, lengths }: TerminalOutputDelivery): string[] {
  if (!lengths) return [data];
  let at = 0;
  return lengths.map((length) => {
    const chunk = data.slice(at, at + length);
    at += length;
    return chunk;
  });
}
