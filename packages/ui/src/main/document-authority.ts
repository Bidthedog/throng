import { ChangeSet, Text } from '@codemirror/state';
import type {
  CanonicalChangeMsg,
  DispatchChangeMsg,
  SerialisedHistory,
  SerialisedUndoEntry,
} from '@throng/core';
import { UndoHistory, type UndoEntry } from './undo-service.js';

/**
 * THE single source of truth for one open document (016, FR-028f · constitution XI).
 *
 * Principle XI tests AUTHORITY, not mechanism: one owner, one ordered change stream, no two
 * originals. The shipped editor failed that test twice over — mirrored views were two `EditorView`s,
 * each its own source of truth, reconciling by whole-document replace. That is peer-to-peer
 * reconciliation between co-equal copies, which XI forbids by name.
 *
 * So UI main owns the document. Every `EditorView` is a derived replica, changed only by applying
 * the ordered stream this class emits.
 *
 * ## Why a rebase, and not simply a ChangeSet relay
 *
 * Swapping the whole-document relay for a plain `ChangeSet` relay — without a version and a rebase
 * — would be WORSE than what shipped. A change that was in flight against a since-superseded
 * version would land at the position it originally NAMED, silently corrupting text, where
 * whole-document replace was at least crude and internally consistent. The version and the rebase
 * are the point, not a refinement of it.
 *
 * ## Why a stale change is never rejected
 *
 * The view has ALREADY shown the user their keystroke — typing cannot wait for a round trip.
 * Rejecting a stale change would visibly revert input the user watched themselves type. So it is
 * rebased and applied, and the rebased form goes out on the canonical stream.
 *
 * ## Why the originator is not told it was rebased
 *
 * Because it already knows. A replica rebases its own in-flight change over each canonical change
 * it receives, using the complementary tie-break (`map(other, true)` on the incoming change,
 * `map(other)` on its own) — so it derives EXACTLY the change this class computes, and its
 * optimistic copy is already correct when the acknowledgement arrives. The originator therefore
 * applies nothing on its own ack; it advances its version. An earlier draft echoed a "you were
 * rebased" flag back to it, which would have been either redundant or, if acted on, a second
 * application of a change already present. Convergence is proven by the two-replica tests, not
 * asserted by a flag.
 *
 * This is not a collaborative-editing engine. There is one history and one authority, and the only
 * thing ever rebased is an in-flight change against changes already ordered — a single
 * `ChangeSet.map()`, not a protocol.
 */

/**
 * How far back a stale change may be rebased.
 *
 * A replica keeps at most ONE change in flight, so its `baseVersion` can only lag by the number of
 * canonical changes the authority emits during a single IPC round trip — in practice zero or one.
 * The window is three orders of magnitude larger than that. It exists so that `applied` cannot grow
 * without bound over a long editing session, not because the limit is expected to be reached.
 */
export const MAX_REBASE_WINDOW = 1000;

/**
 * How long a typing run stays open (ms). A pause longer than this starts a new undo entry, so a
 * user who types, thinks, then types again does not lose both runs to one Ctrl+Z. This is
 * CodeMirror's own `newGroupDelay` default, kept deliberately: the behaviour it produces is the one
 * this editor had before the history moved out of the view, and users had no complaint with it.
 */
export const NEW_GROUP_DELAY_MS = 500;

export class DocumentAuthority {
  /** The canonical content. The ONLY original. */
  private content: Text;
  /** Monotonic; bumped once per applied change. Orders the stream — it does NOT measure dirt. */
  private currentVersion = 0;
  /** The content last written to disk. `null` once the backing file is gone (FR-099). */
  private savedDoc: Text | null;
  /** Recent applied changes, in order — what a stale change is rebased over. Bounded. */
  private readonly applied: ChangeSet[] = [];
  /** The version of `applied[0]`. Anything older than this can no longer be rebased. */
  private appliedBase = 0;

  private readonly history = new UndoHistory();

