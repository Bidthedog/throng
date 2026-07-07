import type { ThrongDatabase } from '../database.js';
import { addColumnsFor } from '../schema-guard.js';

/**
 * Migration v4: sub-workspaces become first-class entities with an independent
 * `name` and dominant `colour` (003 / FR-012). Existing rows are backfilled with
 * the neutral defaults (the column DEFAULTs) that were previously synthesised on
 * read. The column DDL lives in `schema-guard.ts` so the same definition both
 * migrates and self-heals; applying via `addColumnsFor` is idempotent.
 */
export const MIGRATION_V4_VERSION = 4;

export function applyMigrationV4(db: ThrongDatabase): void {
  addColumnsFor(db, 'sub_workspaces', ['name', 'colour']);
}
