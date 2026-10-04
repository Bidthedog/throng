/**
 * The quit gate: closing throng while a paste runs or waits (050, research R11, FR-019f).
 *
 * The main window's close handler asks this FIRST, before the terminals prompt or any other. Not
 * busy → it proceeds at once, and nothing about the close changes. Busy → it asks the renderer
 * *Wait · Cancel pastes* and holds the close until the answer:
 *
 * - **Wait** — the close proceeds once every paste has finished.
 * - **Keep finished / Roll back** — every queued and running paste is cancelled with that choice, so
 *   nothing is asked again per job, and the close proceeds when they have all ended.
 * - **Dismiss** — the close is abandoned and the pastes carry on.
 *
 * "Proceeds" means the caller re-enters its existing close flow, terminals prompt included.
 */
import type { TransferQuitChoice } from '@throng/core';

export interface QuitGateTransfer {
  busy(): { running: number; queued: number };
  whenIdle(): Promise<void>;
  cancelAll(choice: 'keep' | 'rollback'): void;
}

export class TransferQuitGate {
  private pending: { resolve: (choice: TransferQuitChoice) => void; answered: Promise<boolean> } | null = null;

  /** `prompt` sends `throng:transfer:quitPrompt` to the main window. */
  constructor(
    private readonly transfer: QuitGateTransfer,
    private readonly prompt: (counts: { running: number; queued: number }) => void,
  ) {}

  /** True when the close may go on; false when the user abandoned it. */
  check(): Promise<boolean> {
    const counts = this.transfer.busy();
    if (counts.running === 0 && counts.queued === 0) return Promise.resolve(true);
    // A second close while the question is open: ask again, but let only the first close go on.
    if (this.pending) {
      this.prompt(counts);
      return this.pending.answered.then(() => false);
    }
    let resolve!: (choice: TransferQuitChoice) => void;
    const choice = new Promise<TransferQuitChoice>((r) => {
      resolve = r;
    });
    const answered = choice.then(async (c) => {
      this.pending = null;
      if (c === 'dismiss') return false;
      if (c === 'keep' || c === 'rollback') this.transfer.cancelAll(c);
      await this.transfer.whenIdle();
      return true;
    });
    this.pending = { resolve, answered };
    this.prompt(counts);
    return answered;
  }

  /** The renderer's answer (`throng:transfer:quitChoice`). */
  choose(choice: TransferQuitChoice): void {
    this.pending?.resolve(choice);
  }
}
