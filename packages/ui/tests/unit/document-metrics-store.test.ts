/**
 * The document-metrics store is keyed by DOCUMENT, debounced, and invalidated by a reload
 * (040 US1 — FR-003, FR-007, FR-008b; data-model.md §3.2, research.md D5, AS7).
 *
 * ══ THE THREE CLAIMS, AND WHY EACH IS HERE RATHER THAN SOMEWHERE CHEAPER ══
 *
 * **Keyed by document (FR-007).** The counts describe the document, so every panel showing it must
 * agree. research.md D5 records that a per-VIEW store would be observationally identical today and
 * is rejected anyway: it makes FR-007 true by coincidence, and the coincidence breaks the moment
 * one view lags the authority by a transaction. Testing the key scope is what makes it true by
 * construction.
 *
 * **Debounced, settling within 200 ms of the last edit (FR-008b).** The counts are a full document
 * scan and must never ride the keystroke path (FR-008, FR-008c). A burst of edits must produce ONE
 * scan, and the figure must not be left stale once typing stops.
 *
 * **Invalidated by a reload (FR-003, AS7).** A file changed underneath an open editor is reloaded,
 * and a debounced value scheduled against the OLD text must not stand while the new text is
 * counted. A stale count that later corrects itself is worse than no count: it is a number the user
 * has no reason to distrust.
 *
 * Fake timers, because the assertion is about WHEN. `vi.advanceTimersByTime(199)` / `(200)` is the
 * only way to state "settles within 200 ms" without a wall-clock sleep, which would be both slow
 * and a flake generator (`config-broadcast-latency.test.ts` says as much about latency assertions).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  documentMetrics,
  forgetDocumentMetrics,
  invalidateDocumentMetrics,
  scheduleDocumentMetrics,
  subscribeDocumentMetrics,
  __resetDocumentMetricsStore,
} from '../../src/renderer/editor/document-metrics-store.js';

beforeEach(() => {
  vi.useFakeTimers();
  __resetDocumentMetricsStore();
});

afterEach(() => {
  vi.useRealTimers();
});

const DOC_A = 'file:C:/proj/a.txt';
const DOC_B = 'file:C:/proj/b.txt';

describe('keyed by document, so every panel showing it agrees (FR-007)', () => {
  it('holds one figure per document, whoever scheduled it', () => {
    /*
     * Two panels on one file both schedule from their own view. Both write the same key, so the
     * store cannot hold two answers for one document — which is the requirement, stated as the
     * shape of the data rather than as a convention the callers are trusted to keep.
     */
    scheduleDocumentMetrics(DOC_A, 'one two three');
    scheduleDocumentMetrics(DOC_A, 'one two three');
    vi.advanceTimersByTime(200);

    expect(documentMetrics(DOC_A)).toEqual({ totalCharacters: 13, totalWords: 3 });
  });

  it('keeps two different documents apart', () => {
    scheduleDocumentMetrics(DOC_A, 'one two three');
    scheduleDocumentMetrics(DOC_B, 'four');
    vi.advanceTimersByTime(200);

    expect(documentMetrics(DOC_A)).toEqual({ totalCharacters: 13, totalWords: 3 });
    expect(documentMetrics(DOC_B)).toEqual({ totalCharacters: 4, totalWords: 1 });
  });

  it('counts by the shared rules — a CRLF pair is ONE character (FR-003a)', () => {
    // The arithmetic itself belongs to `@throng/core`'s `document-metrics.ts` and is proven there.
    // What this says is that the store USES it rather than reaching for `text.length` — which is
    // still the discriminating fixture after the FR-003a reversal: six letters and two breaks are
    // 8, while the string is 10 units long.
    scheduleDocumentMetrics(DOC_A, 'ab\r\ncd\r\nef');
    vi.advanceTimersByTime(200);

    expect(documentMetrics(DOC_A)).toEqual({ totalCharacters: 8, totalWords: 3 });
  });

  it('reads null for a document nothing has ever counted', () => {
    expect(documentMetrics('file:C:/proj/never.txt')).toBeNull();
  });
});

