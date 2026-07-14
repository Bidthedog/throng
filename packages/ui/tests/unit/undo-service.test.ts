/**
 * The document-level undo history (016, T084 · FR-026d/FR-026e).
 *
 * The stack belongs to the DOCUMENT. It is not a view's history, and it is not CodeMirror's —
 * which is the entire reason it exists: a per-view `history()` cannot let view B undo an edit made
 * in view A, and two views of one document must share one past.
 *
 * This module owns ONLY the stacks and their bounds. Inverting a change and applying it is the
 * authority's job (it owns the content), so those live in `document-authority.ts` and are proven
 * there. What is proven HERE is the shape of the history itself.
 */
import { describe, expect, it } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import { MAX_UNDO_ENTRIES, UndoHistory, type UndoEntry } from '../../src/main/undo-service.js';

/** A throwaway entry — only its identity matters to the stack. */
const entry = (label: string): UndoEntry => ({
  changes: ChangeSet.of({ from: 0, insert: label }, 0),
  inverted: ChangeSet.of({ from: 0, to: label.length }, label.length),
  selectionBefore: null,
  viewId: 'view-a',
});

describe('UndoHistory', () => {
  it('records ONE entry per command, however many ranges that command touched', () => {
    // A multi-cursor edit is one command and one transaction, so it is one entry — not one per
    // cursor. The stack never sees the cursors; it sees the transaction (FR-026e).
    const history = new UndoHistory();
    history.record({
      changes: ChangeSet.of(
        [
          { from: 0, insert: '1' },
          { from: 2, insert: '2' },
          { from: 4, insert: '3' },
        ],
        5,
      ),
      inverted: ChangeSet.empty(8),
      selectionBefore: null,
      viewId: 'view-a',
    });
    expect(history.undoDepth).toBe(1);
  });

  it('is bounded, discarding the OLDEST entry first (FR-026d)', () => {
    const history = new UndoHistory();
    for (let i = 0; i < MAX_UNDO_ENTRIES + 20; i += 1) history.record(entry(`e${i}`));

    expect(history.undoDepth).toBe(MAX_UNDO_ENTRIES);
    // The most RECENT edit is still undoable — it is the oldest end that was dropped.
    const popped = history.popUndo();
    expect(popped?.changes.toJSON()).toEqual(entry(`e${MAX_UNDO_ENTRIES + 19}`).changes.toJSON());
  });

  it('bounds at AT LEAST 500 entries — a long session keeps a usable past', () => {
    expect(MAX_UNDO_ENTRIES).toBeGreaterThanOrEqual(500);
  });

  it('DISCARDS the redo branch when a new edit is recorded', () => {
    // The redo branch described a future that no longer follows from here.
    const history = new UndoHistory();
    history.record(entry('a'));
    history.pushRedo(history.popUndo()!);
    expect(history.redoDepth).toBe(1);

    history.record(entry('b'));
    expect(history.redoDepth).toBe(0);
  });

  it('moves an entry between the stacks WITHOUT discarding the branch it came from', () => {
    // Undo → redo → undo must be repeatable. `pushUndo` (the redo path) must NOT clear the redo
    // stack the way `record` (a new edit) does, or redoing once would destroy every further redo.
    const history = new UndoHistory();
    history.record(entry('a'));
    history.record(entry('b'));

    history.pushRedo(history.popUndo()!); // undo b
    history.pushRedo(history.popUndo()!); // undo a
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(2);

    history.pushUndo(history.popRedo()!); // redo a
    expect(history.undoDepth).toBe(1);
    expect(history.redoDepth).toBe(1); // …b is STILL redoable
  });

  it('pops nothing from an empty stack rather than throwing', () => {
    const history = new UndoHistory();
    expect(history.popUndo()).toBeNull();
    expect(history.popRedo()).toBeNull();
  });

  it('is CLEARED wholesale — both stacks — on revert or an external reload', () => {
    // The history describes content that no longer exists. Undoing into it would splice fragments
    // of a discarded document back into the one the user now has.
    const history = new UndoHistory();
    history.record(entry('a'));
    history.pushRedo(history.popUndo()!);
    history.record(entry('b'));

    history.clear();
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(0);
  });

  it('knows nothing about saving — a save is not a barrier in the history (FR-026d)', () => {
    // Undo past a save is allowed, and re-dirties the document. That works precisely BECAUSE the
    // history has no concept of a save to stop at: `dirty` is derived from the version by the
    // authority, so there is nothing here to keep in step.
    const history = new UndoHistory();
    expect('markSaved' in history).toBe(false);
    expect('savedVersion' in history).toBe(false);
  });
});
