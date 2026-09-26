/**
 * 046 US5 (T076) — category headers over the REAL `ProjectsPanel`
 * (`packages/ui/src/renderer/sidebar/projects-panel.tsx`), `listRows` (`@throng/core`) and the REAL
 * `ProjectsProvider` store (`packages/ui/src/renderer/state/projects-store.tsx`).
 *
 * Covers FR-018, FR-051 – FR-053, FR-056, FR-060, FR-061, SC-007 (tasks.md T076).
 *
 * WHAT IS RED, AND WHY: `projects-panel.tsx` renders a category header today with only a name and a
 * bare count (`:664-666`) — no chevron `IconButton`, no hover title, no minimise behaviour, no
 * `data-pinned-active` handling and no digit-grouped count. `listRows` (T004, already GREEN) already
 * computes `count`, `collapsible` and `pinnedActive`, so this file drives the PANEL and the STORE
 * only; it adds nothing to `@throng/core`.
 *
 * PINNED SHAPES this file assumes (T082 must satisfy them, or this file's own assertions change):
 * - the chevron `IconButton`'s test id is `category-toggle-<categoryId>`, title "Minimise category" /
 *   "Expand category" (contracts/project-categories.md §4).
 * - the count is rendered inside `data-testid="category-count-<categoryId>"`, through `formatGrouped`
 *   (no locale override — the component's own default).
 * - the New Category / Rename Category inline field (contracts/project-categories.md §4) is a single
 *   `<input data-testid="category-name-input">`; a client-side refusal (duplicate name, case-folded)
 *   renders `data-testid="category-name-error"` and leaves the input mounted — the task text's "stays
 *   open with the reason", which is a stronger claim than `commitRename`'s silent stay-open.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatGrouped } from '@throng/core';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import { RpcError, type ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import {
  ProjectsProvider,
  useProjects,
  type ProjectsContextValue,
} from '../../src/renderer/state/projects-store.js';
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

/**
 * A tiny in-memory "daemon": every RPC this store can send mutates and reads back from ONE shared
 * state, so `refresh()` (which every mutation triggers, `projects-store.tsx`'s `run()`) always sees
 * the effect of the mutation that just ran — exactly what the real daemon guarantees.
 */
function makeServer(projects: ProjectDto[], categories: ProjectCategoryDto[]) {
  const state = { projects: [...projects], categories: [...categories] };
  const invoke = vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
    switch (method) {
      case 'projects.list':
        return { projects: state.projects };
      case 'projects.categories.list':
        return { categories: state.categories };
      case 'projects.setActive': {
        const { id } = params as { id: string };
        return { activeId: id };
      }
      case 'projects.categories.setMinimised': {
        const { id, minimised } = params as { id: string; minimised: boolean };
        state.categories = state.categories.map((c) => (c.id === id ? { ...c, minimised } : c));
        return { category: state.categories.find((c) => c.id === id) };
      }
      case 'projects.categories.delete': {
        const { id } = params as { id: string };
        const def = state.categories.find((c) => c.isDefault)!;
        const moved = state.projects.filter((p) => p.categoryId === id).map((p) => p.id);
        state.projects = state.projects.map((p) =>
          p.categoryId === id ? { ...p, categoryId: def.id } : p,
        );
        state.categories = state.categories.filter((c) => c.id !== id);
        return { movedProjectIds: moved };
      }
      case 'projects.categories.create': {
        const { name } = params as { name: string };
        const trimmed = name.trim();
        const dup = state.categories.some(
          (c) => c.name.trim().toLowerCase() === trimmed.toLowerCase(),
        );
        if (trimmed.length === 0) throw new RpcError('Category name cannot be empty.', null);
        if (dup) throw new RpcError('A category with that name already exists.', null);
        const created = makeCategory(`cat-${state.categories.length}`, trimmed);
        state.categories = [...state.categories, created];
        return { category: created };
      }
      default:
        throw new Error(`unexpected projects RPC: ${method}`);
    }
  });
  return { state, bridge: { invoke } as unknown as ThrongBridge };
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

/** Grabs the live store value for tests that must call an action the UI does not yet trigger (T080/T082). */
function Probe({ onReady }: { onReady: (v: ProjectsContextValue) => void }): ReactElement | null {
  const value = useProjects();
  onReady(value);
  return null;
}

function Harness({ onStore }: { onStore: (v: ProjectsContextValue) => void }): ReactElement {
  return createElement(
    'div',
    null,
    createElement(Probe, { onReady: onStore }),
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

let store: ProjectsContextValue;

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
            createElement(
              ConfirmProvider,
              null,
              createElement(ContextMenuProvider, null, createElement(Harness, { onStore: (v) => (store = v) })),
            ),
          ),
        ),
      ),
    ),
  );
  await waitFor(() => expect(store).toBeDefined());
}

