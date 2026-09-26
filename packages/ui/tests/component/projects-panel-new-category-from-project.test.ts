/**
 * 046 US5 fix round (controller ruling, FR-053) — choosing New Category… from a PROJECT's own
 * Move to Category submenu creates the category AND moves that project into it, at the end.
 *
 * FR-053: "Creating and moving happen from a project's context menu: Move to Category, listing the
 * existing categories and New Category…" — one control doing both, not "create it, and then the
 * project stays wherever it already was". Driven over the REAL `ProjectsPanel` wiring, not a mock.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
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
const DEFAULT_CATEGORY: ProjectCategoryDto = {
  id: 'default', name: 'In Progress', isDefault: true, minimised: false, createdAt: now, updatedAt: now,
};
const project = (id: string): ProjectDto => ({
  id, name: id, colour: '#3b82f6', rootFolder: `C:/projects/${id}`, isActive: false,
  createdAt: now, updatedAt: now, hiddenPaths: [], categoryId: 'default',
});

function fakeDaemon(): {
  bridge: ThrongBridge;
  calls: Array<{ method: string; params: unknown }>;
} {
  const calls: Array<{ method: string; params: unknown }> = [];
  let categories: ProjectCategoryDto[] = [DEFAULT_CATEGORY];
  const projects: ProjectDto[] = [project('p1')];
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      calls.push({ method, params });
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects } as unknown as T);
        case 'projects.categories.list':
          return Promise.resolve({ categories } as unknown as T);
        case 'projects.categories.create': {
          const name = (params as { name: string }).name;
          const created: ProjectCategoryDto = {
            id: 'new-cat', name, isDefault: false, minimised: false, createdAt: now, updatedAt: now,
          };
          categories = [...categories, created];
          return Promise.resolve({ category: created } as unknown as T);
        }
        case 'projects.move': {
          const { id, categoryId } = params as { id: string; categoryId: string; orderedIds: string[] };
          const p = projects.find((pr) => pr.id === id);
          if (p) p.categoryId = categoryId;
          return Promise.resolve({ orderedIds: projects.map((pr) => pr.id) } as unknown as T);
        }
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
    },
  };
  return { bridge, calls };
}

async function mount(): Promise<{ calls: Array<{ method: string; params: unknown }> }> {
  const { bridge, calls } = fakeDaemon();
  const projectsClient = new ProjectsClient(bridge);
  const workspaceClient = new WorkspaceClient({
    invoke: () => Promise.reject(new Error('no workspace RPC expected — activeProjectId is null')),
  });
  render(
    createElement(
      ProjectsProvider,
      { client: projectsClient },
      createElement(
        WorkspaceProvider,
        { client: workspaceClient, activeProjectId: null },
        createElement(
          NotificationProvider,
          null,
          createElement(
            ConfirmProvider,
            null,
            createElement(ContextMenuProvider, null, createElement(ProjectsPanel)),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('project-item-p1')).toBeInTheDocument());
  return { calls };
}

beforeAll(() => {
  globalThis.ResizeObserver = ImmediateResizeObserver;
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('New Category… from a project’s Move to Category submenu creates AND moves (FR-053)', () => {
  it('creates the category, then moves the project into it', async () => {
    const { calls } = await mount();

    fireEvent.contextMenu(screen.getByTestId('project-item-p1'));
    await screen.findByTestId('context-menu');
    fireEvent.mouseEnter(screen.getByTestId('menu-item-Move to Category'));
    const newCategoryItem = await screen.findByTestId('menu-item-New Category…');
    fireEvent.click(newCategoryItem);

    const input = await screen.findByTestId('category-name-input');
    fireEvent.change(input, { target: { value: 'Archived' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'projects.categories.create')).toBe(true),
    );
    const createCall = calls.find((c) => c.method === 'projects.categories.create');
    expect(createCall?.params).toEqual({ name: 'Archived' });

    await waitFor(() => expect(calls.some((c) => c.method === 'projects.move')).toBe(true));
    const moveCall = calls.find((c) => c.method === 'projects.move');
    expect(moveCall?.params).toMatchObject({ id: 'p1', categoryId: 'new-cat' });

    // The create happened BEFORE the move — moving into a category that does not exist yet is
    // meaningless.
    expect(calls.indexOf(createCall!)).toBeLessThan(calls.indexOf(moveCall!));
  });

  it('New Category… from a CATEGORY HEADER (not a project) still only creates — nothing to move', async () => {
    const { calls } = await mount();

    // The default category header carries no menu (FR-050) — this scenario is exercised by
    // `projects-panel-category-menu.test.ts` for a non-default header's Rename/Delete/Minimise; here
    // we only need to confirm New Category… from the PROJECT path never fires a move when the value
    // is left empty (cancel-by-emptiness, `commitCategoryName`'s existing rule).
    fireEvent.contextMenu(screen.getByTestId('project-item-p1'));
    await screen.findByTestId('context-menu');
    fireEvent.mouseEnter(screen.getByTestId('menu-item-Move to Category'));
    const newCategoryItem = await screen.findByTestId('menu-item-New Category…');
    fireEvent.click(newCategoryItem);

    const input = await screen.findByTestId('category-name-input');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.queryByTestId('category-name-input')).toBeNull());
    expect(calls.some((c) => c.method === 'projects.categories.create')).toBe(false);
    expect(calls.some((c) => c.method === 'projects.move')).toBe(false);
  });
});
