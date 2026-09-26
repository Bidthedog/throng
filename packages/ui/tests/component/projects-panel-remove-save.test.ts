/**
 * 046 branch review C1/I2 — Remove carried the SAME two Save-All bugs Unload did
 * (`packages/ui/src/renderer/sidebar/projects-panel.tsx#confirmDelete`):
 *
 *  - C1: the result of `editor.saveAll` was never inspected at all (not even a truthy check) — a
 *    failed or skipped save still fell through into removing the project, dropping the unsaved text.
 *  - I2: the call used `scope: 'all'`, which saves every OTHER loaded project's dirty editors too —
 *    a side effect of removing just this one project.
 *
 * This file drives `confirmDelete` through the REAL `ProjectsPanel`, the REAL `ProjectsProvider`
 * store and the REAL `editor-state` dirty tracking — not a mock shaped like the fix.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
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
import { KeybindingsHandler } from '../../src/renderer/app.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';

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

function client(invoke: ReturnType<typeof vi.fn>): ProjectsClient {
  return new ProjectsClient({ invoke } as unknown as ThrongBridge);
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

interface FakeSaveAllResult {
  saved: string[];
  skippedUnpathed: string[];
  failed: { panelId: string; reason: string }[];
}

function Harness(): ReactElement {
  useProjects();
  return createElement(
    'div',
    null,
    createElement(KeybindingsHandler, {
      onToggleProjects: vi.fn(),
      onToggleExplorer: vi.fn(),
      onRevealLeft: vi.fn(),
      onRevealRight: vi.fn(),
    }),
    createElement(DirtyCloseDialog),
    createElement(ProjectsPanel),
  );
}

async function mount(invoke: ReturnType<typeof vi.fn>, saveAll: (params: unknown) => Promise<FakeSaveAllResult>): Promise<void> {
  const projectsClient = client(invoke);
  const services = fakeServices();
  Reflect.set(window, 'throng', {
    editor: { isOpen: () => Promise.resolve(false), saveAll },
    panel: { notifyTyped: () => {} },
  });
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
            createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, createElement(Harness))),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('project-item-p1')).toBeInTheDocument());
}

function makeInvoke(): ReturnType<typeof vi.fn> {
  return vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    switch (method) {
      case 'projects.list':
        return { projects: PROJECTS };
      case 'projects.categories.list':
        return { categories: CATEGORIES };
      case 'projects.delete':
        return { id: (params as { id: string }).id };
      default:
        throw new Error(`unexpected projects RPC: ${method}`);
    }
  });
}

beforeAll(() => {
  globalThis.ResizeObserver = ImmediateResizeObserver;
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
});
beforeEach(() => {
  setActivePane('workspace');
});
afterEach(() => {
  __resetDirtyCloseStore();
  for (const s of allEditorStates()) removeEditorState(s.panelId);
  Reflect.deleteProperty(window, 'throng');
});

describe('Remove carries the same Save-All guard Unload does (branch review C1/I2)', () => {
  it('a FAILED save stops the flow — the project is never removed, with one clear notice (C1)', async () => {
    setEditorState('e1', { dirty: true, ownerProjectId: 'p1' });
    const invoke = makeInvoke();
    const saveAll = vi.fn(() =>
      Promise.resolve<FakeSaveAllResult>({ saved: [], skippedUnpathed: [], failed: [{ panelId: 'e1', reason: 'io' }] }),
    );
    await mount(invoke, saveAll);

    fireEvent.click(screen.getByTestId('project-delete-p1'));
    await screen.findByTestId('dirty-close-dialog');
    await act(async () => {
      (await screen.findByTestId('dirty-close-save')).click();
    });

    await waitFor(() => expect(screen.getAllByTestId('project-error')[0]).toHaveTextContent(/nothing was removed/i));
    expect(screen.getByTestId('project-item-p1')).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith('projects.delete', expect.anything());
    // Never reaches the further "Remove Project" confirmation — the save guard stops it first.
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  // Coordinator follow-up — `reportFailure` routes through the store's `fail(message, action, …)`,
  // and `notice-text.ts#noticeHeading` renders `Couldn't ${action} ${subject}` as the notice's
  // HEADING (inside the same `project-error` element `toHaveTextContent` already reads). The store's
  // `reportFailure` used to hardcode `action: 'unload'` for every caller, Remove included — a failed
  // Remove would show "Couldn't unload {name}", naming the wrong operation.
  it('the notice names REMOVE, not unload, when Remove is what failed', async () => {
    setEditorState('e1', { dirty: true, ownerProjectId: 'p1' });
    const invoke = makeInvoke();
    const saveAll = vi.fn(() =>
      Promise.resolve<FakeSaveAllResult>({ saved: [], skippedUnpathed: [], failed: [{ panelId: 'e1', reason: 'io' }] }),
    );
    await mount(invoke, saveAll);

    fireEvent.click(screen.getByTestId('project-delete-p1'));
    await screen.findByTestId('dirty-close-dialog');
    await act(async () => {
      (await screen.findByTestId('dirty-close-save')).click();
    });

    const notice = await screen.findByTestId('project-error');
    await waitFor(() => expect(notice).toHaveTextContent(/couldn.?t remove/i));
    expect(notice).not.toHaveTextContent(/unload/i);
  });

  it('saves with scope "project", not "all" — removing one project never saves another (I2)', async () => {
    setEditorState('e1', { dirty: true, ownerProjectId: 'p1' });
    const invoke = makeInvoke();
    const saveAll = vi.fn(() => Promise.resolve<FakeSaveAllResult>({ saved: ['e1'], skippedUnpathed: [], failed: [] }));
    await mount(invoke, saveAll);

    fireEvent.click(screen.getByTestId('project-delete-p1'));
    await screen.findByTestId('dirty-close-dialog');
    await act(async () => {
      (await screen.findByTestId('dirty-close-save')).click();
    });

    await waitFor(() => expect(saveAll).toHaveBeenCalledWith({ scope: 'project', activeProjectId: 'p1' }));
  });
});
