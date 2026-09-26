/**
 * 046 iterate round 1 (FR-083, T134) — dragging a category HEADER to reorder the categories
 * themselves, over the REAL `ProjectsPanel` (`packages/ui/src/renderer/sidebar/projects-panel.tsx`)
 * and its real `@dnd-kit` `DndContext`/`PointerSensor`, the same technique
 * `projects-panel-drag-categories.test.ts`'s `dragGripTo` uses.
 *
 * Covers FR-083 ("Users MUST be able to reorder every category except the default … by dragging a
 * non-default category's header … The default category's header is not draggable, and no drop may
 * place a category above it … A drag on a header never moves a project, and a project drag never
 * moves a category.").
 *
 * WHAT IS RED, AND WHY: `projects-panel.tsx` wires no `useDraggable` on a category header at all
 * today — `projects-panel-drag-categories.test.ts`'s own "headers are not draggable" test pins that
 * absence for the PRE-round-1 contract. A pointer sequence started on a header therefore never
 * produces a dnd-kit drag and never calls the new `projects.categories.reorder` RPC
 * (contracts/project-categories.md §5) — every "moves" assertion below times out against today's
 * code. `category-header-*` test ids and the `.project-item`/`.category-header` row layout are
 * unchanged (T076/T078, already GREEN); this file adds nothing to `@throng/core`.
 */
import { fireEvent, screen, render, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
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
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';
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
const DEFAULT_ID = 'default';

function makeCategory(id: string, name: string, opts: Partial<ProjectCategoryDto> = {}): ProjectCategoryDto {
  return { id, name, isDefault: id === DEFAULT_ID, minimised: false, createdAt: now, updatedAt: now, ...opts };
}
function makeProject(id: string, categoryId: string, opts: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id, name: id, colour: '#3b82f6', rootFolder: `C:/projects/${id}`, isActive: false,
    createdAt: now, updatedAt: now, hiddenPaths: [], categoryId, ...opts,
  };
}

function makeServer(projects: ProjectDto[], categories: ProjectCategoryDto[]) {
  const state = { projects: [...projects], categories: [...categories] };
  const invoke = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    switch (method) {
      case 'projects.list':
        return { projects: state.projects };
      case 'projects.categories.list':
        return { categories: state.categories };
      case 'projects.reorder': {
        const { orderedIds } = params as { orderedIds: string[] };
        state.projects = orderedIds
          .map((id) => state.projects.find((p) => p.id === id))
          .filter((p): p is ProjectDto => !!p);
        return { orderedIds };
      }
      case 'projects.move': {
        const { id, categoryId, orderedIds } = params as {
          id: string; categoryId: string; orderedIds: string[];
        };
        state.projects = orderedIds
          .map((pid) => state.projects.find((p) => p.id === pid))
          .filter((p): p is ProjectDto => !!p)
          .map((p) => (p.id === id ? { ...p, categoryId } : p));
        return { orderedIds };
      }
      // contracts/project-categories.md §5 — additive, not yet called by any production code
      // (T138 GREEN). `orderedIds` names the NON-default categories in their new order.
      case 'projects.categories.reorder': {
        const { orderedIds } = params as { orderedIds: string[] };
        const def = state.categories.filter((c) => c.isDefault);
        const rest = orderedIds
          .map((id) => state.categories.find((c) => c.id === id))
          .filter((c): c is ProjectCategoryDto => !!c);
        state.categories = [...def, ...rest];
        return { categories: state.categories };
      }
      // Fix-round regression (the collapse chevron's pointerdown reaching the header's own
      // dnd-kit drag listeners) — needed so this file's new describe block below can assert a
      // plain click on the chevron still toggles.
      case 'projects.categories.setMinimised': {
        const { id, minimised } = params as { id: string; minimised: boolean };
        state.categories = state.categories.map((c) => (c.id === id ? { ...c, minimised } : c));
        return { category: state.categories.find((c) => c.id === id) };
      }
      default:
        throw new Error(`unexpected projects RPC: ${method}`);
    }
  });
  return { state, invoke, bridge: { invoke } as unknown as ThrongBridge };
}

