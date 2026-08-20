import { EditorSelection, EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
  createEditorSearchController,
  searchHighlightExtension,
} from '../../src/renderer/search/editor-search.js';
import type { MatchModes } from '../../src/renderer/search/search-model.js';

/**
 * The editor's search CONTROLLER — the join between the matching model and the document (013).
 *
 * MIGRATED FROM (035 T055):
 *   - `packages/ui/tests/e2e/editor-find.e2e.ts:85`  — finds as you type: highlights every match…
 *   - `packages/ui/tests/e2e/editor-find.e2e.ts:131` — match-case and whole-word narrow live (FR-007)
 *   - `packages/ui/tests/e2e/editor-find.e2e.ts:184` — closing find clears the highlights…
 *   - `packages/ui/tests/e2e/editor-replace.e2e.ts:128` — replace-current changes only the current…
 *   - `packages/ui/tests/e2e/editor-replace.e2e.ts:157` — editing while find is open does not…
 *
 * ══ THE HALF NOBODY TESTED ══
 *
 * `search-model.test.ts` proves the MATCHING — which offsets a term finds, how the index steps and
 * wraps. `search-store.test.ts` proves the BAR — what the find widget shows and what it asks for.
 * `createEditorSearchController` is the join between them and the document, and it had no test at
 * any layer. It is where the offsets meet real text: `resync`, `recompute`, the decoration paint,
 * and the rule that a replace never trusts a remembered offset.
 *
 * ══ WHY THIS IS NOT THE MIGRATION 034 DECLINED ══
 *
 * Four of these five were explicitly LEFT in E2E by 034, and the reason is recorded in
 * `editor-find.e2e.ts`: they assert on `.throng-search-match` decorations in the document, and
 * *"the store test can say the controller was TOLD to clear; only the editor shows that the document
 * stopped drawing them."*
 *
 * That reasoning was right about the store and wrong about the layer. The decorations are a
 * `StateField` — `editor-search.ts:45` — that provides `EditorView.decorations`. A decoration set is
 * part of the STATE, not of the rendering: it exists, with its ranges and its classes, before
 * anything is painted and without a view at all. So the same assertion the E2E made against rendered
 * DOM is made below against `state.facet(EditorView.decorations)`, which is the value the renderer
 * would have drawn.
 *
 * What that does NOT prove is that CodeMirror then paints it, or that the CSS in `find-bar.css`
 * makes a match visible against the syntax layer beneath it (FR-007a's precedence). Both are real,
 * both are layout, and `editor-find.e2e.ts` keeps a test for them.
 *
 * ══ THE HARNESS ══
 *
 * The two-member stand-in `editor-command-semantics.test.ts` argues for, plus `focus` — the three
 * members the controller touches. No `EditorView` is constructed; jsdom has no layout, and the one
 * thing a real view would add here is the measurement this file deliberately does not assert on.
 *
 * One seam is genuinely absent: `searchHighlightExtension` carries an `updateListener` that calls
 * the controller's re-search hook on every document change, and an updateListener needs a view to
 * fire. Nothing below stands in for it — deliberately. An earlier draft did, and the cost is
 * recorded on {@link FakeView.edit}: with the harness re-running the query on every edit, the
 * staleness test passed against a `replaceCurrent` whose `resync()` had been deleted. The harness
 * had done the production code's job, and the mutation that should have reddened it did not.
 *
 * So the absence is the point. `replaceCurrent` re-derives its own offsets, and the test proves it
 * does so when nothing else has. That the listener ALSO re-searches, belt-and-braces, is real and is
 * not asserted here.
 */

const NO_MODES: MatchModes = { caseSensitive: false, wholeWord: false };
const CASE: MatchModes = { caseSensitive: true, wholeWord: false };
const CASE_WORD: MatchModes = { caseSensitive: true, wholeWord: true };

class FakeView {
  state: EditorState;
  readonly dispatched: Transaction[] = [];
  focused = 0;

  constructor(doc: string) {
    this.state = EditorState.create({
      doc,
      extensions: [EditorState.allowMultipleSelections.of(true), searchHighlightExtension],
    });
  }

  dispatch(spec: TransactionSpec): void {
    const tr = this.state.update(spec);
    this.dispatched.push(tr);
    this.state = tr.state;
  }

  focus(): void {
    this.focused += 1;
  }

  get text(): string {
    return this.state.doc.toString();
  }

  caret(at: number): void {
    this.dispatch({ selection: EditorSelection.cursor(at) });
  }

  select(...ranges: [number, number][]): void {
    this.dispatch({
      selection: EditorSelection.create(ranges.map(([a, b]) => EditorSelection.range(a, b))),
    });
  }

