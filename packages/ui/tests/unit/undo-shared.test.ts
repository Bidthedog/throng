/**
 * ONE document, ONE undo stack — proven end to end, replicas and all (016, FR-026c/FR-026e · T087).
 *
 * The authority's own tests exercise it through its API. This one puts the whole protocol together:
 * a real {@link DocumentAuthority} in "UI main", a real {@link DocumentReplica} behind each view,
 * and a wire between them whose delivery I control. That is the only way to prove the thing that
 * actually matters — that a keystroke echoed INSTANTLY in one view, and a rebase performed
 * INDEPENDENTLY in another, converge on the same characters — because it is a property of the two
 * halves together, and neither half can demonstrate it alone.
 *
 * Every test here ends by asserting that both views and the authority hold identical text. A
 * protocol that loses a character is not a protocol.
 */
import { describe, expect, it } from 'vitest';
import { ChangeSet, Text } from '@codemirror/state';
import type { CanonicalChangeMsg, DispatchChangeMsg, MergeClass } from '@throng/core';
import { DocumentAuthority } from '../../src/main/document-authority.js';
import { DocumentReplica } from '../../src/renderer/editor/document-replica.js';

/** One editor view: its own document copy, its own replica, its own idea of `dirty`. */
class View {
  private text: Text;
  readonly replica: DocumentReplica;
  dirty = false;
  /** The cursor set an undo handed back to THIS view (null when it was not the invoker). */
  restoredSelection: unknown = null;

  constructor(
    readonly id: string,
    documentId: string,
    initial: string,
    send: (msg: DispatchChangeMsg) => void,
  ) {
    this.text = Text.of(initial.split('\n'));
    this.replica = new DocumentReplica(documentId, id, send);
  }

  /** The user edits. The view shows it AT ONCE — it does not wait for the authority. */
  edit(
    spec: { from: number; to?: number; insert?: string } | { from: number; to?: number; insert?: string }[],
    opts: { selection?: unknown; mergeClass?: MergeClass } = {},
  ): void {
    const changes = ChangeSet.of(spec, this.text.length);
    this.text = changes.apply(this.text);
    this.replica.record(changes, opts.selection ?? null, opts.mergeClass ?? null);
  }

  /** A canonical message arrives from the authority. */
  deliver(msg: CanonicalChangeMsg): void {
    const apply = this.replica.receive(msg);
    this.dirty = msg.dirty;
    if (!apply) return;
    this.text = apply.changes.apply(this.text);
    this.restoredSelection = apply.selection;
  }

  get content(): string {
    return this.text.toString();
  }
}

/**
 * The wire. Messages from a view queue up and are delivered only when I say so — which is what makes
 * the race deterministic instead of a matter of luck.
 */
class Wire {
  readonly authority: DocumentAuthority;
  readonly views: View[] = [];
  private readonly outbound: DispatchChangeMsg[] = [];

  constructor(private readonly documentId: string, initial: string) {
    this.authority = new DocumentAuthority(documentId, initial);
  }

  view(id: string): View {
    const initial = this.authority.text;
    const view = new View(id, this.documentId, initial, (msg) => {
      this.outbound.push(msg);
    });
    this.views.push(view);
    return view;
  }

  /** Deliver everything in flight, in order — including anything a delivery causes to be sent. */
  flush(): void {
    while (this.outbound.length > 0) {
      const msg = this.outbound.shift()!;
      const canonical = this.authority.dispatch(msg);
      if (canonical) this.broadcast(canonical);
    }
  }

  undo(invokingViewId: string): void {
    const msg = this.authority.undo(invokingViewId);
    if (msg) this.broadcast(msg);
    this.flush();
  }

  redo(invokingViewId: string): void {
    const msg = this.authority.redo(invokingViewId);
    if (msg) this.broadcast(msg);
    this.flush();
  }

  private broadcast(msg: CanonicalChangeMsg): void {
    for (const view of this.views) view.deliver(msg);
  }

  /** Every replica agrees with the authority, character for character. */
  expectConverged(text: string): void {
    expect(this.authority.text).toBe(text);
    for (const view of this.views) expect(`${view.id}: ${view.content}`).toBe(`${view.id}: ${text}`);
  }
}

