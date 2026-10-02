/**
 * 049 T037 — other instances of the selected text, tinted in an EDITOR (#324; FR-013 – FR-020).
 *
 * Headless `EditorView`s for the plugin's own contract (which ranges carry `throng-occurrence`, and when), one
 * mounted editor for the setting reaching a live view, and a measurement over a 10,000-line document for
 * Principle XII / SC-005. The decorations are read out of the state — `state.facet(EditorView.decorations)` —
 * the value CodeMirror paints, as `editor-search-controller.test.ts` does.
 */
import { act, waitFor } from '@testing-library/react';
import { EditorSelection, EditorState } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { deleteCharBackward, deleteCharForward } from '@codemirror/commands';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  occurrenceCompartment,
  occurrenceExtensionFor,
  occurrenceHighlightExtension,
} from '../../src/renderer/editor/occurrence-highlight.js';
import {
  createEditorSearchController,
  searchHighlightExtension,
} from '../../src/renderer/search/editor-search.js';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';

/* jsdom has no text geometry and CodeMirror measures it (see mount-editor.ts): empty answers let a view measure. */
beforeAll(() => {
  const range = globalThis.Range?.prototype as unknown as Record<string, unknown> | undefined;
  if (range && typeof range.getClientRects !== 'function') {
    range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
    range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  }
});

const views: EditorView[] = [];

function viewOf(doc: string, extensions = [searchHighlightExtension, occurrenceHighlightExtension]): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [EditorState.allowMultipleSelections.of(true), ...extensions] }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  views.splice(0).forEach((v) => v.destroy());
});

/** The ranges carrying `cls` in `view`'s decorations, as `[from, to]` pairs in document order. */
function rangesWith(view: EditorView, cls: string): [number, number][] {
  const out: [number, number][] = [];
  for (const source of view.state.facet(EditorView.decorations)) {
    // A view plugin's decorations arrive as a function of the view; a state field's as the set itself.
    const set = typeof source === 'function' ? source(view) : source;
    set.between(0, view.state.doc.length, (from, to, value) => {
      if (String((value.spec as { class?: string }).class ?? '').split(' ').includes(cls)) out.push([from, to]);
    });
  }
  return out.sort((a, b) => a[0] - b[0]);
}
const occurrences = (view: EditorView): [number, number][] => rangesWith(view, 'throng-occurrence');
const select = (view: EditorView, from: number, to: number): void =>
  view.dispatch({ selection: EditorSelection.range(from, to) });

const DOC = 'alpha beta alpha gamma alpha\nwidth id valid some-id-word id_x id.\n';

describe('which ranges are tinted (FR-014, FR-015)', () => {
  it('tints the other visible occurrences of a selected word, and not the selection itself', () => {
    const view = viewOf(DOC);
    select(view, 0, 5); // the first "alpha"
    expect(occurrences(view)).toEqual([
      [11, 16],
      [23, 28],
    ]);
  });

  it('applies the whole-word rule: id tints id, -id- and id. but not width, valid or id_x', () => {
    const view = viewOf(DOC);
    const at = DOC.indexOf(' id ') + 1;
    select(view, at, at + 2);
    const some = DOC.indexOf('some-id-word') + 5;
    const dot = DOC.lastIndexOf('id.');
    expect(occurrences(view)).toEqual([
      [some, some + 2],
      [dot, dot + 2],
    ]);
  });

  it('a selection that is not a whole word tints every literal occurrence', () => {
    const view = viewOf(DOC);
    const at = DOC.indexOf('valid') + 3; // "id" at the end of valid: preceded by a letter, so not a whole word
    select(view, at, at + 2);
    const tinted = occurrences(view).map(([f, t]) => DOC.slice(f, t));
    expect(tinted).toHaveLength(5); // the standalone id, width's "id", some-id-word, id_x, and id.
    expect(tinted.every((s) => s === 'id')).toBe(true);
  });

  it('is case-sensitive', () => {
    const view = viewOf('Alpha alpha ALPHA alpha\n');
    select(view, 6, 11);
    expect(occurrences(view)).toEqual([[18, 23]]);
  });

  it('tints nothing for a single character, a whitespace-only selection, a caret or a multi-line selection', () => {
    const view = viewOf(DOC);
    select(view, 0, 1);
    expect(occurrences(view)).toEqual([]);
    select(view, 5, 6); // a single space
    expect(occurrences(view)).toEqual([]);
    select(view, 3, 3);
    expect(occurrences(view)).toEqual([]);
    select(view, 20, 40); // across the line break
    expect(occurrences(view)).toEqual([]);
  });
});

