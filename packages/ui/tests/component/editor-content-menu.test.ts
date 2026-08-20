import {
  EditorSelection,
  EditorState,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClipboardMode, LineEndingId } from '@throng/core';
import { editorContentMenu, placeCaretForContextMenu } from '../../src/renderer/editor/content-menu.js';
import { asKeyboardMenu } from '../../src/renderer/workspace/keyboard-menu.js';
import type { MenuAction } from '../../src/renderer/workspace/context-menu.js';

/**
 * The editor's CONTENT context menu — what its items DO (016, FR-012/FR-012a/FR-012b, FR-026b).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/editor-content-menu.e2e.ts` (035 T055):
 *   - `:97`  mouse-only cut and paste — no selection cuts the whole line (FR-012b)
 *   - `:123` right-clicking INSIDE a selection preserves it; outside collapses it (FR-012a)
 *   - `:154` right-clicking OUTSIDE a selection moves the caret there (FR-012a)
 *   - `:179` Undo from the content menu reaches the document authority (FR-026b)
 *
 * ══ THE MENU WAS TESTED FOR WHAT IT SAYS, NEVER FOR WHAT IT DOES ══
 *
 * `editorContentMenu` already has two unit tests — `menu-icon-tokens.test.ts` and
 * `menu-sections.test.ts` — and between them they assert every label, icon token, section and
 * shortcut on it. Both build the menu with `{} as EditorView`, because neither ever calls an
 * `onClick`. So the item list was proven exhaustively and **every handler behind it was proven
 * nowhere**, at any layer, and the four E2Es above were the only thing standing between a menu that
 * reads correctly and a menu that does nothing.
 *
 * `placeCaretForContextMenu` was worse: no test of any kind. It is the function the Shift+F10 trap
 * was found in — a keyboard-opened menu carries the focused element's CORNER as its coordinates, so
 * moving the caret there destroys the selection the user opened the menu to act on, and Cut then
 * takes the whole line. That fix has been shipped and unguarded ever since.
 *
 * ══ WHAT IS NOT HERE ══
 *
 * That a right-click on a rendered `.cm-line` reaches this function with usable coordinates, and
 * that the menu actually appears over the text rather than the panel header. Both are layout, and
 * `editor-content-menu.e2e.ts` keeps them.
 *
 * ══ THE HARNESS ══
 *
 * The same two-member stand-in `editor-command-semantics.test.ts` argues for: a real `EditorState`
 * behind the `state`/`dispatch` pair the production code touches, plus `posAtCoords` and `focus`,
 * which this file's subject uses and that one's does not. No `EditorView` is constructed — jsdom has
 * no layout, so `posAtCoords` on a real view would answer `null` to every question and each test
 * below would pass by never doing anything.
 *
 * That is why `posAtCoords` is a STUB RETURNING A POSITION rather than a real measurement: the
 * decision under test is what the code does WITH the position, and a harness that cannot supply one
 * cannot test the decision. The measurement itself is CodeMirror's and is not throng's to re-prove.
 */

/* ────────────────────────────────────────────────────────────────────────── *
 * The subject
 * ────────────────────────────────────────────────────────────────────────── */

class FakeView {
  state: EditorState;
  readonly dispatched: Transaction[] = [];
  focused = 0;

  /** What `posAtCoords` will answer — the caret position the pointer is over. */
  posAt: number | null = 0;

