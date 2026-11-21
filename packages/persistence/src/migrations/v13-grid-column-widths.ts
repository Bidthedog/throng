import type { ThrongDatabase } from '../database.js';
import { addColumnsFor } from '../schema-guard.js';

/**
 * Migration v13: add `grid_column_widths` (a JSON object of column index → pixel width) to
 * `document_state` — a CSV's column widths in the CSV Preview Editor, per file (073 FR-040, research
 * R8). Beside `language_id` (v7) and independent of it; existing rows default to `''` (no widths). The
 * column DDL lives in `schema-guard.ts` (single source for migrate + heal), so a re-run is a no-op.
 */
export const MIGRATION_V13_VERSION = 13;

export function applyMigrationV13(db: ThrongDatabase): void {
  addColumnsFor(db, 'document_state', ['grid_column_widths']);
}
