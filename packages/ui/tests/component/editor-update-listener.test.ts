/**
 * The editor's ONE update listener, widened for the caret readouts without widening what it
 * REPORTS (040 US1 — FR-008, FR-008a; research.md D1).
 *
 * ══ THE MISTAKE THIS FILE EXISTS TO CATCH ══
 *
 * `use-editor.ts` has a single `EditorView.updateListener`, and it opens:
 *
 *     const updateListener = EditorView.updateListener.of((update) => {
 *       if (!update.docChanged) return;
 *
 * Everything below that line ASSUMES a document change. `replica.record` reports the edit to the
 * document authority, and the auto-save timer starts a save. FR-001 needs line and column to follow
 * a pointer click and an arrow key, and CodeMirror reports those as `update.selectionSet` rather
 * than `docChanged` — so the listener has to widen, and FR-008 forbids adding a second listener to
 * the hottest path in the editor.
 *
 * **The obvious widening is wrong.** Relaxing the guard to
 *
 *     if (!update.docChanged && !update.selectionSet) return;
 *
 * lets every arrow key fall through into `replica.record`, which reports a change to the authority
 * that did not happen. Nothing throws, nothing looks wrong on screen, and the damage lands in the
 * shared undo history days later. research.md D1 records the resolution: add the new concerns
 * ABOVE the guard and leave the guard, and everything below it, exactly where it is.
 *
 * ══ WHY THIS IS A COMPONENT TEST AND NOT AN E2E ══
 *
 * The claim is about what the listener does with one update, and `helpers/mount-editor.ts` mounts a
 * REAL `EditorView` in jsdom behind a fake `editor.*` bridge — so a real selection transaction can
 * be dispatched and the messages the renderer sends back can be counted. No window, no daemon, no
 * layout. What jsdom cannot do is measure anything, and nothing here measures anything.
 *
 * ══ PROVEN TO DETECT THE MISTAKE ══
 *
 * Written and run against the naive widening BEFORE the correct one existed: "reports NOTHING to
 * the document authority" and "starts no auto-save timer" both failed, with the selection-only
 * update producing an edit message and a timer. That is the Red step this file is for; a
 * regression test that has never seen the regression is a guess.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountEditor } from './helpers/mount-editor.js';
import { panelCaret, __resetCaretStore } from '../../src/renderer/editor/caret-store.js';
import {
  documentMetrics,
  __resetDocumentMetricsStore,
} from '../../src/renderer/editor/document-metrics-store.js';
import { disposeEditor } from '../../src/renderer/editor/use-editor.js';
import { removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';

const PANEL = 'p-listener';
const PATH = 'C:/proj/note.txt';
/**
 * The document. Line 2 is `beta gamma`, so offset 11 is line 2, column 6 — a position no other
 * line could produce, which is what makes the caret assertions specific rather than plausible.
 */
const DOC = 'alpha\nbeta gamma\ndelta\n';

/** Distinctive enough that a `setTimeout(…, 4321)` can only be the auto-save timer. */
const AUTO_SAVE_MS = 4321;

