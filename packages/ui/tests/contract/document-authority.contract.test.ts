/**
 * The document authority (016, FR-028f · constitution XI · contracts/document-authority.md).
 *
 * This is the one protocol in the feature where getting the message shape wrong CORRUPTS THE USER'S
 * FILE, silently — which is why it has a contract, and why the contract is written before the code.
 *
 * The rule it implements: exactly one component owns the document state; every other copy is a
 * derived replica, changed only by applying that authority's ordered change stream. A change based
 * on a superseded version is REBASED onto the current one — never applied at the position it
 * originally named, and never rejected.
 *
 * "Never rejected" is not a nicety. The view has ALREADY shown the user their keystroke; refusing
 * it would visibly revert input they watched themselves type.
 */
import { describe, expect, it } from 'vitest';
import { ChangeSet, Text } from '@codemirror/state';
import { DocumentAuthority } from '../../src/main/document-authority.js';

const VIEW_A = 'view-a';
const VIEW_B = 'view-b';

/** An insertion of `text` at `at`, expressed against a document of length `docLength`. */
const insert = (docLength: number, at: number, text: string): unknown =>
  ChangeSet.of({ from: at, insert: text }, docLength).toJSON();

/** Apply a canonical change to a document, exactly as a replica would. */
const applyTo = (doc: string, changes: unknown): string =>
  ChangeSet.fromJSON(changes).apply(Text.of(doc.split('\n'))).toString();

describe('applying a change', () => {
  it('applies a change whose baseVersion EQUALS the current version, and bumps the version', () => {
    const authority = new DocumentAuthority('doc', 'hello');
    expect(authority.version).toBe(0);

    const result = authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_A,
      changes: insert(5, 5, ' world'),
      baseVersion: 0,
      selectionBefore: null,
    });

    expect(authority.text).toBe('hello world');
    expect(authority.version).toBe(1);
    expect(result?.version).toBe(1);
  });

  it('REBASES a stale change so it lands at the MAPPED position, not the one it named', () => {
    // This is the whole point of the contract. Two views edit at once:
    //   A inserts "X" at 0  → "Xhello"
    //   B inserts "Y" at 5, computed against "hello" (baseVersion 0 — now stale)
    // Applied at the position it NAMED, B's "Y" would land at offset 5 of "Xhello" — inside the
    // word, before the final "o". Rebased, it lands where B meant it: at the END.
    const authority = new DocumentAuthority('doc', 'hello');

    authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_A,
      changes: insert(5, 0, 'X'),
      baseVersion: 0,
      selectionBefore: null,
    });
    expect(authority.text).toBe('Xhello');

    const rebased = authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_B,
      changes: insert(5, 5, 'Y'), // against the ORIGINAL "hello"
      baseVersion: 0, // …which is now one version stale
      selectionBefore: null,
    });

    expect(authority.text).toBe('XhelloY');
    expect(authority.version).toBe(2);

    // …and the canonical stream carries the REBASED change, not the one the view sent. A replica
    // that applied the message verbatim to the current document must land on the same text the
    // authority holds — which is the property the whole protocol rests on.
    expect(applyTo('Xhello', rebased!.changes)).toBe('XhelloY');
  });

  it('NEVER rejects a stale change — the user has already seen it applied', () => {
    const authority = new DocumentAuthority('doc', 'hello');
    authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_A,
      changes: insert(5, 0, 'X'),
      baseVersion: 0,
      selectionBefore: null,
    });

    const stale = authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_B,
      changes: insert(5, 5, 'Y'),
      baseVersion: 0,
      selectionBefore: null,
    });
    expect(stale).not.toBeNull();
    expect(authority.text).toContain('Y');
  });

  it('names the ORIGIN on every canonical message, rebased or not', () => {
    // A replica recognises its own acknowledgement by this, and applies nothing: it rebased its
    // in-flight change over the same canonical stream, so its copy already matches. Every OTHER
    // view applies the change. Without an origin the two cases are indistinguishable, and the
    // originator would apply its own edit twice.
    const authority = new DocumentAuthority('doc', 'hello');
    const direct = authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_A,
      changes: insert(5, 5, '!'),
      baseVersion: 0,
      selectionBefore: null,
    });
    expect(direct?.origin).toBe(VIEW_A);

    const stale = authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_B,
      changes: insert(5, 0, '>'),
      baseVersion: 0,
      selectionBefore: null,
    });
    expect(stale?.origin).toBe(VIEW_B);
  });

  it('FAILS LOUDLY when a change claims a baseVersion AHEAD of the authority', () => {
    // A replica cannot outrun its authority. This is a bug in the caller, and guessing what it
    // meant would corrupt the document — so it throws rather than silently coercing.
    const authority = new DocumentAuthority('doc', 'hello');
    expect(() =>
      authority.dispatch({
        documentId: 'doc',
        viewId: VIEW_A,
        changes: insert(5, 0, 'X'),
        baseVersion: 7,
        selectionBefore: null,
      }),
    ).toThrow(/ahead|outrun/i);
  });

  it('DROPS a change whose base document was replaced under it — it cannot be rebased', () => {
    // A revert (or an external reload) replaces the content and closes the rebase window: the
    // changes needed to map an in-flight edit onto the new document no longer exist, because the
    // document it was computed against no longer exists.
    //
    // There is no honest position to land such an edit at. Applying it verbatim would splice a
    // fragment of a discarded document into the live one — precisely the corruption this protocol
    // exists to prevent — so it is dropped, and the caller resynchronises the view that sent it.
    const authority = new DocumentAuthority('doc', 'hello');
    authority.reset('a completely different document');

    const dropped = authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_A,
      changes: insert(5, 5, '!'), // computed against "hello", which is gone
      baseVersion: 0,
      selectionBefore: null,
    });

    expect(dropped).toBeNull();
    expect(authority.text).toBe('a completely different document'); // untouched
  });
});

