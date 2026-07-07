import type { ThrongDatabase } from './database.js';

/**
 * Schema-drift safety net (003 / migration strategy).
 *
 * The migration runner is keyed on SQLite's `user_version` and only applies
 * migrations whose version exceeds it. That is correct for a strictly
 * append-only migration history, but it cannot recover a database that an
 * *intermediate* build left half-migrated — e.g. one stamped to a later
 * `user_version` by a migration that was subsequently renumbered/re-purposed, so
 * an additive column it was meant to create was never applied. Such a DB reports
 * "up to date" yet is missing columns the running build queries, and every write
 * to the affected table throws `no such column: …`.
 *
 * This module is the single source of truth for every column added to a table
 * *after* its `CREATE TABLE` (i.e. via `ALTER TABLE … ADD COLUMN`). Each such
 * migration applies its columns through {@link addColumnsFor}; {@link reconcileSchema}
 * re-asserts the same set after the version loop, healing any additive-column
 * drift regardless of how it arose. Because every entry carries a `NOT NULL
 * DEFAULT`, healing is non-destructive and idempotent.
 *
 * INVARIANT: every `ALTER TABLE … ADD COLUMN` introduced by a migration MUST be
 * registered here (and applied via {@link addColumnsFor}); otherwise the guard
 * cannot heal a DB that skipped it.
 */
export interface ColumnRepair {
  table: string;
  column: string;
}

interface AdditiveColumn {
  table: string;
  column: string;
  /** Full `ALTER TABLE … ADD COLUMN …` statement; must carry a NOT NULL DEFAULT. */
  ddl: string;
}

/**
 * Every column added after a table's `CREATE TABLE`, in application order. Mirror
 * of the additive DDL in `migrations/`; the migrations and the guard both drive
 * off this list so there is exactly one definition per column.
 */
const ADDITIVE_COLUMNS: readonly AdditiveColumn[] = [
  // v4 — sub-workspaces become first-class (independent name + dominant colour).
  {
    table: 'sub_workspaces',
    column: 'name',
    ddl: `ALTER TABLE sub_workspaces ADD COLUMN name TEXT NOT NULL DEFAULT 'Sub-workspace'`,
  },
  {
    table: 'sub_workspaces',
    column: 'colour',
    ddl: `ALTER TABLE sub_workspaces ADD COLUMN colour TEXT NOT NULL DEFAULT '#8a8f98'`,
  },
  // v5 — per-owner ordering for the sidebar list.
  {
    table: 'sub_workspaces',
    column: 'position',
    ddl: `ALTER TABLE sub_workspaces ADD COLUMN position INTEGER NOT NULL DEFAULT 0`,
  },
  // v6 — per-project hidden paths for the file tree (004), a JSON string array.
  {
    table: 'projects',
    column: 'hidden_paths',
    ddl: `ALTER TABLE projects ADD COLUMN hidden_paths TEXT NOT NULL DEFAULT '[]'`,
  },
];

function tableExists(db: ThrongDatabase, table: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table) !== undefined
  );
}

function hasColumn(db: ThrongDatabase, table: string, column: string): boolean {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((r) => (r as { name: string }).name === column);
}

/** Add `column` to `table` only if absent; returns true when it was applied. */
function addColumn(db: ThrongDatabase, spec: AdditiveColumn): boolean {
  if (!tableExists(db, spec.table) || hasColumn(db, spec.table, spec.column)) return false;
  db.exec(spec.ddl);
  return true;
}

/**
 * Apply a specific subset of registered additive columns for a table (used by the
 * migration that introduces them). Idempotent: a column already present is
 * skipped, so re-running a migration never errors with "duplicate column".
 */
export function addColumnsFor(db: ThrongDatabase, table: string, columns: readonly string[]): void {
  for (const name of columns) {
    const spec = ADDITIVE_COLUMNS.find((c) => c.table === table && c.column === name);
    if (!spec) {
      throw new Error(`No registered additive column ${table}.${name} (schema-guard.ts)`);
    }
    addColumn(db, spec);
  }
}

/**
 * Reconcile additive-column drift: ensure every registered column exists on its
 * (already-created) table, adding any that are missing. Returns the repairs
 * applied — empty on a healthy database. A no-op when a table is absent (that is a
 * version-migration concern, not additive drift).
 */
export function reconcileSchema(db: ThrongDatabase): ColumnRepair[] {
  const repairs: ColumnRepair[] = [];
  for (const spec of ADDITIVE_COLUMNS) {
    if (addColumn(db, spec)) repairs.push({ table: spec.table, column: spec.column });
  }
  return repairs;
}
