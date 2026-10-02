/**
 * 049 T024 — find in a Markdown EDITOR reveals a match inside a collapsed section through the fold
 * authority (FR-005 – FR-007, research R5; #455's editor half).
 *
 * `revealOffset` is the one route: it writes `revealing` fold state through `setDocumentFoldState` — the
 * document's single source of fold truth, relayed to main and every other view — and re-applies it to this
 * view, rather than dispatching a bare `unfoldEffect` that the next `syncFoldRanges` would undo and main
 * would never hear about. Headless `EditorView` over real Markdown, as `editor-markdown-fold.test.ts` does.
 */
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { codeFolding, foldedRanges } from '@codemirror/language';
import { initialFold, setSection, type FoldState } from '@throng/core';
import {
  __resetFoldStateStore,
  documentFoldState,
  setDocumentFoldState,
} from '../../src/renderer/editor/fold-state-store.js';
import { liveSections, syncFoldRanges } from '../../src/renderer/editor/markdown-fold.js';
import { revealOffset } from '../../src/renderer/editor/editor-fold-reveal.js';
import { __resetFindState, findNext, openFind, setTerm } from '../../src/renderer/search/search-store.js';
import { mountEditor } from './helpers/mount-editor.js';

const DOC = [
  '# One', //            0
  '', //                 1
  'intro', //            2
  '', //                 3
  '## Two', //           4
  '', //                 5
  'body two', //         6
  '', //                 7
  '### Three', //        8
  '', //                 9
  'body three', //       10
].join('\n');

const KEY = 'panel:p-fold';
const deps = { docKey: () => KEY, panelId: 'p-fold', seedDefault: () => initialFold('expanded') };

let view: EditorView;
let setFoldState: ReturnType<typeof vi.fn>;

const offsetOf = (needle: string): number => DOC.indexOf(needle);
const collapse = (...slugs: string[]): FoldState => slugs.reduce((s, slug) => setSection(s, slug, true), initialFold('expanded'));
const foldedCount = (): number => {
  let n = 0;
  foldedRanges(view.state).between(0, view.state.doc.length, () => void n++);
  return n;
};
const apply = (state: FoldState): void => {
  setDocumentFoldState(KEY, state);
  syncFoldRanges(view, liveSections(view), state);
};

beforeEach(() => {
  setFoldState = vi.fn();
  Reflect.set(window, 'throng', { editor: { setFoldState } });
  view = new EditorView({ state: EditorState.create({ doc: DOC, extensions: [markdown(), codeFolding()] }) });
});

afterEach(() => {
  view.destroy();
  __resetFoldStateStore();
  Reflect.deleteProperty(window, 'throng');
});

describe('revealOffset (049 R5)', () => {
  it('opens the collapsed section a position is in: one authority write, and the range stays unfolded after a later sync', () => {
    apply(collapse('two'));
    expect(foldedCount()).toBe(1);

    const revealed = revealOffset(view, offsetOf('body two'), deps);

    expect(revealed).toBe(true);
    expect(setFoldState).toHaveBeenCalledTimes(1);
    expect(setFoldState.mock.calls[0]![0]).toBe('p-fold');
    expect(documentFoldState(KEY, initialFold('expanded')).flipped).toEqual([]);
    expect(foldedCount()).toBe(0);
    // A following sync from the (now authoritative) state must not fold it again.
    syncFoldRanges(view, liveSections(view), documentFoldState(KEY, initialFold('expanded')));
    expect(foldedCount()).toBe(0);
  });

  it('opens every collapsed ancestor in the same single write', () => {
    apply(collapse('one', 'two'));
    expect(foldedCount()).toBe(2); // "two"'s range sits inside "one"'s; both are folded

    expect(revealOffset(view, offsetOf('body three'), deps)).toBe(true);

    expect(setFoldState).toHaveBeenCalledTimes(1);
    expect(documentFoldState(KEY, initialFold('expanded')).flipped).toEqual([]);
    expect(foldedCount()).toBe(0);
  });

  it('leaves a collapsed section that does not contain the position alone — find never collapses and opens only what it needs', () => {
    apply(collapse('two', 'three'));
    revealOffset(view, offsetOf('body two'), deps);
    expect(documentFoldState(KEY, initialFold('expanded')).flipped).toEqual(['three']);
  });

  it('answers false and writes nothing for a position that is already visible', () => {
    apply(collapse('three'));
    expect(revealOffset(view, offsetOf('body two'), deps)).toBe(false);
    expect(revealOffset(view, offsetOf('### Three'), deps)).toBe(false); // a collapsed section's own heading line shows
    expect(setFoldState).not.toHaveBeenCalled();
    expect(documentFoldState(KEY, initialFold('expanded')).flipped).toEqual(['three']);
  });

  it('answers false for a position before the first heading, or in a document with none', () => {
    const plain = new EditorView({ state: EditorState.create({ doc: 'no headings here', extensions: [markdown(), codeFolding()] }) });
    expect(revealOffset(plain, 3, deps)).toBe(false);
    plain.destroy();
    expect(setFoldState).not.toHaveBeenCalled();
  });
});

