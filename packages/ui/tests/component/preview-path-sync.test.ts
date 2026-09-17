/**
 * 044 T141 — `PreviewPathSync`: a preview's `config.filePath` in THIS window's layout follows the file its
 * run shows (contracts/navigation-history.md §3 Path changes, §6; contracts/preview-ipc.md §2; FR-066,
 * FR-090a, FR-013c).
 *
 * Two sources: main's broadcast `throng:preview:pathChanged` (a link followed, a history step, a restore
 * whose history beat a stale path, a parented preview following its document) and `throng:files:moved` (a
 * file or folder moved in-app). Neither names a window, so each window patches the previews its layout
 * holds — mounted or not — and nothing else. `MovedPathSync` is not the route: it listens to EDITOR sync
 * messages, which never name a preview.
 */
import { act } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PREVIEW_KIND, collectPanels, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { PreviewPathSync } from '../../src/renderer/preview/preview-path-sync.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
const README = 'D:/proj/README.md';
const SETUP = 'D:/proj/docs/setup.md';
const EDITED = 'D:/proj/docs/notes.md';

let m: MountedWorkspace | undefined;
let pathListeners: ((evt: { panelId: string; filePath: string }) => void)[] = [];
let movedListeners: ((evt: { moves: { from: string; to: string }[] }) => void)[] = [];

/** Tab 1 (active) holds preview v0 and editor e1; tab 2 (background, unmounted) holds preview v1. */
function layout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'v0' });
  const v0: Panel = { type: 'panel', id: 'v0', originProjectId: PROJECT, title: 'P0', kind: PREVIEW_KIND, config: { filePath: README } };
  const e1: Panel = { type: 'panel', id: 'e1', originProjectId: PROJECT, title: 'Ed', kind: 'editor', config: { filePath: EDITED } };
  l.tabs[0].root = { type: 'split', orientation: 'row', children: [v0, e1], sizes: [0.5, 0.5] };
  const v1: Panel = { type: 'panel', id: 'v1', originProjectId: PROJECT, title: 'P1', kind: PREVIEW_KIND, config: { filePath: SETUP } };
  l.tabs.push({ id: 't2', title: 'Tab 2', root: v1, activePanelId: 'v1' });
  return l;
}

async function mount(): Promise<MountedWorkspace> {
  m = await mountWorkspace(layout(), {
    extras: [createElement(PreviewPathSync, { key: 'sync' })],
    throng: {
      preview: {
        onPathChanged: (cb: (evt: { panelId: string; filePath: string }) => void) => {
          pathListeners.push(cb);
          return () => (pathListeners = pathListeners.filter((l) => l !== cb));
        },
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

const pathChanged = (panelId: string, filePath: string): void =>
  act(() => pathListeners.forEach((l) => l({ panelId, filePath })));
const moved = (moves: { from: string; to: string }[]): void => act(() => movedListeners.forEach((l) => l({ moves })));
const filePathOf = (id: string): unknown =>
  (m!.ws().layout!.tabs.flatMap((t) => collectPanels(t.root) as Panel[]).find((p) => p.id === id)?.config ?? {})
    .filePath;

beforeEach(() => {
  pathListeners = [];
  movedListeners = [];
});

afterEach(() => {
  m?.unmount();
  m = undefined;
});

describe('throng:preview:pathChanged', () => {
  it('writes the new filePath for a preview in the active tab', async () => {
    await mount();
    pathChanged('v0', SETUP);
    expect(filePathOf('v0')).toBe(SETUP);
  });

  it('writes it for a preview in a background tab that is not mounted', async () => {
    await mount();
    pathChanged('v1', README);
    expect(filePathOf('v1')).toBe(README);
    expect(m!.ws().layout!.activeTabId).toBe('t1');
  });

  it('an identical path writes nothing — no new layout, so no save', async () => {
    await mount();
    const before = m!.ws().layout;
    pathChanged('v1', SETUP);
    expect(m!.ws().layout).toBe(before);
  });

  it('a panel this window does not hold writes nothing', async () => {
    await mount();
    const before = m!.ws().layout;
    pathChanged('elsewhere', SETUP);
    expect(m!.ws().layout).toBe(before);
  });

  it('never re-points an EDITOR — pathChanged names previews only', async () => {
    await mount();
    const before = m!.ws().layout;
    pathChanged('e1', SETUP);
    expect(m!.ws().layout).toBe(before);
    expect(filePathOf('e1')).toBe(EDITED);
  });
});

describe('throng:files:moved', () => {
  it('rewrites a preview’s filePath for mounted and unmounted previews, and leaves editors to MovedPathSync', async () => {
    await mount();
    moved([
      { from: README, to: 'D:/proj/README-old.md' },
      { from: 'D:/proj/docs', to: 'D:/proj/guide' },
    ]);
    expect(filePathOf('v0')).toBe('D:/proj/README-old.md');
    expect(filePathOf('v1')).toBe('D:/proj/guide/setup.md');
    expect(filePathOf('e1')).toBe(EDITED);
  });

  it('a move that touches no preview writes nothing', async () => {
    await mount();
    const before = m!.ws().layout;
    moved([{ from: 'D:/proj/elsewhere.md', to: 'D:/proj/there.md' }]);
    expect(m!.ws().layout).toBe(before);
  });
});
