/**
 * The five 046 side-pane and workspace focus commands, driven through the REAL `KeybindingsHandler`
 * (app.tsx) over REAL `FileExplorerPane` / `ProjectsPanel` components — `project.next`,
 * `project.previous`, `focus.explorer`, `focus.projects` (US2, FR-010 – FR-018, FR-024, SC-002,
 * SC-003) and `focus.workspace` (iterate round 3, FR-116). The chords are FR-117's: B / N / M focus
 * Projects, the workspace and the File Explorer, left to right.
 *
 * `window-chords.ts`'s `COVERED_IN_COMPONENT` claims `focus.projects` (T033) and `focus.workspace`
 * (T177) here; `focus.explorer` is claimed by `window-chord-resolution.e2e.ts` (T049), which presses
 * it from a focused real terminal.
 *
 * The harness below is a stripped `App()`: `onRevealLeft`/`onRevealRight` use the SAME
 * `usePersistedBool` keys App() does (`throng.sidebarVisible` / `throng.explorerVisible`), so a
 * reveal is observable on `localStorage` exactly as the real show/hide control leaves it, and each
 * side pane is mounted only while its own `usePersistedBool` says so — the same conditional the real
 * shell uses, so a reveal that does not actually mount the pane is a real regression here too.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { FileExplorerPane } from '../../src/renderer/panes/file-explorer-pane.js';
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';
import { KeybindingsHandler } from '../../src/renderer/app.js';
import { getActivePane, setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { usePersistedBool } from '../../src/renderer/panes/use-persisted-bool.js';
import {
  __resetPanelFocus,
  registerPanelFocus,
  unregisterPanelFocus,
} from '../../src/renderer/workspace/panel-focus.js';
import type { FileTreeEntry } from '../../src/renderer/global.js';

/** jsdom has no ResizeObserver; `FileTree` needs one to size its virtualised `<Tree>`. */
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

/**
 * Review finding 4 — a real browser's ResizeObserver never fires SYNCHRONOUSLY with `observe()`; it
 * reports back on a later turn, after layout. `ImmediateResizeObserver` above hides that: it resolves
 * width/height inside `observe()` itself, well before `useExplorerData`'s file-listing PROMISE (a
 * microtask) settles `ready` — so in every existing test, width/height are already real by the time
 * `ready` flips true, and `explorer-commands.ts:191`'s registration effect (gated on `ready` alone)
 * never gets to run while the tree still has no size.
 *
 * This one fires on a MACROTASK instead, which resolves strictly AFTER any already-queued microtask —
 * so `ready` settles first, and any registration effect gated on `ready` alone runs while width/height
 * are still (0, 0) and `<Tree>` — and `treeRef` — do not exist yet.
 */
class DeferredResizeObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    const contentRect = {
      width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0,
      toJSON: () => ({}),
    } satisfies DOMRectReadOnly;
    setTimeout(() => this.cb([{ target, contentRect } as ResizeObserverEntry], this), 0);
  }
  unobserve(): void {}
  disconnect(): void {}
}

const now = '2026-01-01T00:00:00.000Z';
const CATEGORIES: ProjectCategoryDto[] = [
  { id: 'default', name: 'In Progress', isDefault: true, minimised: false, createdAt: now, updatedAt: now },
  // Minimised: a non-active member is NOT reachable (FR-011) — this is what proves "skips a
  // minimised category" rather than merely asserting it.
  { id: 'later', name: 'Later', isDefault: false, minimised: true, createdAt: now, updatedAt: now },
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
// p1, p2 in the default category; p3 in the minimised one — unreachable until it holds the active
// project.
const PROJECTS: ProjectDto[] = [project('p1', 'default'), project('p2', 'default'), project('p3', 'later')];

const listing: FileTreeEntry[] = [{ name: 'a.txt', kind: 'file', isSymlink: false, hasChildren: false }];

/** A daemon holding the three fixed projects above, with `setActive` tracked so cycling is provable. */
function multiProjectClient(): { client: ProjectsClient; active: () => string | null } {
  let active: string | null = null;
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: PROJECTS } as unknown as TResult);
        case 'projects.categories.list':
          return Promise.resolve({ categories: CATEGORIES } as unknown as TResult);
        case 'projects.setActive':
          active = (params as { id: string }).id;
          return Promise.resolve({ activeId: active } as unknown as TResult);
        default:
          return Promise.reject(new Error(`unexpected projects RPC: ${method}`));
      }
    },
  };
  return { client: new ProjectsClient(bridge), active: () => active };
}

