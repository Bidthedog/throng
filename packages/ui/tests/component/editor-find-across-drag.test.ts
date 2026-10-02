/**
 * 049 T053 — an EDITOR with find at `2 of 5` keeps `2 of 5`, its highlights and Next after a real drag: to a new
 * position in the SAME tab, and into ANOTHER tab (FR-000, FR-001, FR-002).
 *
 * The maintainer saw "No results" after both while a plain tab switch kept the search. So this drives the drag the
 * way the app does — a dnd-kit drag through `TabGroup`, the panel unmounting from where it was and mounting where
 * it landed — and reads what a user reads: the count the bar holds and the match marks the document carries.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addTab, createDefaultLayout, splitPanel, type WorkspaceLayout } from '@throng/core';
import { mountTabGroup, type MountedTabGroup } from './helpers/mount-tab-group.js';
import { dragPanelTo, installDropGeometry } from './helpers/drop-panel.js';
import { __resetPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { __resetSplitMode } from '../../src/renderer/workspace/split-mode.js';
import { __resetFindState, findNext, getFindSession, openFind, setTerm } from '../../src/renderer/search/search-store.js';

const FIVE = 'foo\nfoo\nfoo\nfoo\nfoo\n'; // matches at 0, 4, 8, 12, 16

let mounted: MountedTabGroup | null = null;
let uninstall: () => void = () => {};

beforeEach(() => {
  uninstall = installDropGeometry();
  // jsdom has no text geometry; CodeMirror's selection layer asks for it on every update.
  const range = Range.prototype as unknown as Record<string, unknown>;
  range.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  range.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
});
afterEach(() => {
  uninstall();
  mounted?.unmount();
  mounted = null;
  __resetFindState();
  __resetSplitMode();
  __resetPanelFocus();
});

/** The editor bridge: a document authority that answers `getContent` with the text, whatever else is asked. */
function editorBridge(): Record<string, unknown> {
  const known: Record<string, unknown> = {
    // The real answer crosses IPC, so it lands a few macrotasks after the view mounted.
    getContent: () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              text: FIVE,
              version: 1,
              dirty: false,
              absPath: 'C:/proj/notes.md',
              fileMissing: false,
              unloadable: false,
              encoding: 'utf8',
              hasBom: false,
              lineEnding: 'lf',
            }),
          30,
        ),
      ),
    onSync: () => () => {},
    foldState: (_id: string, seed: 'expanded' | 'collapsed') => Promise.resolve({ base: seed, flipped: [] }),
    setFoldState: () => {},
  };
  return {
    editor: new Proxy(known, {
      get: (target, key: string) => (key in target ? target[key] : vi.fn(() => Promise.resolve({ ok: true }))),
    }),
  };
}

/** t1 holds the editor `ed` beside an untyped `p2`; t2 holds `p3`. */
function layout(): WorkspaceLayout {
  const base = createDefaultLayout('proj-find-drag', { tab: 't1', panel: 'ed' });
  const split = splitPanel(base, 't1', 'ed', 'right', { id: 'p2', title: 'Panel 2' });
  const two = addTab(split, { tab: 't2', panel: 'p3' });
  const withKind: WorkspaceLayout = {
    ...two,
    activeTabId: 't1',
    tabs: two.tabs.map((t) => ({
      ...t,
      root: JSON.parse(JSON.stringify(t.root).replace('"id":"ed"', '"id":"ed","kind":"editor","config":{"filePath":"C:/proj/notes.md"}')),
    })),
  };
  return withKind;
}

function marks(view: EditorView): { from: number; current: boolean }[] {
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

const liveView = (): EditorView => {
  const el = document.querySelector<HTMLElement>('.cm-editor');
  const found = el ? EditorView.findFromDOM(el) : null;
  if (!found) throw new Error('no live editor view');
  return found;
};

async function mountWithFindAtTwoOfFive(): Promise<void> {
  mounted = mountTabGroup(layout(), { throng: editorBridge() });
  await screen.findByTestId('panel-ed');
  await waitFor(() => expect(liveView().state.doc.toString()).toBe(FIVE));
  act(() => {
    openFind('ed', 'editor');
    setTerm('ed', 'foo');
    findNext('ed');
  });
  expect(getFindSession('ed')?.count).toEqual({ current: 2, total: 5 });
  expect(marks(liveView())).toHaveLength(5);
}

async function expectFindKept(): Promise<void> {
  await waitFor(() => expect(liveView().state.doc.toString()).toBe(FIVE));
  await waitFor(() => expect(marks(liveView())).toHaveLength(5));
  expect(getFindSession('ed')?.count).toEqual({ current: 2, total: 5 });
  expect(marks(liveView()).filter((m) => m.current).map((m) => m.from)).toEqual([4]);
  act(() => findNext('ed'));
  expect(getFindSession('ed')?.count).toEqual({ current: 3, total: 5 });
  expect(marks(liveView()).filter((m) => m.current).map((m) => m.from)).toEqual([8]);
}

describe('an editor with an open find, dragged (FR-000)', () => {
  it('to another position in the same tab keeps 2 of 5, its highlights, and Next', async () => {
    await mountWithFindAtTwoOfFive();
    await dragPanelTo(mounted!, 'ed', 'edge-right-p2');
    await expectFindKept();
  });

  it('into another tab, after lingering over its chip until the tab switched mid-drag, keeps 2 of 5, its highlights, and Next', async () => {
    await mountWithFindAtTwoOfFive();
    await dragPanelTo(mounted!, 'ed', 'tab-t2', 700); // the default dwell is 600 ms
    expect(mounted!.ws().layout!.activeTabId).toBe('t2');
    await expectFindKept();
  });

  it('into another tab keeps 2 of 5, its highlights, and Next', async () => {
    await mountWithFindAtTwoOfFive();
    await dragPanelTo(mounted!, 'ed', 'tab-t2');
    expect(mounted!.ws().layout!.activeTabId).toBe('t2');
    await expectFindKept();
  });
});