describe('what CodeMirror does when the selection head enters a folded range (R5 pin)', () => {
  it('DROPS the fold from its own state, so the authority and the view disagree until the sync re-applies it', () => {
    apply(collapse('two'));
    expect(foldedCount()).toBe(1);

    view.dispatch({ selection: EditorSelection.cursor(offsetOf('body two')) });

    // CodeMirror unfolds a fold the caret lands inside. The authority still says "two" is collapsed — a desync
    // that a caret move into hidden text would create silently; find therefore reveals through the authority
    // BEFORE anything moves the selection, and never relies on the caret to open a section.
    expect(foldedCount()).toBe(0);
    expect(documentFoldState(KEY, initialFold('expanded')).flipped).toEqual(['two']);
  });
});

describe('find on a mounted Markdown editor (049 US2.4)', () => {
  it('opens the collapsed section a typed query lands in, through the fold authority', async () => {
    const text = '# Intro\n\n## A\n\nneedle in a\n\n## B\n\nother\n';
    const h = mountEditor({
      panelId: 'p-ed',
      doc: { text, version: 1, absPath: 'C:/proj/note.md' },
      foldAuthority: { base: 'expanded', flipped: ['a'] },
    });
    try {
      await waitFor(() => expect(h.text()).toContain('needle'));
      await waitFor(() => expect(h.settingsLoaded()).toBe(true));
      const key = 'file:C:/proj/note.md';
      await waitFor(() => expect(documentFoldState(key, initialFold('expanded')).flipped).toEqual(['a']));
      await waitFor(() => expect(foldedRanges(h.view().state).size).toBeGreaterThan(0));

      act(() => {
        openFind('p-ed', 'editor');
        setTerm('p-ed', 'needle');
      });

      await waitFor(() => expect(documentFoldState(key, initialFold('expanded')).flipped).toEqual([]));
      expect(foldedRanges(h.view().state).size).toBe(0);
    } finally {
      h.unmount();
      __resetFindState();
    }
  });

  it('opens each collapsed section as Next steps onto its match, every time (049 T055, FR-005)', async () => {
    const text = '# Top\n\n## A\n\nneedle a\n\n## B\n\nneedle b\n\n## C\n\nneedle c\n\n## D\n\nneedle d\n';
    const h = mountEditor({
      panelId: 'p-ed',
      doc: { text, version: 1, absPath: 'C:/proj/steps.md' },
      foldAuthority: { base: 'expanded', flipped: ['a', 'b', 'c', 'd'] },
    });
    try {
      await waitFor(() => expect(h.text()).toContain('needle'));
      await waitFor(() => expect(h.settingsLoaded()).toBe(true));
      const key = 'file:C:/proj/steps.md';
      const flipped = (): string[] => documentFoldState(key, initialFold('expanded')).flipped;
      await waitFor(() => expect(flipped()).toEqual(['a', 'b', 'c', 'd']));
      await waitFor(() => expect(foldedRanges(h.view().state).size).toBe(4));

      act(() => {
        openFind('p-ed', 'editor');
        setTerm('p-ed', 'needle');
      });
      await waitFor(() => expect(flipped()).toEqual(['b', 'c', 'd']));

      for (const [i, open] of [['b', 'c', 'd'], ['c', 'd'], ['d']].entries()) {
        act(() => findNext('p-ed'));
        await waitFor(() => expect(flipped()).toEqual(open.slice(1)));
        expect(foldedRanges(h.view().state).size, `after step ${i + 1}`).toBe(open.length - 1);
      }
    } finally {
      h.unmount();
      __resetFindState();
    }
  });
});
