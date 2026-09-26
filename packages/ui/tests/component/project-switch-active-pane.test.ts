/**
 * 046 iterate round 1 (FR-082, T130) — REPRO of the reported defect "clicking a project flashes the
 * active pane".
 *
 * SUPERSEDES this file's own pre-round-1 content: `PanelFocusSync` (app.tsx) calling
 * `setActivePane('workspace')` on every active-tab change was itself the US2 fix-round-1 behaviour
 * (commit `52d8f13d`) this file used to pin. FR-082 narrows that: for a switch INITIATED FROM THE
 * PROJECTS PANE LIST — a click on a row, or Enter on the selected row — the active pane MUST stay
 * `projects` throughout, never `workspace`, not even transiently; the workspace becomes active only
 * on its own routes (a pointer-down/click in it, a `focus.*` chord). `project.next` / `project.previous`
 * must leave the active pane exactly where it was before the chord.
 *
 * WHAT IS RED, AND WHY: `PanelFocusSync`'s effect (`app.tsx:672`) still calls
 * `setActivePane('workspace')` unconditionally whenever `activeTabId` changes — which a project
 * switch always does, regardless of what caused it. Nothing in `projects-panel.tsx` or
 * `projects-store.tsx` marks a switch's origin yet (that is T136 GREEN), so every list-initiated
 * switch below still ends up recording 'workspace', and every `project.next`/`project.previous`
 * dispatched while the Projects pane is active does too.
 *
 * `paneLog` records EVERY `setActivePane` call, not just the net effect — a flash is exactly the kind
 * of transient value a plain `getActivePane()` read after the fact could miss if it happened to have
 * flashed back.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider, useProjects } from '../../src/renderer/state/projects-store.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';
import { EditorKeybindings } from '../../src/renderer/editor/editor-chrome.js';
import { PanelFocusSync } from '../../src/renderer/app.js';
import {
  registerEditorActions,
  unregisterEditorActions,
  type EditorActions,
} from '../../src/renderer/editor/editor-actions.js';
import { useSidePaneActions } from '../../src/renderer/workspace/side-pane-actions.js';
import { getActivePane, setActivePane, type ActivePane } from '../../src/renderer/workspace/active-pane.js';
import { __resetPanelFocus, registerPanelFocus } from '../../src/renderer/workspace/panel-focus.js';

const paneLog = vi.hoisted((): ActivePane[] => []);

vi.mock('../../src/renderer/workspace/active-pane.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/workspace/active-pane.js')>();
  return {
    ...actual,
    setActivePane: (pane: ActivePane) => {
      paneLog.push(pane);
      actual.setActivePane(pane);
    },
  };
});

const now = '2026-01-01T00:00:00.000Z';
const CATEGORIES: ProjectCategoryDto[] = [
  { id: 'default', name: 'In Progress', isDefault: true, minimised: false, createdAt: now, updatedAt: now },
];
const project = (id: string): ProjectDto => ({
  id,
  name: id,
  colour: '#3b82f6',
  rootFolder: `C:/projects/${id}`,
  isActive: false,
  createdAt: now,
  updatedAt: now,
  hiddenPaths: [],
  categoryId: 'default',
});
const PROJECTS: ProjectDto[] = [project('p1'), project('p2'), project('p3')];

/** Two tabs, each one already-typed editor Panel — no async `setPanelType` needed after the switch.
 *  The second tab (`t-<id>b`) exists so a test can simulate a GENUINE same-project tab switch (the
 *  tab picker's route, which has no `setActivePane` call of its own and relies entirely on
 *  `PanelFocusSync`) without touching any other project's fixture. */
const layoutFor = (projectId: string): WorkspaceLayout => ({
  projectId,
  schemaVersion: 1,
  tabs: [
    {
      id: `t-${projectId}`,
      title: 'Tab 1',
      root: {
        type: 'panel',
        id: `ed-${projectId}`,
        originProjectId: projectId,
        title: 'Editor',
        kind: 'editor',
        config: { filePath: `C:/projects/${projectId}/file.ts` },
      },
      activePanelId: `ed-${projectId}`,
    },
    {
      id: `t-${projectId}b`,
      title: 'Tab 2',
      root: {
        type: 'panel',
        id: `ed-${projectId}b`,
        originProjectId: projectId,
        title: 'Editor 2',
        kind: 'editor',
        config: { filePath: `C:/projects/${projectId}/file2.ts` },
      },
      activePanelId: `ed-${projectId}b`,
    },
  ],
  activeTabId: `t-${projectId}`,
});