  /**
   * An edit made while the bar is open — and NOTHING ELSE.
   *
   * Deliberately no re-query afterwards. An earlier draft of this harness re-ran the query here, on
   * the reasoning that a real view's `updateListener` does, and it made the staleness test pass
   * against a `replaceCurrent` with its `resync()` DELETED: the harness had done the production
   * code's job and the test was asserting nothing. The rule `replaceCurrent` carries is that it
   * re-derives its offsets *itself*, which is precisely what has to hold when nothing else has.
   */
  edit(spec: TransactionSpec): void {
    this.dispatch(spec);
  }

  /**
   * The decorations the renderer WOULD draw, as class names in document order.
   *
   * The field `provide`s `EditorView.decorations`, so this is the same value the view reads —
   * read out of the state instead of off the screen.
   */
  get highlights(): { from: number; to: number; cls: string }[] {
    const out: { from: number; to: number; cls: string }[] = [];
    for (const source of this.state.facet(EditorView.decorations)) {
      if (typeof source === 'function') continue; // a view-driven set; this field is not one
      (source as DecorationSet).between(0, this.state.doc.length, (from, to, value) => {
        out.push({ from, to, cls: String((value.spec as { class?: string }).class ?? '') });
      });
    }
    return out;
  }

  get matchCount(): number {
    return this.highlights.length;
  }

  get currentCount(): number {
    return this.highlights.filter((h) => h.cls.includes('--current')).length;
  }

  get view(): EditorView {
    return this as unknown as EditorView;
  }
}

function open(
  doc: string,
  readOnly = false,
): { v: FakeView; c: ReturnType<typeof createEditorSearchController> } {
  const v = new FakeView(doc);
  return { v, c: createEditorSearchController(v.view, () => readOnly) };
}

const query = (
  c: ReturnType<typeof createEditorSearchController>,
  term: string,
  modes: MatchModes = NO_MODES,
): ReturnType<typeof c.setQuery> => c.setQuery(term, modes);

/* ────────────────────────────────────────────────────────────────────────── *
 * Finding (FR-003, FR-007)
 * ────────────────────────────────────────────────────────────────────────── */

describe('finding highlights every match and marks exactly one as current', () => {
  it('finds every case-insensitive match and counts them 1-based', () => {
    const { v, c } = open('alpha beta\nalpha gamma\nALPHA delta\n');
    v.caret(0);

    expect(query(c, 'alpha')).toEqual({ current: 1, total: 3 });
    expect(v.matchCount).toBe(3);
    expect(v.currentCount).toBe(1);
  });

  it('highlights the ACTUAL match offsets, not just the right number of them', () => {
    // A count of three would also pass with three decorations over the wrong text. The E2E could
    // not tell those apart either; this can.
    const { v, c } = open('alpha beta\nalpha gamma\n');
    v.caret(0);
    query(c, 'alpha');

    expect(v.highlights.map((h) => v.state.sliceDoc(h.from, h.to))).toEqual(['alpha', 'alpha']);
  });

  it('never edits the document — searching is not an edit (SC-001)', () => {
    const { v, c } = open('alpha beta\nalpha gamma\n');
    const before = v.text;

    query(c, 'alpha');
    c.findNext();
    c.findPrevious();

    expect(v.text).toBe(before);
  });

  it('narrows live as match-case and whole-word are turned on (FR-007)', () => {
    // 'foo Foo food' — the E2E's fixture, and the one that separates all three modes.
    const { v, c } = open('foo Foo food\n');
    v.caret(0);

    expect(query(c, 'foo')).toEqual({ current: 1, total: 3 });
    expect(v.matchCount).toBe(3);

    expect(query(c, 'foo', CASE)).toEqual({ current: 1, total: 2 }); // 'Foo' drops out
    expect(v.matchCount).toBe(2);

    expect(query(c, 'foo', CASE_WORD)).toEqual({ current: 1, total: 1 }); // 'food' drops out
    expect(v.matchCount).toBe(1);
    expect(v.state.sliceDoc(v.highlights[0].from, v.highlights[0].to)).toBe('foo');
  });

  it('reports no results for a miss, and draws nothing', () => {
    const { v, c } = open('needle in haystack\n');
    v.caret(0);
    query(c, 'needle');
    expect(v.matchCount).toBe(1);

    expect(query(c, 'zzz-not-here')).toEqual({ current: 0, total: 0 });
    expect(v.matchCount).toBe(0);
    expect(v.text).toBe('needle in haystack\n');
  });

});