function fakeServices(): Services {
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string): Promise<TResult> {
      switch (method) {
        case 'document.pruneMissing':
          return Promise.resolve({ pruned: 0 } as TResult);
        case 'fileopUndo.get':
          return Promise.resolve({ stackJson: null } as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
    },
  };
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

/**
 * A stripped `App()`: the reveal setters use the SAME persisted keys App() does — INCLUDING the
 * project-gated routing (review finding 8): the right pane's key is `throng.explorerVisible` with a
 * project active and `throng.explorerVisibleNoProject` without (FR-007/009), exactly the choice
 * `app.tsx`'s own `rightToggle` makes.
 */
function Harness(): ReactElement {
  const { activeProject, projects, categories } = useProjects();
  const projectActive = Boolean(activeProject);
  const left = usePersistedBool('throng.sidebarVisible', true);
  const explorerPref = usePersistedBool('throng.explorerVisible', true);
  const explorerNoProject = usePersistedBool('throng.explorerVisibleNoProject', false);
  const right = projectActive ? explorerPref : explorerNoProject;
  const revealLeft = (): void => {
    if (!left.value) left.set(true);
  };
  const revealRight = (): void => {
    if (!right.value) right.set(true);
  };
  return createElement(
    'div',
    { 'data-testid': 'harness', 'data-listed': `${projects.length}/${categories.length}` },
    createElement(KeybindingsHandler, {
      onToggleProjects: () => left.set(!left.value),
      onToggleExplorer: () => right.set(!right.value),
      onRevealLeft: revealLeft,
      onRevealRight: revealRight,
    }),
    createElement('div', { 'data-testid': 'left-pane' }, left.value ? createElement(ProjectsPanel) : null),
    createElement(
      'div',
      { 'data-testid': 'right-pane' },
      right.value ? createElement(FileExplorerPane, { onResizeStart: vi.fn(), resizing: false }) : null,
    ),
  );
}

async function mount(): Promise<{ active: () => string | null }> {
  const { client, active } = multiProjectClient();
  const services = fakeServices();
  Reflect.set(window, 'throng', {
    files: {
      setRoot: vi.fn(),
      list: vi.fn(() => Promise.resolve({ entries: listing })),
      onChange: vi.fn(() => () => {}),
      onWatchFailed: vi.fn(() => () => {}),
    },
    editor: { isOpen: () => Promise.resolve(false) },
    panel: { notifyTyped: () => {} },
  });
  render(
    createElement(
      ServicesProvider,
      { services },
      createElement(
        ProjectsProvider,
        { client },
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
  // Always present, whichever pane starts hidden — some tests start the left OR right pane hidden,
  // so waiting on either pane's own content would hang forever for exactly the scenario under test.
  await waitFor(() => expect(screen.getByTestId('left-pane')).toBeInTheDocument());
  /*
   * AND until the store has actually LISTED the projects and categories. Every chord test below
   * presses ONCE and then polls for its effect, so a press that lands before the list has committed
   * finds nothing to step through, does nothing, and the poll times out — observed 2 in ~20 runs as
   * "steps backward…" failing at its first `waitFor`, and reproduced every time by delaying
   * `projects.list` 30ms in the fixture. `left-pane` is rendered synchronously and says nothing
   * about that, and waiting on a project ROW would hang the tests that start the left pane hidden.
   */
  await waitFor(() =>
    expect(screen.getByTestId('harness')).toHaveAttribute('data-listed', `${PROJECTS.length}/${CATEGORIES.length}`),
  );
  return { active };
}

const press = (key: string, mods: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}): boolean =>
  fireEvent.keyDown(document.body, { key, code: key, ...mods });

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
  localStorage.clear();
  Reflect.deleteProperty(window, 'throng');
});

describe('project.next / project.previous cycle the SAME switchProject a click calls (FR-010 – FR-013)', () => {
  it('with no active project, Next goes to the FIRST reachable project (R5)', async () => {
    const { active } = await mount();

    // 046 iterate round 1 (FR-102): project.next's shipped chord moved to tier 1.
    expect(press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true })).toBe(false); // prevented — never reaches a terminal
    await waitFor(() => expect(active()).toBe('p1'));
  });

  it('steps forward, stops at the end with no notice, and SKIPS the minimised category (FR-011)', async () => {
    const { active } = await mount();
    press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() => expect(active()).toBe('p1'));

    press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() => expect(active()).toBe('p2'));

    // p3 lives in the MINIMISED category and holds no active project yet, so it is unreachable —
    // the cycle stops at p2 rather than continuing to it.
    press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
    // Review finding 9 — a positive settle signal (flush every pending microtask/effect via `act`),
    // not a blind timer: `stepProject` returning null means `switchProject` is never even called at
    // the boundary, so there is nothing async to outrun, but `act` proves that rather than assuming
    // it, and can never flake against a loaded machine the way a fixed 10ms could.
    await act(async () => {});
    expect(active()).toBe('p2');
    expect(screen.queryByTestId('project-error')).toBeNull(); // no notice at the end
  });

  it('steps backward with Previous, and stops at the start', async () => {
    const { active } = await mount();
    press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() => expect(active()).toBe('p1'));
    press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() => expect(active()).toBe('p2'));

    press('PageUp', { ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() => expect(active()).toBe('p1'));

    press('PageUp', { ctrlKey: true, shiftKey: true, altKey: true });
    await act(async () => {}); // review finding 9 — settle on a real flush, not a fixed 10ms
    expect(active()).toBe('p1'); // stays — the start
  });

  it('changes neither pane’s visibility', async () => {
    await mount();
    // `usePersistedBool` writes its CURRENT value on every mount, defaults included, so the baseline
    // is read AFTER mount settles rather than assumed to be absent.
    const before = {
      left: localStorage.getItem('throng.sidebarVisible'),
      right: localStorage.getItem('throng.explorerVisible'),
    };

    press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
    await act(async () => {}); // review finding 9 — settle on a real flush, not a fixed 10ms

    expect(localStorage.getItem('throng.sidebarVisible')).toBe(before.left);
    expect(localStorage.getItem('throng.explorerVisible')).toBe(before.right);
  });
});

