/**
 * The window chords on ARROW keys, pressed through the real window key handler (`app.tsx`
 * `KeybindingsHandler`) — 044 US7b fix round 1, item 1.
 *
 * The handler used to drop Shift for arrow keys. That made `Shift+Alt+ArrowLeft` (the editor's column
 * select) resolve as `Alt+ArrowLeft` (`navigate.back`), which the capture phase swallowed. It keeps Shift
 * for arrows now, which changes how the event is BUILT for every arrow chord the window owns — so each of
 * them is pressed here, in both the shape that must fire and the Shift-added shape that must not.
 * `window-chords.ts` names this file as their coverage (the manifest guard reads that claim).
 */
import { act, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { KeybindingsHandler } from '../../src/renderer/app.js';
import { registerEditorActions, unregisterEditorActions, type EditorActions } from '../../src/renderer/editor/editor-actions.js';
import { __resetHistoryStore, setPanelHistory } from '../../src/renderer/navigation/history-store.js';
import { getActivePane, setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
let m: MountedWorkspace | undefined;

const editor = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: id, kind: 'editor', config: { filePath: `D:/proj/${id}.ts` } });

/** A 2×2 grid: p1 p2 over p3 p4. p1 is active. */
function grid(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = {
    type: 'split',
    orientation: 'column',
    sizes: [0.5, 0.5],
    children: [
      { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [editor('p1'), editor('p2')] },
      { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [editor('p3'), editor('p4')] },
    ],
  };
  l.tabs[0].activePanelId = 'p1';
  return l;
}

const press = (key: string, mods: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }): void => {
  fireEvent.keyDown(document.body, { key, code: key, ...mods });
};
const active = (): string | undefined => m!.ws().layout!.tabs[0].activePanelId;

beforeEach(() => {
  __resetHistoryStore();
  setActivePane('workspace');
});

afterEach(() => {
  unregisterEditorActions('p1');
  m?.unmount();
  m = undefined;
});

async function mount(): Promise<void> {
  m = await mountWorkspace(grid(), {
    extras: [createElement(KeybindingsHandler, { key: 'keys', onToggleProjects: () => {}, onToggleExplorer: () => {}, onRevealLeft: () => {}, onRevealRight: () => {} })],
    throng: { editor: { openInto: () => Promise.resolve({ action: 'open' }) } },
  });
}

/**
 * 046 iterate round 1 (FR-102) — `focus.left/right/up/down`'s shipped chord moved to TIER 1
 * (`Ctrl+Shift+Alt+Arrow*`), freeing the plain `Ctrl+Alt+Arrow` family back to the editor/shell.
 */
describe('focus.* — Ctrl+Shift+Alt+Arrow moves the active panel (012, FR-102)', () => {
  it('right, down, left and up each move it one panel', async () => {
    await mount();
    act(() => press('ArrowRight', { ctrlKey: true, shiftKey: true, altKey: true }));
    expect(active()).toBe('p2');
    act(() => press('ArrowDown', { ctrlKey: true, shiftKey: true, altKey: true }));
    expect(active()).toBe('p4');
    act(() => press('ArrowLeft', { ctrlKey: true, shiftKey: true, altKey: true }));
    expect(active()).toBe('p3');
    act(() => press('ArrowUp', { ctrlKey: true, shiftKey: true, altKey: true }));
    expect(active()).toBe('p1');
  });

  it('without Shift it is a different (now unbound) chord, and moves nothing', async () => {
    await mount();
    act(() => press('ArrowRight', { ctrlKey: true, altKey: true }));
    expect(active()).toBe('p1');
  });
});

/**
 * 046 iterate round 4 (FR-122, SC-019) — the four directional chords act only while the WORKSPACE
 * holds the active pane. From the Projects pane or the File Explorer the chord does nothing: no panel
 * is selected, focus stays where it is, and the chord is consumed so it never reaches the list or the
 * tree. The focused element below stands in for the side pane's own focus target; its bubble listener
 * is what "the list or the tree" would receive.
 */
describe('focus.* acts only while the workspace holds the active pane (FR-122)', () => {
  for (const side of ['projects', 'files'] as const) {
    it(`from ${side}: Ctrl+Shift+Alt+ArrowRight moves nothing, keeps focus and is consumed`, async () => {
      await mount();
      const sideTarget = document.createElement('div');
      sideTarget.tabIndex = 0;
      const reached = vi.fn();
      sideTarget.addEventListener('keydown', reached);
      document.body.appendChild(sideTarget);
      try {
        sideTarget.focus();
        act(() => setActivePane(side));

        let notTaken = true;
        act(() => {
          notTaken = fireEvent.keyDown(sideTarget, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, shiftKey: true, altKey: true });
        });

        expect(active(), 'the workspace selection moved from a side pane').toBe('p1');
        expect(getActivePane(), 'the active pane left the side pane').toBe(side);
        expect(document.activeElement).toBe(sideTarget);
        expect(notTaken, 'the chord was not consumed (default not prevented)').toBe(false);
        expect(reached, 'the chord reached the side pane').not.toHaveBeenCalled();
      } finally {
        sideTarget.remove();
      }
    });
  }

  it('from the workspace: the same chord moves the active panel as today (control)', async () => {
    await mount();
    act(() => setActivePane('workspace'));
    act(() => press('ArrowRight', { ctrlKey: true, shiftKey: true, altKey: true }));
    expect(active()).toBe('p2');
    expect(getActivePane()).toBe('workspace');
  });
});

describe('navigate.* — Alt+Arrow steps the focused panel (044 FR-105)', () => {
  function asEditor() {
    const openFile = vi.fn(() => Promise.resolve());
    registerEditorActions('p1', {
      save: () => Promise.resolve(true),
      saveAs: () => Promise.resolve(true),
      isDirty: () => false,
      openFile,
      revert: () => {},
      reloadFromDisk: () => Promise.resolve(true),
    } as EditorActions);
    return openFile;
  }

  it('Alt+ArrowLeft is Back and Alt+ArrowRight is Forward', async () => {
    await mount();
    const openFile = asEditor();
    setPanelHistory('p1', { entries: [{ filePath: 'D:/proj/a.ts' }, { filePath: 'D:/proj/p1.ts' }, { filePath: 'D:/proj/c.ts' }], index: 1 });

    press('ArrowLeft', { altKey: true });
    await waitFor(() => expect(openFile).toHaveBeenCalledWith('D:/proj/a.ts', expect.objectContaining({ navigation: expect.objectContaining({ index: 0 }) })));
    press('ArrowRight', { altKey: true });
    await waitFor(() => expect(openFile).toHaveBeenCalledWith('D:/proj/c.ts', expect.objectContaining({ navigation: expect.objectContaining({ index: 2 }) })));
  });

  it('Shift+Alt+Arrow is NOT Back or Forward — it is left for the editor’s column select', async () => {
    await mount();
    const openFile = asEditor();
    setPanelHistory('p1', { entries: [{ filePath: 'D:/proj/a.ts' }, { filePath: 'D:/proj/p1.ts' }, { filePath: 'D:/proj/c.ts' }], index: 1 });

    const leftNotTaken = fireEvent.keyDown(document.body, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, shiftKey: true });
    const rightNotTaken = fireEvent.keyDown(document.body, { key: 'ArrowRight', code: 'ArrowRight', altKey: true, shiftKey: true });

    expect(leftNotTaken).toBe(true);
    expect(rightNotTaken).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(openFile).not.toHaveBeenCalled();
  });
});
