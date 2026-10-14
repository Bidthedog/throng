/**
 * Focus Mode across projects (manual test change request, 2026-10-11, superseding the "a project switch
 * leaves nothing maximised behind" half of 054 FR-076's handling): a maximised panel survives switching to
 * another project and back, and does not survive that project being unloaded.
 *
 * Layer: component — the claim is about the window's workspace store and projects store together: which
 * layout is shown, which projects are loaded, and what the maximise store keeps across them. No panel is
 * mounted; the stack is the observable (what `TabGroup` draws from).
 */
import { act, render, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
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
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { __resetMaximise, getMaximiseStack, maximisePanel } from '../../src/renderer/workspace/maximise-store.js';

const LAYOUTS: Record<string, WorkspaceLayout> = {
  A: createDefaultLayout('A', { tab: 'tA', panel: 'pA' }),
  B: createDefaultLayout('B', { tab: 'tB', panel: 'pB' }),
};

const captured: { ws: ReturnType<typeof useWorkspace> | null; projects: ReturnType<typeof useProjects> | null } = {
  ws: null,
  projects: null,
};

function Shell(): ReactElement {
  const projects = useProjects();
  captured.projects = projects;
  return createElement(
    WorkspaceProvider,
    { client: services.workspace, activeProjectId: projects.activeProject?.id ?? null },
    createElement(NotificationProvider, null, createElement(Probe)),
  );
}

function Probe(): null {
  captured.ws = useWorkspace();
  return null;
}

const bridge: ThrongBridge = {
  invoke<T>(method: string, params?: unknown): Promise<T> {
    switch (method) {
      case 'workspace.load':
        return Promise.resolve({ layout: LAYOUTS[(params as { projectId: string }).projectId], restored: true } as T);
      case 'projects.list':
        return Promise.resolve({
          projects: [
            { id: 'A', name: 'Alpha', rootFolder: 'D:/a' },
            { id: 'B', name: 'Beta', rootFolder: 'D:/b' },
          ],
        } as T);
      case 'projects.setActive':
        return Promise.resolve({ ok: true } as T);
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

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
  Reflect.deleteProperty(window, 'throng');
  __resetMaximise();
});

async function mountInA(): Promise<void> {
  Reflect.set(window, 'throng', {
    config: { get: () => Promise.resolve({ settings: {} }), onChange: () => () => {} },
    panel: { notifyTyped: () => {} },
  });
  const view = render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        ServicesProvider,
        { services },
        createElement(ProjectsProvider, { client: services.projects }, createElement(Shell)),
      ),
    ),
  );
  unmount = () => view.unmount();
  await waitFor(() => expect(captured.projects?.projects.length).toBe(2));
  await switchTo('A');
}

async function switchTo(id: string): Promise<void> {
  await act(async () => {
    await captured.projects!.switchProject(id);
  });
  await waitFor(() => expect(captured.ws?.layout?.projectId).toBe(id));
}

const shapeOf = (tabId: string): string[] => getMaximiseStack(tabId).map((t) => `${t.kind}:${t.panelId}`);

describe('Focus Mode across a project switch', () => {
  it('a maximised panel is still maximised after switching to another project and back', async () => {
    await mountInA();
    act(() => maximisePanel('tA', 'pA'));
    await switchTo('B');
    expect(shapeOf('tA'), 'kept while project A is merely not shown').toEqual(['panel:pA']);
    await switchTo('A');
    expect(shapeOf('tA')).toEqual(['panel:pA']);
  });

  it('unloading the project restores it', async () => {
    await mountInA();
    act(() => maximisePanel('tA', 'pA'));
    await switchTo('B');
    act(() => captured.projects!.unloadProject('A'));
    await waitFor(() => expect(shapeOf('tA')).toEqual([]));
  });

  it('unloading the shown project restores it', async () => {
    await mountInA();
    act(() => maximisePanel('tA', 'pA'));
    act(() => captured.projects!.unloadProject('A'));
    await waitFor(() => expect(shapeOf('tA')).toEqual([]));
  });

  it('closing the maximised tab in its own project still restores it', async () => {
    await mountInA();
    act(() => maximisePanel('tA', 'pA'));
    act(() => {
      captured.ws!.addTab();
    });
    await waitFor(() => expect(captured.ws!.layout!.tabs).toHaveLength(2));
    act(() => {
      captured.ws!.closeTab('tA');
    });
    await waitFor(() => expect(shapeOf('tA')).toEqual([]));
  });
});