  constructor(
    readonly documentId: string,
    initialText = '',
    /** Injected so a test can hold time still and prove the run-grouping rule exactly. */
    private readonly now: () => number = Date.now,
  ) {
    this.content = Text.of(splitLines(initialText));
    this.savedDoc = this.content;
  }

  get doc(): Text {
    return this.content;
  }

  get text(): string {
    return this.content.toString();
  }

  /** The content last written to disk — what a revert restores. `null` once the file is gone. */
  get savedText(): string | null {
    return this.savedDoc?.toString() ?? null;
  }

  get version(): number {
    return this.currentVersion;
  }

  /**
   * DERIVED, never set. A view cannot relay a dirty flag, because a relayed flag would be a second
   * peer-owned value — the very thing Principle XI forbids.
   *
   * ## Why this compares CONTENT, and not `version !== savedVersion`
   *
   * The contract originally specified the version comparison, and it is wrong — provably, and in a
   * way the user would see. An undo is not a rewind: it is the INVERSE change, applied forward, and
   * it therefore ADVANCES the version like any other change. So undoing an edit back to exactly the
   * text on disk leaves `version > savedVersion`, and the document would report unsaved changes
   * while being byte-for-byte identical to its file — an unsaved dot on a document the user just
   * pressed Ctrl+Z to restore, and a needless rewrite on the next Save-All.
   *
   * The version's job is to ORDER the change stream. Whether the document differs from its file is a
   * question about content, so it is answered by comparing content. `Text.eq` short-circuits on
   * length, which differs for almost every dirty document, so the common case costs nothing.
   */
  get dirty(): boolean {
    // No saved document at all — the backing file was deleted out from under us (FR-099).
    if (this.savedDoc === null) return true;
    return !this.content.eq(this.savedDoc);
  }

  /** The document was written to disk: what we hold is now what the file holds. */
  markSaved(): void {
    this.savedDoc = this.content;
  }

  /**
   * The backing file was DELETED while the document was open (FR-099). No version of this text is
   * on disk any more, so it is dirty whatever it now contains — and stays dirty until a save
   * re-creates the file. Expressed as "there is no saved document" rather than a settable flag: a
   * flag a caller could set is the peer-owned state Principle XI exists to prevent.
   */
  markUnsaved(): void {
    this.savedDoc = null;
  }

  /**
   * Apply a change from a view, REBASING it if it was computed against a superseded version.
   *
   * Returns the canonical change to broadcast to EVERY view — the originator included — or `null`
   * when the change described a document that no longer exists (see below).
   */
  dispatch(msg: DispatchChangeMsg): CanonicalChangeMsg | null {
    if (msg.baseVersion > this.currentVersion) {
      // A replica cannot outrun its authority. This is a bug in the caller, and guessing what it
      // meant would corrupt the document — so fail loudly rather than silently coerce.
      throw new Error(
        `[document-authority] a view sent baseVersion ${msg.baseVersion}, AHEAD of the authority's ${this.currentVersion} — a replica cannot outrun its authority`,
      );
    }
    if (msg.baseVersion < this.appliedBase) {
      // The changes needed to rebase this one are gone — because the document was REPLACED under
      // it (a revert, or an external reload). The edit describes text the user has already
      // discarded, and there is no honest position to land it at: rebasing is impossible and
      // applying it verbatim would splice fragments of a dead document into the live one. Drop it,
      // and let the caller resynchronise the view that sent it.
      return null;
    }

    let changes = ChangeSet.fromJSON(msg.changes);
    for (let v = msg.baseVersion; v < this.currentVersion; v += 1) {
      // Rebase over everything that landed in between, so the change ends up where the user meant
      // it — not at the offset it named against a document that no longer exists.
      changes = changes.map(this.applied[v - this.appliedBase]);
    }

    const inverted = changes.invert(this.content);
    const versionBefore = this.currentVersion;
    this.apply(changes);
    this.record(msg, changes, inverted, versionBefore);

    return {
      documentId: this.documentId,
      kind: 'edit',
      changes: changes.toJSON(),
      version: this.currentVersion,
      dirty: this.dirty,
      origin: msg.viewId,
    };
  }

