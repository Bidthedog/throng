/**
 * 044 US7b fix round 1, item 6 — the two purge routes that are not the header's ✕ (FR-110;
 * contracts/navigation-history.md §7).
 *
 * - A destroy cascaded from another window (`PanelDestroySync`): an editor or preview this window held
 *   has no history any more. Idempotent in main, so hearing a destroy this window caused is harmless.
 * - Clearing an editor's panel type (`clearEditorPanelType`): the panel stays, its document and its
 *   history do not.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_KIND, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { PanelDestroySync } from '../../src/renderer/workspace/panel-destroy-sync.js';
import { clearEditorPanelType } from '../../src/renderer/editor/clear-editor-panel-type.js';
import { EditorFailureBanner } from '../../src/renderer/editor/editor-failure-banner.js';
import { removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { SubWorkspaceWindowContext } from '../../src/renderer/workspace/subworkspace-window-context.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';

const PROJECT = 'proj';
const SUB_PROJECT = 'subworkspace:sw-1';
let m: MountedWorkspace | undefined;

afterEach(() => {
  m?.unmount();
  m = undefined;
  removeEditorState('e1');
  Reflect.deleteProperty(window, 'throng');
});

/** A sub-workspace window's layout: its own synthetic project, holding a PROJECT-owned editor view. */
function subWorkspaceLayout(): WorkspaceLayout {
  const l = createDefaultLayout(SUB_PROJECT, { tab: 't1', panel: 'e1' });
  const e1: Panel = { type: 'panel', id: 'e1', originProjectId: PROJECT, title: 'Ed', kind: 'editor', config: { filePath: 'D:/proj/a.ts' } };
  l.tabs[0].root = e1;
  return l;
}

/** The main window's layout: the same editor, owned by the window's own project. */
function mainLayout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'e1' });
  const e1: Panel = { type: 'panel', id: 'e1', originProjectId: PROJECT, title: 'Ed', kind: 'editor', config: { filePath: 'D:/proj/a.ts' } };
  l.tabs[0].root = e1;
  return l;
}

const banner = (): ReactElement =>
  createElement(ConfirmProvider, { key: 'confirm' }, createElement(EditorFailureBanner, { panelId: 'e1' }));

const bannerInMainWindow = (): ReactElement => banner();

const bannerInSubWorkspace = (): ReactElement =>
  createElement(
    SubWorkspaceWindowContext.Provider,
    { key: 'sub', value: { id: 'sw-1', name: 'Sub', colour: '#336699' } },
    banner(),
  );

function layout(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'e1' });
  const e1: Panel = { type: 'panel', id: 'e1', originProjectId: PROJECT, title: 'Ed', kind: 'editor', config: { filePath: 'D:/proj/a.ts' } };
  const v1: Panel = { type: 'panel', id: 'v1', originProjectId: PROJECT, title: 'Pv', kind: PREVIEW_KIND, config: { filePath: 'D:/proj/R.md' } };
  const u1: Panel = { type: 'panel', id: 'u1', originProjectId: PROJECT, title: 'Plain' };
  l.tabs[0].root = { type: 'split', orientation: 'row', children: [e1, v1, u1], sizes: [0.4, 0.3, 0.3] };
  return l;
}

describe('a destroy cascaded from another window purges the history here (PanelDestroySync)', () => {
  it('for an editor and a preview this window held, and not for a panel with no history', async () => {
    let destroyed: ((id: string) => void) | undefined;
    const purge = vi.fn();
    m = await mountWorkspace(layout(), {
      extras: [createElement(PanelDestroySync, { key: 'sync' })],
      throng: {
        panel: {
          notifyTyped: () => {},
          onDestroyed: (cb: (id: string) => void) => {
            destroyed = cb;
            return () => {};
          },
        },
        preview: { destroyed: vi.fn() },
        history: { purge, attach: vi.fn(), setViewState: vi.fn(), onChanged: () => () => {} },
      },
    });

    act(() => destroyed!('e1'));
    act(() => destroyed!('v1'));
    act(() => destroyed!('u1'));
    act(() => destroyed!('not-here'));

    expect(purge.mock.calls).toEqual([['e1'], ['v1']]);
  });
});

