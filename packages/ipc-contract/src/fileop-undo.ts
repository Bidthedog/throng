/**
 * `fileopUndo.*` daemon RPC (024 US3, #85).
 *
 * Persists a project's file-operation undo/redo stack, so undo survives a restart rather than being
 * a session's private memory — which is the point of FR-010: a user who deletes the wrong folder
 * and closes throng before noticing should still be able to put it back.
 *
 * The stack travels as ONE opaque JSON string. Its shape belongs to the pure engine in
 * `@throng/core`, which always reads and writes it whole, so neither the wire nor the store has to
 * know what an entry is — and a bounded 50-entry stack stays atomic across a save.
 *
 * The OWNER IS NEVER SENT BY THE CLIENT, exactly as `document.*` does not send it: the daemon
 * resolves it from `IUserContext`, so a client cannot ask for another user's history by naming them.
 */
export const FILEOP_UNDO_GET_METHOD = 'fileopUndo.get';
export const FILEOP_UNDO_SET_METHOD = 'fileopUndo.set';

export interface FileOpUndoGetParams {
  projectId: string;
}
export interface FileOpUndoGetResult {
  /** The stored stack JSON, or null when the project has no history yet. */
  stackJson: string | null;
}

export interface FileOpUndoSetParams {
  projectId: string;
  stackJson: string;
}
export interface FileOpUndoSetResult {
  ok: true;
}
