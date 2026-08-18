/**
 * The editor's OWN commands, over a real CodeMirror document (016, US3/US4/US6).
 *
 * MIGRATED FROM (034 FR-045/FR-046):
 *   - `packages/ui/tests/e2e/editor-cut-line.e2e.ts:97`  — `test('Ctrl+X with no selection cuts …')`
 *   - `packages/ui/tests/e2e/editor-cut-line.e2e.ts:128` — `test('a selection is cut EXACTLY …')`
 *   - `packages/ui/tests/e2e/editor-cut-line.e2e.ts:155` — `test('one Ctrl+Z restores a cut line …')`
 *   - `packages/ui/tests/e2e/editor-indentation.e2e.ts:168` — `test('Tab and Shift+Tab indent and outdent …')`
 *   - `packages/ui/tests/e2e/editor-column-select.e2e.ts:147` — `test('Shift+Alt+Arrow builds a real block …')`
 *   - `packages/ui/tests/e2e/editor-column-select.e2e.ts:268` — `test('N EXTERNAL lines over an N-row block …')`
 *
 * ══ ANTI-VACUITY CONTROL (mandatory, 034) ══
 *
 * In `FakeView.dispatch`, replace the state advance with `this.state = this.state;` so a dispatched
 * transaction is recorded but never applied. **Run, and it fails 13 of the 14** — the document ones
 * on unchanged text, the column ones on `ranges` still having length 1.
 *
 * THE FOURTEENTH SURVIVES, LEGITIMATELY, and it is named here rather than rounded away: `is ONE
 * transaction, marked delete.cut and NOT a delete run (FR-026)` asserts on the RECORDED TRANSACTION
 * — how many were dispatched and what they were annotated with — not on the state that results. An
 * editor that never advances still dispatches exactly one correctly-annotated transaction, so it
 * passes, and that is the right answer rather than a hole. Its own proof is mutation `--m6`, which
 * changes the `userEvent` to `delete.backward` and reddens precisely it.
 *
 * Two notes for whoever runs this control next, both learnt by getting it wrong:
 *   - DELETING the line outright leaves `state` never reassigned, which vitest reports as a
 *     transform error and "no tests". A file that failed to LOAD is not a file whose assertions
 *     failed, and reading one as the other is how a control gets believed without ever running.
 *   - The line is quoted verbatim in this very comment, so a bare `this.state = tr.state;` pattern
 *     matches the PROSE first and reports everything green while the code is untouched. Anchor on
 *     the trailing marker. That is the third comment-versus-code mistake spec 034 has paid for; the
 *     tell is a control that fails to fail.
 *
 * ══ WHY THESE COME DOWN FROM E2E ══
 *
 * Every migrated test above asserted on `.cm-line` text read back out of a real Electron window —
 * i.e. on the DOCUMENT, which the specs' own headers say explicitly ("every test below asserts on
 * the DOCUMENT, or on the file on disk"). A document is `EditorState`, and `EditorState` is pure:
 * the whole apparatus of an app, a daemon, a temp project and a real keyboard was buying the
 * translation from a keystroke to a command call, and that translation is CodeMirror's `keymap`,
 * which is not throng's code to re-test. throng's half of it — which chord reaches which command —
 * is already proven at `packages/ui/tests/unit/scope.test.ts:149` and `:168`
 * (`editorChordsFor(DEFAULT_KEYBINDINGS, 'editor.cutLine')` → `['Ctrl+X']`), and the chord→
 * CodeMirror-key spelling by `toCodeMirrorKey`, asserted below.
 *
 * ══ WHAT THIS ASSERTS THAT THE E2E DID NOT ══
 *
 *   - Tab leaves an EMPTY line alone (`commands.ts:355`). No E2E covered it, and the failure it
 *     prevents — trailing whitespace on a blank line — is invisible on screen and loud in a diff.
 *   - The column block's head column is CLAMPED to the widest row it covers (`commands.ts:531`).
 *     The E2E only ever grew a block over equal-length lines, where clamping cannot show.
 *   - A verbatim paste whose line count does NOT match the row count replaces every row with the
 *     whole text (`commands.ts:217`). The E2E asserted only the matching case, which a `perRow`
 *     hard-coded to `true` would also have passed.
 *   - A cut is exactly ONE transaction, marked `delete.cut` and NOT `delete.backward` — which is
 *     what stops it coalescing into the backspaces above it (`use-editor.ts:155`).
 *
 * ══ WHAT DID NOT MOVE, AND WHY ══
 *
 *   - `editor-cut-line.e2e.ts:176` (Ctrl+X in the File Explorer cuts a FILE) — OS focus routing
 *     between two panel kinds; Principle V's focus reserve.
 *   - `editor-indentation.e2e.ts:101` (a TAB-indented file keeps taking TABS) stays as the WIRING
 *     witness: `useEditor` calls `reinferIndent(state.text)` on load (`use-editor.ts:1153`), and no
 *     layer below E2E exercises that hook. Its two siblings (`:125`, `:146`) differ from it only in
 *     which answer the pure decision returns, and that decision is covered at
 *     `packages/ui/tests/integration/indent-infer.integration.test.ts:132` and `:154`.
 *   - The undo HALF of the migrated tests. Undo is not CodeMirror's `history()` here — it belongs to
 *     the document authority in UI main (`use-editor.ts:776`), and "one entry per command" is
 *     asserted at `packages/ui/tests/unit/undo-service.test.ts:25`. What is proven below is the
 *     other half of that composition: the command dispatches ONE transaction, with a userEvent that
 *     does not join a run.
 *   - Everything in `editor-column-select.e2e.ts` that needs an Alt+drag with real character
 *     coordinates, a second panel, the OS clipboard, or bytes on disk.
 *
 * ══ THE HARNESS ══
 *
 * A CodeMirror `Command` is typed `(view: EditorView) => boolean`, but every command in
 * `commands.ts` touches exactly two members of that view: `state` and `dispatch`. So the subject
 * here is a real `EditorState` — real facets, the real `columnBlockField`, real transactions —
 * behind a two-member stand-in. No `EditorView` is constructed: jsdom has no layout, and a view
 * built over it would be measuring nothing while pretending otherwise.
 *
 * jsdom is still required, for two reasons that are both about the module graph rather than the
 * assertions: `commands.ts` imports `@codemirror/view`, and the clipboard seam reads `window.throng`
 * (`commands.ts:46`).
 */