/**
 * Fix-round-2 regression (branch review hypothesis) — p3's layout starts with NO tabs at all,
 * `activeTabId` naming nothing real. `effectiveActivePanelId` then has no tab to resolve at all
 * (`layout.tabs.find(...)` finds nothing), so `activePanelId` is falsy the same way it would be for
 * a tab that exists but holds no panel — `PanelFocusSync`'s old guard
 * (`activeTabId !== null && … && activePanelId`) never reached `consumeProjectSwitchPending` for
 * either shape, so a switch INTO p3 left the mark stuck for whatever `activeTabId` change came next.
 * `'none'` rather than `''` so a DOM assertion failure names the sentinel, not an empty string.
 */
const TABLESS_ACTIVE_TAB_ID = 'none';
const layoutForTabless = (projectId: string): WorkspaceLayout => ({
  projectId,
  schemaVersion: 1,
  tabs: [],
  activeTabId: TABLESS_ACTIVE_TAB_ID,
});

/** `failSetActiveFor`, when given, makes `projects.setActive` for that ONE project id reject — the
 *  daemon-refused-the-switch path (regression test below). Every other project still switches fine. */
function fakeBridge(failSetActiveFor?: string): ThrongBridge {
  return {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: PROJECTS } as unknown as TResult);
        case 'projects.categories.list':
          return Promise.resolve({ categories: CATEGORIES } as unknown as TResult);
        case 'projects.setActive': {
          const { id } = params as { id: string };
          if (id === failSetActiveFor) return Promise.reject(new Error('refused'));
          return Promise.resolve({ activeId: id } as unknown as TResult);
        }
        case 'workspace.load': {
          const { projectId } = params as { projectId: string };
          const layout = projectId === 'p3' ? layoutForTabless(projectId) : layoutFor(projectId);
          return Promise.resolve({ layout, restored: true } as unknown as TResult);
        }
        case 'workspace.save':
          return Promise.resolve({ ok: true } as unknown as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
    },
  };
}

/** Exposes the live workspace layout's active tab as a data attribute — a deterministic "the async
 *  switch has settled" signal `waitFor` can poll, standing in for a visible editor DOM this harness
 *  never mounts. */
function LayoutProbe(): ReactElement {
  const { layout } = useWorkspace();
  return createElement('div', { 'data-testid': 'layout-probe', 'data-active-tab': layout?.activeTabId ?? '' });
}

/** `dispatch('project.next')` behind a button — the SAME dispatch the cog menu's Navigate section and
 *  the chord handler both call (`side-pane-actions.ts`), so exercising it here exercises production
 *  behaviour, not a re-derived stand-in. */
function DispatchNext(): ReactElement {
  const { dispatch } = useSidePaneActions(
    () => {},
    () => {},
  );
  return createElement('button', {
    type: 'button',
    'data-testid': 'dispatch-project-next',
    onClick: () => dispatch('project.next'),
  });
}

/** `setActiveTab` to WHICHEVER of the current project's two tabs is not already active — the tab
 *  picker's own route (`tab-picker.tsx`'s `onChoose`), which carries no `setActivePane` call of its
 *  own and so is the one same-project tab switch that depends entirely on `PanelFocusSync`. */
function ToggleTab(): ReactElement {
  const { layout, setActiveTab } = useWorkspace();
  const other = layout?.tabs.find((t) => t.id !== layout.activeTabId)?.id ?? null;
  return createElement('button', {
    type: 'button',
    'data-testid': 'toggle-tab',
    disabled: other === null,
    onClick: () => other && setActiveTab(other),
  });
}

