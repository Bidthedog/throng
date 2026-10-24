import type { ThrongDatabase } from '../database.js';
import { ensureTableFor } from '../schema-guard.js';

/**
 * Migration v11: the manual attention flag table (057 round 12, FR-125 / FR-128;
 * contracts/daemon-attention.md).
 *
 * A manual flag is the user's own mark on a panel and must survive a restart, so it lives here
 * rather than in the ledger. The DDL lives in `schema-guard.ts`, so the guard can recreate the table
 * on a store stamped 11 without it; `CREATE TABLE IF NOT EXISTS` makes a re-run a safe no-op.
 */
export const MIGRATION_V11_VERSION = 11;

export function applyMigrationV11(db: ThrongDatabase): void {
  ensureTableFor(db, 'attention_flag');
}