describe('focus.explorer reveals the right pane, sets the active pane, and focuses the tree (FR-016, FR-017, contract §1)', () => {
  /*
   * Review finding 8 — App()'s REAL show control writes a DIFFERENT persisted key depending on
   * whether a project is active (FR-007/009): `throng.explorerVisible` with one,
   * `throng.explorerVisibleNoProject` without — the pane defaults collapsed with no project, but the
   * user may still expand it to the empty placeholder, and that choice must not leak into whether it
   * defaults open the next time a project IS active. No project is ever opened in this test, so "the
   * SAME persisted setter as the show control" means the NO-PROJECT key.
   */
  it('reveals a hidden pane through the SAME persisted setter as the show control — explorerVisibleNoProject with no project', async () => {
    localStorage.setItem('throng.explorerVisibleNoProject', 'false');
    await mount();
    expect(screen.queryByTestId('right-pane')?.textContent).toBe('');

    press('M', { ctrlKey: true, shiftKey: true, altKey: true });

    await waitFor(() => expect(localStorage.getItem('throng.explorerVisibleNoProject')).toBe('true'));
    await waitFor(() => expect(getActivePane()).toBe('files'));
  });

  it('focuses the selected/first row of the tree once it mounts (pending-safe)', async () => {
    localStorage.setItem('throng.explorerVisible', 'false');
    const { active } = await mount();
    // p1 becomes the active project, so the tree that mounts on reveal is a REAL one.
    press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() => expect(active()).toBe('p1'));

    press('M', { ctrlKey: true, shiftKey: true, altKey: true });

    await waitFor(() =>
      expect(document.activeElement?.closest('[data-testid="file-explorer-tree"]')).not.toBeNull(),
    );
  });

  it('review finding 4 — a request parked before the tree has SIZE survives to be honoured once it does', async () => {
    globalThis.ResizeObserver = DeferredResizeObserver;
    try {
      localStorage.setItem('throng.explorerVisible', 'false');
      const { active } = await mount();
      press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
      await waitFor(() => expect(active()).toBe('p1'));

      press('M', { ctrlKey: true, shiftKey: true, altKey: true });

      await waitFor(
        () => expect(document.activeElement?.closest('[data-testid="file-explorer-tree"]')).not.toBeNull(),
        { timeout: 2000 },
      );
    } finally {
      globalThis.ResizeObserver = ImmediateResizeObserver;
    }
  });

  it('a following F2 dispatches file.rename — the tree really has DOM focus, not just the highlight', async () => {
    // Visible from the start: this test is about F2 after the FILE (not the un-renameable root) has
    // real focus, so a file is selected by hand first, exactly as a user's earlier click would leave
    // it, and attention is then moved elsewhere — the state `focus.explorer` has to recover from.
    const { active } = await mount();
    press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() => expect(active()).toBe('p1'));
    const fileRow = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-rel-path="a.txt"]');
      if (!el) throw new Error('a.txt row not rendered yet');
      return el;
    });
    fireEvent.click(fileRow);
    setActivePane('projects'); // attention moves away — the state focus.explorer must recover from

    press('M', { ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-testid="file-explorer-tree"]')).not.toBeNull(),
    );

    fireEvent.keyDown(document.activeElement!, { key: 'F2' });

    await waitFor(() => expect(document.querySelector('.tree-row input')).not.toBeNull());
  });

  it('[derived] with no project open, it focuses the empty placeholder (contract §1)', async () => {
    localStorage.setItem('throng.explorerVisible', 'false');
    await mount(); // no project ever opened

    press('M', { ctrlKey: true, shiftKey: true, altKey: true });

    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('file-explorer-empty')));
  });
});

