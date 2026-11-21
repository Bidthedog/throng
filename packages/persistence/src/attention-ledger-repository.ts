import type { AttentionLedgerEntry } from '@throng/core';
import type { ThrongDatabase } from './database.js';

interface AttentionLedgerRow {
  panel_id: string;
  entry: string;
}

/**
 * #692 — the daemon's attention ledger, kept on disk so the marks main holds survive the daemon itself: a machine
 * powered off, an upgrade, Terminate all on close. Before, the ledger lived in the daemon's memory and every restart
 * emptied it, while the Notifications panel's entries (068 FR-031) came back from disk without their marks.
 *
 * The ledger is small (at most `ATTENTION_LEDGER_MAX` entries) and changes on a signal while no window is open or on
 * main's debounced sync, so it is written whole, in one transaction, in its own order (oldest first, which is the
 * order the daemon trims from). Each entry is stored as JSON: the daemon owns its shape and validates what it reads.
 */
export class AttentionLedgerRepository {
  constructor(private readonly db: ThrongDatabase) {}

  /** Every stored entry, oldest first. A row that no longer parses is skipped. */
  load(): AttentionLedgerEntry[] {
    const rows = this.db.prepare('SELECT panel_id, entry FROM attention_ledger ORDER BY seq').all() as AttentionLedgerRow[];
    const out: AttentionLedgerEntry[] = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.entry) as AttentionLedgerEntry);
      } catch {
        // A row written by a build whose shape this one cannot read: the daemon validates what it keeps.
      }
    }
    return out;
  }

  /** Replace the stored ledger with `entries`, in their order. */
  save(entries: readonly AttentionLedgerEntry[]): void {
    const clear = this.db.prepare('DELETE FROM attention_ledger');
    const insert = this.db.prepare('INSERT INTO attention_ledger(panel_id, seq, entry) VALUES (?, ?, ?)');
    this.db.transaction(() => {
      clear.run();
      entries.forEach((e, i) => insert.run(e.panelId, i, JSON.stringify(e)));
    })();
  }
}
