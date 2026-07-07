import type { ThrongDatabase } from '../database.js';
import { addColumnsFor } from '../schema-guard.js';

/**
 * Migration v5: add a per-owner `position` to `sub_workspaces` so the user can
 * reorder the sub-workspace list by dragging (US7, mirroring the project list /
 * FR-046). Existing rows are backfilled by their last-updated order (0-based, per
 * owner) using a correlated count — no window functions needed. The `position`
 * column DDL lives in `schema-guard.ts` (single source for migrate + self-heal).
 */
export const MIGRATION_V5_VERSION = 5;

export function applyMigrationV5(db: ThrongDatabase): void {
  addColumnsFor(db, 'sub_workspaces', ['position']);
  db.exec(`
    UPDATE sub_workspaces SET position = (
      SELECT COUNT(*) FROM sub_workspaces s2
       WHERE s2.owner_user = sub_workspaces.owner_user
         AND (s2.updated_at < sub_workspaces.updated_at
              OR (s2.updated_at = sub_workspaces.updated_at AND s2.id < sub_workspaces.id))
    );
  `);
}
