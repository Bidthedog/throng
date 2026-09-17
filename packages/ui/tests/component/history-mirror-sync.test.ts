/**
 * 044 T141 — `HistoryMirrorSync`: main's history into THIS window's layout and history store
 * (contracts/navigation-history.md §2, §3 Path changes, §6; FR-066, FR-109).
 *
 * Main owns every history. A window writes `config.history` for the panels ITS layout holds, whether or
 * not they are on screen — so nothing here mounts a panel at all, and the preview under test sits in a
 * background tab. Two guards matter as much as the writes: an identical value writes nothing, and a panel
 * this window does not hold writes nothing. Each write builds a new layout and schedules a save, so a blind
 * write would have every window re-save its layout on every history change of every panel.
 */
import { act, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PREVIEW_KIND,
  collectPanels,
  createDefaultLayout,
  serialiseHistory,
  type NavigationHistory,
  type Panel,
  type PersistedHistory,
  type WorkspaceLayout,
} from '@throng/core';
import { HistoryMirrorSync } from '../../src/renderer/navigation/history-mirror-sync.js';
import { BackForwardButtons } from '../../src/renderer/navigation/back-forward-buttons.js';
import { __resetHistoryStore, getPanelHistory } from '../../src/renderer/navigation/history-store.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
const A = 'D:/proj/a.ts';
const B = 'D:/proj/b.ts';
const README = 'D:/proj/README.md';
const SETUP = 'D:/proj/docs/setup.md';

type Changed = { panelId: string; history: NavigationHistory | null };

let m: MountedWorkspace | undefined;
let changedListeners: ((evt: Changed) => void)[] = [];
let movedListeners: ((evt: { moves: { from: string; to: string }[] }) => void)[] = [];

/** Tab 1 (active) holds editor e1; tab 2 (in the background) holds preview v1 with a persisted history. */
function layoutWithBackgroundPreview(): WorkspaceLayout {
  const layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'e1' });
  const e1: Panel = { type: 'panel', id: 'e1', originProjectId: PROJECT, title: 'Ed', kind: 'editor', config: { filePath: B } };
  layout.tabs[0].root = e1;
  const v1: Panel = {
    type: 'panel',
    id: 'v1',
    originProjectId: PROJECT,
    title: 'Pv',
    kind: PREVIEW_KIND,
    config: { filePath: SETUP, history: { v: 1, entries: [{ filePath: README }, { filePath: SETUP }], index: 1 } },
  };
  layout.tabs.push({ id: 't2', title: 'Tab 2', root: v1, activePanelId: 'v1' });
  return layout;
}

async function mount(more: ReactElement[] = []): Promise<MountedWorkspace> {
  m = await mountWorkspace(layoutWithBackgroundPreview(), {
    extras: [createElement(HistoryMirrorSync, { key: 'sync' }), ...more],
    throng: {
      history: {
        onChanged: (cb: (evt: Changed) => void) => {
          changedListeners.push(cb);
          return () => (changedListeners = changedListeners.filter((l) => l !== cb));
        },
        attach: () => Promise.resolve({ entries: [], index: -1 }),
        purge: () => {},
        setViewState: () => {},
      },
      files: {
        onMoved: (cb: (evt: { moves: { from: string; to: string }[] }) => void) => {
          movedListeners.push(cb);
          return () => (movedListeners = movedListeners.filter((l) => l !== cb));
        },
      },
    },
  });
  return m;
}

const changed = (evt: Changed): void => act(() => changedListeners.forEach((l) => l(evt)));
const moved = (moves: { from: string; to: string }[]): void => act(() => movedListeners.forEach((l) => l({ moves })));
const panel = (id: string): Panel =>
  m!.ws().layout!.tabs.flatMap((t) => collectPanels(t.root) as Panel[]).find((p) => p.id === id)!;
const historyOf = (id: string): PersistedHistory | undefined =>
  (panel(id).config as { history?: PersistedHistory } | undefined)?.history;

beforeEach(() => {
  __resetHistoryStore();
  changedListeners = [];
  movedListeners = [];
});

afterEach(() => {
  m?.unmount();
  m = undefined;
});

