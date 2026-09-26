import type { ThrongDatabase } from '../database.js';
import { addColumnsFor, ensureTableFor } from '../schema-guard.js';

/**
 * Migration v10: an explicit category position (046 iterate round 1, FR-083 / FR-084;
 * contracts/project-categories.md §5; data-model §1).
 *
 * Before v10 the list was "the default first, then `created_at`, then `id`". v10 adds
 * `project_categories.position` (registered in `schema-guard.ts`, so the guard heals a store stamped
 * 10 without it) and seeds it from that order, so an upgraded list looks exactly as it did.
 *
 * Seeding is per owner and only for an owner whose non-default positions are NOT already distinct —
 * the state of a freshly added column, where every row reads the column default. An owner the seed
 * (or a later `reorder` or `create`) has already numbered has distinct positions and is left alone,
 * so a re-run never overwrites an order the user has set since.
 */
export const MIGRATION_V10_VERSION = 10;

export function applyMigrationV10(db: ThrongDatabase): void {
  // A store stamped 9 by an intermediate build can lack the v9 table altogether; the version loop
  // runs before the guard, so recreate it here (idempotent) rather than fail the whole upgrade.
  ensureTableFor(db, 'project_categories');
  addColumnsFor(db, 'project_categories', ['position']);

  const unseeded = db
    .prepare(
      `SELECT owner_user FROM project_categories
        WHERE is_default = 0
        GROUP BY owner_user
       HAVING COUNT(*) > 1 AND COUNT(DISTINCT position) < COUNT(*)
        ORDER BY owner_user`,
    )
    .all() as Array<{ owner_user: string }>;

  const rowsOf = db.prepare(
    `SELECT id FROM project_categories
      WHERE owner_user = ? AND is_default = 0
      ORDER BY position ASC, created_at ASC, id ASC`,
  );
  const setPosition = db.prepare(
    `UPDATE project_categories SET position = ? WHERE owner_user = ? AND id = ?`,
  );
  for (const { owner_user: owner } of unseeded) {
    const ids = (rowsOf.all(owner) as Array<{ id: string }>).map((r) => r.id);
    ids.forEach((id, index) => setPosition.run(index, owner, id));
  }
}
