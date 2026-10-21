/**
 * Navigating to a marked panel (057 US3, FR-034, FR-080, FR-080a; research R14).
 *
 * Main tells a window `throng:attention:focusPanel` for a toast link, an OS notification click or Go to
 * Next Marked Panel. This is the renderer half: switch project if the panel is in another, wait for that
 * project's layout, then bring the panel's tab forward and give it the keyboard.
 *
 * Layer: component — the REAL `ProjectsProvider` and `WorkspaceProvider`, so "wait for the layout" is
 * waiting for the real store; the daemon is a fake. Focus is observed through the panel-focus registry,
 * the one seam every panel type registers its input surface against (046 FR-125).
 *
 * ANTI-VACUITY CONTROL: skip the wait and focus right after `switchProject` and the other-project test
 * fails (the panel is not in the layout yet, so nothing is focused); make navigation un-minimise the
 * category and the FR-080a test fails.
 */
import { act, render, waitFor } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, type WorkspaceLayout } from '@throng/core';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { ProjectsProvider, useProjects, type ProjectsContextValue } from '../../src/renderer/state/projects-store.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { AttentionNavigation } from '../../src/renderer/attention/attention-navigation.js';
import { __resetPanelFocus, registerPanelFocus } from '../../src/renderer/workspace/panel-focus.js';

const NOW = '2026-01-01T00:00:00.000Z';
const project = (id: string, categoryId: string): ProjectDto => ({
  id, name: id, colour: '#3b82f6', rootFolder: `C:/c/${id}`, isActive: false,
  createdAt: NOW, updatedAt: NOW, hiddenPaths: [], categoryId,
});
const category = (id: string, minimised: boolean): ProjectCategoryDto => ({
  id, name: id, isDefault: id === 'default', minimised, createdAt: NOW, updatedAt: NOW,
});

const panelOf = (projectId: string): string => `pn-${projectId}`;

/** Two projects: `p1` in the default category, `p2` in a MINIMISED one. */
function makeBridge() {
  const projects = [project('p1', 'default'), project('p2', 'hidden')];
  const categories = [category('default', false), category('hidden', true)];
  const rpcs: string[] = [];
  const bridge = {
    invoke: vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
      rpcs.push(method);
      switch (method) {
        case 'projects.list': return { projects };
        case 'projects.categories.list': return { categories };
        case 'projects.setActive': return { activeId: (params as { id: string }).id };
        case 'workspace.load': {
          const { projectId } = params as { projectId: string };
          const layout: WorkspaceLayout = createDefaultLayout(projectId, { tab: `t-${projectId}`, panel: panelOf(projectId) });
          return { layout, restored: true };
        }
        case 'workspace.save': return { ok: true };
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list': return { subWorkspaces: [] };
        default: throw new Error(`unexpected RPC: ${method}`);
      }
    }),
  } as unknown as ThrongBridge;
  return { bridge, rpcs };
}

const seen: { projects: ProjectsContextValue | null; layout: WorkspaceLayout | null } = { projects: null, layout: null };

function Probe(): null {
  seen.projects = useProjects();
  seen.layout = useWorkspace().layout;
  return null;
}

function ActiveWorkspace({ children }: { children: ReactNode }): ReactElement {
  const { activeProject } = useProjects();
  return createElement(WorkspaceProvider, { client: workspaceClient, activeProjectId: activeProject?.id ?? null, children });
}

let workspaceClient: WorkspaceClient;
let focusPanelCb: (e: { panelId: string; projectId: string }) => void;

async function mount(rpcs = makeBridge()): Promise<ReturnType<typeof makeBridge>> {
  Reflect.set(window, 'throng', {
    editor: { subWorkspaceFiles: () => Promise.resolve([]) },
    projects: { onChanged: () => () => {}, notifyChanged: () => {} },
    panels: { publishIdentities: () => {} },
    panel: { notifyDestroyed: () => {} },
    attention: {
      onFocusPanel: (cb: typeof focusPanelCb) => {
        focusPanelCb = cb;
        return () => {};
      },
    },
  });
  workspaceClient = new WorkspaceClient(rpcs.bridge);
  render(
    createElement(ProjectsProvider, { client: new ProjectsClient(rpcs.bridge) },
      createElement(ActiveWorkspace, null,
        createElement(NotificationProvider, null, createElement(Probe), createElement(AttentionNavigation)))),
  );
  await waitFor(() => expect(seen.projects?.projects.length).toBe(2));
  // Open p1 first: the user is in p1 and the marked panel is elsewhere.
  await act(async () => {
    await seen.projects!.switchProject('p1');
  });
  await waitFor(() => expect(seen.layout?.projectId).toBe('p1'));
  return rpcs;
}

beforeEach(() => {
  __resetPanelFocus();
  seen.projects = null;
  seen.layout = null;
});
afterEach(() => {
  __resetPanelFocus();
  Reflect.deleteProperty(window, 'throng');
});

describe('a panel in the current layout (FR-034)', () => {
  it('takes the keyboard, and its tab is brought forward', async () => {
    await mount();
    const focus = vi.fn();
    registerPanelFocus(panelOf('p1'), focus);
    await act(async () => {
      focusPanelCb({ panelId: panelOf('p1'), projectId: 'p1' });
    });
    await waitFor(() => expect(focus).toHaveBeenCalled());
    expect(seen.layout?.activeTabId).toBe('t-p1');
  });
});

describe('a panel in another project (FR-034, FR-080a)', () => {
  it('switches project, waits for its layout, then focuses the panel', async () => {
    await mount();
    const focus = vi.fn();
    registerPanelFocus(panelOf('p2'), focus);
    await act(async () => {
      focusPanelCb({ panelId: panelOf('p2'), projectId: 'p2' });
    });
    await waitFor(() => expect(seen.layout?.projectId).toBe('p2'));
    await waitFor(() => expect(focus).toHaveBeenCalled());
    expect(seen.projects?.activeProject?.id).toBe('p2');
  });

  it('leaves a minimised category minimised — navigating is not expanding (FR-080a)', async () => {
    const rpcs = await mount();
    registerPanelFocus(panelOf('p2'), vi.fn());
    await act(async () => {
      focusPanelCb({ panelId: panelOf('p2'), projectId: 'p2' });
    });
    await waitFor(() => expect(seen.layout?.projectId).toBe('p2'));
    expect(rpcs.rpcs).not.toContain('projects.categories.setMinimised');
    expect(seen.projects?.categories.find((c) => c.id === 'hidden')?.minimised).toBe(true);
  });

  it('does nothing, and raises no notice, for a panel its project no longer holds', async () => {
    await mount();
    await act(async () => {
      focusPanelCb({ panelId: 'gone', projectId: 'p2' });
    });
    await waitFor(() => expect(seen.layout?.projectId).toBe('p2'));
    const focus = vi.fn();
    registerPanelFocus('gone', focus);
    expect(focus).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="notices"]')?.children.length ?? 0).toBe(0);
  });
});