  /**
   * Undo the last change, whichever view made it (FR-026c).
   *
   * The stack belongs to the DOCUMENT, so Undo in a mirrored view reverts an edit made in the
   * other one — which is the entire guarantee, and the thing a per-view `history()` can never do.
   * The recorded cursor set is returned to the INVOKING view only (FR-026f); other views keep
   * their own cursors, and undo never yanks the viewport of a view the user did not act in.
   */
  undo(invokingViewId: string): CanonicalChangeMsg | null {
    const entry = this.history.popUndo();
    if (!entry) return null;

    // The inverse is expressed against the document as it was AFTER the change. Since undo only
    // ever pops the most recent change, that is exactly the document we have.
    const changes = entry.inverted;
    const inverted = changes.invert(this.content);
    this.apply(changes);
    this.history.pushRedo({ ...entry, changes, inverted });

    return {
      documentId: this.documentId,
      kind: 'undo',
      changes: changes.toJSON(),
      version: this.currentVersion,
      dirty: this.dirty,
      origin: invokingViewId,
      selection: entry.selectionBefore,
    };
  }

  /** Redo what undo undid. */
  redo(invokingViewId: string): CanonicalChangeMsg | null {
    const entry = this.history.popRedo();
    if (!entry) return null;

    const changes = entry.inverted;
    const inverted = changes.invert(this.content);
    this.apply(changes);
    this.history.pushUndo({ ...entry, changes, inverted });

    return {
      documentId: this.documentId,
      kind: 'redo',
      changes: changes.toJSON(),
      version: this.currentVersion,
      dirty: this.dirty,
      origin: invokingViewId,
      selection: entry.selectionBefore,
    };
  }

  /**
   * Replace the document wholesale — a revert, an external reload, or the initial load.
   *
   * The history is CLEARED, because it describes content that no longer exists: undoing into it
   * would splice fragments of a document the user has explicitly discarded back into the one they
   * now have. For the same reason the rebase window is closed: a change still in flight against the
   * OLD document can no longer be landed, and `dispatch` will drop it rather than corrupt this one.
   */
  reset(text: string, markClean = true): void {
    this.content = Text.of(splitLines(text));
    this.currentVersion += 1;
    this.applied.length = 0;
    this.appliedBase = this.currentVersion;
    this.history.clear();
    // `markClean: false` restores content that is NOT what the file holds — unsaved edits recovered
    // after a crash (FR-102). The saved document is left as it was: the disk's content, which is
    // what the recovered text must be compared against to know it is dirty.
    if (markClean) this.savedDoc = this.content;
  }

  /** How deep the undo stack is — for tests and diagnostics. */
  get undoDepth(): number {
    return this.history.undoDepth;
  }

  get redoDepth(): number {
    return this.history.redoDepth;
  }

  /** The undo history as JSON, for the recovery snapshot (FR-027a). */
  serialiseHistory(): SerialisedHistory {
    const toJson = (entry: UndoEntry): SerialisedUndoEntry => ({
      changes: entry.changes.toJSON(),
      inverted: entry.inverted.toJSON(),
      selectionBefore: entry.selectionBefore,
      viewId: entry.viewId,
      version: entry.version,
      mergeClass: entry.mergeClass,
      at: entry.at,
    });
    const { undo, redo } = this.history.entries;
    return { undo: undo.map(toJson), redo: redo.map(toJson) };
  }

  /**
   * Adopt a history recovered from disk (FR-027a).
   *
   * A corrupt or truncated entry takes the history down with it rather than being skipped: the
   * stack is a CHAIN — each entry's inverse is only meaningful against the document the one above it
   * produced — so quietly dropping a link in the middle would leave an undo that splices the wrong
   * text back into the file. An empty history costs the user their undo; a broken one costs them
   * their document.
   */
  restoreHistory(history: SerialisedHistory): void {
    try {
      const fromJson = (entry: SerialisedUndoEntry): UndoEntry => ({
        changes: ChangeSet.fromJSON(entry.changes),
        inverted: ChangeSet.fromJSON(entry.inverted),
        selectionBefore: entry.selectionBefore,
        viewId: entry.viewId,
        version: entry.version,
        mergeClass: entry.mergeClass,
        at: entry.at,
      });
      this.history.restore(history.undo.map(fromJson), history.redo.map(fromJson));
    } catch {
      this.history.clear();
    }
  }