describe('focus.projects reveals the left pane, sets the active pane, and focuses the active row (FR-015, FR-018)', () => {
  it('reveals a hidden pane, sets the active pane to projects, and F2 does NOT dispatch file.rename (R3)', async () => {
    localStorage.setItem('throng.sidebarVisible', 'false');
    const { active } = await mount();
    /*
     * Review finding 7 — with NO project ever opened, `FileExplorerPane` renders its empty
     * placeholder and no `.tree-row` exists anywhere in the DOM, so `document.querySelector('.tree-row
     * input')` was `null` for a reason that has nothing to do with F2's scope: there was never
     * anything to rename. The negative assertion below could not fail whatever F2 actually
     * dispatched. A real project with a real, SELECTED row is what makes it mean something — the
     * `file.rename` dispatcher (`app.tsx`'s window-level listener) reads the tree's OWN selection, not
     * DOM focus location, so only the SCOPE gate (`getActivePane() === 'projects'`) stands between a
     * selected file and a rename box opening on it.
     */
    press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() => expect(active()).toBe('p1'));
    const fileRow = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-rel-path="a.txt"]');
      if (!el) throw new Error('a.txt row not rendered yet');
      return el;
    });
    fireEvent.click(fileRow);

    expect(screen.queryByTestId('left-pane')?.textContent).toBe('');

    press('B', { ctrlKey: true, shiftKey: true, altKey: true });

    await waitFor(() => expect(localStorage.getItem('throng.sidebarVisible')).toBe('true'));
    await waitFor(() => expect(getActivePane()).toBe('projects'));
    // A row is focused inside the Projects pane, not left on the body or on the sidebar container.
    await waitFor(() => expect(screen.getByTestId('projects-panel').contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.activeElement!, { key: 'F2' });
    // A SELECTED file exists now — this proves the scope refuses file.rename, not merely that
    // there was nothing to act on.
    expect(document.querySelector('.tree-row input')).toBeNull();
  });
});

