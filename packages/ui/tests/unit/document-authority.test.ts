/**
 * SC-013b — the race, CONSTRUCTED rather than observed (016, FR-028f).
 *
 * Two mirrored views, both editable, both dispatching a change computed against the SAME version.
 * One of them is stale by the time the authority sees it.
 *
 * This is built deterministically and on purpose. A race that only fires under real timing is a
 * race that passes in CI and corrupts a user's file in the field — so it is not waited for, it is
 * MADE to happen, and the assertion is that BOTH edits survive, each intact and correctly placed.
 */
import { describe, expect, it } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import { DocumentAuthority } from '../../src/main/document-authority.js';

const A = 'view-a';
const B = 'view-b';

const change = (docLength: number, spec: { from: number; to?: number; insert?: string }): unknown =>
  ChangeSet.of(spec, docLength).toJSON();

describe('two views editing at the same instant', () => {
  it('keeps BOTH edits, each intact and correctly placed', () => {
    // Both views see "hello world" (version 0) and type at the same moment:
    //   A prepends "[" at the start
    //   B appends "]" at the end
    const authority = new DocumentAuthority('doc', 'hello world');
    const length = 'hello world'.length;

    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: change(length, { from: 0, insert: '[' }),
      baseVersion: 0,
      selectionBefore: null,
    });

    // B's change was computed against version 0 — which is now stale. Applied at the offset it
    // NAMED (11), it would land BEFORE the "d" of the now-12-character document. Rebased, it lands
    // where B actually meant it: at the end.
    const second = authority.dispatch({
      documentId: 'doc',
      viewId: B,
      changes: change(length, { from: length, insert: ']' }),
      baseVersion: 0,
      selectionBefore: null,
    });

    expect(authority.text).toBe('[hello world]');
    // The canonical stream names B as the origin — and carries the REBASED change, so every other
    // view can apply it verbatim and land on the same text.
    expect(second!.origin).toBe(B);
  });

  it('does not lose an edit when both views type INTO THE SAME PLACE', () => {
    // The nastiest case: both insert at the same offset. Neither may be dropped, and neither may
    // be interleaved into the other.
    const authority = new DocumentAuthority('doc', 'ac');

    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: change(2, { from: 1, insert: 'X' }),
      baseVersion: 0,
      selectionBefore: null,
    });
    authority.dispatch({
      documentId: 'doc',
      viewId: B,
      changes: change(2, { from: 1, insert: 'Y' }),
      baseVersion: 0,
      selectionBefore: null,
    });

    const text = authority.text;
    expect(text).toHaveLength(4);
    expect(text.startsWith('a')).toBe(true);
    expect(text.endsWith('c')).toBe(true);
    // BOTH survive. Which order they land in is the authority's to decide (arrival order); that
    // one of them might vanish is not.
    expect(text).toContain('X');
    expect(text).toContain('Y');
  });

  it('rebases a DELETION over an insertion without eating the wrong characters', () => {
    // A deletion is where an un-rebased change does its worst damage: applied at a stale offset it
    // removes text the user never selected.
    const authority = new DocumentAuthority('doc', 'one two three');

    // A inserts at the very start, shifting everything right by 4.
    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: change('one two three'.length, { from: 0, insert: 'zero ' }),
      baseVersion: 0,
      selectionBefore: null,
    });

    // B deletes "two " (offsets 4..8 of the ORIGINAL document), computed against version 0.
    authority.dispatch({
      documentId: 'doc',
      viewId: B,
      changes: change('one two three'.length, { from: 4, to: 8 }),
      baseVersion: 0,
      selectionBefore: null,
    });

    // Rebased, it removes the word B meant. Applied at the offsets it NAMED, it would have eaten
    // "o on" out of "zero one two three" — text B never touched.
    expect(authority.text).toBe('zero one three');
  });

  it('serialises in ARRIVAL order, so the stream is one ordered history', () => {
    const authority = new DocumentAuthority('doc', '');
    for (const [view, letter] of [
      [A, 'a'],
      [B, 'b'],
      [A, 'c'],
    ] as const) {
      authority.dispatch({
        documentId: 'doc',
        viewId: view,
        changes: change(authority.text.length, { from: authority.text.length, insert: letter }),
        baseVersion: authority.version,
        selectionBefore: null,
      });
    }
    expect(authority.text).toBe('abc');
    expect(authority.version).toBe(3);
  });
});