describe('clearing an editor’s panel type purges its history', () => {
  it('after the document is disposed, before the type is cleared', async () => {
    const order: string[] = [];
    Reflect.set(window, 'throng', {
      editor: { destroy: (id: string) => order.push(`destroy:${id}`) },
      history: { purge: (id: string) => order.push(`purge:${id}`) },
    });
    await clearEditorPanelType('e1', {
      dirty: false,
      name: 'a.ts',
      endsPanel: true,
      confirm: () => Promise.resolve(true),
      clearPanelType: (id) => order.push(`clear:${id}`),
    });
    expect(order).toEqual(['destroy:e1', 'purge:e1', 'clear:e1']);
  });

  it('a Cancel on the dirty prompt purges nothing', async () => {
    const purge = vi.fn();
    Reflect.set(window, 'throng', { editor: { destroy: vi.fn() }, history: { purge } });
    await clearEditorPanelType('e1', {
      dirty: true,
      name: 'a.ts',
      endsPanel: true,
      confirm: () => Promise.resolve(false),
      clearPanelType: vi.fn(),
    });
    expect(purge).not.toHaveBeenCalled();
  });
});

/*
 * 044 T179 (FR-110; contracts/navigation-history.md §7) — Clear panel type purges the history only when
 * THIS view ends the panel, the rule every other route already applies (`killsSession` / `viewEndsPreview`).
 * A project editor synced into a sub-workspace is one panel with two views: clearing its type there takes
 * this window's view, and the project window keeps the panel — and its one history.
 */
describe('Clear panel type purges only when this view ends the panel (T179, FR-110)', () => {
  it('a view that does NOT end the panel clears the type and purges nothing', async () => {
    const purge = vi.fn();
    const clearPanelType = vi.fn();
    Reflect.set(window, 'throng', { editor: { destroy: vi.fn() }, history: { purge } });

    await clearEditorPanelType('e1', {
      dirty: false,
      name: 'a.ts',
      endsPanel: false,
      confirm: () => Promise.resolve(true),
      clearPanelType,
    });

    expect(purge).not.toHaveBeenCalled();
    expect(clearPanelType).toHaveBeenCalledWith('e1');
  });

  it('the failure banner in a SUB-WORKSPACE window purges nothing for a project-owned editor', async () => {
    const purge = vi.fn();
    m = await mountWorkspace(subWorkspaceLayout(), {
      extras: [bannerInSubWorkspace()],
      throng: {
        editor: { destroy: vi.fn() },
        history: { purge, attach: vi.fn(), setViewState: vi.fn(), onChanged: () => () => {} },
      },
    });
    act(() => setEditorState('e1', { filePath: 'D:/proj/a.ts', unloadable: true, dirty: false }));

    fireEvent.click(await screen.findByTitle('Clear panel type'));

    await waitFor(() => expect(m!.ws().layout!.tabs[0].root).toBeTruthy());
    expect(purge).not.toHaveBeenCalled();
  });

  it('the same banner in the MAIN window purges, as it always has', async () => {
    const purge = vi.fn();
    m = await mountWorkspace(mainLayout(), {
      extras: [bannerInMainWindow()],
      throng: {
        editor: { destroy: vi.fn() },
        history: { purge, attach: vi.fn(), setViewState: vi.fn(), onChanged: () => () => {} },
      },
    });
    act(() => setEditorState('e1', { filePath: 'D:/proj/a.ts', unloadable: true, dirty: false }));

    fireEvent.click(await screen.findByTitle('Clear panel type'));

    await waitFor(() => expect(purge).toHaveBeenCalledWith('e1'));
  });
});