describe('debounced, and settled within 200 ms of the LAST edit (FR-008b)', () => {
  it('has not published at 199 ms', () => {
    scheduleDocumentMetrics(DOC_A, 'one two three');
    vi.advanceTimersByTime(199);
    expect(documentMetrics(DOC_A)).toBeNull();
  });

  it('has published by 200 ms', () => {
    scheduleDocumentMetrics(DOC_A, 'one two three');
    vi.advanceTimersByTime(200);
    expect(documentMetrics(DOC_A)).toEqual({ totalCharacters: 13, totalWords: 3 });
  });

  it('counts ONCE for a burst, and counts the LAST text (FR-008)', () => {
    /*
     * The whole point of the debounce. A count per keystroke of a 5 MB file is the defect FR-008c
     * budgets against, and a trailing-edge debounce that counted the FIRST text instead of the last
     * would leave the bar a burst behind for as long as the user kept typing.
     */
    const counted: string[] = [];
    const spy = (text: string): string => {
      counted.push(text);
      return text;
    };

    scheduleDocumentMetrics(DOC_A, spy('a'));
    vi.advanceTimersByTime(150);
    scheduleDocumentMetrics(DOC_A, spy('ab'));
    vi.advanceTimersByTime(150);
    scheduleDocumentMetrics(DOC_A, spy('abc words here'));
    expect(documentMetrics(DOC_A), 'nothing may publish mid-burst').toBeNull();

    vi.advanceTimersByTime(200);
    expect(documentMetrics(DOC_A)).toEqual({ totalCharacters: 14, totalWords: 3 });
    expect(counted).toEqual(['a', 'ab', 'abc words here']);
  });

  it('notifies subscribers exactly once per settled burst', () => {
    const notifications: number[] = [];
    const unsubscribe = subscribeDocumentMetrics(() => notifications.push(1));

    scheduleDocumentMetrics(DOC_A, 'a');
    scheduleDocumentMetrics(DOC_A, 'ab');
    scheduleDocumentMetrics(DOC_A, 'abc');
    vi.advanceTimersByTime(200);

    expect(notifications).toHaveLength(1);
    unsubscribe();
  });

  it('returns the same snapshot object while nothing has changed', () => {
    // `useSyncExternalStore` compares snapshots by identity; a fresh object per read renders forever.
    scheduleDocumentMetrics(DOC_A, 'one two three');
    vi.advanceTimersByTime(200);
    expect(documentMetrics(DOC_A)).toBe(documentMetrics(DOC_A));
  });

  it('debounces each document on its own timer', () => {
    // One shared timer would let a keystroke in file A postpone file B's already-quiet count.
    scheduleDocumentMetrics(DOC_A, 'one two three');
    vi.advanceTimersByTime(150);
    scheduleDocumentMetrics(DOC_B, 'four');
    vi.advanceTimersByTime(50);

    expect(documentMetrics(DOC_A), 'A went quiet 200 ms ago and must have settled').toEqual({
      totalCharacters: 13,
      totalWords: 3,
    });
    expect(documentMetrics(DOC_B), 'B is only 50 ms into its own window').toBeNull();
  });
});

describe('a reload invalidates the debounced value (FR-003, AS7)', () => {
  it('drops a figure scheduled against text the file no longer holds', () => {
    /*
     * AS7: the file changed underneath the editor and the panel reloaded it. A count scheduled from
     * the OLD text is now a lie about the document, and a lie the user cannot detect. It must go,
     * and the pending timer with it — publishing it 40 ms later would be the same defect delayed.
     */
    scheduleDocumentMetrics(DOC_A, 'the old contents entirely');
    vi.advanceTimersByTime(200);
    expect(documentMetrics(DOC_A)).not.toBeNull();

    scheduleDocumentMetrics(DOC_A, 'the old contents entirely, edited');
    invalidateDocumentMetrics(DOC_A);

    expect(documentMetrics(DOC_A), 'the standing figure is stale and must be withdrawn').toBeNull();
    vi.advanceTimersByTime(200);
    expect(documentMetrics(DOC_A), 'the cancelled scan must not fire late').toBeNull();
  });

  it('lets the reloaded text settle normally afterwards', () => {
    scheduleDocumentMetrics(DOC_A, 'the old contents entirely');
    vi.advanceTimersByTime(200);

    invalidateDocumentMetrics(DOC_A);
    scheduleDocumentMetrics(DOC_A, 'brand new');
    vi.advanceTimersByTime(200);

    expect(documentMetrics(DOC_A)).toEqual({ totalCharacters: 9, totalWords: 2 });
  });

  it('invalidates only the document that reloaded', () => {
    scheduleDocumentMetrics(DOC_A, 'one two three');
    scheduleDocumentMetrics(DOC_B, 'four');
    vi.advanceTimersByTime(200);

    invalidateDocumentMetrics(DOC_A);

    expect(documentMetrics(DOC_A)).toBeNull();
    expect(documentMetrics(DOC_B)).toEqual({ totalCharacters: 4, totalWords: 1 });
  });

  it('notifies subscribers, so a strip showing the stale figure stops showing it', () => {
    scheduleDocumentMetrics(DOC_A, 'one two three');
    vi.advanceTimersByTime(200);

    let notified = 0;
    const unsubscribe = subscribeDocumentMetrics(() => (notified += 1));
    invalidateDocumentMetrics(DOC_A);

    expect(notified).toBe(1);
    unsubscribe();
  });
});