const press = (target: Element, key: string): void => {
  fireEvent.keyDown(target, { key, code: key });
};

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

describe('the header (FR-050, FR-051, FR-061)', () => {
  it('shows the name, the digit-grouped count, and a chevron IconButton titled "Minimise category"', async () => {
    const projects = Array.from({ length: 1234 }, (_, i) => makeProject(`p${i}`, 'cat-a'));
    const categories = [makeCategory(DEFAULT_ID, 'In Progress'), makeCategory('cat-a', 'Big Category')];
    const server = makeServer(projects, categories);
    await mount(server);

    const header = await screen.findByTestId('category-header-cat-a');
    expect(header).toHaveTextContent('Big Category');
    expect(screen.getByTestId('category-count-cat-a')).toHaveTextContent(formatGrouped(1234));

    const toggle = screen.getByTestId('category-toggle-cat-a');
    expect(toggle).toHaveAttribute('title', 'Minimise category');
  });

  it('the default category draws no toggle, unlike a non-default one (FR-050)', async () => {
    const server = makeServer(
      [makeProject('p1', DEFAULT_ID), makeProject('p2', 'cat-a')],
      [makeCategory(DEFAULT_ID, 'In Progress'), makeCategory('cat-a', 'Side Quests')],
    );
    await mount(server);

    await screen.findByTestId('category-header-default');
    // The contrast is the point: a category-toggle-<id> exists for a NON-default header (asserted
    // positively, so this cannot pass merely because no header draws one yet) and is absent for the
    // default one.
    expect(screen.getByTestId('category-toggle-cat-a')).toBeInTheDocument();
    expect(screen.queryByTestId('category-toggle-default')).toBeNull();
  });
});