/** `addTab()` behind a button — the same store method the New Tab control and menu item call, with
 *  no `setActivePane` call of its own (`workspace-store.tsx`), so it depends entirely on
 *  `PanelFocusSync` — exactly the route p3's tabless layout starves. */
function AddTab(): ReactElement {
  const { addTab } = useWorkspace();
  return createElement('button', {
    type: 'button',
    'data-testid': 'add-tab',
    onClick: () => addTab(),
  });
}

/** Wires `WorkspaceProvider`'s `activeProjectId` to the live project, the way `App()` does. */
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
          createElement(
            'div',
            null,
            createElement(ProjectsPanel),
            createElement(EditorKeybindings, { isSubWorkspace: false }),
            createElement(PanelFocusSync),
            createElement(LayoutProbe),
            createElement(DispatchNext),
            createElement(ToggleTab),
            createElement(AddTab),
          ),
        ),
      ),
    ),
  );
}

async function mount(bridge: ThrongBridge = fakeBridge()): Promise<void> {
  const projectsClient = new ProjectsClient(bridge);
  const workspaceClient = new WorkspaceClient(bridge);
  Reflect.set(window, 'throng', {
    editor: { isOpen: () => Promise.resolve(false) },
    panel: { notifyTyped: vi.fn(), publishIdentities: vi.fn() },
  });
  render(
    createElement(
      ProjectsProvider,
      { client: projectsClient },
      createElement(WorkspaceWire, { client: workspaceClient }),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('project-item-p1')).toBeInTheDocument());
}

/** Switches to p1 and waits for the async `workspace.load` round trip to settle, so the tests below
 *  start from a known, quiescent state before resetting `paneLog`. */
async function switchToP1AndSettle(): Promise<void> {
  fireEvent.click(screen.getByTestId('project-switch-p1'));
  await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1'));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  paneLog.length = 0;
});

afterEach(() => {
  setActivePane('workspace');
  unregisterEditorActions('ed-p1');
  unregisterEditorActions('ed-p2');
  unregisterEditorActions('ed-p1b');
  unregisterEditorActions('ed-p2b');
  __resetPanelFocus();
  Reflect.deleteProperty(window, 'throng');
});

/** A ready-to-register save spy for the SECOND tab's editor — used by both regression tests below to
 *  prove focus genuinely reached the workspace, the same way the 52d8f13d test above does for the
 *  first tab. */
function saveSpyActions(): { save: ReturnType<typeof vi.fn>; actions: EditorActions } {
  const save = vi.fn(() => Promise.resolve(true));
  return {
    save,
    actions: {
      save,
      saveAs: vi.fn(() => Promise.resolve(true)),
      isDirty: () => true,
      openFile: () => Promise.resolve(),
      revert: () => {},
      reloadFromDisk: () => Promise.resolve(true),
    },
  };
}

describe(
  'a list-initiated project switch stays on the Projects pane — repro of "clicking a project flashes the active pane" (FR-082)',
  () => {
    it('a click on project-switch-p1 never records "workspace", and DOM focus stays on the chosen row', async () => {
      await mount();
      paneLog.length = 0;

      // A real click delivers a pointerdown to the panel container FIRST (jsdom `fireEvent.click`
      // does not), which is what claims the active pane as 'projects' before the switch.
      screen.getByTestId('project-item-p1').dispatchEvent(new Event('pointerdown', { bubbles: true }));
      fireEvent.click(screen.getByTestId('project-switch-p1'));

      await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(paneLog).not.toContain('workspace');
      expect(getActivePane()).toBe('projects');
      expect(document.activeElement).toBe(screen.getByTestId('project-item-p1'));
    });

    it('Enter on the selected row does the same switch a click makes, and never records "workspace"', async () => {
      await mount();
      const row = screen.getByTestId('project-item-p1');
      row.focus();
      paneLog.length = 0;

      fireEvent.keyDown(row, { key: 'Enter' });

      await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(paneLog).not.toContain('workspace');
      expect(getActivePane()).toBe('projects');
    });
  },
);