describe('the shared undo stack (FR-026c/FR-026e)', () => {
  it('lets view B undo an edit made in view A — ONE stack, owned by the document', () => {
    // A per-view `history()` cannot do this, and that is the whole reason the stack moved out of
    // the view and into the authority. This is the central proof of FR-026c.
    const authority = new DocumentAuthority('doc', 'hello');

    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: change(5, { from: 5, insert: ' from A' }),
      baseVersion: 0,
      selectionBefore: null,
    });
    expect(authority.text).toBe('hello from A');

    const undone = authority.undo(B); // …invoked in the OTHER view
    expect(undone).not.toBeNull();
    expect(authority.text).toBe('hello');
    // The cursor set goes back to the view that INVOKED undo, not the one that made the edit.
    expect(undone!.origin).toBe(B);
    expect(undone!.selection).toBeNull(); // …the recorded selection, restored in B alone
  });

  it('is ONE command = ONE undo, however many cursors the command touched', () => {
    const authority = new DocumentAuthority('doc', 'a\nb\nc');
    // A single multi-cursor edit — three insertions, one command, one transaction.
    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: ChangeSet.of(
        [
          { from: 0, insert: '1' },
          { from: 2, insert: '2' },
          { from: 4, insert: '3' },
        ],
        5,
      ).toJSON(),
      baseVersion: 0,
      selectionBefore: null,
    });
    expect(authority.text).toBe('1a\n2b\n3c');
    expect(authority.undoDepth).toBe(1); // …not three

    authority.undo(A);
    expect(authority.text).toBe('a\nb\nc');
  });

  it('survives a SAVE — undoing past it re-dirties the document (FR-026d)', () => {
    const authority = new DocumentAuthority('doc', 'hello');
    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: change(5, { from: 5, insert: '!' }),
      baseVersion: 0,
      selectionBefore: null,
    });
    authority.markSaved();
    expect(authority.dirty).toBe(false);
    expect(authority.undoDepth).toBe(1); // saving is not a barrier

    authority.undo(A);
    expect(authority.text).toBe('hello');
    expect(authority.dirty).toBe(true);
  });

  it('is CLEARED by a revert — the history described content that no longer exists', () => {
    const authority = new DocumentAuthority('doc', 'hello');
    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: change(5, { from: 5, insert: '!' }),
      baseVersion: 0,
      selectionBefore: null,
    });
    expect(authority.undoDepth).toBe(1);

    authority.reset('hello'); // revert / external reload
    expect(authority.undoDepth).toBe(0);
    expect(authority.redoDepth).toBe(0);
    expect(authority.dirty).toBe(false);
  });

  it('is bounded — a long session cannot grow it without limit (FR-026d)', () => {
    const authority = new DocumentAuthority('doc', '');
    for (let i = 0; i < 520; i += 1) {
      authority.dispatch({
        documentId: 'doc',
        viewId: A,
        changes: change(authority.text.length, { from: authority.text.length, insert: 'x' }),
        baseVersion: authority.version,
        selectionBefore: null,
      });
    }
    expect(authority.undoDepth).toBe(500);
  });

  it('redoes what it undid, and a NEW edit discards the redo branch', () => {
    const authority = new DocumentAuthority('doc', 'hello');
    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: change(5, { from: 5, insert: '!' }),
      baseVersion: 0,
      selectionBefore: null,
    });

    authority.undo(A);
    expect(authority.text).toBe('hello');
    authority.redo(A);
    expect(authority.text).toBe('hello!');

    authority.undo(A);
    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: change(5, { from: 5, insert: '?' }),
      baseVersion: authority.version,
      selectionBefore: null,
    });
    // The redo branch described a future that no longer follows from here.
    expect(authority.redoDepth).toBe(0);
    expect(authority.text).toBe('hello?');
  });
});