function fakeServices(bridge: ThrongBridge): Services {
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

function Harness(): ReactElement {
  return createElement('div', null, createElement(DirtyCloseDialog), createElement(ProjectsPanel));
}

async function mount(server: ReturnType<typeof makeServer>): Promise<void> {
  const projectsClient = new ProjectsClient(server.bridge);
  const services = fakeServices(server.bridge);
  Reflect.set(window, 'throng', { editor: { isOpen: () => Promise.resolve(false) }, panel: { notifyTyped: () => {} } });
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

const ROW_HEIGHT = 40;

/** Same deterministic row layout `projects-panel-drag-categories.test.ts` uses, so
 *  `trackReorder`/the drop-target resolution (whatever T138 ends up naming it for a header) sees
 *  real, ordered rects rather than jsdom's default `0,0,0,0`. */
function layoutRows(): HTMLElement[] {
  const list = screen.getByTestId('project-list');
  Object.defineProperty(list, 'getBoundingClientRect', {
    configurable: true,
    value: () => rectAt(0, 10_000),
  });
  const rows = Array.from(list.querySelectorAll<HTMLElement>('.project-item, .category-header'));
  rows.forEach((row, i) => {
    const top = i * ROW_HEIGHT;
    Object.defineProperty(row, 'getBoundingClientRect', { configurable: true, value: () => rectAt(top, top + ROW_HEIGHT) });
  });
  return rows;
}
function rectAt(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

/** A real dnd-kit pointer drag started from an arbitrary element — a category header here, not the
 *  project grip `dragGripTo` (the other file) drives. */
async function dragElementTo(el: Element, targetY: number): Promise<void> {
  fireEvent.pointerDown(el, { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 20 }); // > 4px activation
  fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: targetY });
  fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: targetY });
}

function fourCategoryFixture() {
  return makeServer(
    [
      makeProject('p1', DEFAULT_ID),
      makeProject('p2', 'cat-a'),
      makeProject('p3', 'cat-b'),
      makeProject('p4', 'cat-c'),
    ],
    [
      makeCategory(DEFAULT_ID, 'In Progress'),
      makeCategory('cat-a', 'Side Quests'),
      makeCategory('cat-b', 'Someday'),
      makeCategory('cat-c', 'Archived'),
    ],
  );
  // Row order once mounted (none active, so nothing pins a hidden row visible):
  //  0 category-header-default   1 project-item-p1
  //  2 category-header-cat-a     3 project-item-p2
  //  4 category-header-cat-b     5 project-item-p3
  //  6 category-header-cat-c     7 project-item-p4
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
  Reflect.deleteProperty(window, 'throng');
});

