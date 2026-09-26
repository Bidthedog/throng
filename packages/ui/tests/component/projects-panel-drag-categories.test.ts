/**
 * 046 US5 (T078) — drag-to-reorder across category boundaries (contracts/project-categories.md §4,
 * S3), over the REAL `ProjectsPanel` (`packages/ui/src/renderer/sidebar/projects-panel.tsx`) and its
 * real `@dnd-kit` `DndContext`/`PointerSensor`.
 *
 * Covers FR-055 and the supersession S3 (002 FR-046 now reorders WITHIN a category; a cross-boundary
 * drop moves the project).
 *
 * WHAT IS RED, AND WHY: today's `trackReorder`/`onDragEnd` (`projects-panel.tsx:441-487`) query only
 * `.project-item` elements and always call `reorderProjects` over the FLAT `projects` array — exactly
 * the bug the US2 review flagged (review-US2.md's note for US5): with categories in play this counts
 * VISIBLE rows but splices into the full array, so a drop lands at the wrong global position, and it
 * never calls `moveProject` at all. Category headers carry no droppable and no drag source. This file
 * drives a REAL pointer drag (dnd-kit's `PointerSensor`, 4 px activation — the same technique
 * `panel-header-drag.test.ts` uses) and asserts on the RPC the drop should produce; it is red today
 * because `moveProject` is never called and a cross-category `reorderProjects` call lands the dragged
 * id at the wrong slot.
 *
 * PINNED SHAPE this file assumes: dragging remains via the existing `.project-item__grip`
 * (`ProjectGrip`, `useDraggable`) and marks the dragged row `project-item--dragging`
 * (`projects-panel.tsx:689`, unchanged by this feature) — this file relies on that class to know a
 * real dnd-kit drag has started. It does NOT assume a category header ever carries a grip: FR-055
 * ("Category headers are not draggable") is asserted by the ABSENCE of any grip inside a header row,
 * not by a particular internal selector T082 ends up using for the slot geometry.
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
      case 'projects.setActive':
        return { activeId: (params as { id: string }).id };
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

/**
 * Lays every header and project row out as a fixed-height vertical stack, in DOM order, so
 * `trackReorder`'s halfway-point slot test (`e.clientY < r.top + r.height / 2`) resolves
 * deterministically under jsdom, where every real rect is otherwise `0,0,0,0`.
 */
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

/** A real dnd-kit pointer drag: press the grip, cross the 4 px activation distance, move to the
 *  target Y, release — the same technique `panel-header-drag.test.ts` drives `onDragStart` with. */
async function dragGripTo(gripTestId: string, targetY: number): Promise<void> {
  const grip = screen.getByTestId(gripTestId);
  fireEvent.pointerDown(grip, { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 20 }); // > 4px → dnd-kit onDragStart
  await waitFor(() => expect(document.querySelector('.project-item--dragging')).not.toBeNull());
  fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: targetY });
  fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: targetY });
}

function threeCategoryFixture() {
  return makeServer(
    [
      makeProject('p1', DEFAULT_ID),
      makeProject('p2', 'cat-a'),
      makeProject('p3', 'cat-a'),
      makeProject('p4', 'cat-b'),
    ],
    [
      makeCategory(DEFAULT_ID, 'In Progress'),
      makeCategory('cat-a', 'Side Quests'),
      makeCategory('cat-b', 'Someday', { minimised: true }),
    ],
  );
  // Row order once mounted (none active, so cat-b's p4 is hidden):
  //  0 category-header-default   1 project-item-p1
  //  2 category-header-cat-a     3 project-item-p2   4 project-item-p3
  //  5 category-header-cat-b
}

/**
 * A MINIMISED category sitting BETWEEN two visible ones (`cat-hidden`, `createdAt` earlier than
 * `cat-a`'s so `inListOrder` places it second) — the exact shape review-US2.md's note for US5 names:
 * "wrong position with minimised/INTERLEAVED categories". `pH` never renders a row (minimised,
 * never active), so it is invisible to a slot count built only from `.project-item` rows, but it
 * still sits in the middle of the FLAT `projects` array `reorderProjects`/`moveProject` operate on.
 */
