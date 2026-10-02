/**
 * 049 T046 — an editor's selection stays through losing focus (US5; FR-021 – FR-024).
 *
 * The inactive COLOUR is a stylesheet rule, pinned in `unit/editor-inactive-selection-css.test.ts`; what is here is
 * what the colour is a colour OF: the view stops being `cm-focused` when focus goes to another panel or to its own
 * find bar, the selection is still the view's, getting focus back without a click leaves it unchanged, and Copy then
 * copies exactly its text. A remount over unchanged text restores it (US5.7).
 */
import { act, waitFor } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';

beforeAll(() => {
  const range = globalThis.Range?.prototype as unknown as Record<string, unknown> | undefined;
  if (range && typeof range.getClientRects !== 'function') {
    range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
    range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  }
});

const TEXT = 'first line here\nsecond line here\nthird line\n';
const PANEL = 'p-ed-inactive';
let mounted: EditorHarness | undefined;
const others: HTMLElement[] = [];

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  others.splice(0).forEach((e) => e.remove());
});

async function mount(): Promise<EditorHarness> {
  mounted = mountEditor({ panelId: PANEL, doc: { text: TEXT, version: 1 } });
  await waitFor(() => expect(mounted!.text()).toBe(TEXT));
  return mounted;
}

/** Something else that can take focus — another panel's editor, or this panel's own find bar input. */
function elsewhere(): HTMLInputElement {
  const input = document.createElement('input');
  document.body.appendChild(input);
  others.push(input);
  return input;
}

const selectedText = (h: EditorHarness): string => {
  const r = h.view().state.selection.main;
  return h.view().state.sliceDoc(r.from, r.to);
};

describe('a selection in an editor that loses focus', () => {
  it('stays the view\'s selection when focus moves to another panel, and the view stops being focused', async () => {
    const h = await mount();
    act(() => {
      h.view().focus();
      h.view().dispatch({ selection: EditorSelection.range(6, 10) });
    });
    expect(h.view().dom.classList.contains('cm-focused')).toBe(true);
    expect(selectedText(h)).toBe('line');

    act(() => elsewhere().focus());

    await waitFor(() => expect(h.view().dom.classList.contains('cm-focused')).toBe(false));
    expect(selectedText(h)).toBe('line'); // the colour is inactive; the selection is untouched
  });

  it('stays when focus moves to the panel\'s own find bar (Edge Cases)', async () => {
    const h = await mount();
    act(() => {
      h.view().focus();
      h.view().dispatch({ selection: EditorSelection.range(0, 5) });
    });
    const findInput = elsewhere();
    findInput.setAttribute('data-testid', 'find-input');
    act(() => findInput.focus());

    await waitFor(() => expect(h.view().dom.classList.contains('cm-focused')).toBe(false));
    expect(selectedText(h)).toBe('first');
  });

  it('is unchanged when focus returns without a click, and Copy source is exactly its text (FR-023)', async () => {
    const h = await mount();
    act(() => {
      h.view().focus();
      h.view().dispatch({ selection: EditorSelection.range(16, 22) });
    });
    const before = h.view().state.selection.main;
    act(() => elsewhere().focus());
    await waitFor(() => expect(h.view().dom.classList.contains('cm-focused')).toBe(false));

    act(() => h.view().focus()); // Tab / Shift+Tab / Alt+arrow back: no pointer-down

    await waitFor(() => expect(h.view().dom.classList.contains('cm-focused')).toBe(true));
    const after = h.view().state.selection.main;
    expect([after.from, after.to]).toEqual([before.from, before.to]);
    expect(selectedText(h)).toBe('second');
  });
});

describe('a remount over unchanged text (US5.7)', () => {
  it('shows the same selection again', async () => {
    const first = await mount();
    act(() => {
      first.view().focus();
      first.view().dispatch({ selection: EditorSelection.range(6, 10) });
    });
    first.unmount();
    mounted = undefined;

    const second = await mount();
    await waitFor(() => expect(selectedText(second)).toBe('line'));
  });
});
