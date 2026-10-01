/**
 * A window's workspace as a window mounts it: the real `TabGroup` (strip + the active tab's panels +
 * the one `DndContext`) inside the real menu host, over a layout the test writes (048).
 *
 * The 048 component tests about splitting, outer-edge drops and cancelled drags all need exactly this
 * and each had pasted it; this is the one copy for the new ones. `ws()` is the CURRENT store (never a
 * snapshot held across a mutation).
 */
import { render } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { vi } from 'vitest';
import { createDefaultLayout, DEFAULT_APP_SETTINGS, type WorkspaceLayout } from '@throng/core';
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
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { TabGroup } from '../../../src/renderer/workspace/tab-group.js';

export type TabGroupWs = ReturnType<typeof useWorkspace>;

export interface MountedTabGroup {
  /** The CURRENT store. */
  ws(): TabGroupWs;
  /** Every `workspace.save` the store sent. */
  saves: ReturnType<typeof vi.fn>;
  /** The dragGhost bridge spies, for a test about the OS drag ghost. */
  ghost: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; hint: ReturnType<typeof vi.fn>; move: ReturnType<typeof vi.fn> };
  unmount(): void;
}

export function mountTabGroup(layout?: WorkspaceLayout, opts: { projectId?: string } = {}): MountedTabGroup {
  const projectId = opts.projectId ?? layout?.projectId ?? 'proj-tab-group';
  const initial = layout ?? createDefaultLayout(projectId, { tab: 't1', panel: 'p1' });
  const saves = vi.fn();
  const ghost = { start: vi.fn(), stop: vi.fn(), hint: vi.fn(), move: vi.fn() };
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    config: { get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS }), onChange: () => () => {} },
    dragGhost: ghost,
  });
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load':
          return Promise.resolve({ layout: initial, restored: true } as T);
        case 'workspace.save':
          saves(params);
          return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list':
          return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list':
          return Promise.resolve({ projects: [] } as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: [] } as T);
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
  const captured: { ws: TabGroupWs | null } = { ws: null };
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
            { client: services.workspace, activeProjectId: projectId },
            createElement(
              NotificationProvider,
              null,
              createElement(
                ConfirmProvider,
                null,
                createElement(
                  ContextMenuProvider,
                  null,
                  createElement(Fragment, null, createElement(TabGroup, null), createElement(Probe, null)),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  return {
    ws: () => captured.ws as TabGroupWs,
    saves,
    ghost,
    unmount: () => {
      view.unmount();
      Reflect.deleteProperty(window, 'throng');
    },
  };
}
