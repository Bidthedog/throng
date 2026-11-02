/**
 * "One document, one state" — the half nobody tested (016, FR-028a/FR-028c · T111).
 *
 * Principle XI says the DOCUMENT's state has exactly one owner and every view is a replica of it.
 * T087 proved that of the undo stack, and T045 of the language override. But the principle cuts both
 * ways, and the other edge is the sharper one: **view** state must NOT be shared. A cursor, a
 * selection, a scroll position and 012's per-panel zoom belong to the view looking at the document,
 * and a "fix" that broadcast them alongside the text would yank a user's cursor around whenever
 * somebody typed in the other window — a bug that looks, from the outside, exactly like the editor
 * being possessed.
 *
 * So this file asserts the line between the two:
 *
 *   • the effective INDENTATION is one shared value (it decides which characters enter the shared
 *     buffer, so two views disagreeing about it would put tabs and spaces into one file);
 *   • the CURSOR is not shared — each view maps its own through the same canonical change;
 *   • a cursor whose text is deleted under it collapses GRACEFULLY, rather than pointing into
 *     content that no longer exists.
 */
import { describe, expect, it } from 'vitest';
import { ChangeSet, EditorSelection, Text } from '@codemirror/state';
import {
  DEFAULT_APP_SETTINGS,
  effectiveIndent,
  type CanonicalChangeMsg,
  type DispatchChangeMsg,
  type EditorSettings,
} from '@throng/core';
import { DocumentAuthority } from '../../src/main/document-authority.js';
import { DocumentReplica } from '../../src/renderer/editor/document-replica.js';

/**
 * One view: its own copy of the text, its own replica — and its OWN cursor, which is the point.
 * The cursor is mapped through every canonical change locally, exactly as CodeMirror maps it.
 */
class View {
  private text: Text;
  readonly replica: DocumentReplica;
  selection: EditorSelection;

  constructor(
    readonly id: string,
    documentId: string,
    initial: string,
    at: number,
    send: (msg: DispatchChangeMsg) => void,
  ) {
    this.text = Text.of(initial.split('\n'));
    this.selection = EditorSelection.single(at);
    this.replica = new DocumentReplica(documentId, id, send);
  }

  /**
   * The user edits. `caretAfter` is where THIS view's caret lands — a real editor's transaction
   * carries its own selection rather than inferring one by mapping, which is exactly why typing at
   * the caret leaves the caret after what you typed.
   */
  edit(spec: { from: number; to?: number; insert?: string }, caretAfter?: number): void {
    const changes = ChangeSet.of(spec, this.text.length);
    this.text = changes.apply(this.text);
    this.selection =
      caretAfter === undefined
        ? this.selection.map(changes)
        : EditorSelection.single(caretAfter);
    this.replica.record(changes, null, null);
  }

  deliver(msg: CanonicalChangeMsg): void {
    const apply = this.replica.receive(msg);
    if (!apply) return;
    this.text = apply.changes.apply(this.text);
    // A view maps its OWN cursor through the change. Nothing in the message tells it where to put
    // it, because nothing in UI main knows — or should know — where this view's user is looking.
    this.selection = this.selection.map(apply.changes);
  }

  get content(): string {
    return this.text.toString();
  }

  get head(): number {
    return this.selection.main.head;
  }
}

class Wire {
  readonly authority: DocumentAuthority;
  readonly views: View[] = [];
  private readonly outbound: DispatchChangeMsg[] = [];

  constructor(
    private readonly documentId: string,
    private readonly initial: string,
  ) {
    this.authority = new DocumentAuthority(documentId, initial);
  }

  view(id: string, at: number): View {
    const view = new View(id, this.documentId, this.authority.text, at, (msg) =>
      this.outbound.push(msg),
    );
    this.views.push(view);
    return view;
  }

  flush(): void {
    while (this.outbound.length > 0) {
      const msg = this.outbound.shift()!;
      const canonical = this.authority.dispatch(msg);
      if (canonical) for (const view of this.views) view.deliver(canonical);
    }
  }
}

