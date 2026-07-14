/**
 * The wire between a document's AUTHORITY and its replicas (016, FR-028f · constitution XI).
 *
 * These types live in core because both ends must agree on them and neither end may own them: the
 * authority runs in UI main, the replicas run in every renderer showing the document, and a type
 * that lived in either would make the other import across the process boundary.
 *
 * `changes` is deliberately `unknown` — a serialised CodeMirror `ChangeSet` (`toJSON()`). Core is
 * platform-abstracted and does not depend on the editor library; it carries the payload without
 * inspecting it, and each end parses with `ChangeSet.fromJSON`.
 */

/**
 * How a change may coalesce into the undo entry before it.
 *
 * A run of typed characters is ONE thing to undo. Only the VIEW can classify this — a paste and a
 * keystroke produce indistinguishable ChangeSets, and FR-026 requires the paste to be its own single
 * entry — so the view decides the class and the authority decides whether to merge.
 *
 * `null` never merges: a paste, a drop, a command, a replace-all.
 */
export type MergeClass = 'type' | 'delete' | null;

/** replica → authority. A change the user has ALREADY seen applied in their view. */
export interface DispatchChangeMsg {
  documentId: string;
  /** The originating VIEW — not the panel. Two mirrored views of one document share a panelId and
   *  must still be told apart: each is a separate replica with its own in-flight change. */
  viewId: string;
  /** Serialised CodeMirror ChangeSet (`toJSON()`). */
  changes: unknown;
  /** The version this change was computed against. MAY be stale by the time it arrives. */
  baseVersion: number;
  /** The cursor/selection set before the change, for the undo entry (FR-026a). */
  selectionBefore: unknown;
  /** How this change may coalesce into the previous undo entry (FR-026). */
  mergeClass?: MergeClass;
}

/** authority → EVERY replica, the originator included. The one ordered canonical stream. */
export interface CanonicalChangeMsg {
  documentId: string;
  /**
   * What produced this change.
   *
   * The originator of an `edit` has ALREADY applied it locally and must not apply it again. The
   * invoker of an `undo` or `redo` has applied NOTHING — it asked the authority to act — and must.
   * Both carry the invoking view as their origin, so without this they are indistinguishable, and a
   * user who pressed Ctrl+Z while a keystroke was still in flight would watch the undo be swallowed
   * as though it were their own edit coming back.
   */
  kind: 'edit' | 'undo' | 'redo';
  /** Possibly REBASED — not necessarily what the view sent. */
  changes: unknown;
  /** The document version AFTER applying it. */
  version: number;
  /** DERIVED by the authority (`version !== savedVersion`) — never relayed by a view. */
  dirty: boolean;
  /** The view this change came from. Its replica recognises its own acknowledgement by this and
   *  applies nothing — it has already rebased its in-flight change over the same stream, so its
   *  copy matches. Every other replica applies the change. */
  origin: string;
  /** An undo/redo restores the recorded cursor set — but only in the view that INVOKED it (FR-026f). */
  selection?: unknown;
}

/**
 * authority → EVERY replica. The document was REPLACED wholesale: a revert, an external reload, or
 * a resynchronisation after a replica fell out of step.
 *
 * This is not a peer-to-peer relay of state — it still comes from the one owner, on the one ordered
 * stream. It exists because a replacement has no meaningful expression as a rebasable change: the
 * document it would be rebased against is precisely the one being discarded. A replica that receives
 * it drops whatever it had in flight, because that change described the dead document.
 */
export interface ResetDocumentMsg {
  documentId: string;
  text: string;
  version: number;
  dirty: boolean;
}
