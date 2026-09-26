import { randomUUID } from 'node:crypto';
import type { ThrongDatabase } from '../database.js';
import { addColumnsFor, ensureTableFor } from '../schema-guard.js';

/**
 * Migration v9: project categories (046, FR-050 / FR-058; contracts/project-categories.md §3).
 *
 * Every step is safe to repeat, so a store left half-way by an interrupted run converges on the
 * next start:
 *
 * 1. the `project_categories` table, its owner index and the partial unique index that makes "one
 *    default per owner" a database fact;
 * 2. `projects.category_id` (registered in `schema-guard.ts`, so the guard heals a store stamped 9
 *    without it);
 * 3. one default category per owner that has projects and no default yet;
 * 4. every uncategorised project (`''`) joins its owner's default.
 *
 * `position` is left untouched: a category's order is the global order filtered to it, so every
 * project keeps the place it had (SC-006).
 */
export const MIGRATION_V9_VERSION = 9;

/**
 * The name v9 seeds each owner's default category with. Frozen HERE rather than read from core's
 * `SHIPPED_DEFAULT_CATEGORY_NAME`: a migration is history, and a later rename of the shipped
 * default must not change what an old store is upgraded to.
 */
const V9_DEFAULT_CATEGORY_NAME = 'In Progress';

export function applyMigrationV9(db: ThrongDatabase): void {
  // The table DDL lives in schema-guard.ts, so the guard can recreate it on a drifted store.
  ensureTableFor(db, 'project_categories');

  addColumnsFor(db, 'projects', ['category_id']);

  const owners = db
    .prepare(`SELECT DISTINCT owner_user FROM projects ORDER BY owner_user`)
    .all() as Array<{ owner_user: string }>;
  // Guarded per row, so an owner who already has a default (a re-run, or a default created on
  // demand by the repository) keeps it and gains no second one.
  const insertDefault = db.prepare(
    `INSERT INTO project_categories (id, owner_user, name, is_default, minimised, created_at, updated_at)
     SELECT ?, ?, ?, 1, 0, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM project_categories WHERE owner_user = ? AND is_default = 1
      )`,
  );
  const now = new Date().toISOString();
  for (const { owner_user: owner } of owners) {
    insertDefault.run(randomUUID(), owner, V9_DEFAULT_CATEGORY_NAME, now, now, owner);
  }

  db.prepare(
    `UPDATE projects
        SET category_id = (
          SELECT c.id FROM project_categories c
           WHERE c.owner_user = projects.owner_user AND c.is_default = 1
        )
      WHERE category_id = ''
        AND EXISTS (
          SELECT 1 FROM project_categories c
           WHERE c.owner_user = projects.owner_user AND c.is_default = 1
        )`,
  ).run();
}