beforeEach(() => {
  __resetCaretStore();
  __resetDocumentMetricsStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A mounted editor with auto-save ARMED — a pathed document and a distinctive debounce.
 *
 * ══ THE DOCUMENT ARRIVING IS NOT THE SETTINGS ARRIVING — issue #335 ══
 *
 * These mount with `autoSave: true`, and half the assertions below are about what that produces.
 * But `autoSave` reaches the editor through `config.get()`, which `ConfigProvider` awaits in its
 * own effect, while the text reaches it through `editor.getContent()` — a DIFFERENT promise, in a
 * DIFFERENT component. Waiting for the text says nothing about the settings, and the shipped
 * default for `editor.autoSave` is `false`.
 *
 * So the version of this that waited only for the text was asserting against a tree that USUALLY
 * held the requested settings by then. On a loaded CI runner it did not, the listener took the
 * `metaRef.current.settings.autoSave` branch with the shipped default, no timer was ever armed,
 * and "still arms the auto-save timer" failed with an empty array — then passed on a re-run of the
 * same commit, which is what made it a flake rather than a defect.
 *
 * The fix is the same shape as #321's: wait for the precondition the assertion actually depends
 * on, not for the nearest thing that happens to be observable. `settingsLoaded()` is that
 * precondition, and the harness renders a witness under the provider to expose it.
 */
async function mounted(configDelayTicks = 0) {
  const h = mountEditor({
    panelId: PANEL,
    doc: { text: DOC, version: 1, absPath: PATH },
    settings: { editor: { autoSave: true, autoSaveDebounceMs: AUTO_SAVE_MS } },
    configDelayTicks,
  });
  await waitFor(() => expect(h.view().state.doc.toString()).toBe(DOC));
  await waitFor(() => expect(h.settingsLoaded()).toBe(true));
  return h;
}

/** Timers scheduled at the auto-save debounce, and only those. */
function autoSaveTimers(spy: ReturnType<typeof vi.spyOn>): unknown[] {
  return spy.mock.calls.filter((call) => call[1] === AUTO_SAVE_MS);
}

/* ────────────────────────────────────────────────────────────────────────── *
 * A selection-only update reports NOTHING and saves NOTHING
 * ────────────────────────────────────────────────────────────────────────── */

describe('a caret move is not an edit (FR-008, research.md D1)', () => {
  it('reports NOTHING to the document authority', async () => {
    /*
     * THE test. A relaxed guard sends an edit message for every arrow key — an empty change set
     * against the authority's current version, from a view that changed nothing. It corrupts the
     * shared undo history rather than the screen, so it is invisible until much later.
     */
    const h = await mounted();
    const before = h.dispatched.length;

    act(() => {
      h.view().dispatch({ selection: EditorSelection.cursor(11) });
    });

    expect(
      h.dispatched.length,
      'a selection-only update must not reach replica.record',
    ).toBe(before);
  });

  it('starts no auto-save timer', async () => {
    // The listener's other consequence. A save armed by a caret move writes the file because the
    // user looked at a different line, which is not something a user would ever connect to a cause.
    const h = await mounted();
    const spy = vi.spyOn(globalThis, 'setTimeout');

    act(() => {
      h.view().dispatch({ selection: EditorSelection.cursor(11) });
    });

    expect(autoSaveTimers(spy), 'no save may be armed by a caret move').toEqual([]);
  });

  it('reports nothing for a RANGE selection either', async () => {
    // A drag-select and a Shift+Arrow are the same `selectionSet` update as a bare caret move, and
    // a guard that special-cased empty selections would pass the test above and fail here.
    const h = await mounted();
    const before = h.dispatched.length;

    act(() => {
      h.view().dispatch({ selection: EditorSelection.range(6, 10) });
    });

    expect(h.dispatched.length).toBe(before);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * ANTI-VACUITY: the path the guard protects is still live
 * ────────────────────────────────────────────────────────────────────────── */

describe('a real edit still reports and still arms the save', () => {
  /*
   * Without these two, every assertion above is satisfied by a listener that does nothing at all —
   * including one that was accidentally unregistered. They are the control, not the feature.
   */
  it('still sends the edit to the authority', async () => {
    const h = await mounted();
    const before = h.dispatched.length;

    act(() => {
      h.view().dispatch({ changes: { from: 0, insert: 'X' } });
    });

    expect(h.dispatched.length, 'the existing report path must be untouched').toBe(before + 1);
  });

  it('still arms the auto-save timer', async () => {
    const h = await mounted();
    const spy = vi.spyOn(globalThis, 'setTimeout');

    act(() => {
      h.view().dispatch({ changes: { from: 0, insert: 'X' } });
    });

    expect(autoSaveTimers(spy)).toHaveLength(1);
  });

  it('still arms it when the settings channel loses its race with the document (#335)', async () => {
    /*
     * The regression test for the flake, and the reason it can be one: `configDelayTicks` pushes
     * `config.get()` far enough behind `editor.getContent()` that the settings ALWAYS arrive
     * second. Against the version of `mounted()` that waited only for the document text this
     * fails every run, with the CI wording — "expected [] to have a length of 1 but got +0" —
     * because `editor.autoSave` was still its shipped default of `false` and no timer was armed.
     *
     * Five ticks rather than one: one is enough to lose the race, and four more are there so a
     * future change that adds a hop to either channel does not quietly turn this back into a
     * coin toss that passes.
     */
    const h = await mounted(5);
    const spy = vi.spyOn(globalThis, 'setTimeout');

    act(() => {
      h.view().dispatch({ changes: { from: 0, insert: 'X' } });
    });

    expect(
      autoSaveTimers(spy),
      'the settings must be the ones the test asked for, not the shipped defaults',
    ).toHaveLength(1);
  });

  it('holds the requested settings by the time the document is mounted (#335)', async () => {
    // The precondition itself, asserted directly. Without it the test above could go green for
    // the wrong reason — a debounce that happened to match, or a default that changed.
    const h = await mounted(5);

    expect(h.settings().editor.autoSave).toBe(true);
    expect(h.settings().editor.autoSaveDebounceMs).toBe(AUTO_SAVE_MS);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The caret is computed IN the invocation, not deferred (FR-008a)
 * ────────────────────────────────────────────────────────────────────────── */

describe('the caret figures are computed synchronously (FR-008a)', () => {
  /*
   * FR-008a is stated as a synchronous-computation rule rather than as "the same frame" precisely
   * so a test can check it: the figures must be readable the instant `dispatch` returns. Reading
   * them INSIDE the act callback is what makes that check real — a `queueMicrotask` or a
   * `requestAnimationFrame` implementation would still be correct by the time any later assertion
   * ran, and would still be the lagging caret that reads as a broken editor.
   */
  it('has published the new position before dispatch returns', async () => {
    const h = await mounted();
    let atReturn: unknown;

    act(() => {
      h.view().dispatch({ selection: EditorSelection.cursor(11) });
      atReturn = panelCaret(PANEL).position; // no await, no timer, no flush
    });

    expect(atReturn).toEqual({ line: 2, column: 6 });
  });

  it('follows a caret move that changes nothing else', async () => {
    const h = await mounted();

    act(() => {
      h.view().dispatch({ selection: EditorSelection.cursor(11) });
    });
    expect(panelCaret(PANEL).position).toEqual({ line: 2, column: 6 });

    act(() => {
      h.view().dispatch({ selection: EditorSelection.cursor(0) });
    });
    expect(panelCaret(PANEL).position).toEqual({ line: 1, column: 1 });
  });

  it('publishes the selection size in the same pass, and null for a bare caret (FR-005)', async () => {
    const h = await mounted();
    let atReturn: unknown;

    act(() => {
      h.view().dispatch({ selection: EditorSelection.range(6, 10) }); // "beta"
      atReturn = panelCaret(PANEL).selected;
    });
    expect(atReturn).toBe(4);

    act(() => {
      h.view().dispatch({ selection: EditorSelection.cursor(6) });
    });
    expect(panelCaret(PANEL).selected, 'a bare caret selects nothing, and 0 is not nothing').toBeNull();
  });

  it('sums every range of a multi-range selection (FR-004)', async () => {
    // `EditorState.allowMultipleSelections` is on for column select (016 US6), so this is a
    // selection the editor really produces — and a `selection.main`-only implementation reports 4.
    const h = await mounted();

    act(() => {
      h.view().dispatch({
        selection: EditorSelection.create(
          [EditorSelection.range(6, 10), EditorSelection.range(11, 16)],
          0,
        ),
      });
    });

    expect(panelCaret(PANEL).selected).toBe(9);
  });

  it('follows the caret through an EDIT as well as a move', async () => {
    // `docChanged` without `selectionSet` is a real update too — an authority-driven change, or a
    // command that edits without moving. Publishing only on `selectionSet` would strand the column.
    const h = await mounted();

    act(() => {
      h.view().dispatch({ changes: { from: 0, insert: 'XYZ' }, selection: EditorSelection.cursor(3) });
    });

    expect(panelCaret(PANEL).position).toEqual({ line: 1, column: 4 });
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * The counts are published under the key the BAR reads (FR-003, FR-007)
 * ────────────────────────────────────────────────────────────────────────── */

describe('opening a file into a panel publishes its counts where the bar looks', () => {
  /*
   * ══ THE DEFECT THIS WAS WRITTEN FOR, AND HOW IT WAS FOUND ══
   *
   * Every store test, every listener test and every strip test passed, and the readouts were still
   * blank in the real app: `Ln 1 Col 1` rendered and the two counts did not. The counts are keyed by
   * DOCUMENT (FR-007), and the two sides had picked different ways to name that document. The strip
   * derives the key from `editor-state`'s `filePath`, which `openFile` records the moment the load
   * returns. The listener was deriving it from `panel.config.filePath`, which is the workspace
   * LAYOUT's copy and arrives later. So the count was computed once, under the untitled key, and
   * the bar spent the rest of the session reading a key nobody was writing.
   *
   * It is a one-shot write against a live read, which is why nothing caught it: the caret is
   * republished on every keystroke and healed itself, and word wrap re-reads its key on every
   * render. A figure written once under a key that later changes is invisible forever.
   *
   * So the fix is not "reschedule when the key changes" — it is that both sides name the document
   * the SAME way. This test asserts the observable that proves it: after a file is opened into a
   * panel, the bar shows that file's counts.
   */
  const OPENED = 'C:/proj/opened.txt';

  it('shows the opened file’s counts on the bar', async () => {
    // Mounted UNTITLED, then a file opened into it — the ordinary route, and the one where the
    // panel's layout config lags the editor state.
    const h = mountEditor({ panelId: PANEL, doc: { text: '', version: 1, absPath: null } });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe(''));

    await h.openFile({ absPath: OPENED, text: 'one two three\nfour\n', version: 2 });

    await waitFor(
      () => {
        expect(screen.getByTestId(`editor-status-chars-${PANEL}`)).toHaveTextContent('19 chars');
        expect(screen.getByTestId(`editor-status-words-${PANEL}`)).toHaveTextContent('4 words');
      },
      { timeout: 3000 },
    );
  });

  it('follows a SECOND file opened into the same panel', async () => {
    /*
     * The other half, and the one a "schedule once at mount" fix would miss: a panel is reused for
     * file after file, and each one is a different document with different counts. A bar still
     * showing the previous file's figures is worse than a blank one — the number looks authoritative
     * and describes something the user is no longer looking at (AS7's concern, one route along).
     */
    const h = mountEditor({ panelId: PANEL, doc: { text: '', version: 1, absPath: null } });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe(''));

    await h.openFile({ absPath: OPENED, text: 'one two three\nfour\n', version: 2 });
    await waitFor(() => expect(screen.getByTestId(`editor-status-chars-${PANEL}`)).toHaveTextContent('19 chars'), {
      timeout: 3000,
    });

    await h.openFile({ absPath: 'C:/proj/second.txt', text: 'aa bb\n', version: 3 });

    await waitFor(
      () => {
        expect(screen.getByTestId(`editor-status-chars-${PANEL}`)).toHaveTextContent('6 chars');
        expect(screen.getByTestId(`editor-status-words-${PANEL}`)).toHaveTextContent('2 words');
      },
      { timeout: 3000 },
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Destroying the panel takes the counts with it (FR-007, FR-008b)
 * ────────────────────────────────────────────────────────────────────────── */

describe('disposing an editor forgets the document it was counting', () => {
  /*
   * ══ WHY THIS IS HERE AND NOT IN THE STORE'S UNIT TEST ══
   *
   * `unit/document-metrics-store.test.ts` proves `forgetDocumentMetrics` does what it says. What it
   * cannot see is whether anything CALLS it — and nothing did. `forgetDocumentMetrics` was exported,
   * documented "called when it is closed in every panel", and unit-tested, while `disposeEditor`
   * forgot the caret and the saved view state and left the counts behind.
   *
   * Two consequences, and the second is the reason the assertion is written as "after the debounce
   * has had time to fire" rather than as "the map is empty". `settled` grows one entry per document
   * ever opened, for the life of the session (an untitled buffer keys on `panel:<id>`, so every
   * scratch panel leaks one). And a scan armed within 200 ms of teardown still RUNS: the thunk is
   * `() => update.state.doc.toString()`, which holds the `ViewUpdate` — both `EditorState`s and the
   * rope — alive past `view.destroy()`, and then materialises the whole document as a string in
   * order to count a file nobody has open. `document-metrics-store.ts` describes exactly that hazard
   * beside `cancel()`; the cancel path simply had no caller.
   *
   * The panel is disposed while the view is still mounted, which is the harsher ordering and the one
   * the hazard names: teardown arriving inside the debounce window, not after it.
   */
  const DISPOSED = 'C:/proj/disposed.txt';
  const DOC_KEY = `file:${DISPOSED}`;

  /**
   * Long enough for a schedule armed at teardown to have fired.
   *
   * A sleep rather than a waited condition, deliberately: the claim is an ABSENCE at a known
   * deadline (`METRICS_DEBOUNCE_MS` is 200), and there is no event that says "the scan you cancelled
   * did not happen". Waiting past the deadline is the only honest way to ask.
   */
  const PAST_THE_DEBOUNCE = 300;

  afterEach(() => {
    removeEditorState('p-other-view');
  });

  it('drops the figure and cancels a scan armed as the panel went away', async () => {
    const h = mountEditor({ panelId: PANEL, doc: { text: '', version: 1, absPath: null } });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe(''));
    await h.openFile({ absPath: DISPOSED, text: 'one two three\nfour\n', version: 2 });
    await waitFor(() => expect(documentMetrics(DOC_KEY)).not.toBeNull(), { timeout: 3000 });

    // An edit arms a FRESH scan, holding the update alive behind a thunk…
    act(() => {
      h.view().dispatch({ changes: { from: 0, insert: 'Z' } });
    });
    // …and the panel is destroyed before it can run.
    disposeEditor(PANEL);

    await new Promise((resolve) => setTimeout(resolve, PAST_THE_DEBOUNCE));

    expect(
      documentMetrics(DOC_KEY),
      'the counts of a document no panel holds must not survive the panel',
    ).toBeNull();
  });

  it('KEEPS them while another panel still shows the same document (FR-007)', async () => {
    /*
     * The control, and the reason the call is guarded rather than unconditional. The counts are
     * DOCUMENT state: two panels on one file read the one figure, so disposing either of them must
     * not blank the bar of the other. An unconditional `forgetDocumentMetrics(docKey)` in
     * `disposeEditor` passes the declaration above and fails this one — and in the app it would show
     * as a status bar that loses its counts when a second panel somewhere else is closed, with
     * nothing to bring them back until the next keystroke.
     */
    const h = mountEditor({ panelId: PANEL, doc: { text: '', version: 1, absPath: null } });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe(''));
    await h.openFile({ absPath: DISPOSED, text: 'one two three\nfour\n', version: 2 });
    await waitFor(() => expect(documentMetrics(DOC_KEY)).not.toBeNull(), { timeout: 3000 });

    // A second view of the SAME document, in another panel that is not going anywhere.
    setEditorState('p-other-view', { filePath: DISPOSED });
    disposeEditor(PANEL);

    await new Promise((resolve) => setTimeout(resolve, PAST_THE_DEBOUNCE));

    expect(
      documentMetrics(DOC_KEY),
      'a document another panel still shows is not a closed document',
    ).not.toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * An EMPTY document is still a document, and it reports zero (FR-003, AS1)
 * ────────────────────────────────────────────────────────────────────────── */

describe('an empty document reports 0 characters and 0 words', () => {
  /*
   * ══ THE DEFECT, AND WHY FOUR REVIEWS AND FOUR TESTS WALKED PAST IT ══
   *
   * `initialise` adopts the authority's document with
   *
   *     view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: state.text } });
   *
   * and the view it dispatches into was created one statement earlier with `doc: ''`. For an EMPTY
   * document that is `{ from: 0, to: 0, insert: '' }` — an empty `ChangeSet`, so `update.docChanged`
   * is FALSE and the update listener's `if (update.docChanged)` never schedules a count. The only
   * other schedulers are `republishCounts`, which is reached from a Save-As, an in-place open and a
   * move; and none of those happens on a plain mount. So `documentMetrics()` stays `null` forever,
   * and `status-strip.tsx`'s `if (metrics !== null)` omits BOTH readouts rather than showing zero.
   *
   * The spec's "empty document" Edge Case says it reports 0 characters and 0 words. It reported
   * nothing at all — for every untitled/scratch panel, which is the ordinary case, and for any
   * 0-byte file.
   *
   * Nothing caught it because every test that mounts `text: ''` treats that mount as a SETUP STEP
   * and only asserts counts after a non-empty file has been opened into the panel (see the two
   * describes above, and the two disposal tests). And to a reader, `metrics === null` is
   * indistinguishable from the FR-008b debounce window, which a test above asserts on purpose.
   *
   * ══ WHY THE ASSERTION IS ON THE BAR AND NOT ON THE STORE ══
   *
   * `documentMetrics(key) === null` is the mechanism; "the user sees no count" is the requirement,
   * and the two are joined by `if (metrics !== null)`, which is the line that turns a missing
   * figure into a missing ELEMENT. Asserting the rendered readouts covers both halves and would
   * still hold if the store learned to answer zeros some other way.
   */

  it('shows them in a fresh untitled panel', async () => {
    // The ordinary route: a scratch editor panel, no file, nothing typed yet.
    const h = mountEditor({ panelId: PANEL, doc: { text: '', version: 1, absPath: null } });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe(''));

    await waitFor(
      () => {
        expect(screen.getByTestId(`editor-status-chars-${PANEL}`)).toHaveTextContent('0 chars');
        expect(screen.getByTestId(`editor-status-words-${PANEL}`)).toHaveTextContent('0 words');
      },
      { timeout: 3000 },
    );
    expect(documentMetrics(`panel:${PANEL}`)).toEqual({ totalCharacters: 0, totalWords: 0 });
  });

  it('shows them for a 0-byte FILE opened into a panel', async () => {
    /*
     * The second route, and a distinct one: this document has a path, so it keys on `file:…` rather
     * than `panel:…` and it is reached by a mount that adopts a real file rather than a scratch
     * buffer. Same empty `ChangeSet`, same silence.
     */
    const EMPTY = 'C:/proj/empty.txt';
    const h = mountEditor({ panelId: PANEL, doc: { text: '', version: 1, absPath: EMPTY } });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe(''));

    await waitFor(
      () => {
        expect(screen.getByTestId(`editor-status-chars-${PANEL}`)).toHaveTextContent('0 chars');
        expect(screen.getByTestId(`editor-status-words-${PANEL}`)).toHaveTextContent('0 words');
      },
      { timeout: 3000 },
    );
    expect(documentMetrics(`file:${EMPTY}`)).toEqual({ totalCharacters: 0, totalWords: 0 });
  });

  it('reports zero again after the last character is deleted', async () => {
    // The control on the fix. Emptying a document IS a document change, so this path already
    // worked — and a "schedule zeros once at mount" fix that special-cased the empty case would
    // still have to leave it working.
    const h = mountEditor({ panelId: PANEL, doc: { text: 'abc', version: 1, absPath: null } });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('abc'));
    await waitFor(() => expect(documentMetrics(`panel:${PANEL}`)).not.toBeNull(), { timeout: 3000 });

    act(() => {
      h.view().dispatch({ changes: { from: 0, to: 3, insert: '' } });
    });

    await waitFor(
      () => expect(documentMetrics(`panel:${PANEL}`)).toEqual({ totalCharacters: 0, totalWords: 0 }),
      { timeout: 3000 },
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A SAME-PATH reload withdraws the outgoing figure (AS7)
 * ────────────────────────────────────────────────────────────────────────── */

describe('a file that changed on disk withdraws its old counts while it reloads (AS7)', () => {
  /*
   * ══ THE ASSERTION GAP THIS CLOSES ══
   *
   * `use-editor.ts`'s `applyReset` calls `invalidateDocumentMetrics` with a comment naming 040 AS7,
   * and it is correct — but DELETING that line made nothing go red. `unit/document-metrics-store.ts`
   * calls `invalidateDocumentMetrics` directly, so it can only prove the function does what it says,
   * never that anything calls it. And the reset test above drives `applyReset` by opening a
   * DIFFERENT file into the panel, which changes the document KEY: the bar then reads a key nobody
   * has written yet, so it shows no count whether the outgoing figure was withdrawn or not.
   *
   * The unasserted window is the one AS7 is actually about: the file changes on disk, the panel
   * reloads it, the path does NOT change — so the key does not change either, and the previous
   * text's figure would stand for the full 200 ms debounce, describing a document that is no longer
   * on screen. A count that is merely late reads as a count that is late; a count that is WRONG
   * reads as authoritative.
   *
   * The check is taken IMMEDIATELY after the reset, inside `act`, because the defect is a window
   * and not an end state: 200 ms later the reloaded text's own schedule settles and both the fixed
   * and the broken implementation agree. Only the instant after the reload separates them.
   */
  const RELOADED = 'C:/proj/reloaded.txt';
  const DOC_KEY = `file:${RELOADED}`;

  it('shows no count during the window rather than the previous text’s figure', async () => {
    const h = mountEditor({
      panelId: PANEL,
      doc: { text: 'one two three\nfour\n', version: 1, absPath: RELOADED },
    });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe('one two three\nfour\n'));
    await waitFor(
      () => expect(documentMetrics(DOC_KEY)).toEqual({ totalCharacters: 19, totalWords: 4 }),
      { timeout: 3000 },
    );

    // The authority reloaded the SAME path with different content — no open, no Save-As, no move.
    let atReturn: unknown = 'not read';
    act(() => {
      h.pushReset({ text: 'aa\n', version: 2, absPath: RELOADED });
      atReturn = documentMetrics(DOC_KEY);
    });

    expect(
      atReturn,
      'the outgoing text’s count must be WITHDRAWN by the reload, not left standing for 200 ms',
    ).toBeNull();
    expect(
      screen.queryByTestId(`editor-status-chars-${PANEL}`),
      'and the bar must show nothing rather than a figure describing the file’s previous content',
    ).toBeNull();

    // …and the reloaded document then reports itself, in the ordinary way.
    await waitFor(
      () => expect(documentMetrics(DOC_KEY)).toEqual({ totalCharacters: 3, totalWords: 1 }),
      { timeout: 3000 },
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A reload that leaves the document EMPTY is the same hole, one path along
 * ────────────────────────────────────────────────────────────────────────── */

describe('an empty document that is reloaded still reports zero', () => {
  /*
   * The second face of the empty-`ChangeSet` defect, and the one the AS7 withdrawal makes
   * permanent rather than merely silent.
   *
   * `applyReset` withdraws the outgoing figure and then dispatches the incoming text. When BOTH are
   * empty that dispatch is `{ from: 0, to: 0, insert: '' }` — no change, no update, no schedule — so
   * the withdrawal is the last thing that happens to this document's counts. The bar goes blank at
   * the first revert of an empty buffer and stays blank for the rest of the session.
   *
   * Cheap to reach: a scratch panel, a revert or a resync from the authority.
   */
  it('does not go blank when a reset replaces empty with empty', async () => {
    const h = mountEditor({ panelId: PANEL, doc: { text: '', version: 1, absPath: null } });
    await waitFor(() => expect(h.view().state.doc.toString()).toBe(''));
    await waitFor(
      () => expect(documentMetrics(`panel:${PANEL}`)).toEqual({ totalCharacters: 0, totalWords: 0 }),
      { timeout: 3000 },
    );

    act(() => {
      h.pushReset({ text: '', version: 2, absPath: null });
    });

    await waitFor(
      () => {
        expect(screen.getByTestId(`editor-status-chars-${PANEL}`)).toHaveTextContent('0 chars');
        expect(screen.getByTestId(`editor-status-words-${PANEL}`)).toHaveTextContent('0 words');
      },
      { timeout: 3000 },
    );
  });
});
