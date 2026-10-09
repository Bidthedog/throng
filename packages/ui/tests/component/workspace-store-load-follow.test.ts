/**
 * 052 T025 (FR-005, research R4) — `throng:files:moved` arriving while a project LOAD is in flight.
 *
 * A project switched to in the same instant as a move reads its layout from the daemon before the move reached it,
 * and `MovedPathSync` has no layout to patch yet — so the moved path would be lost. The store remembers the moves it
 * hears while a load is pending, applies them to the layout that load returns, and marks it for save.
 */
import { act, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPanels, createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
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

const PROJECT = 'proj-a';
const OLD = 'D:/proj/a.md';
const NEW = 'D:/proj/renamed.md';

type Ws = ReturnType<typeof useWorkspace>;
let unmount: (() => void) | undefined;

function layoutWithEditor(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p0' });
  const ed: Panel = { type: 'panel', id: 'ed', originProjectId: PROJECT, title: 'Ed', kind: 'editor', config: { filePath: OLD } };
  l.tabs.push({ id: 't2', title: 'Tab 2', root: ed, activePanelId: 'ed' });
  return l;
}

function mount() {
  const saves = vi.fn();
  const captured: { ws: Ws | null } = { ws: null };
  let releaseLoad: (() => void) | undefined;
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load':
          // The daemon read happened BEFORE the move reached it: the layout still names the old path.
          return new Promise<T>((resolve) => {
            releaseLoad = () => resolve({ layout: layoutWithEditor(), restored: true } as T);
          });
        case 'workspace.save':
          saves(params);
          return Promise.resolve({ ok: true } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [{ id: PROJECT, name: 'Proj', rootFolder: 'D:/proj' }] } as T);
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
  return {
    saves,
    ws: () => captured.ws as Ws,
    release: () => act(async () => releaseLoad?.()),
    moved: (moves = [{ from: OLD, to: NEW }]) => act(() => listeners.forEach((l) => l({ moves }))),
    pathOf: () =>
      (captured.ws?.layout?.tabs.flatMap((t) => collectPanels(t.root) as Panel[]).find((p) => p.id === 'ed')?.config as
        | { filePath?: string }
        | undefined)?.filePath,
  };
}

afterEach(() => unmount?.());

describe('a move heard while a project load is pending (052 T025)', () => {
  it('is applied to the loaded layout, and the next save carries it', async () => {
    const h = mount();
    await waitFor(() => expect(h.ws()).toBeTruthy());
    h.moved();
    await h.release();
    await waitFor(() => expect(h.ws().layout).toBeTruthy());

    expect(h.pathOf()).toBe(NEW);
    await waitFor(() => {
      const last = h.saves.mock.calls.at(-1)?.[0] as { layout: WorkspaceLayout } | undefined;
      const saved = last?.layout.tabs.flatMap((t) => collectPanels(t.root) as Panel[]).find((p) => p.id === 'ed');
      expect((saved?.config as { filePath?: string } | undefined)?.filePath).toBe(NEW);
    });
  });

  it('leaves a layout alone when the move touches none of it, and saves nothing', async () => {
    const h = mount();
    await waitFor(() => expect(h.ws()).toBeTruthy());
    h.moved([{ from: 'D:/proj/else.md', to: 'D:/proj/else2.md' }]);
    await h.release();
    await waitFor(() => expect(h.ws().layout).toBeTruthy());

    expect(h.pathOf()).toBe(OLD);
    await new Promise((r) => setTimeout(r, 450));
    expect(h.saves).not.toHaveBeenCalled();
  });

  it('a move heard AFTER the load has landed is left to MovedPathSync (not applied twice)', async () => {
    const h = mount();
    await waitFor(() => expect(h.ws()).toBeTruthy());
    await h.release();
    await waitFor(() => expect(h.ws().layout).toBeTruthy());
    h.moved();
    // No MovedPathSync is mounted here, so nothing rewrites it: the store alone does not.
    expect(h.pathOf()).toBe(OLD);
  });
});