describe('changed → config.history, for panels this window holds', () => {
  it('writes an editor’s history into the layout, serialised', async () => {
    await mount();
    const h: NavigationHistory = { entries: [{ filePath: A }, { filePath: B }], index: 1 };
    changed({ panelId: 'e1', history: h });
    expect(historyOf('e1')).toEqual(serialiseHistory(h));
  });

  it('writes a preview’s history though it sits in a background tab that is not mounted', async () => {
    await mount();
    const h: NavigationHistory = {
      entries: [{ filePath: README, viewState: { line: 4, offsetRatio: 0 } }, { filePath: SETUP }],
      index: 0,
    };
    changed({ panelId: 'v1', history: h });
    expect(historyOf('v1')).toEqual(serialiseHistory(h));
    expect(m!.ws().layout!.activeTabId).toBe('t1');
  });

  it('skips a value identical to what the layout holds — no new layout, so no save is scheduled', async () => {
    await mount();
    const before = m!.ws().layout;
    // Structurally equal to the persisted history, but a different object, as IPC delivers it.
    changed({ panelId: 'v1', history: { entries: [{ filePath: README }, { filePath: SETUP }], index: 1 } });
    expect(m!.ws().layout).toBe(before);
  });

  it('fix round 1, item 8 — the same view state with its keys in another order is the same value', async () => {
    await mount();
    changed({
      panelId: 'v1',
      history: { entries: [{ filePath: README, viewState: { offsetRatio: 0.5, line: 4 } }, { filePath: SETUP }], index: 0 },
    });
    const before = m!.ws().layout;
    changed({
      panelId: 'v1',
      history: { entries: [{ filePath: README, viewState: { line: 4, offsetRatio: 0.5 } }, { filePath: SETUP }], index: 0 },
    });
    expect(m!.ws().layout).toBe(before);
  });

  it('writes nothing for a panel this window does not hold', async () => {
    await mount();
    const before = m!.ws().layout;
    changed({ panelId: 'elsewhere', history: { entries: [{ filePath: A }], index: 0 } });
    expect(m!.ws().layout).toBe(before);
  });

  it('a purge (history: null) removes config.history rather than writing an empty list', async () => {
    await mount();
    changed({ panelId: 'v1', history: null });
    expect(historyOf('v1')).toBeUndefined();
    expect(panel('v1').config?.filePath).toBe(SETUP);
  });

  it('an EMPTY history is not a purge — it is written as one', async () => {
    await mount();
    changed({ panelId: 'e1', history: { entries: [], index: -1 } });
    expect(historyOf('e1')).toEqual({ v: 1, entries: [], index: -1 });
  });
});

describe('changed → this window’s history store (the buttons’ one source)', () => {
  it('mirrors the value, and a purge forgets it', async () => {
    await mount();
    const h: NavigationHistory = { entries: [{ filePath: A }, { filePath: B }], index: 1 };
    changed({ panelId: 'e1', history: h });
    expect(getPanelHistory('e1')).toEqual(h);
    changed({ panelId: 'e1', history: null });
    expect(getPanelHistory('e1')).toBeUndefined();
  });

  it('a mounted pair of buttons follows the mirrored value', async () => {
    await mount([createElement(BackForwardButtons, { key: 'bf', panelId: 'e1', onBack: () => {}, onForward: () => {} })]);
    const back = screen.getByTestId('panel-back-e1') as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    changed({ panelId: 'e1', history: { entries: [{ filePath: A }, { filePath: B }], index: 1 } });
    expect(back.disabled).toBe(false);
  });
});

describe('throng:files:moved rewrites every panel’s config.history in this window (FR-109)', () => {
  it('follows a moved file in an editor and in an unmounted background preview', async () => {
    await mount();
    changed({ panelId: 'e1', history: { entries: [{ filePath: A }, { filePath: B }], index: 1 } });
    moved([
      { from: A, to: 'D:/proj/src/a.ts' },
      { from: 'D:/proj/docs', to: 'D:/proj/guide' },
    ]);
    expect(historyOf('e1')?.entries.map((e) => e.filePath)).toEqual(['D:/proj/src/a.ts', B]);
    expect(historyOf('e1')?.index).toBe(1);
    expect(historyOf('v1')?.entries.map((e) => e.filePath)).toEqual([README, 'D:/proj/guide/setup.md']);
    expect(historyOf('v1')?.index).toBe(1);
  });

  it('a move that touches no history writes nothing', async () => {
    await mount();
    const before = m!.ws().layout;
    moved([{ from: 'D:/proj/unrelated.txt', to: 'D:/proj/other.txt' }]);
    expect(m!.ws().layout).toBe(before);
  });
});
