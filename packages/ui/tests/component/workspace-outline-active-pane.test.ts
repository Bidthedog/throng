/**
 * 046 iterate round 4 (FR-121, S28, SC-012, SC-019) — the workspace's active-panel treatment shows
 * only while the WORKSPACE holds the active pane.
 *
 * While the Projects pane or the File Explorer holds it, no workspace panel frame carries
 * `panel-box--active` or `panel-box--active-dimmed`, so the side pane's own outline (FR-073) is the
 * only active indication in the window. The tab's active panel id is NOT changed by that, so any
 * route back to the workspace lights the SAME panel. 012 FR-002's two window states stand while the
 * workspace holds the pane: foreground → active, background → dimmed.
 *
 * The active pane is driven through `setActivePane`, the one store every side pane's pointer-down,
 * `focus.projects` / `focus.explorer` and `focus.workspace` write to (`workspace/active-pane.ts`);
 * the frames are real `PanelPlaceholder`s under the same six providers `panel-box.test.ts` mounts.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, createDefaultLayout, type WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { PanelPlaceholder } from '../../src/renderer/workspace/panel-placeholder.js';
import { setActivePane, type ActivePane } from '../../src/renderer/workspace/active-pane.js';

const PROJECT = 'proj-1';

/** Two panels side by side; p2 is the tab's active panel, so "active" is a choice, not the default. */
function twoPanels(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = {
    type: 'split',
    orientation: 'row',
    sizes: [0.5, 0.5],
    children: [
      { type: 'panel', id: 'p1', originProjectId: PROJECT, title: 'p1' },
      { type: 'panel', id: 'p2', originProjectId: PROJECT, title: 'p2' },
    ],
  };
  l.tabs[0].activePanelId = 'p2';
  return l;
}

type Ws = ReturnType<typeof useWorkspace>;
const captured: { ws: Ws | null } = { ws: null };

function Host(): ReactElement | null {
  const ws = useWorkspace();
  captured.ws = ws;
  const tab = ws.layout?.tabs[0];
  if (!tab) return null;
  return createElement(
    'div',
    null,
    ...collectPanels(tab.root).map((p) => createElement(PanelPlaceholder, { key: p.id, panel: p, tabId: tab.id })),
  );
}

async function mount(): Promise<void> {
  const layout = twoPanels();
  const bridge: ThrongBridge = {
    invoke<T>(method: string): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
    },
  };
  const services: Services = {
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
  Reflect.set(window, 'throng', { panel: { notifyDestroyed: vi.fn() } });
  render(
    createElement(
      ServicesProvider,
      { services },
      createElement(
        ProjectsProvider,
        { client: services.projects },
        createElement(
          WorkspaceProvider,
          { client: services.workspace, activeProjectId: PROJECT },
          createElement(
            NotificationProvider,
            null,
            createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, createElement(Host))),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('panel-p2')).toBeInTheDocument());
}

const box = (id: string): HTMLElement => screen.getByTestId(`panel-${id}`);
const treated = (): Element[] => [...document.querySelectorAll('.panel-box--active, .panel-box--active-dimmed')];
const activeId = (): string | undefined => captured.ws?.layout?.tabs[0].activePanelId;
const pane = (p: ActivePane): void => act(() => setActivePane(p));

/** The window's foreground state, as `useWindowFocus` reads it: `document.hasFocus()` plus focus/blur. */
function windowForeground(fg: boolean): void {
  vi.spyOn(document, 'hasFocus').mockReturnValue(fg);
  act(() => {
    window.dispatchEvent(new Event(fg ? 'focus' : 'blur'));
  });
}

beforeEach(() => {
  captured.ws = null;
  setActivePane('workspace');
});
afterEach(() => {
  vi.restoreAllMocks();
  setActivePane('workspace');
  Reflect.deleteProperty(window, 'throng');
});

describe('the workspace outline follows the active pane (FR-121)', () => {
  it('no panel frame carries the treatment while Projects, then the File Explorer, holds the active pane', async () => {
    windowForeground(true);
    await mount();
    // Positive control: with the workspace active, the tab's active panel wears it.
    await waitFor(() => expect(box('p2')).toHaveClass('panel-box--active'));

    for (const side of ['projects', 'files'] as const) {
      pane(side);
      await waitFor(() => expect(treated(), `a panel frame is outlined while ${side} holds the active pane`).toEqual([]));
      // The tab's active panel id is untouched: hiding the treatment is not a change of selection.
      expect(activeId()).toBe('p2');
    }
  });

  it('shows it on the SAME panel again once the workspace holds the active pane', async () => {
    windowForeground(true);
    await mount();
    pane('projects');
    await waitFor(() => expect(treated()).toEqual([]));

    pane('workspace');
    await waitFor(() => expect(box('p2')).toHaveClass('panel-box--active'));
    expect(box('p1')).not.toHaveClass('panel-box--active');
    expect(treated()).toHaveLength(1);
  });

  it('carries neither the active nor the dimmed class from a side pane with the window in the background', async () => {
    windowForeground(false);
    await mount();
    await waitFor(() => expect(box('p2')).toHaveClass('panel-box--active-dimmed'));

    pane('files');
    await waitFor(() => expect(treated()).toEqual([]));
  });

  it('keeps 012 FR-002’s dimmed treatment with the workspace active and the window in the background', async () => {
    windowForeground(true);
    await mount();
    await waitFor(() => expect(box('p2')).toHaveClass('panel-box--active'));

    windowForeground(false);
    await waitFor(() => expect(box('p2')).toHaveClass('panel-box--active-dimmed'));
  });
});
