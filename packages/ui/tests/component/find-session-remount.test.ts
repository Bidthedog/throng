/**
 * 049 T014 — #456 for EDITORS: an open find survives the panel's view being rebuilt (FR-000, FR-001..003).
 *
 * The find SESSION outlives a panel's unmount (`search-store.ts`, 043 rule 3), but the CONTROLLER that
 * paints and steps its matches is rebuilt with the view and starts with no query. So the bar read `2 of 5`
 * while the document carried no highlights and Next did nothing — the session said one thing, the view
 * another. A tab switch, a drag, a split all unmount the view.
 *
 * The assertions read what a user sees: the match marks the document carries (`state.facet(
 * EditorView.decorations)`, the value CodeMirror paints), the count the bar reads, and what Next does.
 */
import { act, waitFor } from '@testing-library/react';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';
import {
  __resetFindState,
  findNext,
  getFindSession,
  openFind,
  setTerm,
} from '../../src/renderer/search/search-store.js';

const PANEL = 'p-ed';
const FIVE = 'foo\nfoo\nfoo\nfoo\nfoo\n'; // matches at 0, 4, 8, 12, 16

function marks(h: EditorHarness): { from: number; current: boolean }[] {
  const view = h.view();
  const out: { from: number; current: boolean }[] = [];
  for (const source of view.state.facet(EditorView.decorations)) {
    if (typeof source === 'function') continue;
    (source as DecorationSet).between(0, view.state.doc.length, (from, _to, value) => {
      const cls = String((value.spec as { class?: string }).class ?? '');
      if (cls.includes('throng-search-match')) out.push({ from, current: cls.includes('--current') });
    });
  }
  return out;
}

async function mountWith(text: string, version = 1): Promise<EditorHarness> {
  const h = mountEditor({ panelId: PANEL, doc: { text, version } });
  await waitFor(() => expect(h.text()).toBe(text));
  return h;
}

afterEach(() => {
  __resetFindState();
});

describe('an editor panel with an open find, unmounted and remounted (#456)', () => {
  it('shows the same matches, the same current one, and Next carries on from it', async () => {
    const first = await mountWith(FIVE);
    act(() => {
      openFind(PANEL, 'editor');
      setTerm(PANEL, 'foo');
      findNext(PANEL);
    });
    expect(getFindSession(PANEL)?.count).toEqual({ current: 2, total: 5 });
    expect(marks(first)).toHaveLength(5);

    act(() => first.unmount());
    const second = await mountWith(FIVE);

    await waitFor(() => expect(marks(second)).toHaveLength(5));
    expect(marks(second).map((m) => m.from)).toEqual([0, 4, 8, 12, 16]);
    expect(marks(second).filter((m) => m.current).map((m) => m.from)).toEqual([4]);
    expect(getFindSession(PANEL)?.count).toEqual({ current: 2, total: 5 });

    act(() => findNext(PANEL));
    expect(getFindSession(PANEL)?.count).toEqual({ current: 3, total: 5 });
    expect(marks(second).filter((m) => m.current).map((m) => m.from)).toEqual([8]);
  });

  it('re-runs the search when the document changed while hidden, landing on the nearest following match (FR-003)', async () => {
    const first = await mountWith(FIVE);
    act(() => {
      openFind(PANEL, 'editor');
      setTerm(PANEL, 'foo');
      findNext(PANEL); // current match at offset 4
    });
    act(() => first.unmount());

    // While hidden the text changed: the first line's match is gone from 4, matches now at 0, 7, 11, 15.
    const second = await mountWith('foo\nxx\nfoo\nfoo\nfoo\n', 2);

    await waitFor(() => expect(marks(second).map((m) => m.from)).toEqual([0, 7, 11, 15]));
    expect(marks(second).filter((m) => m.current).map((m) => m.from)).toEqual([7]);
    expect(getFindSession(PANEL)?.count).toEqual({ current: 2, total: 4 });
  });

  it('does not run a search for a panel whose find bar is closed', async () => {
    const first = await mountWith(FIVE);
    act(() => first.unmount());
    const second = await mountWith(FIVE);
    expect(marks(second)).toHaveLength(0);
    expect(getFindSession(PANEL)).toBeUndefined();
  });
});