  constructor(doc: string) {
    this.state = EditorState.create({
      doc,
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
  }

  dispatch(spec: TransactionSpec): void {
    const tr = this.state.update(spec);
    this.dispatched.push(tr);
    this.state = tr.state;
  }

  posAtCoords(): number | null {
    return this.posAt;
  }

  focus(): void {
    this.focused += 1;
  }

  get text(): string {
    return this.state.doc.toString();
  }

  get selected(): string[] {
    return this.state.selection.ranges.map((r) => this.state.sliceDoc(r.from, r.to));
  }

  caret(at: number): void {
    this.dispatch({ selection: EditorSelection.cursor(at) });
  }

  select(from: number, to: number): void {
    this.dispatch({ selection: EditorSelection.single(from, to) });
  }

  get view(): EditorView {
    return this as unknown as EditorView;
  }
}

const make = (doc = 'alpha\nbeta\ngamma\n'): FakeView => new FakeView(doc);

/** A right-click at some coordinates. The numbers never matter — `posAtCoords` is the stub. */
const rightClick = (): MouseEvent => new MouseEvent('contextmenu', { clientX: 40, clientY: 12 });

/* ────────────────────────────────────────────────────────────────────────── *
 * The seams: the clipboard and the document authority, both `window.throng`
 * ────────────────────────────────────────────────────────────────────────── */

interface ClipEntry {
  text: string;
  mode: ClipboardMode;
}

let clipboard: ClipEntry | null;
let writes: ClipEntry[];
let undos: { panelId: string; viewId: string }[];
let redos: { panelId: string; viewId: string }[];

beforeEach(() => {
  clipboard = null;
  writes = [];
  undos = [];
  redos = [];
  Reflect.set(window, 'throng', {
    clipboard: {
      write: (entry: ClipEntry): Promise<void> => {
        writes.push(entry);
        clipboard = entry;
        return Promise.resolve();
      },
      paste: (): Promise<ClipEntry | null> => Promise.resolve(clipboard),
    },
    editor: {
      undo: (arg: { panelId: string; viewId: string }): void => void undos.push(arg),
      redo: (arg: { panelId: string; viewId: string }): void => void redos.push(arg),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/** A cut writes to the clipboard before it deletes, and paste reads it — both land a tick later. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function menu(v: FakeView): MenuAction[] {
  return editorContentMenu({
    view: v.view,
    panelId: 'panel-1',
    viewId: 'view-1',
    lineEnding: (): LineEndingId => 'lf',
    wordWrap: { on: false, toggle: () => {} },
    gotoLine: { open: () => {} },
  });
}

/** Find an item by its label and invoke it, exactly as a click would. */
function click(v: FakeView, label: string): void {
  const item = menu(v).find((m) => m.label === label);
  if (!item) throw new Error(`no menu item labelled ${label}`);
  item.onClick?.();
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Where the caret goes when the user right-clicks (FR-012a)
 * ────────────────────────────────────────────────────────────────────────── */

describe('a right-click inside a selection preserves it; outside, it moves the caret', () => {
  it('leaves an existing selection alone when the click lands INSIDE it', () => {
    /*
     * The user selected something and right-clicked it because they are about to act on it.
     * Collapsing the selection here destroys the very thing the menu was opened for, and the
     * failure is silent: Cut then takes the whole line and looks like it worked.
     */
    const v = make();
    v.select(0, 5); // "alpha"
    const before = v.dispatched.length;
    v.posAt = 2; // …the pointer is over "p", inside the selection

    placeCaretForContextMenu(v.view, rightClick());

    expect(v.dispatched).toHaveLength(before);
    expect(v.selected).toEqual(['alpha']);
  });

  it('collapses the selection and moves the caret when the click lands OUTSIDE it', () => {
    const v = make();
    v.select(0, 5); // "alpha"
    v.posAt = 12; // …the start of "gamma", well outside

    placeCaretForContextMenu(v.view, rightClick());

    expect(v.selected).toEqual(['']);
    expect(v.state.selection.main.head).toBe(12);
  });

  it('treats the selection edges as inside — the boundary is not outside it', () => {
    // `pos >= r.from && pos <= r.to`. A click on the last character of a selection is a click on the
    // selection, and an exclusive bound here would collapse it on the most natural place to aim.
    const v = make();
    v.select(0, 5);

    for (const pos of [0, 5]) {
      v.posAt = pos;
      const before = v.dispatched.length;
      placeCaretForContextMenu(v.view, rightClick());
      expect(v.dispatched, `a click at ${pos} must not collapse the selection`).toHaveLength(before);
    }
  });

  it('moves the caret when there is NO selection — an empty range is not something to preserve', () => {
    const v = make();
    v.caret(0);
    v.posAt = 7;

    placeCaretForContextMenu(v.view, rightClick());

    expect(v.state.selection.main.head).toBe(7);
  });

  it('does nothing at all for a KEYBOARD-opened menu, whatever the coordinates say', () => {
    /*
     * THE SHIFT+F10 TRAP, and the reason this function has a guard at the top of it.
     *
     * A keyboard-opened menu is a synthetic `contextmenu` carrying the focused element's CORNER, so
     * `posAtCoords` answers a real position that has nothing to do with the caret. Acting on it
     * collapses the selection the user pressed Shift+F10 to act on, and Cut takes the whole line
     * instead of the selected word. Nothing distinguishes the event itself — only this flag does.
     */
    const v = make();
    v.select(0, 5);
    v.posAt = 12; // …outside the selection, so an unguarded run WOULD collapse it
    const before = v.dispatched.length;

    asKeyboardMenu(() => placeCaretForContextMenu(v.view, rightClick()));

    expect(v.dispatched).toHaveLength(before);
    expect(v.selected).toEqual(['alpha']);
  });

  it('leaves the caret alone when the coordinates resolve to nothing', () => {
    // A click in the padding below the last line. Dispatching a cursor at `null` would throw.
    const v = make();
    v.caret(3);
    v.posAt = null;
    const before = v.dispatched.length;

    placeCaretForContextMenu(v.view, rightClick());

    expect(v.dispatched).toHaveLength(before);
    expect(v.state.selection.main.head).toBe(3);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Cut, Copy and Paste — mouse-only editing (FR-012b, FR-015a)
 * ────────────────────────────────────────────────────────────────────────── */

describe('the editing items act on the caret when nothing is selected (FR-012b)', () => {
  it('Cut with a bare caret takes the WHOLE line, break and all', async () => {
    const v = make();
    v.caret(6); // …the start of "beta"

    click(v, 'Cut');
    await settle();

    expect(v.text).toBe('alpha\ngamma\n');
    expect(writes).toEqual([{ text: 'beta\n', mode: 'full-line' }]);
  });

  it('Paste puts a full-line entry in as a whole line ABOVE, leaving that line unsplit', async () => {
    // The E2E's second half: cut a line, then paste it back with the caret INSIDE another line. A
    // verbatim insert would split "gamma" in two (FR-015a).
    const v = make();
    v.caret(6);
    click(v, 'Cut');
    await settle();
    expect(v.text).toBe('alpha\ngamma\n');

    v.caret(8); // …between "ga" and "mma"
    click(v, 'Paste');
    await settle();

    expect(v.text).toBe('alpha\nbeta\ngamma\n');
  });

  it('Cut over a selection takes EXACTLY the selection, and never widens it to the line', async () => {
    // The damaging failure this direction: the user selects two characters and loses the line.
    const v = make();
    v.select(6, 8); // "be"

    click(v, 'Cut');
    await settle();

    expect(v.text).toBe('alpha\nta\ngamma\n');
    expect(writes).toEqual([{ text: 'be', mode: 'verbatim' }]);
  });

  it('Copy takes the same text as Cut and leaves the document untouched', async () => {
    const v = make();
    v.caret(6);

    click(v, 'Copy');
    await settle();

    expect(writes).toEqual([{ text: 'beta\n', mode: 'full-line' }]);
    expect(v.text).toBe('alpha\nbeta\ngamma\n');
  });

  it('Paste returns focus to the editor, so the next keystroke lands in the document', async () => {
    // Without this the caret is in a menu that has closed, and the user types into nothing.
    const v = make();
    v.caret(6);
    click(v, 'Cut');
    await settle();
    const focusedBefore = v.focused;

    v.caret(0);
    click(v, 'Paste');
    await settle();

    expect(v.focused).toBeGreaterThan(focusedBefore);
  });

  it('Paste with an empty clipboard changes nothing', async () => {
    const v = make();
    v.caret(6);

    click(v, 'Paste');
    await settle();

    expect(v.text).toBe('alpha\nbeta\ngamma\n');
  });

  it('Select All selects the whole document and returns focus', () => {
    const v = make();
    v.caret(0);

    click(v, 'Select All');

    expect(v.selected).toEqual(['alpha\nbeta\ngamma\n']);
    expect(v.focused).toBeGreaterThan(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Undo and Redo go to the AUTHORITY (FR-026b)
 * ────────────────────────────────────────────────────────────────────────── */

describe('Undo and Redo reach the document authority, not CodeMirror', () => {
  it('Undo calls the bridge, naming this panel and this view', () => {
    /*
     * The undo stack belongs to the document in UI main, and the local `history()` these would
     * otherwise operate on was DELETED when it moved there. So a menu item bound to CodeMirror's own
     * `undo` is a dead no-op that reads perfectly correctly in the source — the same trap the keymap
     * fell into one layer up, which is why FR-026b names it.
     *
     * The viewId matters as much as the panelId: undo is per DOCUMENT, but the cursors it restores
     * go to the view that asked, and two panels showing one file must not steal each other's caret.
     */
    const v = make();

    click(v, 'Undo');

    expect(undos).toEqual([{ panelId: 'panel-1', viewId: 'view-1' }]);
    expect(v.dispatched).toHaveLength(0);
  });

  it('Redo calls the bridge the same way', () => {
    const v = make();

    click(v, 'Redo');

    expect(redos).toEqual([{ panelId: 'panel-1', viewId: 'view-1' }]);
    expect(v.dispatched).toHaveLength(0);
  });
});
