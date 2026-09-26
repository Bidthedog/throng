/**
 * 046 US5 (T077) — the category header's context menu (contracts/menus.md §2) and the project row's
 * Move to Category submenu (contracts/menus.md §1), over the REAL `ProjectsPanel`
 * (`packages/ui/src/renderer/sidebar/projects-panel.tsx`) and the REAL `KeybindingsHandler`
 * (`app.tsx`).
 *
 * Covers FR-050, FR-053, FR-054, US5 scenario 4.
 *
 * WHAT IS RED, AND WHY: `projects-panel.tsx` wires no `onContextMenu` on a category header row yet
 * (T082), `packages/ui/src/renderer/sidebar/category-menu.ts` (T080) does not exist, and
 * `packages/ui/src/renderer/sidebar/project-menu.ts` (T072, US4) does not exist either — so a project
 * row's own menu (needed to reach Move to Category) never opens. Every test here is red for one of
 * those three absences until T072, T080 and T082 all land.
 *
 * PINNED SHAPES this file assumes:
 * - `menu-item-Rename Category`, `menu-item-Delete Category`, `menu-item-Minimise Category` (the
 *   Word Wrap idiom: a STABLE test id, the label itself gaining " ✓" while minimised —
 *   `content-menu.ts`'s `Word Wrap` / `Word Wrap ✓`).
 * - the project row's submenu item is `menu-item-Move to Category` (labels never carry the drawn ▸ —
 *   every existing submenu-parent in this codebase omits it, e.g. `menu-item-Open In`,
 *   `menu-item-Sync to`), and its own rows are `menu-item-<category name>` plus
 *   `menu-item-New Category…`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      case 'projects.categories.setMinimised': {
        const { id, minimised } = params as { id: string; minimised: boolean };
        state.categories = state.categories.map((c) => (c.id === id ? { ...c, minimised } : c));
        return { category: state.categories.find((c) => c.id === id) };
      }
      case 'projects.categories.rename': {
        const { id, name } = params as { id: string; name: string };
        state.categories = state.categories.map((c) => (c.id === id ? { ...c, name } : c));
        return { category: state.categories.find((c) => c.id === id) };
      }
      case 'projects.categories.delete': {
        const { id } = params as { id: string };
        const def = state.categories.find((c) => c.isDefault)!;
        state.projects = state.projects.map((p) =>
          p.categoryId === id ? { ...p, categoryId: def.id } : p,
        );
        state.categories = state.categories.filter((c) => c.id !== id);
        return { movedProjectIds: [] };
      }
      // contracts/project-categories.md §5 (046 iterate round 1, FR-083) — additive, not yet called
      // by any production code (T138 GREEN). `orderedIds` names the NON-default categories in their
      // new order; the default always stays first.
      case 'projects.categories.reorder': {
        const { orderedIds } = params as { orderedIds: string[] };
        const def = state.categories.filter((c) => c.isDefault);
        const rest = orderedIds
          .map((id) => state.categories.find((c) => c.id === id))
          .filter((c): c is ProjectCategoryDto => !!c);
        state.categories = [...def, ...rest];
        return { categories: state.categories };
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

const press = (target: Element, key: string, mods: { shiftKey?: boolean } = {}): void => {
  fireEvent.keyDown(target, { key, code: key, ...mods });
};

function twoCategoryFixture() {
  return makeServer(
    [makeProject('p1', DEFAULT_ID), makeProject('p2', 'cat-a')],
    [makeCategory(DEFAULT_ID, 'In Progress'), makeCategory('cat-a', 'Side Quests')],
  );
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

describe('the non-default header menu (contracts/menus.md §2)', () => {
  it('offers Rename Category, Delete Category and a checkable Minimise Category', async () => {
    const server = twoCategoryFixture();
    await mount(server);

    fireEvent.contextMenu(screen.getByTestId('category-header-cat-a'));

    await screen.findByTestId('context-menu');
    expect(screen.getByTestId('menu-item-Rename Category')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-Delete Category')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-Minimise Category')).toBeInTheDocument();
  });

  it('the toggle reflects the category’s current minimised state (the Word Wrap idiom)', async () => {
    const server = makeServer(
      [makeProject('p1', DEFAULT_ID), makeProject('p2', 'cat-a')],
      [makeCategory(DEFAULT_ID, 'In Progress'), makeCategory('cat-a', 'Side Quests', { minimised: true })],
    );
    await mount(server);

    fireEvent.contextMenu(screen.getByTestId('category-header-cat-a'));

    await screen.findByTestId('context-menu');
    expect(screen.getByTestId('menu-item-Minimise Category')).toHaveTextContent('✓');
  });
});

describe('the default header menu (FR-050)', () => {
  it('offers Rename Category only — Delete and Minimise are ABSENT, not disabled, and there is no divider', async () => {
    const server = twoCategoryFixture();
    await mount(server);

    fireEvent.contextMenu(screen.getByTestId('category-header-default'));

    const menu = await screen.findByTestId('context-menu');
    expect(screen.getByTestId('menu-item-Rename Category')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-item-Delete Category')).toBeNull();
    expect(screen.queryByTestId('menu-item-Minimise Category')).toBeNull();
    expect(menu.querySelector('.context-menu__separator')).toBeNull();
  });
});

describe('Shift+F10 and the ContextMenu key open the SAME header menu (FR-053 keyboard route, T075)', () => {
  it('Shift+F10 on a focused header opens it', async () => {
    const server = twoCategoryFixture();
    await mount(server);
    const header = screen.getByTestId('category-header-cat-a');
    header.focus();

    press(header, 'F10', { shiftKey: true });

    await screen.findByTestId('context-menu');
    expect(screen.getByTestId('menu-item-Delete Category')).toBeInTheDocument();
  });

  it('the ContextMenu key does the same', async () => {
    const server = twoCategoryFixture();
    await mount(server);
    const header = screen.getByTestId('category-header-cat-a');
    header.focus();

    press(header, 'ContextMenu');

    await screen.findByTestId('context-menu');
    expect(screen.getByTestId('menu-item-Delete Category')).toBeInTheDocument();
  });
});

describe('the project row’s Move to Category submenu (contracts/menus.md §1)', () => {
  it('lists every OTHER category, then New Category…, and omits the project’s own category', async () => {
    const server = makeServer(
      [makeProject('p1', DEFAULT_ID), makeProject('p2', 'cat-a')],
      [
        makeCategory(DEFAULT_ID, 'In Progress'),
        makeCategory('cat-a', 'Side Quests'),
        makeCategory('cat-b', 'Someday'),
      ],
    );
    await mount(server);

    fireEvent.contextMenu(screen.getByTestId('project-item-p2')); // p2 is in cat-a
    await screen.findByTestId('context-menu');
    fireEvent.click(screen.getByTestId('menu-item-Move to Category'));

    expect(await screen.findByTestId('menu-item-In Progress')).toBeInTheDocument();
    expect(screen.getByTestId('menu-item-Someday')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-item-Side Quests')).toBeNull(); // p2's own category
    expect(screen.getByTestId('menu-item-New Category…')).toBeInTheDocument();
  });
});

describe('Delete Category (FR-054, US5 scenario 4)', () => {
  it('calls deleteCategory, and its projects reappear under the default category', async () => {
    const server = twoCategoryFixture();
    await mount(server);

    fireEvent.contextMenu(screen.getByTestId('category-header-cat-a'));
    await screen.findByTestId('context-menu');
    fireEvent.click(screen.getByTestId('menu-item-Delete Category'));

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith(
        'projects.categories.delete',
        expect.objectContaining({ id: 'cat-a' }),
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('category-header-cat-a')).toBeNull());
    expect(screen.getByTestId('project-item-p2')).toBeInTheDocument();
  });
});

/**
 * 046 iterate round 1 (FR-083, T133) — Move Category Up / Move Category Down in a non-default
 * category header's menu (contracts/menus.md §6): disabled at the ends, absent on the default
 * category, each calling the store's reorder with the new order.
 *
 * WHAT IS RED, AND WHY: `category-menu.ts` (`categoryMenu()`) draws only Rename / Delete / Minimise
 * today (`:30-45`) — no Move Category Up/Down item exists in either menu's output yet, so every
 * `screen.getByTestId('menu-item-Move Category …')` below throws "not found" against today's code.
 */
