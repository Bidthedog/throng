/**
 * 046 US4 fix round (review-US4-B.md #1, #2) — Unload disposes a NON-active loaded project's
 * editors, through the REAL `disposeEditor` teardown, driven over the REAL `ProjectsPanel` wiring
 * (`packages/ui/src/renderer/sidebar/projects-panel.tsx`), not `unload-project.ts`'s injected mocks.
 *
 * ══ #1 — editorPanelIds must not come from `ws.layout` ══
 *
 * `ws.layout` only ever holds the ACTIVE project's layout (the main Workspace Pane never mixes
 * projects). Unloading a project that is LOADED but NOT ACTIVE — US4's own Independent Test — used
 * to compute an empty `editorPanelIds` for it, so its dirty editor's state was never disposed and its
 * "Unsaved changes" dot never cleared. The fix reads `allEditorStates()` filtered on
 * `ownerProjectId`, which `editor-state.ts`'s store keeps for exactly this reason (`dirtyProjectKey`
 * reads the same field) — an editor's state SURVIVES its panel unmounting when the project you switch
 * away from goes into the background; only an explicit destroy (`disposeEditor`) removes it.
 *
 * ══ #2 — the wired `disposeEditor` must be the REAL one ══
 *
 * `editor/use-editor.ts`'s `disposeEditor` does the full teardown (state, actions, language, view
 * state, search, caret, links, metrics) AND calls `window.throng.editor.destroy(panelId)`, which is
 * `EditorCoordinator.destroy` in main — stopping the file watcher, unregistering the panel and
 * removing its recovery temp entry. Wiring `removeEditorState` (a bare `Map.delete`) skipped all of
 * that: every Unload leaked a watcher + registry + recovery entry per editor. This spies
 * `window.throng.editor.destroy` to prove the REAL teardown ran, not merely that some function calling
 * itself "disposeEditor" was invoked.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects, type ProjectsContextValue } from '../../src/renderer/state/projects-store.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { DirtyCloseDialog } from '../../src/renderer/editor/dirty-close-dialog.js';
import { __resetDirtyCloseStore } from '../../src/renderer/editor/dirty-close-store.js';
import { allEditorStates, removeEditorState, setEditorState } from '../../src/renderer/editor/editor-state.js';
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';

class ImmediateResizeObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    const contentRect = {
      width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0,
      toJSON: () => ({}),
    } satisfies DOMRectReadOnly;
    this.cb([{ target, contentRect } as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

const now = '2026-01-01T00:00:00.000Z';
const CATEGORIES: ProjectCategoryDto[] = [
  { id: 'default', name: 'In Progress', isDefault: true, minimised: false, createdAt: now, updatedAt: now },
];
const project = (id: string): ProjectDto => ({
  id, name: id, colour: '#3b82f6', rootFolder: `C:/projects/${id}`, isActive: false,
  createdAt: now, updatedAt: now, hiddenPaths: [], categoryId: 'default',
});
const PROJECTS: ProjectDto[] = [project('p1'), project('p2')];

function client(): ProjectsClient {
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: PROJECTS } as unknown as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories: CATEGORIES } as unknown as T);
        case 'projects.setActive':
          return Promise.resolve({ activeId: (params as { id: string }).id } as unknown as T);
        default:
          return Promise.reject(new Error(`unexpected projects RPC: ${method}`));
      }
    },
  };
  return new ProjectsClient(bridge);
}

function fakeServices(): Services {
  const bridge: ThrongBridge = { invoke: () => Promise.reject(new Error('unexpected RPC')) };
  return {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
}

function Probe({ onReady }: { onReady: (ctx: ProjectsContextValue) => void }): null {
  onReady(useProjects());
  return null;
}

async function mount(destroy: (panelId: string) => void): Promise<() => ProjectsContextValue> {
  const projectsClient = client();
  const services = fakeServices();
  Reflect.set(window, 'throng', {
    editor: { saveAll: () => Promise.resolve(true), destroy },
    terminal: {
      list: () => Promise.resolve({ sessions: [] }),
      closeIdle: () => Promise.resolve({ closed: 0 }),
      killAll: () => Promise.resolve({ killed: 0 }),
    },
  });
  const captured: { ctx: ProjectsContextValue | null } = { ctx: null };
  render(
    createElement(
      ServicesProvider,
      { services },
      createElement(
        ProjectsProvider,
        { client: projectsClient },
        createElement(
          WorkspaceProvider,
          { client: services.workspace, activeProjectId: null },
          createElement(
            NotificationProvider,
            null,
            createElement(
              ConfirmProvider,
              null,
              createElement(
                ContextMenuProvider,
                null,
                createElement(
                  'div',
                  null,
                  createElement(Probe, { onReady: (ctx) => { captured.ctx = ctx; } }),
                  createElement(DirtyCloseDialog),
                  createElement(ProjectsPanel),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('project-item-p1')).toBeInTheDocument());
  return () => captured.ctx as ProjectsContextValue;
}

beforeAll(() => {
  globalThis.ResizeObserver = ImmediateResizeObserver;
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
});
beforeEach(() => {
  // no-op; kept symmetrical with projects-panel-menu.test.ts
});
afterEach(() => {
  __resetDirtyCloseStore();
  Reflect.deleteProperty(window, 'throng');
  for (const s of allEditorStates()) removeEditorState(s.panelId);
});

describe('Unload disposes a NON-ACTIVE loaded project’s editors, through the REAL disposeEditor (review #1, #2)', () => {
  it('p1 active, p2 loaded-but-inactive with a dirty editor: Discard → Unload disposes it via window.throng.editor.destroy', async () => {
    const destroy = vi.fn();
    const ctx = await mount(destroy);

    // p1 active, p2 loaded-but-inactive (the exact scenario US4's Independent Test and review #1 name).
    await act(async () => {
      await ctx().switchProject('p1');
    });
    await waitFor(() => expect(ctx().activeProject?.id).toBe('p1'));
    await act(async () => {
      await ctx().switchProject('p2');
    });
    await waitFor(() => expect(ctx().activeProject?.id).toBe('p2'));
    await act(async () => {
      await ctx().switchProject('p1');
    });
    await waitFor(() => expect(ctx().activeProject?.id).toBe('p1'));
    expect(ctx().loadedIds.has('p2')).toBe(true);

    // p2's editor goes dirty while p2 is in the background — exactly what the unsaved dot means.
    act(() => {
      setEditorState('editor-b', {
        filePath: 'C:/projects/p2/a.ts',
        dirty: true,
        ownerProjectId: 'p2',
        ownerKind: 'project',
        displayName: 'a.ts',
      });
    });
    await waitFor(() => expect(screen.getByTestId('project-unsaved-p2')).toBeInTheDocument());

    // Right-click p2 → Unload Project (keepRunning, the shipped preference; 046 FR-081) → the dirty
    // guard fires first → Discard.
    fireEvent.contextMenu(screen.getByTestId('project-item-p2'));
    await screen.findByTestId('context-menu');
    fireEvent.click(screen.getByTestId('menu-item-Unload Project'));
    await screen.findByTestId('dirty-close-dialog');
    await act(async () => {
      (await screen.findByTestId('dirty-close-discard')).click();
    });

    // The REAL teardown ran: window.throng.editor.destroy was called for editor-b …
    await waitFor(() => expect(destroy).toHaveBeenCalledWith('editor-b'));
    // … which is what actually clears the dot — not merely the store's own unloadProject(id).
    await waitFor(() => expect(screen.queryByTestId('project-unsaved-p2')).toBeNull());
    // p1 stayed active throughout — unloading a BACKGROUND project touches no other project.
    expect(ctx().activeProject?.id).toBe('p1');
  });
});
