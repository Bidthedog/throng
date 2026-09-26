/**
 * The Projects panel as an ARIA TREE, keyboard-driven (046 US2, T034 — FR-015, FR-018, R4).
 *
 * `projects-panel.tsx` used to render a flat `<ul>` of `.project-item` rows with no ARIA role and no
 * keyboard navigation of its own; the panel worked only because every row happened to be a native
 * `<button>`. FR-015/FR-018 ask for a real tree — category headers as `treeitem`s alongside project
 * rows, roving tabindex, and Home/End/Arrow/Enter — built over `listRows` (046 data-model §7), the
 * SAME model `stepProject` and the cog's Navigate section already read.
 *
 * Contexts: `ProjectsProvider` over a fake bridge that answers `projects.categories.list` for real, so
 * the rendered tree is the daemon's own category order — `project-settings-dialog.test.ts` / the
 * `projects-panel-form.test.ts` idiom.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';
import { setActivePane, getActivePane } from '../../src/renderer/workspace/active-pane.js';
import {
  requestProjectsFocus,
  __resetProjectsPanelCommands,
} from '../../src/renderer/sidebar/projects-panel-commands.js';

const now = '2026-01-01T00:00:00.000Z';
const CATEGORIES: ProjectCategoryDto[] = [
  { id: 'default', name: 'In Progress', isDefault: true, minimised: false, createdAt: now, updatedAt: now },
  { id: 'later', name: 'Later', isDefault: false, minimised: false, createdAt: now, updatedAt: now },
];
const project = (id: string, categoryId: string): ProjectDto => ({
  id,
  name: id,
  colour: '#3b82f6',
  rootFolder: `C:/projects/${id}`,
  isActive: false,
  createdAt: now,
  updatedAt: now,
  hiddenPaths: [],
  categoryId,
});
// p1, p2 under the default header; p3 under "Later" — two headers and three project rows, five
// rows total, exactly what a tree-shaped list needs to prove Home/End move across a boundary.
const PROJECTS: ProjectDto[] = [project('p1', 'default'), project('p2', 'default'), project('p3', 'later')];

function mockClient(initialProjects: ProjectDto[] = PROJECTS): { client: ProjectsClient; switched: string[] } {
  let live = [...initialProjects];
  const switched: string[] = [];
  let active: string | null = null;
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: live } as unknown as TResult);
        case 'projects.categories.list':
          return Promise.resolve({ categories: CATEGORIES } as unknown as TResult);
        case 'projects.setActive':
          active = (params as { id: string }).id;
          switched.push(active);
          return Promise.resolve({ activeId: active } as unknown as TResult);
        // Review finding 6's repro needs a row to genuinely disappear from `rows` — a real delete,
        // refetched by the store's own `refresh()`, is what a category minimising would also do.
        case 'projects.delete':
          live = live.filter((p) => p.id !== (params as { id: string }).id);
          return Promise.resolve({ ok: true } as unknown as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
    },
  };
  return { client: new ProjectsClient(bridge), switched };
}

/** Test-only: drives the store's `deleteProject` directly, bypassing the panel's confirm dialogs — the
 *  panel's OWN delete button is `projects-panel-form.test.ts`'s to cover. */
function DeleteTrigger({ id }: { id: string }): ReturnType<typeof createElement> {
  const { deleteProject } = useProjects();
  return createElement('button', {
    type: 'button',
    'data-testid': `test-delete-${id}`,
    onClick: () => void deleteProject(id),
  });
}

async function mount(
  projects: ProjectDto[] = PROJECTS,
  extra: ReturnType<typeof createElement>[] = [],
): Promise<{ switched: string[] }> {
  const { client, switched } = mockClient(projects);
  const workspaceClient = new WorkspaceClient({
    invoke: () => Promise.reject(new Error('no workspace RPC expected — activeProjectId is null')),
  });
  render(
    createElement(
      ProjectsProvider,
      { client },
      // `activeProjectId: null` skips the layout load entirely (`file-explorer-pane.test.ts`'s
      // idiom) — nothing under test here reads `ws.layout`, only that `useWorkspace()` resolves.
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
            ...extra,
          ),
        ),
      ),
    ),
  );
  if (projects.length > 0) {
    await waitFor(() => expect(screen.getByTestId(`project-item-${projects[0].id}`)).toBeInTheDocument());
  } else {
    await waitFor(() => expect(screen.getByTestId('projects-empty')).toBeInTheDocument());
  }
  return { switched };
}