describe('dragging a non-default category header reorders the categories (FR-083)', () => {
  it('dragging cat-c above cat-a calls projects.categories.reorder with cat-c ahead of cat-a, and moves no project', async () => {
    const server = fourCategoryFixture();
    await mount(server);
    layoutRows();

    // Drag category-header-cat-c (row 6, top 240..280) up into category-header-cat-a's rect
    // (row 2, top 80..120) — y=90.
    await dragElementTo(screen.getByTestId('category-header-cat-c'), 90);

    await waitFor(
      () => expect(server.invoke).toHaveBeenCalledWith('projects.categories.reorder', expect.anything()),
      { timeout: 300 },
    );
    const call = server.invoke.mock.calls.find(([m]) => m === 'projects.categories.reorder')!;
    const { orderedIds } = call[1] as { orderedIds: string[] };
    expect(orderedIds).not.toContain(DEFAULT_ID);
    expect(orderedIds.indexOf('cat-c')).toBeLessThan(orderedIds.indexOf('cat-a'));

    expect(server.invoke).not.toHaveBeenCalledWith('projects.reorder', expect.anything());
    expect(server.invoke).not.toHaveBeenCalledWith('projects.move', expect.anything());
  });

  it('the default header is not draggable: a pointer sequence on it moves nothing', async () => {
    const server = fourCategoryFixture();
    await mount(server);
    layoutRows();

    await dragElementTo(screen.getByTestId('category-header-default'), 220);

    expect(server.invoke).not.toHaveBeenCalledWith('projects.categories.reorder', expect.anything());
    expect(server.invoke).not.toHaveBeenCalledWith('projects.reorder', expect.anything());
    expect(server.invoke).not.toHaveBeenCalledWith('projects.move', expect.anything());
  });

  it('no drop lands above the default header — the default stays first even after dragging the first non-default category upward onto it', async () => {
    const server = fourCategoryFixture();
    await mount(server);
    layoutRows();

    // Drag category-header-cat-a (row 2, top 80..120) up onto category-header-default's own rect
    // (row 0, top 0..40) — y=10.
    await dragElementTo(screen.getByTestId('category-header-cat-a'), 10);

    // Whether or not a reorder RPC ever fires for this drop, the default id can never appear in
    // orderedIds (contracts/project-categories.md §5), and the header actually rendered first in
    // the DOM is still the default one.
    for (const call of server.invoke.mock.calls) {
      if (call[0] === 'projects.categories.reorder') {
        const { orderedIds } = call[1] as { orderedIds: string[] };
        expect(orderedIds).not.toContain(DEFAULT_ID);
      }
    }
    const headers = screen.getAllByTestId(/^category-header-/);
    expect(headers[0]).toHaveAttribute('data-testid', 'category-header-default');
  });

  it('dragging a project by its grip never calls projects.categories.reorder', async () => {
    const server = fourCategoryFixture();
    await mount(server);
    layoutRows();

    const grip = screen.getByTestId('project-grip-p2');
    fireEvent.pointerDown(grip, { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 20 });
    await waitFor(() => expect(document.querySelector('.project-item--dragging')).not.toBeNull());
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 250 });
    fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 250 });

    expect(server.invoke).not.toHaveBeenCalledWith('projects.categories.reorder', expect.anything());
  });
});

/**
 * Fix-round regression (controller finding, "IMPORTANT") — the collapse chevron
 * (`category-toggle-<id>`) stops CLICK propagation (`projects-panel.tsx`) but never POINTERDOWN, and
 * a non-default header's `useDraggable` listeners (T138) now live on the header itself. A press on
 * the chevron that moves ≥4px before release therefore starts a header drag, swallowing the
 * collapse gesture the chevron exists for. A plain click (no intervening move) must still toggle.
 */
describe('the collapse chevron refuses to start a header drag (FR-051, fix-round regression)', () => {
  it('pointerDown + move ≥4px + pointerUp on category-toggle-cat-a does not reorder categories, and leaves the category expanded', async () => {
    const server = fourCategoryFixture();
    await mount(server);
    layoutRows();

    const toggle = screen.getByTestId('category-toggle-cat-a');
    fireEvent.pointerDown(toggle, { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 90 });
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 220 });
    fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 220 });

    expect(server.invoke).not.toHaveBeenCalledWith('projects.categories.reorder', expect.anything());
    expect(server.invoke).not.toHaveBeenCalledWith('projects.categories.setMinimised', expect.anything());
    expect(screen.getByTestId('category-header-cat-a')).toHaveAttribute('aria-expanded', 'true');
  });

  it('a plain click on the chevron still toggles the category', async () => {
    const server = fourCategoryFixture();
    await mount(server);

    fireEvent.click(screen.getByTestId('category-toggle-cat-a'));

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith(
        'projects.categories.setMinimised',
        expect.objectContaining({ id: 'cat-a', minimised: true }),
      ),
    );
  });
});