  /**
   * File the change in the undo history — either as a new entry, or ABSORBED into the run already
   * open above it (FR-026).
   *
   * A run stays open only while every one of these holds: the same view is still typing (or still
   * deleting), the change class matches, nothing else has landed in between, the user has not
   * paused, and the new change is contiguous with the run's edge. Break any of them and the run
   * closes — which is what makes a paste, a command, or a jump to another line its own undo step.
   */
  private record(
    msg: DispatchChangeMsg,
    changes: ChangeSet,
    inverted: ChangeSet,
    versionBefore: number,
  ): void {
    const at = this.now();
    const entry: UndoEntry = {
      changes,
      inverted,
      selectionBefore: msg.selectionBefore,
      viewId: msg.viewId,
      version: this.currentVersion,
      mergeClass: msg.mergeClass ?? null,
      at,
    };

    const top = this.history.peekUndo();
    const continuesRun =
      entry.mergeClass !== null &&
      top !== null &&
      top.mergeClass === entry.mergeClass &&
      top.viewId === entry.viewId &&
      // Nothing landed between them, so they really are adjacent in the one ordered history.
      top.version === versionBefore &&
      at - top.at <= NEW_GROUP_DELAY_MS &&
      isContiguous(top.changes, changes);

    if (!continuesRun) {
      this.history.record(entry);
      return;
    }

    // Absorb it: the run reverts as one, and restores the cursor set from before the run BEGAN.
    this.history.replaceTop({
      ...entry,
      changes: top.changes.compose(changes),
      // The run's inverse runs newest-first: undo this change, then undo everything before it.
      inverted: inverted.compose(top.inverted),
      selectionBefore: top.selectionBefore,
    });
  }

  /** Apply a canonical change to the content and advance the version. */
  private apply(changes: ChangeSet): void {
    this.content = changes.apply(this.content);
    this.applied.push(changes);
    if (this.applied.length > MAX_REBASE_WINDOW) {
      this.applied.shift();
      this.appliedBase += 1;
    }
    this.currentVersion += 1;
  }
}

/** The outer bounds of everything a change touched, on each side of it. */
function span(changes: ChangeSet): { fromA: number; toA: number; fromB: number; toB: number } | null {
  let bounds: { fromA: number; toA: number; fromB: number; toB: number } | null = null;
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    bounds = bounds
      ? {
          fromA: Math.min(bounds.fromA, fromA),
          toA: Math.max(bounds.toA, toA),
          fromB: Math.min(bounds.fromB, fromB),
          toB: Math.max(bounds.toB, toB),
        }
      : { fromA, toA, fromB, toB };
  });
  return bounds;
}

/**
 * Does `next` continue the run that `run` ended?
 *
 * `run`'s B-side and `next`'s A-side both describe the CURRENT document, so they are directly
 * comparable. Typing continues where the last insertion ended; backspacing continues leftwards from
 * where the last deletion began; a forward delete continues at the same offset. Anything else — the
 * user clicked somewhere else and carried on typing — starts a new entry, so one Ctrl+Z does not
 * swallow edits made in two unrelated places.
 */
function isContiguous(run: ChangeSet, next: ChangeSet): boolean {
  const a = span(run);
  const b = span(next);
  if (!a || !b) return false;
  return b.fromA === a.toB || b.toA === a.fromB || b.fromA === a.fromB;
}

/** Split on any line ending WITHOUT normalising it — the text keeps whatever it came with. */
function splitLines(text: string): string[] {
  return text.split('\n');
}