/**
 * Supersession S26 (spec 046, controller ruling `bb0e3e85`) — FR-082 covers a LIST-INITIATED
 * switch only. `project.next`/`project.previous` pressed FROM THE PROJECTS PANE is the same route
 * (the chord dispatched while the list already holds the active pane) and stays there. Pressed FROM
 * THE WORKSPACE — a panel already holds focus — it is 023 FR-030/#144's route, unchanged: the new
 * project's active panel still takes real focus, exactly as `editor-caret-persist.e2e.ts:173` pins
 * end-to-end. `projects-store.tsx`'s `switchProject` tells the two apart by `getActivePane()` at the
 * moment it is called, not by which caller dispatched it.
 *
 * WHAT WAS RED, AND WHY (fix-round regression, live E2E defect): `switchProject` marked its
 * "PanelFocusSync must not claim the workspace" flag for EVERY switch, chord included, whichever
 * pane was active. A workspace-chord switch therefore had its own focus delivery suppressed —
 * `setActivePane('workspace')`/`requestPanelFocus` never ran — leaving `getActivePane()` reporting
 * 'workspace' (the flag never MOVED the active pane away from it) while DOM focus landed nowhere:
 * open a project's editor, click another project, click its panel, then project.previous — the
 * first project's freshly mounted editor never took focus, and typing went nowhere.
 */
describe('project.next leaves the active pane exactly where it was before the chord, and still delivers focus from the workspace (FR-082, S26)', () => {
  it('from the Projects pane, project.next leaves the active pane on "projects" and never records "workspace"', async () => {
    await mount();
    await switchToP1AndSettle();
    setActivePane('projects');
    paneLog.length = 0;

    fireEvent.click(screen.getByTestId('dispatch-project-next'));

    await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p2'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getActivePane()).toBe('projects');
    expect(paneLog).not.toContain('workspace');
  });

  it('from the workspace, project.next claims the workspace and delivers real focus into the new project’s panel (S26, 023 FR-030/#144)', async () => {
    await mount();
    await switchToP1AndSettle();
    setActivePane('workspace');
    const focused: string[] = [];
    registerPanelFocus('ed-p2', () => focused.push('ed-p2'));
    paneLog.length = 0;

    fireEvent.click(screen.getByTestId('dispatch-project-next'));

    await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p2'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Unlike a list-initiated switch, THIS transition itself must claim the workspace — not merely
    // "still report workspace" from before the chord, which a suppressed claim would satisfy too.
    expect(paneLog).toContain('workspace');
    expect(getActivePane()).toBe('workspace');
    expect(focused).toEqual(['ed-p2']);
  });
});