import { EditorSelection, EditorState, type TransactionSpec, type Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClipboardMode, IndentProfile, LineEndingId } from '@throng/core';
import {
  applyPaste,
  columnBlockField,
  columnSelectDown,
  columnSelectLeft,
  columnSelectRight,
  cutLineCommand,
  indentExtensions,
  indentLinesCommand,
  outdentLinesCommand,
  selectionIsRectangular,
  toCodeMirrorKey,
} from '../../src/renderer/editor/commands.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * The subject
 * ────────────────────────────────────────────────────────────────────────── */

const SPACES4: IndentProfile = { style: 'spaces', indentWidth: 4, tabWidth: 4 };
const SPACES2: IndentProfile = { style: 'spaces', indentWidth: 2, tabWidth: 4 };
const TABS: IndentProfile = { style: 'tabs', indentWidth: 4, tabWidth: 4 };

/**
 * A real `EditorState` behind the two members a `Command` actually uses.
 *
 * `allowMultipleSelections` and `columnBlockField` are here because the live view has them
 * (`use-editor.ts:749`, `:772`) and a block cannot exist without either: with the facet off,
 * CodeMirror reduces every transaction's selection to its main range and a ten-row block silently
 * becomes one cursor.
 */
class FakeView {
  state: EditorState;
  readonly dispatched: Transaction[] = [];