describe('the DOCUMENT’s state is shared', () => {
  it('gives every view of a document the SAME effective indentation (FR-028a)', () => {
    // Indentation is not a view preference: it decides which characters a keystroke puts into the
    // shared buffer. Two views disagreeing would mix tabs and spaces into one file, one Tab at a
    // time — and each view would look perfectly self-consistent while doing it.
    //
    // It is shared because it is DERIVED from things the document owns: what the file already does,
    // what language it is, and the settings. Nothing view-shaped is an input, so no two views of one
    // document can compute it differently.
    const settings: EditorSettings = DEFAULT_APP_SETTINGS.editor;
    const inferred = { style: 'tabs', width: 4 } as const;
    const forView = (): ReturnType<typeof effectiveIndent> =>
      effectiveIndent({ inferred, languageId: 'python', settings });

    expect(forView()).toEqual(forView());
    // …and it is the FILE's own style that wins, not Python's spaces (FR-018a).
    expect(forView().style).toBe('tabs');
  });

  it('re-derives that one value when the document’s language changes — for every view at once', () => {
    const settings: EditorSettings = DEFAULT_APP_SETTINGS.editor;
    const asPython = effectiveIndent({ inferred: null, languageId: 'python', settings });
    const asGo = effectiveIndent({ inferred: null, languageId: 'go', settings });

    // A language override is DOCUMENT state (FR-028a), so this change reaches every view. The two
    // profiles must actually differ, or this test would pass on a codebase where the language was
    // ignored entirely.
    expect(asGo).not.toEqual(asPython);
    expect(asGo.style).toBe('tabs'); // …Go indents with tabs
    expect(asPython.style).toBe('spaces'); // …Python with spaces
  });
});

describe('the VIEW’s state is not', () => {
  it('leaves each view’s cursor where its own user put it (FR-028c)', () => {
    const wire = new Wire('doc', 'hello world');
    const a = wire.view('A', 0); // …user A is at the very start
    const b = wire.view('B', 11); // …user B is at the very end

    // A types at its caret. The TEXT is shared…
    a.edit({ from: 0, insert: 'X' }, 1);
    wire.flush();

    expect(wire.authority.text).toBe('Xhello world');
    expect(a.content).toBe('Xhello world');
    expect(b.content).toBe('Xhello world');

    // …and the CURSORS are not. Each moved only as the text under it moved: A's stayed after its own
    // insertion, B's slid one character right because a character appeared before it. Neither was
    // dragged to the other's position — which is what a broadcast of view state would have done.
    expect(a.head).toBe(1);
    expect(b.head).toBe(12);
  });

  it('collapses a cursor GRACEFULLY when the text under it is deleted by another view', () => {
    // The failure this prevents is not cosmetic. B's cursor sits inside "world"; A deletes "world".
    // A cursor left at its old offset would point past the end of a document that is now shorter —
    // and the next character B typed would land at an invalid position, or throw.
    const wire = new Wire('doc', 'hello world');
    const a = wire.view('A', 0);
    const b = wire.view('B', 9); // …inside "world", between 'r' and 'l'

    a.edit({ from: 5, to: 11, insert: '' }); // …delete " world"
    wire.flush();

    expect(wire.authority.text).toBe('hello');
    expect(b.content).toBe('hello');

    // It collapsed to the edge of the deletion — a real position in the document that now exists,
    // and the nearest one to where the user was looking.
    expect(b.head).toBe(5);
    expect(b.head).toBeLessThanOrEqual(b.content.length);
  });

  it('never puts view state on the wire at all — which is WHY the cursors cannot be yanked', () => {
    // The property above is not an accident of CodeMirror's mapping; it is structural. The canonical
    // message carries the DOCUMENT (the change, the version, whether it is dirty) and nothing about
    // any view's cursor, scroll or zoom. There is no field through which one view could impose its
    // cursor on another, so no future change can quietly start doing so.
    const wire = new Wire('doc', 'hello');
    const a = wire.view('A', 0);
    wire.view('B', 5);

    let seen: CanonicalChangeMsg | null = null;
    const original = wire.views[1].deliver.bind(wire.views[1]);
    wire.views[1].deliver = (msg: CanonicalChangeMsg): void => {
      seen = msg;
      original(msg);
    };

    a.edit({ from: 0, insert: 'X' }, 1);
    wire.flush();

    const msg = seen as CanonicalChangeMsg | null;
    expect(msg).not.toBeNull();

    // Every field on the wire is DOCUMENT state. `selection` is the only selection-shaped one, and
    // it is the cursor set an UNDO hands back to the view that ASKED for it — absent on an ordinary
    // edit, as here, and never another view's cursor.
    const allowed = ['changes', 'dirty', 'documentId', 'kind', 'origin', 'selection', 'version'];
    expect(Object.keys(msg!).filter((k) => !allowed.includes(k))).toEqual([]);
    expect(msg!.selection).toBeUndefined();

    // …and there is no field through which a view's own state could travel at all, so no future
    // change can quietly start broadcasting one view's cursor into another's window.
    for (const forbidden of ['cursor', 'scroll', 'zoom', 'viewState', 'viewId']) {
      expect(Object.keys(msg!)).not.toContain(forbidden);
    }
  });
});