describe('the workspace still becomes active on its own routes, and the 52d8f13d Ctrl+S fix still holds (FR-082)', () => {
  it("after a pointer-down in the workspace, Ctrl+S reaches the new project's editor", async () => {
    await mount();
    const save = vi.fn(() => Promise.resolve(true));
    const actions: EditorActions = {
      save,
      saveAs: vi.fn(() => Promise.resolve(true)),
      isDirty: () => true,
      openFile: () => Promise.resolve(),
      revert: () => {},
      reloadFromDisk: () => Promise.resolve(true),
    };
    registerEditorActions('ed-p1', actions);

    await switchToP1AndSettle();
    // The user's OWN route into the workspace (FR-082's carve-out) — not the list switch itself.
    setActivePane('workspace');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});

/**
 * Fix-round regression (controller finding, "CRITICAL") — `switchProject` marked its
 * "don't claim the workspace" flag UNCONDITIONALLY, including for a switch to the project that is
 * ALREADY active (a redundant click, or Enter, on the active row — `projects-panel.tsx`'s switch
 * button and `onTreeKeyDown` both call `switchProject` with no active-project guard). That no-op
 * switch never changes `activeTabId`, so `PanelFocusSync` never gets a change to consume the flag on
 * — it survives, stale, until the NEXT genuine activeTabId change, which then WRONGLY skips
 * `setActivePane('workspace')`/`requestPanelFocus`. The tab picker's own route
 * (`tab-picker.tsx`'s `onChoose`, simulated here via `ToggleTab`/`useWorkspace().setActiveTab`) is
 * exactly the 52d8f13d/FR-014 case this breaks: no other code claims the workspace for it, so a
 * stuck flag leaves Ctrl+S dead until the user clicks into the editor by hand.
 */
describe('a redundant switch to the already-active project must not stick the "skip the workspace claim" flag (fix-round regression)', () => {
  it('after a redundant click on the active row, a genuine same-project tab switch still claims the workspace and Ctrl+S reaches it', async () => {
    await mount();
    await switchToP1AndSettle();
    const { save, actions } = saveSpyActions();
    registerEditorActions('ed-p1b', actions);

    // Redundant: p1 is already active. Must not change activeTabId, and must not leave a pending
    // flag behind for the unrelated tab switch below.
    fireEvent.click(screen.getByTestId('project-switch-p1'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1');

    paneLog.length = 0;
    fireEvent.click(screen.getByTestId('toggle-tab'));

    await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1b'));
    expect(paneLog).toContain('workspace');
    expect(getActivePane()).toBe('workspace');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it('Enter on the already-active row is the same no-op, and the next genuine tab switch still claims the workspace', async () => {
    await mount();
    await switchToP1AndSettle();
    const row = screen.getByTestId('project-item-p1');
    row.focus();

    fireEvent.keyDown(row, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1');

    paneLog.length = 0;
    fireEvent.click(screen.getByTestId('toggle-tab'));

    await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1b'));
    expect(paneLog).toContain('workspace');
    expect(getActivePane()).toBe('workspace');
  });

  it('rejecting projects.setActive does not leave the flag stuck either — the next genuine tab switch still claims the workspace', async () => {
    await mount(fakeBridge('p2'));
    await switchToP1AndSettle();

    // Attempt to switch to p2; the daemon refuses it, and the store reverts to p1. `layout` never
    // clears while a load is in flight (`workspace-store.tsx`), so `data-active-tab` reads "t-p1"
    // throughout — waiting on IT would settle trivially, before the revert's own fresh reload of
    // p1 has actually run. Wait on the refusal's own notice instead, then let that reload's promise
    // chain drain, so the flag-stuck bug this test is for isn't masked by a race in the test itself.
    fireEvent.click(screen.getByTestId('project-switch-p2'));
    await screen.findByTestId('project-error');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { save, actions } = saveSpyActions();
    registerEditorActions('ed-p1b', actions);

    paneLog.length = 0;
    fireEvent.click(screen.getByTestId('toggle-tab'));

    await waitFor(() => expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', 't-p1b'));
    expect(paneLog).toContain('workspace');
    expect(getActivePane()).toBe('workspace');

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});

/**
 * Fix-round-2 regression (branch review hypothesis) — the pending mark was consumed only inside
 * `PanelFocusSync`'s "deliver focus into a Panel" branch, gated on `activeTabId !== null && …
 * && activePanelId`. Switching INTO p3 — a project with NO tabs at all — never satisfies that
 * gate (`activePanelId` is falsy with nothing to resolve), so the mark from THAT switch survived
 * to wrongly suppress the workspace claim for whatever `activeTabId` change came next: here, the
 * user adding p3's first tab (`addTab()`, which carries no `setActivePane` call of its own —
 * `workspace-store.tsx` — and so depends entirely on `PanelFocusSync`).
 */
describe('a switch into a tabless project must not stick the pending mark either (fix-round-2 regression, branch review hypothesis)', () => {
  it('after switching to a project with no tabs, adding its first tab still claims the workspace', async () => {
    await mount();

    fireEvent.click(screen.getByTestId('project-switch-p3'));
    await waitFor(() =>
      expect(screen.getByTestId('layout-probe')).toHaveAttribute('data-active-tab', TABLESS_ACTIVE_TAB_ID),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    paneLog.length = 0;
    fireEvent.click(screen.getByTestId('add-tab'));

    await waitFor(() =>
      expect(screen.getByTestId('layout-probe')).not.toHaveAttribute('data-active-tab', TABLESS_ACTIVE_TAB_ID),
    );
    expect(paneLog).toContain('workspace');
    expect(getActivePane()).toBe('workspace');
  });
});