/*
 * 046 iterate round 3 (T177, FR-116) — `focus.workspace`, the route back to the centre.
 *
 * The harness above pins `WorkspaceProvider` to no project, so it has no layout to move focus into.
 * This one wires the provider to the LIVE active project, the way `App()` does, and answers
 * `workspace.load` with a fixed layout per project. Each panel's "input surface" is a textarea that
 * registers itself in the real panel-focus registry, which is exactly what a terminal or editor view
 * does — so "the panel's input surface holds DOM focus" is observable without mounting either.
 */
const layoutWithSplit = (projectId: string): WorkspaceLayout => ({
  projectId,
  schemaVersion: 1,
  tabs: [
    {
      id: `t-${projectId}`,
      title: 'Tab 1',
      root: {
        type: 'split',
        orientation: 'row',
        sizes: [50, 50],
        children: [
          { type: 'panel', id: `a-${projectId}`, originProjectId: projectId, title: 'A', kind: 'editor', config: {} },
          { type: 'panel', id: `b-${projectId}`, originProjectId: projectId, title: 'B', kind: 'editor', config: {} },
        ],
      },
      // The SECOND panel is active, so "went to the first panel" and "went to the active one" differ.
      activePanelId: `b-${projectId}`,
    },
    {
      id: `t-${projectId}-2`,
      title: 'Tab 2',
      root: { type: 'panel', id: `c-${projectId}`, originProjectId: projectId, title: 'C', kind: 'editor', config: {} },
      activePanelId: `c-${projectId}`,
    },
  ],
  activeTabId: `t-${projectId}`,
});

/** No tab at all — `activeTabId` names nothing (the tabless shape project-switch-active-pane pins). */
const layoutTabless = (projectId: string): WorkspaceLayout => ({
  projectId,
  schemaVersion: 1,
  tabs: [],
  activeTabId: 'none',
});

/** A tab whose split holds no panel — `effectiveActivePanelId` has nothing to answer. */
const layoutPanelless = (projectId: string): WorkspaceLayout => ({
  projectId,
  schemaVersion: 1,
  tabs: [
    {
      id: `t-${projectId}`,
      title: 'Empty',
      root: { type: 'split', orientation: 'row', sizes: [], children: [] },
    },
  ],
  activeTabId: `t-${projectId}`,
});

/** Projects + workspace over one bridge. `layouts` answers `workspace.load` per project. */
function workspaceClient(
  layouts: (projectId: string) => WorkspaceLayout,
): { projects: ProjectsClient; workspace: WorkspaceClient; active: () => string | null } {
  let active: string | null = null;
  const bridge: ThrongBridge = {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: PROJECTS } as unknown as TResult);
        case 'projects.categories.list':
          return Promise.resolve({ categories: CATEGORIES } as unknown as TResult);
        case 'projects.setActive':
          active = (params as { id: string }).id;
          return Promise.resolve({ activeId: active } as unknown as TResult);
        case 'workspace.load': {
          const { projectId } = params as { projectId: string };
          return Promise.resolve({ layout: layouts(projectId), restored: true } as unknown as TResult);
        }
        case 'workspace.save':
          return Promise.resolve({ ok: true } as unknown as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
    },
  };
  return { projects: new ProjectsClient(bridge), workspace: new WorkspaceClient(bridge), active: () => active };
}

/** The live layout's active tab and that tab's active panel, as attributes `waitFor` can poll. */
function LayoutProbe(): ReactElement {
  const { layout } = useWorkspace();
  const tab = layout?.tabs.find((t) => t.id === layout.activeTabId);
  return createElement('div', {
    'data-testid': 'layout-probe',
    'data-active-tab': layout?.activeTabId ?? '',
    'data-active-panel': tab?.activePanelId ?? '',
  });
}