describe('two mirrored views of ONE document', () => {
  it('lets view B undo an edit made in view A, and both views update (FR-026c)', () => {
    // The headline guarantee. A per-view `history()` cannot do this at all: B's history has never
    // heard of A's edit, so Ctrl+Z in B would either do nothing or undo something else entirely.
    const wire = new Wire('doc', 'hello');
    const a = wire.view('view-a');
    const b = wire.view('view-b');

    a.edit({ from: 5, insert: ' from A' });
    wire.flush();

    expect(b.content).toBe('hello from A'); // B saw it
    expect(a.dirty).toBe(true);
    expect(b.dirty).toBe(true); // …and both agree the document is dirty

    wire.undo('view-b'); // …Ctrl+Z pressed in the OTHER view

    wire.expectConverged('hello');
    expect(a.dirty).toBe(false); // back to the saved content, in both
    expect(b.dirty).toBe(false);
  });

  it('hands the restored cursor set to the INVOKING view alone (FR-026f)', () => {
    // The stack is shared but the cursor is not. An undo that dragged every view's caret to an edit
    // its user did not make would be a worse bug than the one being fixed.
    const wire = new Wire('doc', 'hello');
    const a = wire.view('view-a');
    const b = wire.view('view-b');

    a.edit({ from: 5, insert: '!' }, { selection: 'A-cursor-before' });
    wire.flush();

    wire.undo('view-b');

    expect(b.restoredSelection).toBe('A-cursor-before'); // the invoker gets the cursors
    expect(a.restoredSelection).toBeNull(); // …the bystander keeps its own
  });

  it('redoes from either view, because the redo stack is shared too', () => {
    const wire = new Wire('doc', 'hello');
    const a = wire.view('view-a');
    wire.view('view-b');

    a.edit({ from: 5, insert: '!' });
    wire.flush();
    wire.undo('view-a');
    wire.expectConverged('hello');

    wire.redo('view-b'); // …redone from the view that did not make the edit, nor undo it
    wire.expectConverged('hello!');
  });
});

describe('the race: two views typing at the same instant', () => {
  it('keeps BOTH edits and converges — every copy identical, none of them the authority', () => {
    // Neither view has heard of the other's keystroke when it makes its own. Both echo locally at
    // once (as they must — typing cannot wait for IPC), so for a moment there are three different
    // documents in the app. What must be true when the dust settles is that there is one.
    const wire = new Wire('doc', 'hello world');
    const a = wire.view('view-a');
    const b = wire.view('view-b');

    a.edit({ from: 0, insert: '[' }); // …at the same moment
    b.edit({ from: 11, insert: ']' }); // …against the same version

    // Both are optimistically applied, and both are WRONG about the other.
    expect(a.content).toBe('[hello world');
    expect(b.content).toBe('hello world]');

    wire.flush();

    wire.expectConverged('[hello world]');
  });

  it('does not eat the wrong characters when a DELETION races an insertion', () => {
    // The case where an un-rebased change does real damage: applied at a stale offset, a deletion
    // removes text the user never selected — and no test that only checks lengths would notice.
    const wire = new Wire('doc', 'one two three');
    const a = wire.view('view-a');
    const b = wire.view('view-b');

    a.edit({ from: 0, insert: 'zero ' });
    b.edit({ from: 4, to: 8 }); // deletes "two " — offsets in the ORIGINAL document

    wire.flush();

    wire.expectConverged('zero one three');
  });

  it('keeps typing responsive: a run typed DURING a round trip is buffered, not lost', () => {
    // A replica keeps one change in flight. Everything typed while it is out composes into a buffer
    // and goes on the next acknowledgement — so the user's keystrokes appear instantly and arrive
    // exactly once, in order.
    const wire = new Wire('doc', '');
    const a = wire.view('view-a');
    const b = wire.view('view-b');

    a.edit({ from: 0, insert: 'f' }, { mergeClass: 'type' });
    a.edit({ from: 1, insert: 'a' }, { mergeClass: 'type' }); // …while "f" is still in flight
    a.edit({ from: 2, insert: 's' }, { mergeClass: 'type' });
    a.edit({ from: 3, insert: 't' }, { mergeClass: 'type' });
    expect(a.content).toBe('fast'); // the typist never waited

    wire.flush();

    wire.expectConverged('fast');
    expect(b.content).toBe('fast');
  });

  it('an undo pressed while a keystroke is STILL IN FLIGHT is applied, not swallowed', () => {
    // The originator of an edit must not re-apply it when it comes back; the invoker of an undo MUST
    // apply it. Both messages carry the same origin, so a replica that told them apart by origin
    // alone would silently drop the undo — the user presses Ctrl+Z and nothing happens.
    const wire = new Wire('doc', '');
    const a = wire.view('view-a');
    wire.view('view-b');

    a.edit({ from: 0, insert: 'first' }, { mergeClass: null });
    wire.flush();

    a.edit({ from: 5, insert: '?' }, { mergeClass: null }); // …in flight, NOT yet acknowledged
    wire.undo('view-a'); // …and Ctrl+Z lands in the middle of it

    // The undo reverted "first" (the last change the authority had actually applied), and the
    // in-flight "?" was rebased on top of it rather than lost.
    wire.expectConverged('?');
  });
});

