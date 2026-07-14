import type { ThrongDatabase } from '../database.js';

/**
 * Migration v7 (016, FR-028e): per-document state, keyed by owner + project + project-relative
 * path.
 *
 * This REVERSES a decision feature 006 took deliberately — that an editor needs no table, because
 * a panel's kind and config ride the `workspace_layout` blob. That held while editor state was
 * per-PANEL. A language override is per-DOCUMENT: it must be found by a panel opening the file
 * LATER, in another window or another session, which a layout blob keyed by panel cannot answer.
 * The reversal is explicit and reviewed; the two guards that pinned the old decision are rewritten
 * rather than quietly deleted.
 *
 * Shaped for per-document state IN GENERAL, not for this one column: `encoding` and `line_ending`
 * are the declared next occupants (the status strip already anticipates them) and must be able to
 * join without a redesign. A column added LATER must be registered in `schema-guard.ts` with a
 * NOT NULL DEFAULT; a fresh CREATE TABLE like this one needs no such registration.
 *
 * The composite primary key mirrors `workspace_layout` exactly. The foreign key — with the
 * per-connection `PRAGMA foreign_keys = ON` — is what makes deleting a project cascade its
 * document rows for free.
 */
export const MIGRATION_V7_VERSION = 7;

export function applyMigrationV7(db: ThrongDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_state (
      owner_user   TEXT NOT NULL,
      project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      rel_path     TEXT NOT NULL,
      language_id  TEXT,
      updated_at   TEXT NOT NULL,
      PRIMARY KEY (owner_user, project_id, rel_path)
    );
    CREATE INDEX IF NOT EXISTS idx_docstate_owner_project
      ON document_state(owner_user, project_id);
  `);
}