/** One textarea per panel id, each registered as that panel's input surface. */
function PanelInputs({ ids }: { ids: readonly string[] }): ReactElement {
  return createElement(
    'div',
    null,
    ids.map((id) =>
      createElement('textarea', {
        key: id,
        'data-testid': `input-${id}`,
        ref: (el: HTMLTextAreaElement | null) => {
          if (el) registerPanelFocus(id, () => el.focus());
          else unregisterPanelFocus(id);
        },
      }),
    ),
    // Somewhere DOM focus can be put that is none of the above.
    createElement('button', { type: 'button', 'data-testid': 'elsewhere' }, 'elsewhere'),
  );
}

function WorkspaceWire({ client }: { client: WorkspaceClient }): ReactElement {
  const { activeProject } = useProjects();
  return createElement(
    WorkspaceProvider,
    { client, activeProjectId: activeProject?.id ?? null },
    createElement(
      NotificationProvider,
      null,
      createElement(
        ConfirmProvider,
        null,
        createElement(
          ContextMenuProvider,
          null,
          createElement(Harness),
          createElement(LayoutProbe),
          createElement(PanelInputs, { ids: ['a-p1', 'b-p1', 'c-p1', 'a-p2', 'b-p2', 'c-p2'] }),
        ),
      ),
    ),
  );
}

async function mountWorkspace(
  layouts: (projectId: string) => WorkspaceLayout = layoutWithSplit,
): Promise<{ active: () => string | null }> {
  const { projects, workspace, active } = workspaceClient(layouts);
  const services = fakeServices();
  Reflect.set(window, 'throng', {
    files: {
      setRoot: vi.fn(),
      list: vi.fn(() => Promise.resolve({ entries: listing })),
      onChange: vi.fn(() => () => {}),
      onWatchFailed: vi.fn(() => () => {}),
    },
    editor: { isOpen: () => Promise.resolve(false) },
    panel: { notifyTyped: () => {}, publishIdentities: vi.fn() },
  });
  render(
    createElement(
      ServicesProvider,
      { services },
      createElement(ProjectsProvider, { client: projects }, createElement(WorkspaceWire, { client: workspace })),
    ),
  );
  await waitFor(() =>
    expect(screen.getByTestId('harness')).toHaveAttribute('data-listed', `${PROJECTS.length}/${CATEGORIES.length}`),
  );
  return { active };
}

/** Make p1 active and wait until its layout has loaded. */
async function openP1(active: () => string | null): Promise<void> {
  press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
  await waitFor(() => expect(active()).toBe('p1'));
  await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1'));
}

/** Ctrl+Shift+Alt+N on the physical N key, FR-117's `focus.workspace` chord. */
const FOCUS_WORKSPACE_PRESS = { key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true, altKey: true } as const;
const pressFocusWorkspace = (): boolean =>
  fireEvent.keyDown(document.activeElement ?? document.body, FOCUS_WORKSPACE_PRESS);

const visibility = (): Record<string, string | null> => ({
  left: localStorage.getItem('throng.sidebarVisible'),
  right: localStorage.getItem('throng.explorerVisible'),
  rightNoProject: localStorage.getItem('throng.explorerVisibleNoProject'),
});

