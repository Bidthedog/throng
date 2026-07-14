import type { ThrongDatabase } from './database.js';
import { reconcileSchema, type ColumnRepair } from './schema-guard.js';
import { applyMigrationV2, MIGRATION_V2_VERSION } from './migrations/v2-projects-workspace.js';
import { applyMigrationV3, MIGRATION_V3_VERSION } from './migrations/v3-project-order.js';
import { applyMigrationV4, MIGRATION_V4_VERSION } from './migrations/v4-subworkspace-identity.js';
import { applyMigrationV5, MIGRATION_V5_VERSION } from './migrations/v5-subworkspace-order.js';
import { applyMigrationV6, MIGRATION_V6_VERSION } from './migrations/v6-project-hidden.js';
import { applyMigrationV7, MIGRATION_V7_VERSION } from './migrations/v7-document-state.js';

/** The baseline schema version (no domain tables — only a `_meta` marker). */
export const BASELINE_VERSION = 1;

interface Migration {
  version: number;
  up(db: ThrongDatabase): void;
}

/** Ordered migration chain, applied by ascending version (research D5). */
const MIGRATIONS: readonly Migration[] = [
  {
    version: BASELINE_VERSION,
    up(db) {
      db.exec('CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      db.prepare('INSERT OR REPLACE INTO _meta(key, value) VALUES (?, ?)').run(
        'baseline_version',
        String(BASELINE_VERSION),
      );
    },
  },
  {
    version: MIGRATION_V2_VERSION,
    up: applyMigrationV2,
  },
  {
    version: MIGRATION_V3_VERSION,
    up: applyMigrationV3,
  },
  {
    version: MIGRATION_V4_VERSION,
    up: applyMigrationV4,
  },
  {
    version: MIGRATION_V5_VERSION,
    up: applyMigrationV5,
  },
  {
    version: MIGRATION_V6_VERSION,
    up: applyMigrationV6,
  },
  {
    version: MIGRATION_V7_VERSION,
    up: applyMigrationV7,
  },
];

/** The schema version this build brings the store up to. */
export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export interface MigrationResult {
  /** The `user_version` found before running. */
  from: number;
  /** The `user_version` after running. */
  to: number;
  /** Whether any version migration step was applied (false when already current). */
  applied: boolean;
  /**
   * Additive-column drift healed by the schema guard *after* the version loop.
   * Empty on a healthy DB; non-empty means the store's `user_version` was ahead
   * of its actual schema (see `schema-guard.ts`).
   */
  repairs: ColumnRepair[];
}

/**
 * Idempotent startup migration runner keyed on SQLite's `user_version` PRAGMA
 * (FR-026/029). Applies every migration whose version exceeds the stored
 * `user_version`, in order, each in its own transaction, stamping the version
 * after each step.
 *
 * The version loop alone trusts `user_version` to reflect the real schema. To
 * survive a DB that an intermediate build left half-migrated (stamped ahead of
 * its columns — the cause of the "cannot create sub-workspaces" defect), the run
 * ALWAYS finishes with {@link reconcileSchema}, which re-asserts every additive
 * column and heals any that are missing — even when no version migration ran.
 */
export function runMigrations(db: ThrongDatabase): MigrationResult {
  const from = Number(db.pragma('user_version', { simple: true }));

  let applied = false;
  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    const step = db.transaction(() => migration.up(db));
    try {
      step();
      // PRAGMA user_version cannot be parameterised; the version is a trusted constant.
      db.pragma(`user_version = ${migration.version}`);
    } catch (error) {
      throw new Error(
        `Migration v${migration.version} failed: ${(error as Error).message}`,
        { cause: error },
      );
    }
    applied = true;
  }

  // Safety net: heal additive-column drift regardless of version state.
  const repairs = reconcileSchema(db);

  const to = Number(db.pragma('user_version', { simple: true }));
  return { from, to, applied, repairs };
}