  constructor(doc: string, profile: IndentProfile) {
    this.state = EditorState.create({
      doc,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        columnBlockField,
        indentExtensions(profile),
      ],
    });
  }

  dispatch(spec: TransactionSpec): void {
    const tr = this.state.update(spec);
    this.dispatched.push(tr);
    this.state = tr.state; // ← the anti-vacuity control deletes THIS line
  }

  get text(): string {
    return this.state.doc.toString();
  }

  /** The text of every selection range, in document order. */
  get selected(): string[] {
    return this.state.selection.ranges.map((r) => this.state.sliceDoc(r.from, r.to));
  }

  /** Place a bare caret. */
  caret(at: number): void {
    this.dispatch({ selection: EditorSelection.cursor(at) });
  }

  /** Select exactly `from`..`to`. */
  select(from: number, to: number): void {
    this.dispatch({ selection: EditorSelection.single(from, to) });
  }

  /** The command's view argument. */
  get view(): EditorView {
    return this as unknown as EditorView;
  }
}

const make = (doc: string, profile: IndentProfile = SPACES4): FakeView => new FakeView(doc, profile);

/** The document's line ending, as the commands ask for it. */
const LF = (): LineEndingId => 'lf';

/* ────────────────────────────────────────────────────────────────────────── *
 * The clipboard seam
 * ────────────────────────────────────────────────────────────────────────── */

interface ClipEntry {
  text: string;
  mode: ClipboardMode;
}

let clipboard: ClipEntry | null;
let writes: ClipEntry[];