describe('the scope is the DOCUMENT, never the panel (FR-026e)', () => {
  it('gives two panels on DIFFERENT files entirely separate stacks', () => {
    // Undo in one file must never reach into another. Two documents, two authorities, two histories.
    const one = new Wire('doc-one', 'one');
    const two = new Wire('doc-two', 'two');
    const a = one.view('view-a');
    const b = two.view('view-b');

    a.edit({ from: 3, insert: ' EDITED' });
    b.edit({ from: 3, insert: ' EDITED' });
    one.flush();
    two.flush();

    one.undo('view-a');

    one.expectConverged('one'); // reverted…
    two.expectConverged('two EDITED'); // …and the other file is untouched
    expect(two.authority.undoDepth).toBe(1); // its history still has its own edit in it
  });
});

describe('replace-all rides the shared stack as ONE entry (T117 · FR-026)', () => {
  it('is reverted by a single Undo, in either view, however many matches it rewrote', () => {
    // 013's replace-all dispatches one multi-range transaction precisely so it is one undo step. It
    // used to rely on the view's local `history()`; now it must be one entry in the DOCUMENT's
    // history — and, unlike typing, it must never coalesce with whatever came before it.
    const wire = new Wire('doc', 'a a a a');
    const a = wire.view('view-a');
    const b = wire.view('view-b');

    a.edit(
      [
        { from: 0, to: 1, insert: 'X' },
        { from: 2, to: 3, insert: 'X' },
        { from: 4, to: 5, insert: 'X' },
        { from: 6, to: 7, insert: 'X' },
      ],
      { mergeClass: null }, // a command, not typing: it never merges into a run
    );
    wire.flush();

    wire.expectConverged('X X X X');
    expect(wire.authority.undoDepth).toBe(1); // …one entry, not four

    wire.undo('view-b'); // …and undone from the other view

    wire.expectConverged('a a a a');
    expect(b.content).toBe('a a a a');
  });

  it('does not swallow the typing that preceded it into the same undo step', () => {
    const wire = new Wire('doc', 'a');
    const a = wire.view('view-a');

    a.edit({ from: 1, insert: ' a' }, { mergeClass: 'type' });
    wire.flush();
    a.edit([{ from: 0, to: 1, insert: 'X' }, { from: 2, to: 3, insert: 'X' }], { mergeClass: null });
    wire.flush();
    wire.expectConverged('X X');

    wire.undo('view-a');
    wire.expectConverged('a a'); // the replace-all alone came back out
  });
});

describe('a change BUFFERED behind an in-flight one (review finding I3)', () => {
  it('does not let a PASTE be swallowed into the typing run it was buffered behind (FR-026)', () => {
    // While one change is in flight, everything after it is composed into a single buffer and sent
    // as one dispatch. The buffer's merge class used to be taken from whichever change OPENED it —
    // so a paste arriving second inherited `'type'`, and the authority happily merged it into the
    // typing run above.
    //
    // The result: ONE Ctrl+Z took back the paste AND the typing before it. That is exactly what
    // FR-026 forbids, and exactly what `input.paste` not being a run class is supposed to prevent —
    // the guard was simply looking at the wrong change. It only ever showed up under IPC latency,
    // which is why every earlier test missed it: they flushed the wire after every keystroke.
    const wire = new Wire('doc', 'hello');
    const a = wire.view('A');

    a.edit({ from: 5, insert: ' a' }, { mergeClass: 'type' }); // …in flight, not yet acknowledged
    a.edit({ from: 7, insert: 'b' }, { mergeClass: 'type' }); // …buffered behind it
    a.edit({ from: 8, insert: 'PASTED' }, { mergeClass: null }); // …composed into the SAME buffer

    wire.flush();
    wire.expectConverged('hello abPASTED');

    // Two entries, not one: the typing run, and the buffer that contains the paste.
    expect(wire.authority.undoDepth).toBe(2);

    // …so one Undo takes back the paste and leaves the typing that preceded it.
    wire.undo('A');
    wire.expectConverged('hello a');
  });

  it('still coalesces a buffer of PURE typing into the run it belongs to', () => {
    // The fix must not make every buffered keystroke its own undo entry — that would turn a fast
    // typist's IPC latency into a punishing undo history.
    const wire = new Wire('doc', 'hello');
    const a = wire.view('A');

    a.edit({ from: 5, insert: ' a' }, { mergeClass: 'type' });
    a.edit({ from: 7, insert: 'b' }, { mergeClass: 'type' });
    a.edit({ from: 8, insert: 'c' }, { mergeClass: 'type' });

    wire.flush();
    wire.expectConverged('hello abc');

    expect(wire.authority.undoDepth).toBe(1);
    wire.undo('A');
    wire.expectConverged('hello');
  });
});
