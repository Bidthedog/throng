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
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
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
    extras: [createElement(KeybindingsHandler, { key: 'keys', onToggleProjects: () => {}, onToggleExplorer: () => {} })],
    throng: { editor: { openInto: () => Promise.resolve({ action: 'open' }) } },
  });
}

describe('focus.* — Ctrl+Alt+Arrow moves the active panel (012)', () => {
  it('right, down, left and up each move it one panel', async () => {
    await mount();
    act(() => press('ArrowRight', { ctrlKey: true, altKey: true }));
    expect(active()).toBe('p2');
    act(() => press('ArrowDown', { ctrlKey: true, altKey: true }));
    expect(active()).toBe('p4');
    act(() => press('ArrowLeft', { ctrlKey: true, altKey: true }));
    expect(active()).toBe('p3');
    act(() => press('ArrowUp', { ctrlKey: true, altKey: true }));
    expect(active()).toBe('p1');
  });

  it('with Shift added it is a different chord, and moves nothing', async () => {
    await mount();
    act(() => press('ArrowRight', { ctrlKey: true, altKey: true, shiftKey: true }));
    expect(active()).toBe('p1');
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