function interleavedFixture() {
  return makeServer(
    [makeProject('p1', DEFAULT_ID), makeProject('pH', 'cat-hidden'), makeProject('p2', 'cat-a'), makeProject('p3', 'cat-a')],
    [
      makeCategory(DEFAULT_ID, 'In Progress'),
      makeCategory('cat-hidden', 'Parked', { minimised: true, createdAt: '2025-01-01T00:00:00.000Z' }),
      makeCategory('cat-a', 'Side Quests', { createdAt: '2025-06-01T00:00:00.000Z' }),
    ],
  );
  // Row order once mounted (pH hidden — minimised, never active):
  //  0 category-header-default     1 project-item-p1
  //  2 category-header-cat-hidden
  //  3 category-header-cat-a       4 project-item-p2   5 project-item-p3
}

/**
 * `pStale`'s RAW `categoryId` names a category ('cat-ghost') that does not exist — `listRows`'s
 * heal rule (`healCategoryId`) lists it under the DEFAULT category instead, so it renders as an
 * ordinary member row there. review-US5.md Important: `onDragEnd` must read a neighbour's category
 * off the resolved ROW, not this raw field, or a drop beside `pStale` sends `moveProject` a category
 * id ('cat-ghost') nothing recognises.
 */
function staleFixture() {
  return makeServer(
    [makeProject('p1', DEFAULT_ID), makeProject('pStale', 'cat-ghost'), makeProject('p2', 'cat-a')],
    [makeCategory(DEFAULT_ID, 'In Progress'), makeCategory('cat-a', 'Side Quests')],
  );
  // Row order once mounted:
  //  0 category-header-default   1 project-item-p1   2 project-item-pStale (healed to default)
  //  3 category-header-cat-a     4 project-item-p2
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

describe('drag-to-reorder across category boundaries (FR-055, S3)', () => {
  it('a drop within the source category calls reorderProjects, and a minimised INTERLEAVED category does not move (review-US2.md, US5 note)', async () => {
    const server = interleavedFixture();
    await mount(server);
    layoutRows();

    // Drag p3 (row 5, top 200) to inside p2's rect (row 4, top 160..200, midpoint 180) — before p2.
    await dragGripTo('project-grip-p3', 165);

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith('projects.reorder', expect.anything()),
    );
    const call = server.invoke.mock.calls.find(([m]) => m === 'projects.reorder')!;
    const orderedIds = (call[1] as { orderedIds: string[] }).orderedIds;
    expect(orderedIds.indexOf('p3')).toBeLessThan(orderedIds.indexOf('p2'));
    // The bug review-US2.md flags for US5: a slot counted over VISIBLE `.project-item` rows only
    // (skipping the hidden `pH`) spliced into the FULL flat array shoves the interleaved, minimised
    // category's own member into the middle of `cat-a` — `pH` belongs to `cat-hidden`, which lists
    // BEFORE `cat-a`, so it must stay ahead of every `cat-a` member, `p3` included.
    expect(orderedIds.indexOf('pH')).toBeLessThan(orderedIds.indexOf('p3'));
    expect(server.invoke).not.toHaveBeenCalledWith('projects.move', expect.anything());
  });

  it('a drop between two projects of another category calls moveProject at that slot', async () => {
    const server = threeCategoryFixture();
    await mount(server);
    layoutRows();

    // Drag p1 (default, row 1) to between p2 (row 3, 120..160) and p3 (row 4, 160..200) — y=155.
    await dragGripTo('project-grip-p1', 155);

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith(
        'projects.move',
        expect.objectContaining({ id: 'p1', categoryId: 'cat-a' }),
      ),
    );
    const call = server.invoke.mock.calls.find(([m]) => m === 'projects.move')!;
    const { orderedIds } = call[1] as { orderedIds: string[] };
    expect(orderedIds.indexOf('p2')).toBeLessThan(orderedIds.indexOf('p1'));
    expect(orderedIds.indexOf('p1')).toBeLessThan(orderedIds.indexOf('p3'));
  });

  it('a drop on a minimised header calls moveProject at the end of that category', async () => {
    const server = threeCategoryFixture();
    await mount(server);
    layoutRows();

    // Drag p1 onto category-header-cat-b (row 5, 200..240) — its minimised header, holding p4.
    await dragGripTo('project-grip-p1', 220);

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith(
        'projects.move',
        expect.objectContaining({ id: 'p1', categoryId: 'cat-b' }),
      ),
    );
    const call = server.invoke.mock.calls.find(([m]) => m === 'projects.move')!;
    const { orderedIds } = call[1] as { orderedIds: string[] };
    // "at the end of that category" — after p4, cat-b's only other member.
    expect(orderedIds.indexOf('p4')).toBeLessThan(orderedIds.indexOf('p1'));
  });

  it("a drop in a category's LAST project row's lower half stays in THAT category, at its end — the next header does not steal it (review-US5.md CRITICAL)", async () => {
    const server = threeCategoryFixture();
    await mount(server);
    layoutRows();

    // Drag p1 (default) into p3's LOWER half — row 4, 160..200, midpoint 180 — y=190. Before the
    // fix, the header-cat-b zone below (200..240) claimed any y < 240 with no lower bound, so this
    // resolved to categoryEnd('cat-b') instead of "after p3, in cat-a".
    await dragGripTo('project-grip-p1', 190);

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith(
        'projects.move',
        expect.objectContaining({ id: 'p1', categoryId: 'cat-a' }),
      ),
    );
    const call = server.invoke.mock.calls.find(([m]) => m === 'projects.move')!;
    const { orderedIds } = call[1] as { orderedIds: string[] };
    expect(orderedIds.indexOf('p3')).toBeLessThan(orderedIds.indexOf('p1'));
  });

  it("a drop beside a project whose raw categoryId is stale reads the row-resolved (healed) category, not the raw one (review-US5.md Important)", async () => {
    const server = staleFixture();
    await mount(server);
    layoutRows();

    // Drag p2 (cat-a) to just BEFORE pStale — row 2, 80..120, midpoint 100 — y=90. pStale's raw
    // `categoryId` is 'cat-ghost'; its RESOLVED category (what it is actually listed under) is the
    // default category.
    await dragGripTo('project-grip-p2', 90);

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith(
        'projects.move',
        expect.objectContaining({ id: 'p2', categoryId: DEFAULT_ID }),
      ),
    );
  });

  it('headers are not draggable: no grip inside a header row, and dragging from one moves nothing', async () => {
    const server = threeCategoryFixture();
    await mount(server);
    layoutRows();

    const header = screen.getByTestId('category-header-cat-a');
    expect(header.querySelector('.project-item__grip')).toBeNull();

    fireEvent.pointerDown(header, { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 90 });
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 220 });
    fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 220 });

    expect(server.invoke).not.toHaveBeenCalledWith('projects.reorder', expect.anything());
    expect(server.invoke).not.toHaveBeenCalledWith('projects.move', expect.anything());
  });
});

