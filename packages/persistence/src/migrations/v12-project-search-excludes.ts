import type { ThrongDatabase } from '../database.js';
import { addColumnsFor } from '../schema-guard.js';

/**
 * Migration v12: add a per-project `search_exclude_globs` (JSON string array) to the `projects`
 * table — the glob patterns Find in Files skips in that project, whatever a panel's exclusions
 * toggle says (060 #532, FR-030 / FR-040). Beside `hidden_paths` (v6) and independent of it: those
 * hide entries from the TREE. Existing rows default to `'[]'`. The column DDL lives in
 * `schema-guard.ts` (single source for migrate + heal), so a re-run is a safe no-op.
 */
export const MIGRATION_V12_VERSION = 12;

export function applyMigrationV12(db: ThrongDatabase): void {
  addColumnsFor(db, 'projects', ['search_exclude_globs']);
}
