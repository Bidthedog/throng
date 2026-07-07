import type { ThrongDatabase } from '../database.js';

/**
 * Migration v3: add a per-owner `position` to `projects` so the user can reorder
 * the project list by dragging (FR-046). Existing rows are backfilled by created
 * order (0-based, per owner) using a correlated count — no window functions needed.
 */
export const MIGRATION_V3_VERSION = 3;

export function applyMigrationV3(db: ThrongDatabase): void {
  db.exec(`ALTER TABLE projects ADD COLUMN position INTEGER NOT NULL DEFAULT 0;`);
  db.exec(`
    UPDATE projects SET position = (
      SELECT COUNT(*) FROM projects p2
       WHERE p2.owner_user = projects.owner_user
         AND (p2.created_at < projects.created_at
              OR (p2.created_at = projects.created_at AND p2.id < projects.id))
    );
  `);
}