describe('dirty state is DERIVED, never relayed', () => {
  it('derives dirty by comparing the document with the one on disk', () => {
    const authority = new DocumentAuthority('doc', 'hello');
    expect(authority.dirty).toBe(false);

    const result = authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_A,
      changes: insert(5, 5, '!'),
      baseVersion: 0,
      selectionBefore: null,
    });
    expect(result?.dirty).toBe(true);
    expect(authority.dirty).toBe(true);

    authority.markSaved();
    expect(authority.dirty).toBe(false);
  });

  it('is CLEAN again when an edit is undone back to the saved content', () => {
    // The contract originally specified `dirty = version !== savedVersion`. That is wrong, and this
    // is the case that proves it: an undo is the INVERSE change applied FORWARD, so it advances the
    // version like any other change. Under the version rule, undoing an edit back to exactly the
    // text on disk would leave the document reporting unsaved changes while being byte-for-byte
    // identical to its file — an unsaved dot on a document the user just restored, and a pointless
    // rewrite on the next Save-All.
    //
    // Amendment recorded in contracts/document-authority.md.
    const authority = new DocumentAuthority('doc', 'hello');
    authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_A,
      changes: insert(5, 5, '!'),
      baseVersion: 0,
      selectionBefore: null,
    });
    expect(authority.dirty).toBe(true);

    authority.undo(VIEW_A);

    expect(authority.text).toBe('hello');
    expect(authority.version).toBeGreaterThan(0); // the version moved FORWARD…
    expect(authority.dirty).toBe(false); // …and the document is nonetheless clean
  });

  it('re-dirties for free when an edit is undone PAST a save (FR-026d)', () => {
    // No special case anywhere: dirty is `version !== savedVersion`, and an undo moves the version.
    // A relayed dirty flag would be a second peer-owned value — exactly what Principle XI forbids.
    const authority = new DocumentAuthority('doc', 'hello');
    authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_A,
      changes: insert(5, 5, '!'),
      baseVersion: 0,
      selectionBefore: null,
    });
    authority.markSaved();
    expect(authority.dirty).toBe(false);

    authority.undo(VIEW_A);
    expect(authority.text).toBe('hello');
    expect(authority.dirty).toBe(true);
  });

  it('stays dirty with no version to save back to when the file is DELETED (FR-099)', () => {
    // The backing file is gone, so no version of this document is on disk. `markUnsaved` moves the
    // saved version out of the counter's reach rather than introducing a settable dirty flag — a
    // flag a caller could set would be a second owner of the state.
    const authority = new DocumentAuthority('doc', 'hello');
    expect(authority.dirty).toBe(false);

    authority.markUnsaved();
    expect(authority.dirty).toBe(true);

    // …and it survives an edit, an undo, and anything else short of an actual save.
    authority.dispatch({
      documentId: 'doc',
      viewId: VIEW_A,
      changes: insert(5, 5, '!'),
      baseVersion: 0,
      selectionBefore: null,
    });
    expect(authority.dirty).toBe(true);
    authority.undo(VIEW_A);
    expect(authority.dirty).toBe(true);

    authority.markSaved(); // the save re-created the file
    expect(authority.dirty).toBe(false);
  });

  it('offers no way for a view to SET dirty — the type does not have one', () => {
    const authority = new DocumentAuthority('doc', 'hello');
    expect((authority as unknown as { setDirty?: unknown }).setDirty).toBeUndefined();
  });
});

describe('the document is a Text, and stays one', () => {
  it('exposes its canonical content as text', () => {
    const authority = new DocumentAuthority('doc', 'a\nb\n');
    expect(authority.text).toBe('a\nb\n');
    expect(authority.doc).toBeInstanceOf(Text);
  });

  it('preserves line endings exactly as given — the authority does not normalise', () => {
    const authority = new DocumentAuthority('doc', 'a\r\nb\r\n');
    expect(authority.text).toBe('a\r\nb\r\n');
  });
});
