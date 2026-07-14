/**
 * `document.*` daemon RPC (016, FR-028b/FR-028e) — see
 * `specs/016-advanced-editor/contracts/document-state-rpc.md`.
 *
 * Persists the document-scoped manual language override, so a panel opening the file LATER — in
 * another session, another window, or a sub-workspace — ADOPTS it rather than re-detecting.
 *
 * The OWNER IS NEVER SENT BY THE CLIENT. The daemon resolves it from `IUserContext`, exactly as
 * `projects.*` and `workspace.*` already do: a client that could name its own owner could read
 * another user's rows.
 */
export const DOCUMENT_GET_STATE_METHOD = 'document.getState';
export const DOCUMENT_SET_STATE_METHOD = 'document.setState';
export const DOCUMENT_MOVE_PATH_METHOD = 'document.movePath';
export const DOCUMENT_PRUNE_METHOD = 'document.pruneMissing';

/** Per-document state, keyed by project + project-relative path. */
export interface DocumentStateDto {
  projectId: string;
  relPath: string;
  /** The manual language override; null when none. A stale id is PRESERVED, never rewritten. */
  languageId: string | null;
}

export interface DocumentGetStateParams {
  projectId: string;
  relPath: string;
}
export interface DocumentGetStateResult {
  state: DocumentStateDto | null;
}

export interface DocumentSetStateParams {
  projectId: string;
  relPath: string;
  languageId: string | null;
}
export interface DocumentSetStateResult {
  state: DocumentStateDto;
}

/** Carry a document's state with the file across an in-throng rename or move (FR-028e). */
export interface DocumentMovePathParams {
  projectId: string;
  fromRelPath: string;
  toRelPath: string;
}
export interface DocumentMovePathResult {
  /** false when there was no row — the common case, not an error. */
  moved: boolean;
}

/**
 * Drop rows whose file no longer exists, so the table cannot grow without bound.
 *
 * The client sends ONLY the project id. It does NOT send the list of files that still exist —
 * that was the original shape, and it is a trap: a client that supplied an incomplete list (a
 * shallow directory listing, a tree it had not finished walking) would silently delete every
 * override in every subdirectory it missed. The daemon knows the project's root folder, so it
 * checks each ROW instead — O(rows), never O(files), and impossible to over-delete.
 */
export interface DocumentPruneParams {
  projectId: string;
}
export interface DocumentPruneResult {
  pruned: number;
}