/**
 * 046 iterate round 1 (FR-075, T131) — the drag listeners move from the grip (`ProjectGrip`,
 * `useDraggable`) to the WHOLE row: a press on the name, the colour swatch, or the row's own empty
 * space must start the same real dnd-kit drag the grip already starts, while Edit, Remove and an open
 * rename input must still refuse to. A press that never crosses the 4px activation distance stays a
 * click (switch project), and a double-click on the name still renames (002 FR-041) — both unchanged
 * by this FR.
 *
 * WHAT IS RED, AND WHY: `useDraggable`'s `listeners`/`attributes` are still spread only onto
 * `ProjectGrip`'s own `<span>` (`projects-panel.tsx:69-85`) — a sibling of the name/swatch/row, not
 * an ancestor of them — so a pointer sequence started on the name, the swatch, or the row itself
 * never reaches dnd-kit at all today: no `.project-item--dragging` class, no `projects.reorder` call.
 * The three "moves the project" cases below time out against today's code for exactly that reason.
 */
describe('whole-row project drag (FR-075)', () => {
  function twoProjectFixture() {
    return makeServer(
      [makeProject('p1', DEFAULT_ID), makeProject('p2', DEFAULT_ID)],
      [makeCategory(DEFAULT_ID, 'In Progress')],
    );
    // Row order once mounted: 0 category-header-default  1 project-item-p1  2 project-item-p2
  }

  /** A real dnd-kit pointer drag started from an ARBITRARY element — not necessarily the grip
   *  `dragGripTo` above drives — the same technique, generalised. */
  async function dragElementTo(el: Element, targetY: number): Promise<void> {
    fireEvent.pointerDown(el, { isPrimary: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 20 }); // > 4px activation
    fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: targetY });
    fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1, clientX: 10, clientY: targetY });
  }

  it('a drag starting on the name moves the project', async () => {
    const server = twoProjectFixture();
    await mount(server);
    layoutRows();
    const row = screen.getByTestId('project-item-p1');
    const name = row.querySelector<HTMLElement>('.project-item__name')!;

    await dragElementTo(name, 110); // into p2's lower half (row 2, top 80..120) — after p2

    await waitFor(
      () => expect(server.invoke).toHaveBeenCalledWith('projects.reorder', expect.anything()),
      { timeout: 300 },
    );
    const call = server.invoke.mock.calls.find(([m]) => m === 'projects.reorder')!;
    const { orderedIds } = call[1] as { orderedIds: string[] };
    expect(orderedIds.indexOf('p2')).toBeLessThan(orderedIds.indexOf('p1'));
  });

  it('a drag starting on the colour swatch moves the project', async () => {
    const server = twoProjectFixture();
    await mount(server);
    layoutRows();
    const row = screen.getByTestId('project-item-p1');
    const dot = row.querySelector<HTMLElement>('.project-item__dot')!;

    await dragElementTo(dot, 110);

    await waitFor(
      () => expect(server.invoke).toHaveBeenCalledWith('projects.reorder', expect.anything()),
      { timeout: 300 },
    );
  });

  it("a drag starting on the row's empty space moves the project", async () => {
    const server = twoProjectFixture();
    await mount(server);
    layoutRows();
    const row = screen.getByTestId('project-item-p1');

    await dragElementTo(row, 110);

    await waitFor(
      () => expect(server.invoke).toHaveBeenCalledWith('projects.reorder', expect.anything()),
      { timeout: 300 },
    );
  });

  it('a drag starting on Edit, Remove or an open rename input does not move the project', async () => {
    const server = twoProjectFixture();
    await mount(server);
    layoutRows();

    await dragElementTo(screen.getByTestId('project-edit-p1'), 110);
    await dragElementTo(screen.getByTestId('project-delete-p1'), 110);

    fireEvent.doubleClick(screen.getByTestId('project-item-p1').querySelector('.project-item__name')!);
    const renameInput = await screen.findByTestId('project-rename-input-p1');
    await dragElementTo(renameInput, 110);

    expect(server.invoke).not.toHaveBeenCalledWith('projects.reorder', expect.anything());
    expect(server.invoke).not.toHaveBeenCalledWith('projects.move', expect.anything());
  });

  it('a press under the activation distance still switches project', async () => {
    const server = twoProjectFixture();
    await mount(server);

    fireEvent.click(screen.getByTestId('project-switch-p1'));

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith('projects.setActive', expect.objectContaining({ id: 'p1' })),
    );
  });

  it('a double-click on the name still renames (002 FR-041)', async () => {
    const server = twoProjectFixture();
    await mount(server);

    fireEvent.doubleClick(screen.getByTestId('project-item-p1').querySelector('.project-item__name')!);

    expect(await screen.findByTestId('project-rename-input-p1')).toBeInTheDocument();
  });
});