describe('precedence with find (FR-013)', () => {
  it('paints no occurrence on a range that is a search match', () => {
    const view = viewOf(DOC);
    const controller = createEditorSearchController(view, () => false);
    controller.setQuery('alpha', { caseSensitive: false, wholeWord: false });
    select(view, 0, 5);
    expect(occurrences(view)).toEqual([]); // every other "alpha" is a find match, painted as one
    expect(rangesWith(view, 'throng-search-match')).toHaveLength(3);

    controller.setQuery('gamma', { caseSensitive: false, wholeWord: false });
    expect(occurrences(view)).toEqual([
      [11, 16],
      [23, 28],
    ]);
  });
});

describe('following the selection at once (FR-018)', () => {
  it('replaces the tints when the selection changes and removes them when it clears', () => {
    const view = viewOf(DOC);
    select(view, 0, 5);
    expect(occurrences(view)).toHaveLength(2);

    select(view, 6, 10); // "beta" occurs once
    expect(occurrences(view)).toEqual([]);

    select(view, 0, 5);
    expect(occurrences(view)).toHaveLength(2);
    select(view, 0, 0);
    expect(occurrences(view)).toEqual([]);
  });
});

describe('a visual aid only (FR-017)', () => {
  it('typing, Delete and Backspace change the selection and nothing else', () => {
    const typed = viewOf(DOC);
    select(typed, 0, 5);
    typed.dispatch(typed.state.replaceSelection('omega'));
    expect(typed.state.doc.toString()).toBe(DOC.replace('alpha', 'omega'));

    const back = viewOf(DOC);
    select(back, 0, 5);
    deleteCharBackward(back);
    expect(back.state.doc.toString()).toBe(DOC.replace('alpha', ''));

    const forward = viewOf(DOC);
    select(forward, 11, 16);
    deleteCharForward(forward);
    expect(forward.state.doc.toString()).toBe(DOC.replace('alpha beta alpha', 'alpha beta '));
    expect(forward.state.doc.toString().match(/alpha/g)).toHaveLength(2);
    // The tinted occurrences were never part of the selection.
    expect(forward.state.selection.ranges).toHaveLength(1);
  });
});

/** The decoration sets the view's plugins provide, by identity — a rebuild yields a new set, no work yields the same one. */
function decorationSets(view: EditorView): unknown[] {
  return view.state.facet(EditorView.decorations).map((source) => (typeof source === 'function' ? source(view) : source));
}

describe('scrolling does no work (049 FR-030, supersedes FR-020\'s on-screen-only scan)', () => {
  const lines = Array.from({ length: 3000 }, (_, i) => (i % 1000 === 0 ? 'needle here' : `row ${i}`));
  const text = lines.join('\n');

  it('tints every occurrence in the document, on screen or not, so a scroll has nothing to add', () => {
    const view = viewOf(text);
    select(view, 0, 6); // the needle on the first line
    const second = text.indexOf('needle', 1);
    const third = text.indexOf('needle', second + 1);
    // The viewport is the first screenful: the next needles are far below it, and are already tinted.
    expect(view.viewport.to).toBeLessThan(second);
    expect(occurrences(view)).toEqual([
      [second, second + 6],
      [third, third + 6],
    ]);
  });

  it('a scroll that moves the viewport rebuilds nothing: the same decoration sets, the same tints', () => {
    const view = viewOf(text);
    select(view, 0, 6);
    const second = text.indexOf('needle', 1);
    const before = decorationSets(view);
    const tinted = occurrences(view);

    view.scrollDOM.scrollTop = 1_000_000;
    view.dispatch({ effects: EditorView.scrollIntoView(second, { y: 'start' }) });
    view.measure();
    expect(view.viewport.from).toBeLessThanOrEqual(second); // the viewport really did move

    decorationSets(view).forEach((set, i) => expect(set).toBe(before[i]));
    expect(occurrences(view)).toEqual(tinted);
  });

  it('still recomputes on a selection change, so the tints follow the selection', () => {
    const view = viewOf(text);
    select(view, 0, 6);
    const [first] = occurrences(view);
    expect(first).toBeDefined();
    select(view, 5, 8); // "e h"
    expect(occurrences(view)).not.toEqual([first]);
  });
});

describe('Prec.low (the layering rule)', () => {
  it('sits beneath default-precedence decorations, as the search highlight does', () => {
    const other = Decoration.set([Decoration.mark({ class: 'other' }).range(0, 5)]);
    const view = viewOf(DOC, [occurrenceHighlightExtension, EditorView.decorations.of(other)]);
    const sources = view.state.facet(EditorView.decorations);
    // Higher precedence comes first in the facet, whatever order the extensions were listed in.
    expect(sources.indexOf(other)).toBeGreaterThanOrEqual(0);
    expect(sources.findIndex((s) => typeof s === 'function')).toBeGreaterThan(sources.indexOf(other));
  });
});

