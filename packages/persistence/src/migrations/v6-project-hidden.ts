import type { ThrongDatabase } from '../database.js';
import { addColumnsFor } from '../schema-guard.js';

/**
 * Migration v6: add a per-project `hidden_paths` (JSON string array) to the
 * `projects` table — root-relative paths the user has hidden from the file tree,
 * in addition to the global excludeGlobs (004). Existing rows default to `'[]'`.
 * The column DDL lives in `schema-guard.ts` (single source for migrate + heal).
 */
export const MIGRATION_V6_VERSION = 6;

export function applyMigrationV6(db: ThrongDatabase): void {
  addColumnsFor(db, 'projects', ['hidden_paths']);
}
