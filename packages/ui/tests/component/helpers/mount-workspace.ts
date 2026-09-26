/**
 * A window's workspace store over a layout the test writes, with no panel components mounted (044 US7).
 *
 * The history mirrors, the path mirror, the consolidated open flow and the navigate command are all
 * decisions over the LAYOUT and a few module registries. None of them needs a panel on screen, and
 * several of them are specifically about panels that are NOT on screen (a preview in a background tab),
 * so mounting nothing is the honest arrangement rather than a shortcut.
 *
 * `extras` are window-level components mounted inside every provider — a sync component, a key handler.
 */
import { render, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { expect, vi } from 'vitest';
import type { WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../../src/renderer/state/projects-store.js';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';

export type Ws = ReturnType<typeof useWorkspace>;

export interface MountedWorkspace {
  /** The CURRENT store — re-read on every call, never a snapshot held across a mutation. */
  ws(): Ws;
  /** Every `workspace.save` the store scheduled. */
  saves: ReturnType<typeof vi.fn>;
  unmount(): void;
}

export async function mountWorkspace(
  layout: WorkspaceLayout,
  opts: { extras?: ReactElement[]; throng?: Record<string, unknown>; projectRoot?: string } = {},
): Promise<MountedWorkspace> {
  const captured: { ws: Ws | null } = { ws: null };
  const saves = vi.fn();
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save':
          saves(params);
          return Promise.resolve({ ok: true } as T);
        case 'projects.list':
          return Promise.resolve({
            projects: [{ id: layout.projectId, name: 'Proj', rootFolder: opts.projectRoot ?? 'D:/proj' }],
          } as T);
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
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
  Reflect.set(window, 'throng', {
    config: { get: () => Promise.resolve({ settings: {} }), onChange: () => () => {} },
    panel: { notifyTyped: () => {} },
    ...opts.throng,
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
            { client: services.workspace, activeProjectId: layout.projectId },
            createElement(NotificationProvider, null, createElement(Probe), ...(opts.extras ?? [])),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(captured.ws?.layout).toBeTruthy());
  return {
    ws: () => captured.ws as Ws,
    saves,
    unmount: () => {
      view.unmount();
      Reflect.deleteProperty(window, 'throng');
    },
  };
}