describe('Move Category Up / Move Category Down (FR-083)', () => {
  function threeNonDefaultFixture() {
    return makeServer(
      [makeProject('p1', DEFAULT_ID), makeProject('p2', 'cat-a'), makeProject('p3', 'cat-b'), makeProject('p4', 'cat-c')],
      [
        makeCategory(DEFAULT_ID, 'In Progress'),
        makeCategory('cat-a', 'Side Quests'),
        makeCategory('cat-b', 'Someday'),
        makeCategory('cat-c', 'Archived'),
      ],
    );
  }

  it('Move Category Up is disabled on the first non-default category, and Move Category Down is enabled', async () => {
    const server = threeNonDefaultFixture();
    await mount(server);

    fireEvent.contextMenu(screen.getByTestId('category-header-cat-a'));
    await screen.findByTestId('context-menu');

    expect(screen.getByTestId('menu-item-Move Category Up')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('menu-item-Move Category Down')).toHaveAttribute('aria-disabled', 'false');
  });

  it('Move Category Down is disabled on the last non-default category, and Move Category Up is enabled', async () => {
    const server = threeNonDefaultFixture();
    await mount(server);

    fireEvent.contextMenu(screen.getByTestId('category-header-cat-c'));
    await screen.findByTestId('context-menu');

    expect(screen.getByTestId('menu-item-Move Category Down')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('menu-item-Move Category Up')).toHaveAttribute('aria-disabled', 'false');
  });

  it('neither item is drawn on the default category’s menu', async () => {
    const server = threeNonDefaultFixture();
    await mount(server);

    fireEvent.contextMenu(screen.getByTestId('category-header-default'));
    await screen.findByTestId('context-menu');

    expect(screen.queryByTestId('menu-item-Move Category Up')).toBeNull();
    expect(screen.queryByTestId('menu-item-Move Category Down')).toBeNull();
  });

  it('Move Category Up calls the store’s reorder, moving the category earlier', async () => {
    const server = threeNonDefaultFixture();
    await mount(server);

    fireEvent.contextMenu(screen.getByTestId('category-header-cat-b'));
    await screen.findByTestId('context-menu');
    fireEvent.click(screen.getByTestId('menu-item-Move Category Up'));

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith('projects.categories.reorder', expect.anything()),
    );
    const call = server.invoke.mock.calls.find(([m]) => m === 'projects.categories.reorder')!;
    const { orderedIds } = call[1] as { orderedIds: string[] };
    expect(orderedIds.indexOf('cat-b')).toBeLessThan(orderedIds.indexOf('cat-a'));
  });

  it('Move Category Down calls the store’s reorder, moving the category later', async () => {
    const server = threeNonDefaultFixture();
    await mount(server);

    fireEvent.contextMenu(screen.getByTestId('category-header-cat-a'));
    await screen.findByTestId('context-menu');
    fireEvent.click(screen.getByTestId('menu-item-Move Category Down'));

    await waitFor(() =>
      expect(server.invoke).toHaveBeenCalledWith('projects.categories.reorder', expect.anything()),
    );
    const call = server.invoke.mock.calls.find(([m]) => m === 'projects.categories.reorder')!;
    const { orderedIds } = call[1] as { orderedIds: string[] };
    expect(orderedIds.indexOf('cat-b')).toBeLessThan(orderedIds.indexOf('cat-a'));
  });
});