describe('two editor panels on one file (FR-014b)', () => {
  it('each tints only occurrences of its own selection', () => {
    const a = viewOf(DOC);
    const b = viewOf(DOC);
    select(a, 0, 5);
    expect(occurrences(a)).toHaveLength(2);
    expect(occurrences(b)).toEqual([]);
    select(b, 6, 10);
    expect(occurrences(b)).toEqual([]);
    expect(occurrences(a)).toHaveLength(2);
  });
});

describe('the setting (FR-019)', () => {
  it('occurrenceExtensionFor(false) tints nothing, and a live reconfigure switches it on and off', () => {
    const view = viewOf(DOC, [occurrenceCompartment.of(occurrenceExtensionFor(false))]);
    select(view, 0, 5);
    expect(occurrences(view)).toEqual([]);
    view.dispatch({ effects: occurrenceCompartment.reconfigure(occurrenceExtensionFor(true)) });
    expect(occurrences(view)).toHaveLength(2);
    view.dispatch({ effects: occurrenceCompartment.reconfigure(occurrenceExtensionFor(false)) });
    expect(occurrences(view)).toEqual([]);
  });

  describe('on a mounted editor', () => {
    let h: EditorHarness | undefined;
    afterEach(() => {
      h?.unmount();
      h = undefined;
    });

    it('is applied without a remount when editor.highlightOccurrences is toggled', async () => {
      h = mountEditor({ doc: { text: DOC, version: 1, absPath: 'C:/proj/note.txt' } });
      await waitFor(() => expect(h!.text()).toContain('alpha'));
      await waitFor(() => expect(h!.settingsLoaded()).toBe(true));
      const view = h.view();

      act(() => select(view, 0, 5));
      await waitFor(() => expect(occurrences(view)).toHaveLength(2));

      act(() => h!.pushSettings({ editor: { highlightOccurrences: false } }));
      await waitFor(() => expect(occurrences(view)).toEqual([]));

      act(() => h!.pushSettings({ editor: { highlightOccurrences: true } }));
      await waitFor(() => expect(occurrences(view)).toHaveLength(2));
    });
  });
});

/**
 * Principle XII / SC-005: occurrence tinting is work on the input path, so it carries a measurement on a
 * representative large input — a 10,000-line document with a word of ≥ 2,000 occurrences.
 */
describe('cost on a 10,000-line document (Principle XII, SC-005)', () => {
  const LINES = 10_000;
  const doc = Array.from({ length: LINES }, (_, i) => (i % 5 === 0 ? `const needle = value${i}; // needle` : `plain line ${i}`)).join('\n');
  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

  function time(extensions: Parameters<typeof viewOf>[1], action: (v: EditorView, i: number) => void, runs = 15): number {
    const samples: number[] = [];
    const view = viewOf(doc, extensions);
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      action(view, i);
      samples.push(performance.now() - t0);
    }
    return median(samples);
  }

  it('a selection change and a single-character insert each take well under 100 ms, and typing is no slower than with tinting off', () => {
    expect((doc.match(/needle/g) ?? []).length).toBeGreaterThanOrEqual(2000);
    const at = doc.indexOf('needle');
    const withPlugin = [searchHighlightExtension, occurrenceHighlightExtension];
    const without = [searchHighlightExtension];

    const selectionChange = (v: EditorView, i: number): void => select(v, at + (i % 2), at + 6);
    const typeOne = (v: EditorView): void => {
      select(v, at, at + 6);
      v.dispatch({ changes: { from: 0, insert: 'x' } });
    };

    const selOn = time(withPlugin, selectionChange);
    const insOn = time(withPlugin, typeOne);
    const insOff = time(without, typeOne);
    const summary =
      `[049 T037 timings, 10,000 lines, median of 15] selection change ${selOn.toFixed(2)} ms; ` +
      `insert with tint ${insOn.toFixed(2)} ms vs without ${insOff.toFixed(2)} ms`;
    // Shown for the PR body with `--silent=false`, which prints a passing test's console output.
    console.info(summary);

    expect(selOn).toBeLessThan(100);
    expect(insOn).toBeLessThan(100);
    // "No slower": within measurement noise of the plugin-off baseline.
    expect(insOn - insOff).toBeLessThan(25);
  });
});