beforeEach(() => {
  clipboard = null;
  writes = [];
  // `commands.ts:46` reaches the clipboard through `window.throng` — the same seam the app uses, so
  // main's record and the OS clipboard cannot disagree (FR-016b).
  Reflect.set(window, 'throng', {
    clipboard: {
      write: (entry: ClipEntry): Promise<void> => {
        writes.push(entry);
        clipboard = entry;
        return Promise.resolve();
      },
      paste: (): Promise<ClipEntry | null> => Promise.resolve(clipboard),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/**
 * A cut writes to the clipboard BEFORE it deletes anything (`commands.ts:117`), so its dispatch
 * lands a microtask later. Waiting for it is the point: a test that asserted immediately would be
 * asserting that the deletion had not happened yet.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/* ────────────────────────────────────────────────────────────────────────── *
 * cut-line (FR-016/FR-016a/FR-015a)
 * ────────────────────────────────────────────────────────────────────────── */

describe('cut-line takes a whole line, or exactly the selection (FR-016a)', () => {
  it('cuts the WHOLE line with a bare caret — break and all, leaving no blank line', async () => {
    const v = make('alpha\nbeta\ngamma\n');
    v.caret(6); // …the start of "beta"

    expect(cutLineCommand(LF)(v.view)).toBe(true);
    await settle();

    expect(v.text).toBe('alpha\ngamma\n');
    expect(writes).toEqual([{ text: 'beta\n', mode: 'full-line' }]);
  });

  it('pastes a full-line entry as a whole line ABOVE the caret, leaving that line unsplit', () => {
    // The caret sits INSIDE a word. A verbatim insert would split "alpha" in half — which is what
    // every editor that forgets the clipboard's shape does (FR-015a).
    const v = make('alpha\ngamma\n');
    v.caret(2); // …between "al" and "pha"

    applyPaste(v.view, 'beta\n', 'full-line');

    expect(v.text).toBe('beta\nalpha\ngamma\n');
  });

  it('cuts a selection EXACTLY, and never widens it to the line', async () => {
    // The damaging failure: the user selects two characters and loses the line.
    const v = make('alpha\nbeta\ngamma\n');
    v.select(0, 2); // …"al"

    expect(cutLineCommand(LF)(v.view)).toBe(true);
    await settle();

    expect(v.text).toBe('pha\nbeta\ngamma\n');
    expect(writes).toEqual([{ text: 'al', mode: 'verbatim' }]);

    // …and it pastes back verbatim, INTO the line rather than above it.
    applyPaste(v.view, 'al', 'verbatim');
    expect(v.text).toBe('alpha\nbeta\ngamma\n');
  });

  it('is ONE transaction, marked delete.cut and NOT a delete run (FR-026)', async () => {
    // Half of the "one Ctrl+Z restores a cut line" claim. The other half — that one entry in the
    // authority's history is one undo — is `packages/ui/tests/unit/undo-service.test.ts:25`.
    // `delete.cut` is deliberately not `delete.backward`/`delete.forward`: those are the only two
    // classes `use-editor.ts:155` lets coalesce, so a cut can never join the backspaces above it.
    const v = make('alpha\nbeta\ngamma\n');
    v.caret(0);
    const before = v.dispatched.length;

    cutLineCommand(LF)(v.view);
    await settle();

    const edits = v.dispatched.slice(before);
    expect(edits).toHaveLength(1);
    expect(edits[0].isUserEvent('delete.cut')).toBe(true);
    expect(edits[0].isUserEvent('delete.backward')).toBe(false);
    expect(edits[0].isUserEvent('delete.forward')).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * indent / outdent (FR-018/FR-019/FR-026)
 * ────────────────────────────────────────────────────────────────────────── */

describe('Tab and Shift+Tab move every line a selection touches (FR-019)', () => {
  it('indents EVERY touched line in ONE transaction', () => {
    const v = make('def a():\n    if x:\n        return 1\n');
    v.select(0, v.state.doc.length);
    const before = v.dispatched.length;

    expect(indentLinesCommand(() => SPACES4)(v.view)).toBe(true);

    expect(v.text).toBe('    def a():\n        if x:\n            return 1\n');
    // One transaction, however many lines it moved — the shape FR-026 needs from a command.
    expect(v.dispatched.slice(before)).toHaveLength(1);
    expect(v.dispatched[v.dispatched.length - 1].isUserEvent('input.indent')).toBe(true);
  });

  it('outdents every touched line, and leaves an UNINDENTED line alone', () => {
    // Eating the first character of `def a():` would be the worst outcome here: a silent edit to
    // code the user only meant to shift.
    const v = make('def a():\n    if x:\n        return 1\n');
    v.select(0, v.state.doc.length);

    expect(outdentLinesCommand(() => SPACES4)(v.view)).toBe(true);

    expect(v.text).toBe('def a():\nif x:\n    return 1\n');
  });

  it('leaves an EMPTY line alone rather than giving it trailing whitespace', () => {
    // Never covered at E2E. An indented blank line is invisible on screen, flagged by every linter,
    // and shows in the diff as a change the user cannot see they made.
    const v = make('a\n\nb\n', SPACES2);
    v.select(0, v.state.doc.length);

    indentLinesCommand(() => SPACES2)(v.view);

    expect(v.text).toBe('  a\n\n  b\n');
  });

  it('outdents a TAB-indented line as a tab, whatever width the profile carries', () => {
    // Reading the LINE rather than assuming the configured style is what lets a tab-indented file be
    // outdented while the setting says spaces (FR-018a).
    const v = make('\tone\n  two\n', SPACES4);
    v.select(0, v.state.doc.length);

    outdentLinesCommand(() => SPACES4)(v.view);

    expect(v.text).toBe('one\ntwo\n');
  });

  it('inserts the PROFILE’s unit at a bare caret, under the chord CodeMirror matches', () => {
    const tabbed = make('x', TABS);
    tabbed.caret(1);
    indentLinesCommand(() => TABS)(tabbed.view);
    expect(tabbed.text).toBe('x\t');

    const spaced = make('x', SPACES4);
    spaced.caret(1);
    indentLinesCommand(() => SPACES4)(spaced.view);
    expect(spaced.text).toBe('x    ');

    // The throng half of "pressing Tab indents". WHICH chords reach the command is
    // `packages/ui/tests/unit/scope.test.ts:149`; this is the notation translation, where a wrong
    // answer fails INVISIBLY — `commands.ts:576` documents the Ctrl-X/Ctrl-x case that cost a
    // release.
    expect(toCodeMirrorKey('Tab')).toBe('Tab');
    expect(toCodeMirrorKey('Shift+Tab')).toBe('Shift-Tab');
    expect(toCodeMirrorKey('Ctrl+X')).toBe('Ctrl-x');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * column selection (FR-025/FR-025h)
 * ────────────────────────────────────────────────────────────────────────── */

describe('the keyboard builds a real column block (FR-025)', () => {
  it('makes one range per row, so a single insert lands on EVERY row', () => {
    const v = make('aaaa\nbbbb\ncccc\ndddd\n');
    v.caret(0);

    expect(columnSelectDown(v.view)).toBe(true);
    expect(columnSelectDown(v.view)).toBe(true);

    // Three zero-width cursors, stacked in column 0 — not one cursor on the last row, which is what
    // a dropped `allowMultipleSelections` silently produces.
    expect(v.state.selection.ranges).toHaveLength(3);

    v.dispatch(v.state.replaceSelection('X'));
    expect(v.text).toBe('Xaaaa\nXbbbb\nXcccc\ndddd\n');
  });

  it('clamps the head column to the WIDEST row the block covers', () => {
    // Without the bound the column runs off into virtual space: the block looks unchanged while its
    // column is 13, and the user must press Left nine times before anything moves
    // (`commands.ts:531`).
    const v = make('aaaa\nbb\ncccc\n');
    v.caret(0);
    columnSelectDown(v.view); // …rows 1–2, so the widest row is "aaaa" at 4

    for (let i = 0; i < 9; i += 1) columnSelectRight(v.view);
    expect(v.selected).toEqual(['aaaa', 'bb']);

    // The load-bearing half: ONE Left must shrink the block. The assertion above passes either way —
    // an unclamped column of 13 still materialises as the whole of both lines — so the bug is only
    // visible in what the NEXT keystroke does.
    columnSelectLeft(v.view);
    expect(v.selected).toEqual(['aaa', 'bb']);
  });

  it('is recognised as rectangular, which is what decides the clipboard’s shape', () => {
    const v = make('aaaa\nbbbb\ncccc\n');
    v.caret(0);
    columnSelectDown(v.view);
    columnSelectRight(v.view);

    // The length assertion is not decoration: `isRectangular` is trivially true of a SINGLE row, so
    // without it this test would pass over a selection that never became a block at all.
    expect(v.state.selection.ranges).toHaveLength(2);
    expect(selectionIsRectangular(v.view)).toBe(true);
  });

  it('distributes N EXTERNAL lines one per row over an N-row block (FR-025h)', () => {
    // Plain text from another application, carrying no rectangular marker. Matching the line count
    // to the row count is the ONLY route by which external column data enters a block.
    const v = make('aaaa\nbbbb\ncccc\ndddd\n');
    v.caret(0);
    columnSelectDown(v.view);
    columnSelectDown(v.view);
    columnSelectRight(v.view);

    applyPaste(v.view, '1\n2\n3', 'verbatim');

    expect(v.text).toBe('1aaa\n2bbb\n3ccc\ndddd\n');
  });

  it('replaces every row with the WHOLE text when the counts do not match', () => {
    // Never covered at E2E, and a `perRow` hard-coded to true would have passed the test above.
    // There is no honest way to spread two lines across three rows, so the text goes in whole.
    const v = make('aaaa\nbbbb\ncccc\ndddd\n');
    v.caret(0);
    columnSelectDown(v.view);
    columnSelectDown(v.view);
    columnSelectRight(v.view);

    applyPaste(v.view, '1\n2', 'verbatim');

    expect(v.text).toBe('1\n2aaa\n1\n2bbb\n1\n2ccc\ndddd\n');
  });
});