describe('minimising (FR-051, FR-052, FR-060, SC-007)', () => {
  function twoCategoryFixture() {
    const projects = [
      makeProject('p1', DEFAULT_ID),
      makeProject('p2', 'cat-a'),
      makeProject('p3', 'cat-a'),
    ];
    const categories = [makeCategory(DEFAULT_ID, 'In Progress'), makeCategory('cat-a', 'Side Quests')];
    return makeServer(projects, categories);
  }

  it('clicking the chevron toggles the category and hides its rows', async () => {
    const server = twoCategoryFixture();
    await mount(server);
    await screen.findByTestId('project-item-p2');

    fireEvent.click(screen.getByTestId('category-toggle-cat-a'));

    await waitFor(() => expect(screen.queryByTestId('project-item-p2')).toBeNull());
    expect(screen.queryByTestId('project-item-p3')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('category-header-cat-a')).toHaveAttribute('aria-expanded', 'false'),
    );
    expect(screen.getByTestId('category-toggle-cat-a')).toHaveAttribute('title', 'Expand category');
  });

  // Branch review I3 (contracts/project-categories.md §4 "Clicking a non-default header toggles
  // minimise") — the chevron used to be the ONLY click target; the name/count area beside it did
  // nothing.
  it('clicking the header itself (the name/count area, not just the chevron) toggles a non-default category (I3)', async () => {
    const server = twoCategoryFixture();
    await mount(server);
    await screen.findByTestId('project-item-p2');

    fireEvent.click(screen.getByText('Side Quests'));

    await waitFor(() => expect(screen.queryByTestId('project-item-p2')).toBeNull());
    await waitFor(() =>
      expect(screen.getByTestId('category-header-cat-a')).toHaveAttribute('aria-expanded', 'false'),
    );
  });

  it('clicking the default header does nothing (I3)', async () => {
    const server = twoCategoryFixture();
    await mount(server);
    await screen.findByTestId('project-item-p1');

    fireEvent.click(screen.getByTestId('category-header-default'));

    // No toggle exists, no aria-expanded to flip, and the default category's own project stays put.
    expect(screen.queryByTestId('category-toggle-default')).toBeNull();
    expect(screen.getByTestId('project-item-p1')).toBeInTheDocument();
  });

  // Branch review M11 — the chevron carried one glyph for both states; nothing distinguished
  // minimised from expanded.
  it('the chevron visibly reflects minimised vs expanded state (M11)', async () => {
    const server = twoCategoryFixture();
    await mount(server);
    await screen.findByTestId('project-item-p2');

    const toggle = screen.getByTestId('category-toggle-cat-a');
    expect(toggle.className).toMatch(/category-header__toggle--open/);

    fireEvent.click(toggle);

    await waitFor(() => expect(screen.queryByTestId('project-item-p2')).toBeNull());
    expect(screen.getByTestId('category-toggle-cat-a').className).not.toMatch(/category-header__toggle--open/);
  });

  it('Enter on the focused header toggles it', async () => {
    const server = twoCategoryFixture();
    await mount(server);
    const header = await screen.findByTestId('category-header-cat-a');
    header.focus();

    press(header, 'Enter');

    await waitFor(() => expect(screen.queryByTestId('project-item-p2')).toBeNull());
  });

  it('Space on the focused header toggles it', async () => {
    const server = twoCategoryFixture();
    await mount(server);
    const header = await screen.findByTestId('category-header-cat-a');
    header.focus();

    press(header, ' ');

    await waitFor(() => expect(screen.queryByTestId('project-item-p2')).toBeNull());
  });

  it('the active project stays visible under a minimised category, pinned, and disappears once another project becomes active', async () => {
    const server = twoCategoryFixture();
    await mount(server);
    await act(async () => {
      await store.switchProject('p2');
    });
    fireEvent.click(screen.getByTestId('category-toggle-cat-a'));
    await waitFor(() => expect(screen.queryByTestId('project-item-p3')).toBeNull());

    const pinned = screen.getByTestId('project-item-p2');
    expect(pinned).toHaveAttribute('data-pinned-active', 'true');

    await act(async () => {
      await store.switchProject('p1');
    });

    await waitFor(() => expect(screen.queryByTestId('project-item-p2')).toBeNull());
  });

  // Branch review renderer-ui #1 — a row holding REAL DOM focus that leaves `rows` (hidden by a
  // minimised category) used to drop focus to `document.body`: the roving tabindex still showed
  // `tabIndex={0}` on some row, but nothing was actually focused, so the next Tab left the tree.
  it('moves DOM focus to the category header when the locally focused row disappears under a minimised category (renderer-ui #1)', async () => {
    const server = twoCategoryFixture();
    await mount(server);
    const row = await screen.findByTestId('project-item-p2');
    row.focus();
    await waitFor(() => expect(document.activeElement).toBe(row));

    // p2 is not the active project, so minimising cat-a (from elsewhere — another window, or the
    // store directly, not a local click) hides its row out from under the focus that is on it.
    await act(async () => {
      await store.setCategoryMinimised('cat-a', true);
    });

    await waitFor(() => expect(screen.queryByTestId('project-item-p2')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('category-header-cat-a')));
  });

  it('minimising does not unload a hidden project — it keeps its loaded state (FR-060)', async () => {
    const server = twoCategoryFixture();
    await mount(server);
    await act(async () => {
      await store.switchProject('p2'); // loads + activates p2
    });
    await act(async () => {
      await store.switchProject('p3'); // loads + activates p3; p2 stays loaded, not active
    });
    fireEvent.click(screen.getByTestId('category-toggle-cat-a')); // minimise: p3 (active) pinned, p2 hidden
    await waitFor(() => expect(screen.queryByTestId('project-item-p2')).toBeNull());

    fireEvent.click(screen.getByTestId('category-toggle-cat-a')); // expand again

    await waitFor(() =>
      expect(screen.getByTestId('project-item-p2')).toHaveAttribute('data-loaded', 'true'),
    );
  });
});

describe('listing (FR-056, FR-054, US5 scenario 4)', () => {
  it('an empty category is still listed, with a count of 0', async () => {
    const server = makeServer(
      [makeProject('p1', DEFAULT_ID)],
      [makeCategory(DEFAULT_ID, 'In Progress'), makeCategory('cat-a', 'Empty One')],
    );
    await mount(server);

    await screen.findByTestId('category-header-cat-a');
    expect(screen.getByTestId('category-count-cat-a')).toHaveTextContent('0');
  });

  it('deleting the only non-default category while it is minimised lists its projects under the default category', async () => {
    const server = makeServer(
      [makeProject('p1', DEFAULT_ID), makeProject('p2', 'cat-a')],
      [makeCategory(DEFAULT_ID, 'In Progress'), makeCategory('cat-a', 'Side Quests', { minimised: true })],
    );
    await mount(server);
    await screen.findByTestId('category-header-cat-a');

    await act(async () => {
      await store.deleteCategory('cat-a');
    });

    await waitFor(() => expect(screen.queryByTestId('category-header-cat-a')).toBeNull());
    expect(screen.getByTestId('project-item-p2')).toBeInTheDocument();
    expect(screen.getByTestId('category-count-default')).toHaveTextContent('2');
  });
});

