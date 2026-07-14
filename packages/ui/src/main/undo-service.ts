import type { ChangeSet } from '@codemirror/state';
import type { MergeClass } from '@throng/core';

/**
 * The undo history of ONE document (016, FR-026c/FR-026d/FR-026e).
 *
 * The stack belongs to the document, never to a view. That is the whole point: CodeMirror's
 * `history()` is a state field of a single `EditorView`, so two views of one document get two
 * pasts, and Undo in one of them cannot reach an edit made in the other. Moving the stack up to
 * the document — beside the authority that owns the text — is what makes FR-026c possible at all.
 *
 * This module owns the STACKS. It does not own the text, so it cannot invert or apply anything:
 * a change is only invertible against the document it was applied to, and that document belongs to
 * {@link DocumentAuthority}. The authority inverts, applies, and hands the entry here. Splitting it
 * the other way — a history that reaches into the document to invert — would make two owners of the
 * content, which is exactly what Principle XI forbids.
 */

/** One undoable step: a command, not a cursor. A multi-cursor edit is ONE of these. */
export interface UndoEntry {
  /** The change as applied to the canonical document. */
  changes: ChangeSet;
  /** Its inverse — what undoing it applies. */
  inverted: ChangeSet;
  /** The cursor set to restore in the view that invokes undo (FR-026a/FR-026f). */
  selectionBefore: unknown;
  /** The view that made the edit. Recorded, but NOT where the cursors go on undo — they go to
   *  whichever view invoked it, so undo never yanks the viewport of a view the user did not act in. */
  viewId: string;
  /** The document version this entry produced. A later change may only merge into it if nothing
   *  else has landed since — otherwise the two are not adjacent in the one ordered history. */
  version: number;
  /** How a following change may coalesce with this one. */
  mergeClass: MergeClass;
  /** When it was recorded, so a run that the user paused in the middle of becomes two entries. */
  at: number;
}

/**
 * Bounded at 500 entries, oldest discarded first (FR-026d). Fixed, and deliberately not a setting:
 * an unbounded history is a memory leak with a friendly name, and no user has an opinion about the
 * five-hundredth entry.
 */
export const MAX_UNDO_ENTRIES = 500;

export class UndoHistory {
  private readonly undoStack: UndoEntry[] = [];
  private readonly redoStack: UndoEntry[] = [];

  /**
   * A NEW edit was applied. Pushes it, bounds the stack, and discards the redo branch — which
   * described a future that no longer follows from here.
   */
  record(entry: UndoEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_UNDO_ENTRIES) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** The most recent entry, without removing it — the candidate a new change may merge into. */
  peekUndo(): UndoEntry | null {
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }

  /**
   * Replace the most recent entry with one that ABSORBS a following change (a continued typing or
   * deletion run). The redo branch is already empty whenever this is legal — merging requires the
   * top entry to be the last thing applied, and an undo would have moved it — but it is cleared
   * anyway, because this is a new edit and a new edit invalidates redo.
   */
  replaceTop(entry: UndoEntry): void {
    if (this.undoStack.length === 0) throw new Error('[undo-service] nothing to merge into');
    this.undoStack[this.undoStack.length - 1] = entry;
    this.redoStack.length = 0;
  }

  popUndo(): UndoEntry | null {
    return this.undoStack.pop() ?? null;
  }

  popRedo(): UndoEntry | null {
    return this.redoStack.pop() ?? null;
  }

  /**
   * Move an entry onto the undo stack (the redo path). Unlike {@link record} this must NOT clear
   * the redo branch — a redo does not invalidate the redos above it, and clearing here would make
   * undo → redo → redo lose everything past the first step.
   */
  pushUndo(entry: UndoEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_UNDO_ENTRIES) this.undoStack.shift();
  }

  /** Move an entry onto the redo stack (the undo path). */
  pushRedo(entry: UndoEntry): void {
    this.redoStack.push(entry);
  }

  /**
   * Forget everything (revert, external reload, document closed).
   *
   * The entries describe content that no longer exists: undoing into them would splice fragments of
   * a document the user explicitly discarded back into the one they now have.
   */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /** Both stacks, for persistence (FR-027a). Copies: the caller must not be able to mutate them. */
  get entries(): { undo: readonly UndoEntry[]; redo: readonly UndoEntry[] } {
    return { undo: [...this.undoStack], redo: [...this.redoStack] };
  }

  /** Replace both stacks with a history recovered from disk (FR-027a). */
  restore(undo: readonly UndoEntry[], redo: readonly UndoEntry[]): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.undoStack.push(...undo.slice(-MAX_UNDO_ENTRIES));
    this.redoStack.push(...redo.slice(-MAX_UNDO_ENTRIES));
  }
}