describe('a typing run is ONE undo entry (FR-026)', () => {
  /** An authority whose clock we hold still, so the run-grouping rule is proven, not timed. */
  const stopped = (text = ''): { authority: DocumentAuthority; tick: (ms: number) => void } => {
    let clock = 1_000;
    const authority = new DocumentAuthority('doc', text, () => clock);
    return { authority, tick: (ms) => { clock += ms; } };
  };

  /** Type one character at the end of the document, exactly as a keystroke arrives. */
  const type = (authority: DocumentAuthority, viewId: string, char: string, selection = 0): void => {
    const at = authority.text.length;
    authority.dispatch({
      documentId: 'doc',
      viewId,
      changes: change(at, { from: at, insert: char }),
      baseVersion: authority.version,
      selectionBefore: selection,
      mergeClass: 'type',
    });
  };

  it('undoes a whole typed word, not one letter at a time', () => {
    // CodeMirror's `history()` did this for a single view. Moving the stack to the document must
    // not cost the user the behaviour — Ctrl+Z walking backwards a character at a time would be a
    // regression no requirement asked for.
    const { authority, tick } = stopped();
    for (const char of 'hello') {
      type(authority, A, char);
      tick(30); // a fast typist, well inside the run window
    }

    expect(authority.text).toBe('hello');
    expect(authority.undoDepth).toBe(1);

    authority.undo(A);
    expect(authority.text).toBe(''); // …the whole run, in one press
  });

  it('restores the cursor set from before the run BEGAN, not before its last keystroke', () => {
    const { authority, tick } = stopped();
    type(authority, A, 'h', 42); // the selection the user had before they started typing
    tick(30);
    type(authority, A, 'i', 99);

    const undone = authority.undo(A);
    expect(undone!.selection).toBe(42);
  });

  it('closes the run when the user PAUSES — two runs, two undos', () => {
    const { authority, tick } = stopped();
    type(authority, A, 'h');
    tick(30);
    type(authority, A, 'i');

    tick(5_000); // …the user stops to think

    type(authority, A, '!');
    expect(authority.undoDepth).toBe(2);

    authority.undo(A);
    expect(authority.text).toBe('hi'); // only the second run went
  });

  it('does NOT absorb a PASTE into a typing run — a paste is its own single entry (FR-026)', () => {
    // The ChangeSets are indistinguishable; only the view knows which was which. This is why the
    // class is classified there and sent, rather than guessed at from the change here.
    const { authority, tick } = stopped();
    type(authority, A, 'h');
    tick(30);
    type(authority, A, 'i');
    tick(30);

    const at = authority.text.length;
    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: change(at, { from: at, insert: ' PASTED' }),
      baseVersion: authority.version,
      selectionBefore: null,
      mergeClass: null, // a paste — never merges
    });

    expect(authority.text).toBe('hi PASTED');
    expect(authority.undoDepth).toBe(2);

    authority.undo(A);
    expect(authority.text).toBe('hi'); // the paste alone is undone, the typing survives
  });

  it('closes the run when the user types somewhere ELSE', () => {
    // Two edits made in unrelated places must not fall to one Ctrl+Z, however fast they came.
    const { authority, tick } = stopped('one\ntwo');
    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: change(7, { from: 7, insert: '!' }), // end of "two"
      baseVersion: authority.version,
      selectionBefore: null,
      mergeClass: 'type',
    });
    tick(30);
    authority.dispatch({
      documentId: 'doc',
      viewId: A,
      changes: change(8, { from: 0, insert: '?' }), // …now up at the very start
      baseVersion: authority.version,
      selectionBefore: null,
      mergeClass: 'type',
    });

    expect(authority.text).toBe('?one\ntwo!');
    expect(authority.undoDepth).toBe(2);
  });

  it('does not merge one view’s typing into ANOTHER view’s run', () => {
    const { authority, tick } = stopped();
    type(authority, A, 'a');
    tick(30);
    type(authority, B, 'b'); // the other mirrored view, typing at the same moment

    expect(authority.text).toBe('ab');
    expect(authority.undoDepth).toBe(2); // …two authors, two entries

    authority.undo(B);
    expect(authority.text).toBe('a'); // B's own keystroke went first — it was last
  });

  it('merges a backspace run, and does not merge it into the typing that preceded it', () => {
    const { authority, tick } = stopped();
    type(authority, A, 'a');
    tick(30);
    type(authority, A, 'b');
    tick(30);

    // …then two backspaces, which form a run of their own.
    for (let i = 0; i < 2; i += 1) {
      const at = authority.text.length;
      authority.dispatch({
        documentId: 'doc',
        viewId: A,
        changes: change(at, { from: at - 1, to: at }),
        baseVersion: authority.version,
        selectionBefore: null,
        mergeClass: 'delete',
      });
      tick(30);
    }

    expect(authority.text).toBe('');
    expect(authority.undoDepth).toBe(2); // one typing run, one deleting run

    authority.undo(A);
    expect(authority.text).toBe('ab'); // both backspaces come back together
  });
});
