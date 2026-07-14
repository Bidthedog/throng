import type { ThrongDatabase } from './database.js';

/** One document's persisted state (016, FR-028e). */
export interface DocumentState {
  projectId: string;
  /** Project-relative path. A file belongs to exactly one project (Principle I). */
  relPath: string;
  /** The manual language override; null when the document has none. */
  languageId: string | null;
}

interface DocumentStateRow {
  project_id: string;
  rel_path: string;
  language_id: string | null;
}

/**
 * Per-document state over better-sqlite3 (016, FR-028e).
 *
 * Keyed by owner + project + project-relative path, so the row is found by the FILE, not by the
 * panel that happened to be showing it. That is the entire point: an override set today must be
 * adopted by a panel that opens the file next week, in another window or another session — a
 * question a panel-keyed layout blob cannot answer.
 *
 * The table is deliberately shaped for per-document state in general; `encoding` and `line_ending`
 * are its declared next occupants.
 */
export class DocumentStateRepository {
  constructor(private readonly db: ThrongDatabase) {}

  /** The document's state, or null when it has none. Never throws for an unknown path. */
  get(ownerUser: string, projectId: string, relPath: string): DocumentState | null {
    const row = this.db
      .prepare(
        `SELECT project_id, rel_path, language_id FROM document_state
          WHERE owner_user = ? AND project_id = ? AND rel_path = ?`,
      )
      .get(ownerUser, projectId, relPath) as DocumentStateRow | undefined;
    return row ? toState(row) : null;
  }

  /**
   * Set the document's language override, or REMOVE the row when `languageId` is null.
   *
   * A null is an erasure, not a stored "no override": an absent row and a row holding null mean
   * the same thing, and keeping both would be two ways to say one thing. But `'plaintext'` is NOT
   * null — it is a real, deliberate decision by the user that this file is plain text, and it is
   * stored as a real row (FR-004c). Collapsing it to null would silently discard the choice and
   * hand the file back to detection, which is precisely what the user overrode.
   */
  set(ownerUser: string, projectId: string, relPath: string, languageId: string | null): DocumentState {
    if (languageId === null) {
      this.db
        .prepare(
          `DELETE FROM document_state WHERE owner_user = ? AND project_id = ? AND rel_path = ?`,
        )
        .run(ownerUser, projectId, relPath);
      return { projectId, relPath, languageId: null };
    }
    this.db
      .prepare(
        `INSERT INTO document_state (owner_user, project_id, rel_path, language_id, updated_at)
           VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_user, project_id, rel_path)
           DO UPDATE SET language_id = excluded.language_id, updated_at = excluded.updated_at`,
      )
      .run(ownerUser, projectId, relPath, languageId, new Date().toISOString());
    return { projectId, relPath, languageId };
  }

  /**
   * Carry a document's row with the file across an in-throng rename or move (FR-028e).
   *
   * A SINGLE atomic statement, deliberately — not a client-side get → set-new → delete-old, which
   * is three round-trips with two windows in which a crash leaves the override duplicated or lost.
   *
   * `false` when there was no row: most files carry no override, so that is the COMMON CASE, not
   * an error. A row already at the destination is replaced — the moved row describes the file that
   * now lives there.
   */
  movePath(ownerUser: string, projectId: string, fromRelPath: string, toRelPath: string): boolean {
    const move = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM document_state WHERE owner_user = ? AND project_id = ? AND rel_path = ?`,
        )
        .run(ownerUser, projectId, toRelPath);
      return this.db
        .prepare(
          `UPDATE document_state SET rel_path = ?, updated_at = ?
            WHERE owner_user = ? AND project_id = ? AND rel_path = ?`,
        )
        .run(toRelPath, new Date().toISOString(), ownerUser, projectId, fromRelPath).changes;
    });
    return move() > 0;
  }

  /** Remove a document's row — the file was deleted inside throng (FR-028e). */
  remove(ownerUser: string, projectId: string, relPath: string): boolean {
    return (
      this.db
        .prepare(`DELETE FROM document_state WHERE owner_user = ? AND project_id = ? AND rel_path = ?`)
        .run(ownerUser, projectId, relPath).changes > 0
    );
  }

  /**
   * Drop rows whose file no longer exists, so the table cannot grow without bound (FR-028e).
   *
   * The backstop for files removed OUTSIDE throng — a delete inside throng removes its row there
   * and then. Called on project open, never on the path that opens a file: it must not be what
   * stands between the user and their first document.
   *
   * It asks `exists` about each ROW, rather than being handed a list of the files that survive.
   * That difference matters: a caller who supplied an INCOMPLETE list — a shallow directory
   * listing, say — would silently delete every override in every subdirectory it forgot to walk.
   * Asking row-by-row is also O(rows), not O(files in the project); a file with no override is
   * never looked at, and most files have none.
   */
  pruneMissing(
    ownerUser: string,
    projectId: string,
    exists: (relPath: string) => boolean,
  ): number {
    const rows = this.db
      .prepare(`SELECT project_id, rel_path, language_id FROM document_state
                 WHERE owner_user = ? AND project_id = ?`)
      .all(ownerUser, projectId) as DocumentStateRow[];
    const doomed = rows.filter((r) => !exists(r.rel_path));
    if (doomed.length === 0) return 0;
    const del = this.db.prepare(
      `DELETE FROM document_state WHERE owner_user = ? AND project_id = ? AND rel_path = ?`,
    );
    const prune = this.db.transaction(() => {
      for (const row of doomed) del.run(ownerUser, projectId, row.rel_path);
    });
    prune();
    return doomed.length;
  }
}

function toState(row: DocumentStateRow): DocumentState {
  return {
    projectId: row.project_id,
    relPath: row.rel_path,
    // A stale id — a language a later build removed — is returned AS IT WAS STORED. It is never
    // rewritten or dropped, so a build that reintroduces the language resolves it again (FR-005b).
    languageId: row.language_id,
  };
}
