/**
 * 049 T041 — an editor's caret, selection and scroll cross windows (US6.1; FR-000a; research R3).
 *
 * A mounted editor registers a live `editor` capture with the hand-off; an editor mounting over a seeded
 * `editor-view-state` entry — what the receiving window's claim-and-seed leaves — restores that selection and
 * scrolls the anchor line to the top, by the same `initialise()` path a tab switch already uses.
 */
import { act, waitFor } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PanelSnapshot } from '@throng/core';
import { stashPanelState } from '../../src/renderer/workspace/panel-state-capture.js';
import { clearEditorViewState, seedEditorViewState } from '../../src/renderer/editor/editor-view-state.js';
import { mountEditor, type EditorHarness } from './helpers/mount-editor.js';

const PANEL = 'p-ed';
const LINES = Array.from({ length: 600 }, (_, i) => `line ${String(i).padStart(3, '0')}`);
const TEXT = LINES.join('\n');
const lineStart = (n: number): number => LINES.slice(0, n).join('\n').length + (n > 0 ? 1 : 0);

let h: EditorHarness | undefined;
afterEach(() => {
  h?.unmount();
  h = undefined;
  clearEditorViewState(PANEL);
});

function mount(withHandoff: ReturnType<typeof vi.fn>): EditorHarness {
  h = mountEditor({
    panelId: PANEL,
    doc: { text: TEXT, version: 1, absPath: 'C:/proj/big.txt' },
    throng: { panelState: { stash: withHandoff, claim: vi.fn() } },
  });
  return h;
}

describe('the editor capture', () => {
  it('returns the LIVE selection and scroll anchor of the mounted view', async () => {
    const stash = vi.fn(async () => undefined);
    const harness = mount(stash);
    await waitFor(() => expect(harness.text()).toContain('line 599'));
    await waitFor(() => expect(harness.settingsLoaded()).toBe(true));

    const from = lineStart(120);
    act(() => harness.view().dispatch({ selection: EditorSelection.range(from, from + 8) }));
    await stashPanelState([PANEL]);

    const sent = (stash.mock.calls[0] as unknown as [PanelSnapshot[]])[0];
    expect(sent).toHaveLength(1);
    expect(sent[0]!.panelId).toBe(PANEL);
    expect(sent[0]!.editor?.selection).toEqual({ ranges: [{ anchor: from, head: from + 8 }], main: 0 });
    expect(typeof sent[0]!.editor?.scrollAnchor).toBe('number');
  });

  it('stops answering once the view is unmounted — and the saved entry answers instead', async () => {
    const stash = vi.fn(async () => undefined);
    const harness = mount(stash);
    await waitFor(() => expect(harness.text()).toContain('line 599'));
    const from = lineStart(10);
    act(() => harness.view().dispatch({ selection: EditorSelection.range(from, from + 4) }));
    harness.unmount();
    h = undefined;

    await stashPanelState([PANEL]);
    const sent = (stash.mock.calls[0] as unknown as [PanelSnapshot[]])[0];
    // The unmount saved the view state (the tab-switch path); the capture reads that, not a dead view.
    expect(sent[0]!.editor?.selection.ranges).toEqual([{ anchor: from, head: from + 4 }]);
  });
});

describe('an editor mounted over a seeded entry (what the receiving window leaves)', () => {
  it('restores the selection and scrolls the anchor line to the top', async () => {
    const sel = lineStart(300);
    seedEditorViewState(PANEL, {
      selection: { ranges: [{ anchor: sel, head: sel + 9 }], main: 0 },
      scrollAnchor: lineStart(290),
    });
    const harness = mount(vi.fn());
    await waitFor(() => expect(harness.text()).toContain('line 599'));
    await waitFor(() => expect(harness.settingsLoaded()).toBe(true));

    const main = harness.view().state.selection.main;
    expect([main.anchor, main.head]).toEqual([sel, sel + 9]);
    // The anchor line is scrolled to the top: it is inside the viewport, which starts at or just before it.
    const view = harness.view();
    await waitFor(() => {
      view.measure();
      expect(view.viewport.from).toBeLessThanOrEqual(lineStart(290));
      expect(view.viewport.to).toBeGreaterThan(lineStart(290));
    });
  });
});
