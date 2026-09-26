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
 * cannot heal a DB that skipped it. A new table that an existing read path joins
 * is registered too (GUARDED_TABLES, applied via {@link ensureTableFor}).
 */
export interface ColumnRepair {
  table: string;
  /** The column added, or `'*'` when the whole table (with its indexes) was recreated. */
  column: string;
}

interface GuardedTable {
  table: string;
  /** `CREATE TABLE IF NOT EXISTS …` then every `CREATE [UNIQUE] INDEX IF NOT EXISTS …` it needs. */
  ddl: string;
}

/**
 * Tables the guard recreates when a store stamped past their migration lacks them. Registered here
 * only when an existing read path depends on the table, so a drifted store fails EVERY read of
 * that path rather than only the writes. `project_categories` is joined by every project read
 * (the category heal rule), so without it `projects.list` throws "no such table" and no project
 * list loads. The migration that introduces a table creates it through {@link ensureTableFor}, so
 * there is one definition.
 */
const GUARDED_TABLES: readonly GuardedTable[] = [
  // v9 — project categories (046). The partial unique index makes "one default per owner" a
  // database fact, so it is part of the table, not an optimisation.
  {
    table: 'project_categories',
    ddl: `
      CREATE TABLE IF NOT EXISTS project_categories (
        id          TEXT PRIMARY KEY,
        owner_user  TEXT NOT NULL,
        name        TEXT NOT NULL,
        is_default  INTEGER NOT NULL DEFAULT 0,
        minimised   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_categories_owner ON project_categories(owner_user);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_project_categories_one_default
        ON project_categories(owner_user) WHERE is_default = 1;`,
  },
];

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
  // v9 — the category a project is listed under (046). '' is resolved to the owner's default
  // category at read time, so a healed column is never an uncategorised project.
  {
    table: 'projects',
    column: 'category_id',
    ddl: `ALTER TABLE projects ADD COLUMN category_id TEXT NOT NULL DEFAULT ''`,
  },
  // v10 — a user-set order for the non-default categories (046 iterate round 1, FR-083 / FR-084).
  // A healed column reads 0 everywhere; the list then falls back to its `id` tie-break, with the
  // default still first, rather than throwing "no such column: position".
  {
    table: 'project_categories',
    column: 'position',
    ddl: `ALTER TABLE project_categories ADD COLUMN position INTEGER NOT NULL DEFAULT 0`,
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
 * Create a registered table and its indexes if absent (used by the migration that introduces it).
 * Idempotent; returns true when the table itself was missing.
 */
export function ensureTableFor(db: ThrongDatabase, table: string): boolean {
  const spec = GUARDED_TABLES.find((t) => t.table === table);
  if (!spec) throw new Error(`No registered guarded table ${table} (schema-guard.ts)`);
  const missing = !tableExists(db, spec.table);
  // Always run: every statement is IF NOT EXISTS, so this also restores a dropped index.
  db.exec(spec.ddl);
  return missing;
}

/**
 * Reconcile schema drift: recreate every guarded table that is missing, then ensure every
 * registered column exists on its (already-created) table, adding any that are missing. Returns
 * the repairs applied — empty on a healthy database. An additive column is skipped when its table
 * is absent (that is a version-migration concern, not additive drift).
 */
export function reconcileSchema(db: ThrongDatabase): ColumnRepair[] {
  const repairs: ColumnRepair[] = [];
  for (const spec of GUARDED_TABLES) {
    if (ensureTableFor(db, spec.table)) repairs.push({ table: spec.table, column: '*' });
  }
  for (const spec of ADDITIVE_COLUMNS) {
    if (addColumn(db, spec)) repairs.push({ table: spec.table, column: spec.column });
  }
  return repairs;
}
