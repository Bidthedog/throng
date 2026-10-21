/**
 * Go to Next Marked Panel (057 US7, FR-080, FR-081; research R14, R15).
 *
 * `focus.nextMarkedPanel`, Ctrl+Shift+Alt+G, is a WINDOW command: it must fire from a focused terminal
 * (a textarea inside a panel here stands in for xterm's, and the claim is that the chord is consumed
 * before it can reach it). Pressed through the REAL `KeybindingsHandler` over the real stores.
 * `window-chords.ts` claims this chord here (`COVERED_IN_COMPONENT`), which is why the press uses key
 * `G` with Ctrl, Shift and Alt.
 *
 * ANTI-VACUITY CONTROL: remove the `case 'focus.nextMarkedPanel'` in the dispatcher and every test here
 * fails; sort the order by raise time instead of the project/tab/panel order and the two-mark test fails.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addPanel, collectPanels, createDefaultLayout, type WorkspaceLayout } from '@throng/core';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { ProjectsProvider, useProjects, type ProjectsContextValue } from '../../src/renderer/state/projects-store.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { KeybindingsHandler } from '../../src/renderer/app.js';
import { AttentionNavigation } from '../../src/renderer/attention/attention-navigation.js';
import { __resetAttentionStore, setAttentionMarks } from '../../src/renderer/attention/attention-store.js';
import { __resetPanelFocus, registerPanelFocus } from '../../src/renderer/workspace/panel-focus.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { makeMark } from './attention-fixtures.js';

const NOW = '2026-01-01T00:00:00.000Z';
const project = (id: string): ProjectDto => ({
  id, name: id, colour: '#3b82f6', rootFolder: `C:/c/${id}`, isActive: false,
  createdAt: NOW, updatedAt: NOW, hiddenPaths: [], categoryId: 'default',
});
const DEFAULT_CATEGORY: ProjectCategoryDto = {
  id: 'default', name: 'default', isDefault: true, minimised: false, createdAt: NOW, updatedAt: NOW,
};
const firstPanelOf = (projectId: string): string => `pn-${projectId}`;
const SECOND_OF_P2 = 'pn-p2-second';

function makeBridge() {
  const rpcs: string[] = [];
  const bridge = {
    invoke: vi.fn(async (method: string, params?: unknown): Promise<unknown> => {
      rpcs.push(method);
      switch (method) {
        case 'projects.list': return { projects: [project('p1'), project('p2')] };
        case 'projects.categories.list': return { categories: [DEFAULT_CATEGORY] };
        case 'projects.setActive': return { activeId: (params as { id: string }).id };
        case 'workspace.load': {
          const { projectId } = params as { projectId: string };
          const base: WorkspaceLayout = createDefaultLayout(projectId, { tab: `t-${projectId}`, panel: firstPanelOf(projectId) });
          // p2 holds a second panel after the first, so "first in layout order" is a real choice there.
          const layout = projectId === 'p2' ? addPanel(base, `t-${projectId}`, SECOND_OF_P2) : base;
          return { layout, restored: true };
        }
        case 'workspace.save': return { ok: true };
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list': return { subWorkspaces: [] };
        default: throw new Error(`unexpected RPC: ${method}`);
      }
    }),
  } as unknown as ThrongBridge;
  return { bridge, rpcs };
}

const seen: { projects: ProjectsContextValue | null; ws: ReturnType<typeof useWorkspace> | null } = { projects: null, ws: null };
let workspaceClient: WorkspaceClient;

function Probe(): null {
  seen.projects = useProjects();
  seen.ws = useWorkspace();
  return null;
}
function ActiveWorkspace({ children }: { children: ReactNode }): ReactElement {
  const { activeProject } = useProjects();
  return createElement(WorkspaceProvider, { client: workspaceClient, activeProjectId: activeProject?.id ?? null, children });
}

async function mount(): Promise<string[]> {
  Reflect.set(window, 'throng', {
    editor: { subWorkspaceFiles: () => Promise.resolve([]) },
    projects: { onChanged: () => () => {}, notifyChanged: () => {} },
    panels: { publishIdentities: () => {} },
    panel: { notifyDestroyed: () => {} },
    attention: { onFocusPanel: () => () => {}, onChanged: () => () => {}, goTo: vi.fn() },
  });
  const { bridge, rpcs } = makeBridge();
  workspaceClient = new WorkspaceClient(bridge);
  render(
    createElement(ProjectsProvider, { client: new ProjectsClient(bridge) },
      createElement(ActiveWorkspace, null,
        createElement(NotificationProvider, null,
          createElement(Probe),
          createElement(AttentionNavigation),
          createElement('div', { 'data-panel-host': 'host-a' }, createElement('textarea', { 'data-testid': 'terminal-input' })),
          createElement(KeybindingsHandler, {
            onToggleProjects: vi.fn(), onToggleExplorer: vi.fn(), onRevealLeft: vi.fn(), onRevealRight: vi.fn(),
          })))),
  );
  await waitFor(() => expect(seen.projects?.projects.length).toBe(2));
  await act(async () => {
    await seen.projects!.switchProject('p1');
  });
  await waitFor(() => expect(seen.ws?.layout?.projectId).toBe('p1'));
  return rpcs;
}

/** The chord's own press: key G with Ctrl, Shift and Alt. Returns `false` when the window consumed it. */
const pressNext = (target: Element = document.body): boolean =>
  fireEvent.keyDown(target, { key: 'G', code: 'KeyG', ctrlKey: true, shiftKey: true, altKey: true });

