import type { ThrongDatabase } from './database.js';

interface FileOpUndoRow {
  stack_json: string;
}

/**
 * The per-project file-operation undo/redo stack over better-sqlite3 (024 US3, #85; migration v8).
 *
 * Stores the stack as ONE JSON blob per (owner, project) — the pure engine in `@throng/core` owns its
 * shape and always reads/writes it whole, so a blob keeps the bounded-50 stack atomic and lets the
 * store stay ignorant of the entry format. Keyed like `document_state`; the CASCADE foreign key drops
 * a deleted project's history for free.
 */
export class FileOpUndoRepository {
  constructor(private readonly db: ThrongDatabase) {}

  /** The stored stack JSON for a project, or null when none has been saved. Never throws. */
  get(ownerUser: string, projectId: string): string | null {
    const row = this.db
      .prepare('SELECT stack_json FROM fileop_undo WHERE owner_user = ? AND project_id = ?')
      .get(ownerUser, projectId) as FileOpUndoRow | undefined;
    return row ? row.stack_json : null;
  }

  /** Upsert the project's stack JSON. The caller (main) serialises via the core engine. */
  set(ownerUser: string, projectId: string, stackJson: string, updatedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO fileop_undo(owner_user, project_id, stack_json, updated_at)
           VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_user, project_id)
           DO UPDATE SET stack_json = excluded.stack_json, updated_at = excluded.updated_at`,
      )
      .run(ownerUser, projectId, stackJson, updatedAt);
  }

  /** Drop a project's stack (e.g. an explicit clear). */
  remove(ownerUser: string, projectId: string): void {
    this.db
      .prepare('DELETE FROM fileop_undo WHERE owner_user = ? AND project_id = ?')
      .run(ownerUser, projectId);
  }
}