describe('the current match moves with the caret, not from the top', () => {
  it('picks the match at or after the caret', () => {
    const { v, c } = open('alpha\nalpha\nalpha\n');
    v.caret(6); // …the start of the second

    expect(query(c, 'alpha')).toEqual({ current: 2, total: 3 });
    expect(v.highlights[1].cls).toContain('--current');
    expect(v.highlights[0].cls).not.toContain('--current');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Seeding from the selection (FR-002b, FR-025i)
 * ────────────────────────────────────────────────────────────────────────── */

describe('the find input seeds from the selection', () => {
  it('takes a single-line selection verbatim', () => {
    const { v, c } = open('needle in haystack\n');
    v.select([10, 18]); // "haystack"

    expect(c.seedFromSelection()).toBe('haystack');
  });

  it('reads EVERY range of a rectangular block, not just the main one (FR-025i)', () => {
    /*
     * `selection.main` is whichever row the drag's head ended on. Reading only it would pre-fill
     * find with an arbitrary line of the user's ten-row block — wrong, and impossible to notice,
     * because the input holds something that plainly came from the selection.
     *
     * A block of several non-empty rows is not a search term, so the right answer is ''. That is
     * also what distinguishes the two implementations: seeding from `main` would return 'bbb'.
     */
    const { v, c } = open('aaa\nbbb\nccc\n');
    v.select([0, 3], [4, 7], [8, 11]);

    expect(c.seedFromSelection()).toBe('');
  });

  it('seeds from a single range even when the selection carries empty ones beside it', () => {
    // A block collapsed to carets on every row but one — the empties are not competing terms.
    const { v, c } = open('aaa\nbbb\nccc\n');
    v.select([0, 0], [4, 7], [8, 8]);

    expect(c.seedFromSelection()).toBe('bbb');
  });

  it('refuses a multi-line fragment — that is a block of text, not a term', () => {
    const { v, c } = open('aaa\nbbb\n');
    v.select([0, 7]);

    expect(c.seedFromSelection()).toBe('');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Replace (FR-008)
 * ────────────────────────────────────────────────────────────────────────── */

describe('replace changes the current match, and only the current match', () => {
  it('replaces one occurrence and advances to the next', () => {
    const { v, c } = open('cat cat cat\n');
    v.caret(0);
    query(c, 'cat');

    c.replaceCurrent('dog');

    expect(v.text).toBe('dog cat cat\n');
    // The next match is now current — re-finding the text just inserted would be a loop.
    expect(v.highlights.map((h) => h.from)).toEqual([4, 8]);
    expect(v.highlights[0].cls).toContain('--current');
  });

  it('re-derives the offsets from the document as it is NOW, not as it was', () => {
    /*
     * THE ONE THAT MATTERS. The user opens find, then edits above the match. Every remembered
     * offset has shifted, and a replace against them writes over whatever now sits at those
     * positions — silently, and in the middle of a word.
     */
    const { v, c } = open('cat sat\n');
    v.caret(0);
    query(c, 'sat');
    expect(v.highlights.map((h) => h.from)).toEqual([4]);

    // Insert six characters BEFORE the match. "sat" now starts at 10, not 4.
    v.edit({ changes: { from: 0, to: 0, insert: 'INSERT' } });

    c.replaceCurrent('lay');

    expect(v.text).toBe('INSERTcat lay\n');
  });

  it('refuses to replace in a read-only document, while find still works', () => {
    const { v, c } = open('cat cat\n', true);
    v.caret(0);

    expect(query(c, 'cat')).toEqual({ current: 1, total: 2 });
    c.replaceCurrent('dog');
    c.replaceAll('dog');

    expect(v.text).toBe('cat cat\n');
  });

  it('replaces every match in ONE transaction, so it is ONE undo step (FR-008)', () => {
    const { v, c } = open('cat cat cat\n');
    v.caret(0);
    query(c, 'cat');
    const before = v.dispatched.length;

    c.replaceAll('dog');

    expect(v.text).toBe('dog dog dog\n');
    const changing = v.dispatched.slice(before).filter((tr) => tr.docChanged);
    expect(changing, 'replace-all must be a single document transaction').toHaveLength(1);
  });

  it('replace-all with no matches does nothing at all', () => {
    const { v, c } = open('cat cat\n');
    v.caret(0);
    query(c, 'nope');
    const before = v.dispatched.length;

    c.replaceAll('dog');

    expect(v.text).toBe('cat cat\n');
    expect(v.dispatched.slice(before).filter((tr) => tr.docChanged)).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Closing (FR-004)
 * ────────────────────────────────────────────────────────────────────────── */

describe('closing find clears the document of highlights', () => {
  it('removes every decoration and hands focus back to the content', () => {
    const { v, c } = open('close me\n');
    v.caret(0);
    query(c, 'close');
    expect(v.matchCount).toBe(1);
    const focusedBefore = v.focused;

    c.close();

    expect(v.matchCount).toBe(0);
    expect(v.focused).toBeGreaterThan(focusedBefore);
  });

  it('closes WITHOUT taking focus when the user moved to another panel', () => {
    // Pulling focus back to a panel the user has just left would fight them.
    const { v, c } = open('close me\n');
    v.caret(0);
    query(c, 'close');
    const focusedBefore = v.focused;

    c.close({ refocus: false });

    expect(v.matchCount).toBe(0);
    expect(v.focused).toBe(focusedBefore);
  });
});