describe('the text may be deferred, so a keystroke does not materialise the document (FR-008)', () => {
  /*
   * ══ WHY A THUNK IS NOT GOLD-PLATING ══
   *
   * The caller is CodeMirror's update listener, which holds a `Text` rope rather than a string.
   * Turning that rope into a string is O(document) — for a 5 MB file, a 5 MB allocation — and on a
   * per-keystroke path it is precisely the class of cost FR-008/FR-008c exist to keep off it. The
   * COUNT being debounced does not help if the argument to the debounced call is built eagerly.
   *
   * research.md D2 says the counts are "computed from `update.state.doc`", which is the rope, not a
   * string. Accepting a thunk is what lets the call site honour that: the rope is flattened once,
   * when the scan actually runs, and never during a burst that is about to be superseded.
   */
  it('does not call the thunk while the burst is still going', () => {
    let flattened = 0;
    const text = (value: string) => () => {
      flattened += 1;
      return value;
    };

    scheduleDocumentMetrics(DOC_A, text('a'));
    vi.advanceTimersByTime(150);
    scheduleDocumentMetrics(DOC_A, text('ab'));
    vi.advanceTimersByTime(150);
    scheduleDocumentMetrics(DOC_A, text('abc words here'));

    expect(flattened, 'a superseded schedule must never touch the document').toBe(0);
  });

  it('calls it exactly once, when the scan runs, and counts what it returns', () => {
    let flattened = 0;
    scheduleDocumentMetrics(DOC_A, () => {
      flattened += 1;
      return 'one two three';
    });

    vi.advanceTimersByTime(200);

    expect(flattened).toBe(1);
    expect(documentMetrics(DOC_A)).toEqual({ totalCharacters: 13, totalWords: 3 });
  });

  it('never calls a thunk whose scan was cancelled by a reload', () => {
    let flattened = 0;
    scheduleDocumentMetrics(DOC_A, () => {
      flattened += 1;
      return 'the text the file no longer holds';
    });

    invalidateDocumentMetrics(DOC_A);
    vi.advanceTimersByTime(200);

    expect(flattened).toBe(0);
  });
});

describe('forgetting a closed document', () => {
  it('drops its figure and cancels any pending scan', () => {
    // Closed in every panel: nothing will read it again, and a timer holding its text alive is a
    // 5 MB string the garbage collector cannot reach.
    scheduleDocumentMetrics(DOC_A, 'one two three');
    forgetDocumentMetrics(DOC_A);
    vi.advanceTimersByTime(200);

    expect(documentMetrics(DOC_A)).toBeNull();
  });
});

describe('the test-only reset behaves like the other withdrawals', () => {
  it('NOTIFIES subscribers, so a mounted strip does not keep painting counts that are gone', () => {
    /*
     * `__resetCaretStore` emits and this one did not, which is a difference with a visible
     * consequence rather than a tidiness point. `useSyncExternalStore` re-reads a snapshot only when
     * the store says something moved, so a reset that clears `settled` silently leaves every
     * mounted `StatusStrip` still painting the figures of a document the store no longer holds —
     * the same class of lie `invalidateDocumentMetrics` emits to prevent (AS7), arriving through
     * the door a test uses between cases.
     */
    scheduleDocumentMetrics(DOC_A, 'one two three');
    vi.advanceTimersByTime(200);
    expect(documentMetrics(DOC_A)).not.toBeNull();

    let notified = 0;
    const unsubscribe = subscribeDocumentMetrics(() => (notified += 1));
    __resetDocumentMetricsStore();

    expect(documentMetrics(DOC_A), 'the figure must be gone').toBeNull();
    expect(notified, 'and every reader must have been told it is gone').toBe(1);
    unsubscribe();
  });
});
