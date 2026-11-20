/**
 * 073 FR-033d — the editor's half of the sync mark: the line the pair is in step at is softly highlighted whether it is
 * at the editor's top or part way down it (an editor that ran out of room while the other view carried on), and drawing
 * it never moves the caret, the selection or the focus.
 *
 * Layer: component — a real CodeMirror view in jsdom, the pair's mark published through the store the preview chrome
 * publishes to. The panel's decision of WHEN to publish is `preview-sync-mark.test.ts`'s.
 */
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncMarkExtension } from '../../src/renderer/editor/sync-mark.js';
import { SYNC_MARK_FADE_MS, SYNC_MARK_REMOVE_MS, __resetSyncMarks, clearSyncMark, publishSyncMark } from '../../src/renderer/preview/sync-mark-store.js';

const DOC = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
let view: EditorView | undefined;

function mount(panelId = 'ed-1'): EditorView {
  const parent = document.body.appendChild(document.createElement('div'));
  view = new EditorView({ parent, state: EditorState.create({ doc: DOC, extensions: [syncMarkExtension(panelId)] }) });
  return view;
}
const marked = (): { text: string; on: boolean }[] =>
  [...view!.dom.querySelectorAll<HTMLElement>('.cm-line.throng-sync-mark')].map((el) => ({
    text: el.textContent ?? '',
    on: el.classList.contains('throng-sync-mark--on'),
  }));

beforeEach(() => __resetSyncMarks());
afterEach(() => {
  vi.useRealTimers();
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
});

describe('the editor line highlight (FR-033d)', () => {
  it('highlights the marked line, 0-based, on the whole line', () => {
    mount();
    expect(marked()).toEqual([]);
    act(() => publishSyncMark('ed-1', 3));
    expect(marked()).toEqual([{ text: 'line 3', on: true }]);
  });

  it('is on a line part way down when that is where the pair is in step (the editor is clamped short of the top)', () => {
    mount();
    act(() => publishSyncMark('ed-1', 20));
    expect(marked()).toEqual([{ text: 'line 20', on: true }]);
  });

  it('moves with the next sync scroll, never two lines at once', () => {
    mount();
    act(() => publishSyncMark('ed-1', 3));
    act(() => publishSyncMark('ed-1', 7));
    expect(marked()).toEqual([{ text: 'line 7', on: true }]);
  });

  it('changes neither the caret, the selection nor the focus', () => {
    const v = mount();
    v.focus();
    v.dispatch({ selection: { anchor: 12, head: 20 } });
    const focused = document.activeElement;
    const before = v.state.selection.toJSON();
    act(() => publishSyncMark('ed-1', 20));
    expect(v.state.selection.toJSON()).toEqual(before);
    expect(document.activeElement).toBe(focused);
  });

  it('fades: bright until 1.5 s after the last mark, then off, then gone', () => {
    mount();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => publishSyncMark('ed-1', 3));
    act(() => void vi.advanceTimersByTime(SYNC_MARK_FADE_MS));
    expect(marked()).toEqual([{ text: 'line 3', on: false }]);
    act(() => void vi.advanceTimersByTime(SYNC_MARK_REMOVE_MS));
    expect(marked()).toEqual([]);
  });

  it('clearing the pair\'s mark removes it at once', () => {
    mount();
    act(() => publishSyncMark('ed-1', 3));
    act(() => clearSyncMark('ed-1'));
    expect(marked()).toEqual([]);
  });

  it('ignores another editor\'s pair', () => {
    mount('ed-1');
    act(() => publishSyncMark('ed-2', 3));
    expect(marked()).toEqual([]);
  });

  it('clamps a line past the end of the document to the last line', () => {
    mount();
    act(() => publishSyncMark('ed-1', 5000));
    expect(marked()).toEqual([{ text: 'line 29', on: true }]);
  });
});

describe('moving the highlight costs no CodeMirror update (073 T075)', () => {
  it('a hundred mark moves dispatch no transaction and touch the class of two lines at most each', () => {
    const v = mount();
    const dispatch = vi.spyOn(v, 'dispatch');
    const touched: Set<Element>[] = [];
    let current = new Set<Element>();
    const mo = new MutationObserver((records) => records.forEach((r) => current.add(r.target as Element)));
    mo.observe(v.dom, { subtree: true, attributes: true, attributeFilter: ['class'] });
    for (let i = 1; i <= 100; i += 1) {
      current = new Set();
      act(() => publishSyncMark('ed-1', i % 25));
      current = new Set([...current, ...mo.takeRecords().map((r) => r.target as Element)]);
      touched.push(current);
    }
    mo.disconnect();
    // Before: a decoration, so one full view update (every plugin, the link scan, a measure) per move.
    expect(dispatch).not.toHaveBeenCalled();
    expect(touched.every((t) => t.size <= 2)).toBe(true);
    expect(marked()).toHaveLength(1);
  });

  it('puts the class back on a line CodeMirror redrew, and takes it off with the mark', async () => {
    const v = mount();
    act(() => publishSyncMark('ed-1', 4));
    // An edit above redraws lines; the mark follows the line number it names, applied again after the update.
    act(() => v.dispatch({ changes: { from: 0, insert: 'inserted\n' } }));
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(marked()).toHaveLength(1);
    act(() => clearSyncMark('ed-1'));
    expect(marked()).toEqual([]);
  });
});
