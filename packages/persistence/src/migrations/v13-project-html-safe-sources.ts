import type { ThrongDatabase } from '../database.js';
import { addColumnsFor } from '../schema-guard.js';

/**
 * Migration v13: add a per-project `html_safe_sources` (JSON string array) to the `projects` table —
 * the remote `https:` origins an HTML Preview of a file in that project may load stylesheets, fonts
 * and images from, beside the global preference (074 FR-072a). Beside `hidden_paths` (v6) and
 * `search_exclude_globs` (v12) and independent of both. Existing rows default to `'[]'`. The column
 * DDL lives in `schema-guard.ts` (single source for migrate + heal), so a re-run is a safe no-op.
 */
export const MIGRATION_V13_VERSION = 13;

export function applyMigrationV13(db: ThrongDatabase): void {
  addColumnsFor(db, 'projects', ['html_safe_sources']);
}
