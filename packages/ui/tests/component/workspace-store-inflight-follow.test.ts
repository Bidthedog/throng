/**
 * 052 T023 (FR-005, research R4) — the project-switch race. A layout save built BEFORE `throng:files:moved`
 * carries pre-move paths; if it lands after main's walk it puts them back, and the window no longer holds that
 * project to repair it. So a move heard while a project's save is in flight chains exactly one scoped
 * `workspace.followMoves` after that save settles — and none when nothing is in flight.
 */
import { act, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, type WorkspaceLayout } from '@throng/core';
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
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { settleLayoutSaves } from '../../src/renderer/state/layout-saves.js';

const PROJECT = 'proj-a';
const MOVES = [{ from: 'D:/proj/a.md', to: 'D:/proj/b.md' }];

type Ws = ReturnType<typeof useWorkspace>;
let unmount: (() => void) | undefined;

async function mount() {
  const follow: unknown[] = [];
  const releases: (() => void)[] = [];
  const captured: { ws: Ws | null } = { ws: null };
  const layout: WorkspaceLayout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          // Held until the test releases it: a save that is IN FLIGHT.
          return new Promise<T>((resolve) => releases.push(() => resolve({ ok: true } as T)));
        case 'workspace.followMoves':
          follow.push(params);
          return Promise.resolve({ changedProjectIds: [], changedSubWorkspaceIds: [], skipped: 0 } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        default:
          return Promise.resolve({} as T);
      }
    },
  };
  const services: Services = {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
  const listeners: ((evt: { moves: { from: string; to: string }[] }) => void)[] = [];
  Reflect.set(window, 'throng', {
    config: { get: () => Promise.resolve({ settings: {} }), onChange: () => () => {} },
    panel: { notifyTyped: () => {} },
    files: {
      onMoved: (cb: (evt: { moves: { from: string; to: string }[] }) => void) => {
        listeners.push(cb);
        return () => listeners.splice(listeners.indexOf(cb), 1);
      },
    },
  });
  function Probe(): null {
    captured.ws = useWorkspace();
    return null;
  }
  const view = render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        ServicesProvider,
        { services },
        createElement(
          ProjectsProvider,
          { client: services.projects },
          createElement(
            WorkspaceProvider,
            { client: services.workspace, activeProjectId: PROJECT },
            createElement(NotificationProvider, null, createElement(Probe)),
          ),
        ),
      ),
    ),
  );
  unmount = () => {
    view.unmount();
    Reflect.deleteProperty(window, 'throng');
  };
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  return {
    ws: () => captured.ws as Ws,
    follow,
    releases,
    moved: () => act(() => listeners.forEach((l) => l({ moves: MOVES }))),
  };
}

afterEach(() => unmount?.());

describe('throng:files:moved while a layout save is in flight (052 T023)', () => {
  it('chains exactly one scoped followMoves after the save settles', async () => {
    const h = await mount();
    act(() => {
      h.ws().addTab();
    });
    // Fire the armed debounce now: the save leaves for the daemon and stays there.
    void settleLayoutSaves();
    await waitFor(() => expect(h.releases).toHaveLength(1));

    h.moved();
    // Not before the save settles — it would race the very write it exists to repair.
    expect(h.follow).toEqual([]);

    await act(async () => {
      h.releases[0]();
    });
    await waitFor(() => expect(h.follow).toHaveLength(1));
    expect(h.follow[0]).toEqual({ moves: MOVES, held: { projectIds: [], subWorkspaceIds: [] }, only: { projectIds: [PROJECT] } });
    // And never a second one for the one move.
    await new Promise((r) => setTimeout(r, 30));
    expect(h.follow).toHaveLength(1);
  });

  it('makes no call when no save is in flight', async () => {
    const h = await mount();
    h.moved();
    await new Promise((r) => setTimeout(r, 30));
    expect(h.follow).toEqual([]);
  });
});
