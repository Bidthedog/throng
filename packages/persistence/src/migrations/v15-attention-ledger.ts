import type { ThrongDatabase } from '../database.js';
import { ensureTableFor } from '../schema-guard.js';

/**
 * Migration v15: the daemon's attention ledger, on disk (#692; 057 FR-091a).
 *
 * The ledger held main's marks in the daemon's memory, so a daemon that ended took them with it while the
 * Notifications panel's entries came back. The DDL lives in `schema-guard.ts`, so the guard can recreate the table on
 * a store stamped 15 without it; `CREATE TABLE IF NOT EXISTS` makes a re-run a safe no-op.
 */
export const MIGRATION_V15_VERSION = 15;

export function applyMigrationV15(db: ThrongDatabase): void {
  ensureTableFor(db, 'attention_ledger');
}
