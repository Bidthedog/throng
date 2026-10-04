/**
 * `MovedOutLayoutSync` (050 FR-035, SC-012, US2 scenario 10): when a move takes a file out of the project, or
 * an undo brings it back, EVERY editor and preview of THIS window's held layout learns it — the panels in
 * background tabs too, which have never mounted this session and so have no live document or run to say so.
 * Main's walk covers only the layouts no window holds; the window is the one writer of its own record.
 */
import { act } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PREVIEW_KIND, collectPanels, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { MovedOutLayoutSync } from '../../src/renderer/editor/moved-out-layout-sync.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
const EDITED = 'D:/proj/notes.md';
const SHOWN = 'D:/proj/README.md';
const AWAY = 'E:/other';

let m: MountedWorkspace | undefined;
let movedListeners: ((evt: { moves: { from: string; to: string }[] }) => void)[] = [];

/** Tab 1 (active, mounted) holds nothing of interest; tab 2 (background, never mounted) holds an editor and a preview. */
function layout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p0' });
  const ed: Panel = { type: 'panel', id: 'ed', originProjectId: PROJECT, title: 'Ed', kind: 'editor', config: { filePath: EDITED } };
  const pv: Panel = { type: 'panel', id: 'pv', originProjectId: PROJECT, title: 'Pv', kind: PREVIEW_KIND, config: { filePath: SHOWN } };
  l.tabs.push({ id: 't2', title: 'Tab 2', root: { type: 'split', orientation: 'row', children: [ed, pv], sizes: [0.5, 0.5] }, activePanelId: 'ed' });
  return l;
}

const moved = (moves: { from: string; to: string }[]): void => act(() => movedListeners.forEach((l) => l({ moves })));
const configOf = (id: string): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify((m!.ws().layout!.tabs.flatMap((t) => collectPanels(t.root) as Panel[]).find((p) => p.id === id)?.config ?? {})),
  );

beforeEach(async () => {
  movedListeners = [];
  m = await mountWorkspace(layout(), {
    extras: [createElement(MovedOutLayoutSync, { key: 'sync' })],
    throng: {
      files: {
        onMoved: (cb: (evt: { moves: { from: string; to: string }[] }) => void) => {
          movedListeners.push(cb);
          return () => (movedListeners = movedListeners.filter((l) => l !== cb));
        },
      },
    },
  });
});

afterEach(() => {
  m?.unmount();
  m = undefined;
});

describe('a move out of the project, and the undo that brings it back', () => {
  it('flags an unmounted editor and preview, naming the new path, and clears both on the way back', () => {
    moved([
      { from: EDITED, to: `${AWAY}/notes.md` },
      { from: SHOWN, to: `${AWAY}/README.md` },
    ]);
    expect(configOf('ed')).toEqual({ filePath: `${AWAY}/notes.md`, movedOut: true });
    expect(configOf('pv')).toEqual({ filePath: `${AWAY}/README.md`, movedOut: true });

    moved([
      { from: `${AWAY}/notes.md`, to: EDITED },
      { from: `${AWAY}/README.md`, to: SHOWN },
    ]);
    expect(configOf('ed')).toEqual({ filePath: EDITED });
    expect(configOf('pv')).toEqual({ filePath: SHOWN });
  });

  it('a move inside the project sets no flag and writes nothing', () => {
    const before = m!.ws().layout;
    moved([{ from: EDITED, to: 'D:/proj/docs/notes.md' }]);
    expect(m!.ws().layout).toBe(before);
  });

  it('a move that touches none of its panels writes nothing', () => {
    const before = m!.ws().layout;
    moved([{ from: 'D:/proj/else.md', to: `${AWAY}/else.md` }]);
    expect(m!.ws().layout).toBe(before);
  });
});