describe('focus.workspace returns focus to the active tab’s active panel, and switches nothing (FR-116)', () => {
  afterEach(() => {
    __resetPanelFocus();
  });

  it('from a focused Projects pane: the workspace becomes active and the active panel’s input holds focus', async () => {
    const { active } = await mountWorkspace();
    await openP1(active);

    press('B', { ctrlKey: true, shiftKey: true, altKey: true }); // focus.projects
    await waitFor(() => expect(getActivePane()).toBe('projects'));
    await waitFor(() => expect(screen.getByTestId('projects-panel').contains(document.activeElement)).toBe(true));
    const before = visibility();

    expect(pressFocusWorkspace()).toBe(false); // prevented — the chord never reaches a panel

    await waitFor(() => expect(getActivePane()).toBe('workspace'));
    expect(document.activeElement).toBe(screen.getByTestId('input-b-p1'));
    // Nothing switched: tab, panel and project are as they were, and neither pane moved.
    expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1');
    expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-panel', 'b-p1');
    expect(active()).toBe('p1');
    expect(visibility()).toEqual(before);
  });

  it('from a focused File Explorer: the same', async () => {
    const { active } = await mountWorkspace();
    await openP1(active);

    press('M', { ctrlKey: true, shiftKey: true, altKey: true }); // focus.explorer
    await waitFor(() => expect(getActivePane()).toBe('files'));
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-testid="file-explorer-tree"]')).not.toBeNull(),
    );
    const before = visibility();

    expect(pressFocusWorkspace()).toBe(false);

    await waitFor(() => expect(getActivePane()).toBe('workspace'));
    expect(document.activeElement).toBe(screen.getByTestId('input-b-p1'));
    expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1');
    expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-panel', 'b-p1');
    expect(active()).toBe('p1');
    expect(visibility()).toEqual(before);
  });

  it('with the workspace already active and DOM focus moved elsewhere, it puts focus back in the panel', async () => {
    const { active } = await mountWorkspace();
    await openP1(active);
    setActivePane('workspace');
    screen.getByTestId('elsewhere').focus();
    expect(document.activeElement).toBe(screen.getByTestId('elsewhere'));

    pressFocusWorkspace();

    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('input-b-p1')));
    expect(getActivePane()).toBe('workspace');
    expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-panel', 'b-p1');
  });

  it('with no project, nothing changes and no notice is raised', async () => {
    const { active } = await mountWorkspace();
    setActivePane('projects');
    screen.getByTestId('elsewhere').focus();
    const before = visibility();

    expect(pressFocusWorkspace()).toBe(false); // still swallowed, as every claimed chord is

    await act(async () => {});
    expect(active()).toBeNull();
    expect(getActivePane()).toBe('projects');
    expect(document.activeElement).toBe(screen.getByTestId('elsewhere'));
    expect(visibility()).toEqual(before);
    expect(screen.queryAllByTestId('notice-body')).toEqual([]);
  });

  it('with no active tab, nothing changes and no notice is raised', async () => {
    const { active } = await mountWorkspace(layoutTabless);
    press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() => expect(active()).toBe('p1'));
    await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 'none'));
    setActivePane('projects');
    screen.getByTestId('elsewhere').focus();

    pressFocusWorkspace();

    await act(async () => {});
    expect(getActivePane()).toBe('projects');
    expect(document.activeElement).toBe(screen.getByTestId('elsewhere'));
    expect(screen.queryAllByTestId('notice-body')).toEqual([]);
  });

  it('with a tab that holds no panel, nothing changes and no notice is raised', async () => {
    const { active } = await mountWorkspace(layoutPanelless);
    press('PageDown', { ctrlKey: true, shiftKey: true, altKey: true });
    await waitFor(() => expect(active()).toBe('p1'));
    await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1'));
    setActivePane('projects');
    screen.getByTestId('elsewhere').focus();

    pressFocusWorkspace();

    await act(async () => {});
    expect(getActivePane()).toBe('projects');
    expect(document.activeElement).toBe(screen.getByTestId('elsewhere'));
    expect(screen.queryAllByTestId('notice-body')).toEqual([]);
  });
});

describe('focus.left/right/up/down/cycle never land on a side pane (FR-024)', () => {
  it('leaves the active pane exactly where it was', async () => {
    await mount();
    setActivePane('workspace');

    // 046 iterate round 1 (FR-102): focus.left's shipped chord moved to tier 1.
    press('ArrowLeft', { ctrlKey: true, shiftKey: true, altKey: true });

    expect(getActivePane()).toBe('workspace');
  });
});