describe('naming (FR-053)', () => {
  /*
   * CONTROLLER RULING (report-US5-red.md) — the Edge Case says a duplicate category name is
   * "Refused inline, the same way a duplicate project name is treated" (spec.md). A duplicate
   * PROJECT name is never shown as its own dedicated inline reason: `commitRename` and the
   * create/edit form both leave the field's value in place and let the RPC refusal surface through
   * the ONE shared `project-error` notice (`useErrorNotice`, 018/FR-051 "one condition, one
   * notice") — there is no second, field-level echo of the same failure. So there is no
   * `category-name-error` element to assert on; mirroring that behaviour exactly is what "the same
   * way" means. The input staying mounted (never closing itself on a refusal) is the "stays open"
   * half, matching `commitRename`'s own shape.
   */
  it('the inline New Category field refuses a duplicate that differs only in case, and stays open, reporting the refusal through the shared project-error notice — as a duplicate project name is treated', async () => {
    const server = makeServer(
      [makeProject('p1', DEFAULT_ID)],
      [makeCategory(DEFAULT_ID, 'In Progress')],
    );
    await mount(server);
    fireEvent.contextMenu(screen.getByTestId('project-item-p1'));
    await screen.findByTestId('context-menu');
    fireEvent.click(screen.getByTestId('menu-item-Move to Category'));
    fireEvent.click(await screen.findByTestId('menu-item-New Category…'));

    const input = await screen.findByTestId('category-name-input');
    fireEvent.change(input, { target: { value: 'IN PROGRESS' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.getAllByTestId('project-error')[0]).toHaveTextContent(/already exists/i),
    );
    expect(screen.getByTestId('category-name-input')).toBeInTheDocument();
  });
});

/**
 * 046 iterate round 1 (FR-072, T132) — every category header, the default's included, draws a
 * highlighted background from a theme token; the uppercase already shipped (`theme.css:527-538`) is
 * a display style only, so the stored name and the Rename Category field keep the user's casing, and
 * the count stays a plain digit-grouped number.
 *
 * WHAT IS RED, AND WHY: `.category-header` (`theme.css:527-538`) declares `font-weight: 600` and
 * `text-transform: uppercase` but no `background` at all — parsed as TEXT rather than through
 * `getComputedStyle`, because jsdom does not resolve a `var()` custom property through the cascade
 * (the same reason `preview-text-selection-css.test.ts` and `gutter-tokens-live.test.ts` read their
 * target files as text). Both headers in this file — default and non-default — share the ONE
 * `.category-header` class (`projects-panel.tsx`), so a single rule covers "every header, the
 * default's included".
 */
describe('the header background token (FR-072)', () => {
  it("theme.css's .category-header rule declares background: var(--throng-colour-categoryHeaderBackground)", () => {
    // `resolve(process.cwd(), …)`, not `new URL(…, import.meta.url)` — jsdom's global `URL`
    // polyfill (the component project's environment) does not resolve a relative path against
    // `import.meta.url` the way Node's does, and `fileURLToPath` then refuses the result ("The URL
    // must be of scheme file"). `gutter-tokens-live.test.ts` reads its own CSS target the same way.
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
    const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const match = text.match(/\.category-header\s*\{([^}]*)\}/);
    expect(match, 'a .category-header rule in theme.css').not.toBeNull();
    const declarations = new Map<string, string>();
    for (const part of (match?.[1] ?? '').split(';')) {
      const colon = part.indexOf(':');
      if (colon < 0) continue;
      declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
    }
    expect(declarations.get('background')).toBe('var(--throng-colour-categoryHeaderBackground)');
  });

  it('a mixed-case category name keeps its stored casing in the Rename Category field, and the count stays a plain digit-grouped number', async () => {
    const projects = Array.from({ length: 1234 }, (_, i) => makeProject(`p${i}`, 'cat-a'));
    const categories = [makeCategory(DEFAULT_ID, 'In Progress'), makeCategory('cat-a', 'Side Quests')];
    const server = makeServer(projects, categories);
    await mount(server);
    await screen.findByTestId('category-header-cat-a');

    fireEvent.contextMenu(screen.getByTestId('category-header-cat-a'));
    await screen.findByTestId('context-menu');
    fireEvent.click(screen.getByTestId('menu-item-Rename Category'));

    const input = (await screen.findByTestId('category-name-input')) as HTMLInputElement;
    expect(input.value).toBe('Side Quests'); // not the display-only uppercase 'SIDE QUESTS'
    expect(screen.getByTestId('category-count-cat-a')).toHaveTextContent(formatGrouped(1234));
  });
});
