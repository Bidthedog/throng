import type { ThrongDatabase } from '../database.js';

/**
 * Migration v8 (024 US3, #85): the per-project file-operation undo/redo stack.
 *
 * Stored as ONE JSON blob per (owner, project) — like `workspace_layout` — because the stack is
 * always read and written whole (the pure engine in `@throng/core` owns its shape), and a blob keeps
 * the bounded-50 stack atomic. The composite primary key and the CASCADE foreign key mirror
 * `document_state` (v7): deleting a project drops its undo history for free.
 *
 * `CREATE TABLE IF NOT EXISTS` makes re-running the migration against an already-v8 store a safe
 * no-op (constitution v3.5.0 — idempotent migrations).
 */
export const MIGRATION_V8_VERSION = 8;

export function applyMigrationV8(db: ThrongDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fileop_undo (
      owner_user  TEXT NOT NULL,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      stack_json  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (owner_user, project_id)
    );
  `);
}
