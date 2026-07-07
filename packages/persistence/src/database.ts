import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type { IPersistenceSettings } from '@throng/core';

export type ThrongDatabase = BetterSqliteDatabase;

/**
 * Open (creating if necessary) the embedded SQLite database at the injected
 * path. The containing directory is created on demand. Open/initialisation
 * failures are surfaced explicitly rather than swallowed (spec Edge Case:
 * "Database initialisation failure").
 */
export function openDatabase(settings: IPersistenceSettings): ThrongDatabase {
  const { databasePath } = settings;
  try {
    mkdirSync(dirname(databasePath), { recursive: true });
    const db = new Database(databasePath);
    // Foreign-key enforcement is per-connection in SQLite; enable it so
    // ON DELETE CASCADE (workspace_layout → projects) fires (migration v2 / FR-006).
    db.pragma('foreign_keys = ON');
    return db;
  } catch (error) {
    throw new Error(
      `Failed to open throng database at "${databasePath}": ${(error as Error).message}`,
      { cause: error },
    );
  }
}