/** A second panel in p1's first tab: panel A is the default, B is added. Returns [A, B]. */
async function twoPanels(): Promise<[string, string]> {
  const a = firstPanelOf('p1');
  let b = '';
  act(() => {
    b = seen.ws!.addPanel('t-p1');
  });
  await waitFor(() => expect(collectPanels(seen.ws!.layout!.tabs[0].root)).toHaveLength(2));
  return [a, b];
}

beforeEach(() => {
  __resetPanelFocus();
  __resetAttentionStore();
  setActivePane('workspace');
  seen.projects = null;
  seen.ws = null;
});
afterEach(() => {
  __resetPanelFocus();
  __resetAttentionStore();
  Reflect.deleteProperty(window, 'throng');
});

describe('Go to Next Marked Panel', () => {
  it('focuses the next marked panel in the current project (US7 AS1)', async () => {
    await mount();
    const [a, b] = await twoPanels();
    const focusA = vi.fn();
    const focusB = vi.fn();
    registerPanelFocus(a, focusA);
    registerPanelFocus(b, focusB);
    act(() => setAttentionMarks([makeMark(b, 'p1')]));
    pressNext();
    await waitFor(() => expect(focusB).toHaveBeenCalled());
    expect(focusA).not.toHaveBeenCalled();
  });

  it('switches project and then focuses when the next marked panel is in another one (US7 AS1)', async () => {
    await mount();
    const focus = vi.fn();
    registerPanelFocus(firstPanelOf('p2'), focus);
    act(() => setAttentionMarks([makeMark(firstPanelOf('p2'), 'p2')]));
    pressNext();
    await waitFor(() => expect(seen.ws?.layout?.projectId).toBe('p2'));
    await waitFor(() => expect(focus).toHaveBeenCalled());
  });

  it('goes in project, tab, panel order from where the user is, and wraps (FR-080)', async () => {
    await mount();
    const [a, b] = await twoPanels();
    const focusB = vi.fn();
    const focusP2 = vi.fn();
    registerPanelFocus(a, vi.fn());
    registerPanelFocus(b, focusB);
    registerPanelFocus(firstPanelOf('p2'), focusP2);
    // Raised in the OPPOSITE order to the navigation order: p2's panel first.
    act(() => setAttentionMarks([makeMark(firstPanelOf('p2'), 'p2'), makeMark(b, 'p1')]));
    pressNext(); // from A: B is next
    await waitFor(() => expect(focusB).toHaveBeenCalledTimes(1));
    expect(focusP2).not.toHaveBeenCalled();
  });

  it('in a project this window has not loaded, takes the FIRST marked panel in its layout order, not the oldest raised (FR-080, T071)', async () => {
    await mount();
    const first = vi.fn();
    const second = vi.fn();
    registerPanelFocus(firstPanelOf('p2'), first);
    registerPanelFocus(SECOND_OF_P2, second);
    // Raised in REVERSE layout order: the later panel is the older mark, which is what core's unloaded-project
    // ordering (raisedAt) would pick before the layout is known.
    act(() => setAttentionMarks([makeMark(SECOND_OF_P2, 'p2', { raisedAt: 1 }), makeMark(firstPanelOf('p2'), 'p2', { raisedAt: 2 })]));
    pressNext();
    await waitFor(() => expect(seen.ws?.layout?.projectId).toBe('p2'));
    await waitFor(() => expect(first).toHaveBeenCalled());
    expect(second).not.toHaveBeenCalled();
  });

  it('does nothing, and raises no notice, when nothing is marked (US7 AS2)', async () => {
    const rpcs = await mount();
    const [a, b] = await twoPanels();
    const focus = vi.fn();
    registerPanelFocus(a, focus);
    registerPanelFocus(b, focus);
    const setActiveBefore = rpcs.filter((m) => m === 'projects.setActive').length;
    pressNext();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(focus).not.toHaveBeenCalled();
    expect(rpcs.filter((m) => m === 'projects.setActive').length).toBe(setActiveBefore);
    expect(document.querySelector('[data-testid="notices"]')?.children.length ?? 0).toBe(0);
  });

  it('is consumed by the window when pressed in a focused terminal, so it never reaches the shell', async () => {
    await mount();
    const [, b] = await twoPanels();
    const focusB = vi.fn();
    registerPanelFocus(b, focusB);
    act(() => setAttentionMarks([makeMark(b, 'p1')]));
    const input = document.querySelector<HTMLTextAreaElement>('[data-testid="terminal-input"]')!;
    input.focus();
    expect(pressNext(input)).toBe(false); // preventDefault'd in the capture phase
    await waitFor(() => expect(focusB).toHaveBeenCalled());
  });
});