const tree = (): HTMLElement => screen.getByTestId('project-list');
const rowEl = (testId: string): HTMLElement => screen.getByTestId(testId);
const press = (key: string): void => {
  // React attaches the roving-tabindex handler to the <ul>; keydown bubbles there from any row.
  const focused = document.activeElement ?? tree();
  focused.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

afterEach(() => {
  setActivePane('workspace');
  __resetProjectsPanelCommands();
});

describe('markup — role=tree, category headers and project rows at the right aria-level (FR-015)', () => {
  it('the list is role=tree', async () => {
    await mount();
    expect(tree()).toHaveAttribute('role', 'tree');
  });

  it('category headers are treeitem at aria-level 1, with aria-expanded except the default', async () => {
    await mount();
    const defaultHeader = rowEl('category-header-default');
    expect(defaultHeader).toHaveAttribute('role', 'treeitem');
    expect(defaultHeader).toHaveAttribute('aria-level', '1');
    expect(defaultHeader).not.toHaveAttribute('aria-expanded');

    const laterHeader = rowEl('category-header-later');
    expect(laterHeader).toHaveAttribute('aria-level', '1');
    expect(laterHeader).toHaveAttribute('aria-expanded', 'true');
  });

  it('projects are treeitem at aria-level 2', async () => {
    await mount();
    expect(rowEl('project-item-p1')).toHaveAttribute('role', 'treeitem');
    expect(rowEl('project-item-p1')).toHaveAttribute('aria-level', '2');
  });

  it('exactly one row carries tabindex 0 — roving tabindex', async () => {
    await mount();
    const zeroTabIndex = [
      'category-header-default',
      'project-item-p1',
      'project-item-p2',
      'category-header-later',
      'project-item-p3',
    ].filter((id) => rowEl(id).getAttribute('tabindex') === '0');
    expect(zeroTabIndex).toHaveLength(1);
  });

  it('keeps every existing class and data-testid (project-item, project-list)', async () => {
    await mount();
    expect(tree()).toHaveClass('project-list');
    expect(rowEl('project-item-p1')).toHaveClass('project-item');
    expect(screen.getByTestId(`project-switch-p1`)).toBeInTheDocument();
    expect(screen.getByTestId(`project-edit-p1`)).toBeInTheDocument();
    expect(screen.getByTestId(`project-delete-p1`)).toBeInTheDocument();
  });

  // Review finding 5 — the WAI-ARIA tree pattern's selection state: the active project's row carries
  // aria-selected; every other project row states it is NOT selected (never simply absent, so a
  // screen reader has something to announce either way). Category headers have no such state.
  it('aria-selected names the ACTIVE project row, true on it and false on the rest (FR-015)', async () => {
    const { switched } = await mount();
    rowEl('project-item-p1').focus();
    press('Enter');
    expect(switched).toEqual(['p1']);

    // `press` dispatches a raw DOM event (not `fireEvent`), so the resulting `setOpenedId` state
    // update — unlike the synchronous mock-bridge push `switched` just proved — is not guaranteed to
    // have flushed to the DOM the instant `dispatchEvent` returns.
    await waitFor(() => expect(rowEl('project-item-p1')).toHaveAttribute('aria-selected', 'true'));
    expect(rowEl('project-item-p2')).toHaveAttribute('aria-selected', 'false');
    expect(rowEl('project-item-p3')).toHaveAttribute('aria-selected', 'false');
    expect(rowEl('category-header-default')).not.toHaveAttribute('aria-selected');
  });

  // Review finding 5 — nested buttons (the drag grip, Edit, Remove) were real tab stops inside every
  // row, defeating roving tabindex (WAI-ARIA APG tree view: only the row itself is in Tab order; a
  // row's own controls are reached by activating the row, not by tabbing past it three more times).
  // `explorer/tree-node.tsx`'s twisty button is the house precedent for the same fix.
  it('the grip, Edit and Remove controls are tabIndex=-1 — out of Tab order, still reachable by click/focus', async () => {
    await mount();
    expect(rowEl('project-grip-p1')).toHaveAttribute('tabindex', '-1');
    expect(rowEl('project-edit-p1')).toHaveAttribute('tabindex', '-1');
    expect(rowEl('project-delete-p1')).toHaveAttribute('tabindex', '-1');
  });

  // T090 (partial T034, review finding 5) — the same fix missed these two: the row's own switch
  // button and a non-default header's chevron were still real Tab stops inside their row.
  it('the switch button and a non-default header chevron are tabIndex=-1 too', async () => {
    await mount();
    expect(rowEl('project-switch-p1')).toHaveAttribute('tabindex', '-1');
    expect(rowEl('category-toggle-later')).toHaveAttribute('tabindex', '-1');
  });
});

describe('keyboard — Arrow moves one row, Home/End jump, Enter switches a PROJECT row (FR-018, R4)', () => {
  it('ArrowDown moves the roving highlight row by row, in listRows order', async () => {
    await mount();
    rowEl('category-header-default').focus();

    press('ArrowDown');
    expect(document.activeElement).toBe(rowEl('project-item-p1'));
    press('ArrowDown');
    expect(document.activeElement).toBe(rowEl('project-item-p2'));
    press('ArrowDown');
    expect(document.activeElement).toBe(rowEl('category-header-later'));
    press('ArrowDown');
    expect(document.activeElement).toBe(rowEl('project-item-p3'));
    // Clamped, not wrapped, at the end.
    press('ArrowDown');
    expect(document.activeElement).toBe(rowEl('project-item-p3'));
  });

  it('ArrowUp moves back up, clamped at the top', async () => {
    await mount();
    rowEl('project-item-p2').focus();

    press('ArrowUp');
    expect(document.activeElement).toBe(rowEl('project-item-p1'));
    press('ArrowUp');
    expect(document.activeElement).toBe(rowEl('category-header-default'));
    press('ArrowUp');
    expect(document.activeElement).toBe(rowEl('category-header-default'));
  });

  it('Home and End jump to the first and last row', async () => {
    await mount();
    rowEl('project-item-p2').focus();

    press('End');
    expect(document.activeElement).toBe(rowEl('project-item-p3'));
    press('Home');
    expect(document.activeElement).toBe(rowEl('category-header-default'));
  });

  it('moving alone never switches the active project', async () => {
    const { switched } = await mount();
    rowEl('category-header-default').focus();

    press('ArrowDown');
    press('ArrowDown');
    press('End');
    press('Home');

    expect(switched).toEqual([]);
  });

  it('Enter on a project row switches — the SAME switchProject a click calls', async () => {
    const { switched } = await mount();
    rowEl('project-item-p2').focus();

    press('Enter');

    expect(switched).toEqual(['p2']);
  });

  it('Enter on the default header does nothing', async () => {
    const { switched } = await mount();
    rowEl('category-header-default').focus();

    press('Enter');

    expect(switched).toEqual([]);
  });

  // Review finding 10 — the rename box's own Enter already bubbles to this handler with an INPUT
  // target, already excluded (`onTreeKeyDown`'s INPUT/TEXTAREA guard); this proves it stays excluded.
  it('Enter in the rename input commits the rename, not a project switch', async () => {
    const { switched } = await mount();
    fireEvent.doubleClick(rowEl('project-switch-p1'));
    const input = await screen.findByTestId('project-rename-input-p1');
    input.focus();

    fireEvent.keyDown(input, { key: 'Enter', bubbles: true });

    expect(switched).toEqual([]);
  });

  // T090 — a nested BUTTON only keeps its OWN Enter/Space; Arrow/Home/End must still move the
  // roving row from there, exactly as from the row itself. The previous guard swallowed every key
  // for any nested button, which left the tree dead to Arrow/Home/End the moment one of these
  // tabIndex=-1 controls held real DOM focus (e.g. after a click on the already-active project's
  // own switch button).
  it('ArrowDown, ArrowUp, Home and End still move the roving row while focus sits on the switch button', async () => {
    await mount();
    rowEl('project-switch-p2').focus();
    expect(document.activeElement).toBe(rowEl('project-switch-p2'));

    press('ArrowDown');
    expect(document.activeElement).toBe(rowEl('category-header-later'));
    press('ArrowUp');
    expect(document.activeElement).toBe(rowEl('project-item-p2'));
    press('End');
    expect(document.activeElement).toBe(rowEl('project-item-p3'));
    press('Home');
    expect(document.activeElement).toBe(rowEl('category-header-default'));
  });

  it('ArrowDown still moves the roving row while focus sits on a non-default header chevron', async () => {
    await mount();
    rowEl('category-toggle-later').focus();
    expect(document.activeElement).toBe(rowEl('category-toggle-later'));

    press('ArrowDown');

    expect(document.activeElement).toBe(rowEl('project-item-p3'));
  });
});

// Review finding 6 — `focusedKey` (the roving-tabindex STATE) was never cleared when the row it names
// disappears from `rows` (a project deleted, or a category minimising over a non-active member —
// US5's). `effectiveFocusedKey` then names a row nothing renders, so `tabIndex={effectiveFocusedKey
// === key ? 0 : -1}` matches NOTHING: the whole tree loses its one Tab stop.
describe('the roving tabindex recovers when its row disappears (R finding 6)', () => {
  it('deleting the focused row leaves exactly one OTHER row tabIndex=0, not zero rows', async () => {
    await mount(PROJECTS, [createElement(DeleteTrigger, { id: 'p3' })]);
    rowEl('project-item-p3').focus();
    // `.focus()` is a real DOM call (unlike `fireEvent`), so the `onTreeFocus`-driven `focusedKey`
    // state update it triggers is not guaranteed to have flushed to the `tabindex` attribute yet.
    await waitFor(() => expect(rowEl('project-item-p3')).toHaveAttribute('tabindex', '0'));

    fireEvent.click(screen.getByTestId('test-delete-p3'));
    await waitFor(() => expect(screen.queryByTestId('project-item-p3')).toBeNull());

    const remaining = ['category-header-default', 'project-item-p1', 'project-item-p2', 'category-header-later'];
    const zeroTabIndex = remaining.filter((id) => rowEl(id).getAttribute('tabindex') === '0');
    expect(zeroTabIndex).toHaveLength(1);
  });
});

// Review finding 2 — Enter on a row's Edit/Remove button (real DOM focus, e.g. after a click)
// bubbled to the SAME tree keydown handler, which read the row it lives in and switched the
// project instead of letting the button handle its own Enter.
describe('a nested control keeps its OWN Enter — the tree does not hijack it into a switch (R finding 2)', () => {
  it('Enter on the Edit button opens the edit form, not a switch', async () => {
    const { switched } = await mount();
    const user = userEvent.setup();
    rowEl('project-edit-p1').focus();

    await user.keyboard('{Enter}');

    expect(switched).toEqual([]);
    expect(screen.getByTestId('project-form')).toBeInTheDocument();
  });

  it('Enter on the Remove button opens the confirm dialog, not a switch', async () => {
    const { switched } = await mount();
    const user = userEvent.setup();
    rowEl('project-delete-p1').focus();

    await user.keyboard('{Enter}');

    expect(switched).toEqual([]);
    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument());
  });
});

// Review finding 3 — with zero projects, `listRows` still returns a category-header row (its count
// is simply 0), so the panel's OWN `rows.length === 0` check never fired even though the empty
// message — not those headers — is what actually renders; `focus.projects` landed on an unmounted
// ref and focus went nowhere (FR-018 Edge Case: "the empty state's create control").
describe('focus.projects with zero projects lands on the create control (FR-018 Edge Case)', () => {
  it('requestProjectsFocus() focuses "+ New" when there are no projects', async () => {
    await mount([]);

    requestProjectsFocus();

    expect(document.activeElement).toBe(screen.getByTestId('project-new'));
  });
});

describe('pointerdown and focusin set the active pane to projects (FR-015)', () => {
  it('a pointerdown inside the panel sets the active pane', async () => {
    await mount();
    setActivePane('workspace');

    rowEl('project-item-p1').dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(getActivePane()).toBe('projects');
  });

  it('a focusin (no preceding click) also sets the active pane', async () => {
    await mount();
    setActivePane('workspace');

    rowEl('project-item-p1').focus();

    expect(getActivePane()).toBe('projects');
  });
});
