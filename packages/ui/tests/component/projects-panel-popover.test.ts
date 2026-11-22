/**
 * #695, 077 FR-027 — a project row uses the row's full width until it is hovered, and shows ONE popover
 * after `projects.popoverDelayMs`: the full name, the ID, the full path, the tab and panel counts and
 * "Double-click to rename". `projects.popoverEnabled` off shows none. The move handle, the action buttons
 * and the attention mark keep their own tooltips, so resting on them shows no row popover.
 *
 * Layer: component — the REAL `ProjectsPanel`; the two settings are steered through `useAppSettings`.
 * Where the buttons sit and how the labels shrink is layout, left to the manual plan.
 *
 * ANTI-VACUITY CONTROL: arm the popover on the grip and the controls too and the "own tooltip" test
 * fails; ignore `popoverEnabled` and the "off" test fails; open it on pointer entry with no delay and the
 * "before the delay" assertion fails.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ProjectsPanel } from '../../src/renderer/sidebar/projects-panel.js';

const knobs = vi.hoisted(() => ({ delay: 300, enabled: true }));
vi.mock('../../src/renderer/config/config-store.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/renderer/config/config-store.js')>();
  const { useMemo } = await import('react');
  return {
    ...real,
    useAppSettings: () => {
      const s = real.useAppSettings();
      const { delay, enabled } = knobs;
      return useMemo(
        () => ({ ...s, projects: { ...s.projects, popoverDelayMs: delay, popoverEnabled: enabled } }),
        [s, delay, enabled],
      );
    },
  };
});

class ImmediateResizeObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    const contentRect = { width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } satisfies DOMRectReadOnly;
    this.cb([{ target, contentRect } as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

const NOW = '2026-01-01T00:00:00.000Z';
const category: ProjectCategoryDto = { id: 'default', name: 'Default', isDefault: true, minimised: false, createdAt: NOW, updatedAt: NOW };
const project = (id: string, name: string, tabCount: number, panelCount: number): ProjectDto => ({
  id, name, colour: '#3b82f6', rootFolder: `C:/code/a/rather/long/path/to/${id}`, isActive: false,
  createdAt: NOW, updatedAt: NOW, hiddenPaths: [], categoryId: 'default', tabCount, panelCount,
});

function mountPanel(): void {
  const projects = [project('a', 'Alpha project', 1, 1234), project('b', 'Beta', 2, 3)];
  const bridge = {
    invoke: vi.fn(async (method: string): Promise<unknown> => {
      switch (method) {
        case 'projects.list': return { projects };
        case 'projects.categories.list': return { categories: [category] };
        default: throw new Error(`unexpected RPC from the projects panel: ${method}`);
      }
    }),
  } as unknown as ThrongBridge;
  Reflect.set(window, 'throng', { editor: { subWorkspaceFiles: () => Promise.resolve([]) }, projects: { onChanged: () => () => {}, notifyChanged: () => {} }, panels: { publishIdentities: () => {} } });
  render(
    createElement(ProjectsProvider, { client: new ProjectsClient(bridge) },
      createElement(WorkspaceProvider, { client: new WorkspaceClient(bridge), activeProjectId: null },
        createElement(NotificationProvider, null,
          createElement(ConfirmProvider, null,
            createElement(ContextMenuProvider, null, createElement(ProjectsPanel)))))),
  );
}

beforeAll(() => { globalThis.ResizeObserver = ImmediateResizeObserver; });
afterAll(() => { Reflect.deleteProperty(globalThis, 'ResizeObserver'); });
beforeEach(() => { knobs.delay = 300; knobs.enabled = true; });
afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(window, 'throng'); });

/** Mounted, with the rows listed, and timers faked from here on. */
async function ready(): Promise<void> {
  mountPanel();
  await waitFor(() => screen.getByTestId('project-item-b'));
  vi.useFakeTimers();
}
const row = (id: string): HTMLElement => screen.getByTestId(`project-item-${id}`);
const popover = (): HTMLElement | null => screen.queryByTestId('project-popover');
const rest = (el: Element): void => { fireEvent.pointerMove(el); };
const leave = (el: Element): void => { fireEvent.pointerOut(el, { relatedTarget: document.body }); };
const wait = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };

describe('a project row at rest (#695)', () => {
  it('shows no tab and panel count, and no native tooltip on the name, the path or the row', async () => {
    await ready();
    const r = row('a');
    expect(r.textContent).not.toMatch(/\dT·\dP/);
    expect(r.querySelector('[data-testid^="project-counts-"]')).toBeNull();
    expect(r.querySelector('.project-item__switch')).not.toHaveAttribute('title');
    expect(r.querySelector('[data-testid="project-path"]')).not.toHaveAttribute('title');
    expect(r.querySelector('.project-item__name')).not.toHaveAttribute('title');
    // The handle and the buttons keep theirs.
    expect(screen.getByTestId('project-grip-a')).toHaveAttribute('title', 'Drag to reorder');
    expect(screen.getByTestId('project-edit-a')).toHaveAttribute('title', 'Edit');
    expect(screen.getByTestId('project-delete-a')).toHaveAttribute('title', 'Remove project');
  });
});

describe('the row popover (077 FR-027)', () => {
  it('opens once the pointer has rested for the delay, with the full name, ID, path, counts and rename hint', async () => {
    await ready();
    rest(row('a'));
    wait(299);
    expect(popover()).toBeNull();
    wait(1);
    const p = popover()!;
    expect(p).toHaveAttribute('data-project-id', 'a');
    expect(p).toHaveAttribute('role', 'tooltip');
    expect(screen.getByTestId('project-popover-name')).toHaveTextContent('Alpha project');
    expect(screen.getByTestId('project-popover-id')).toHaveTextContent('ID: a');
    expect(screen.getByTestId('project-popover-path')).toHaveTextContent('C:/code/a/rather/long/path/to/a');
    // A displayed quantity is digit-grouped (constitution 4.5.0 / 5.4.0).
    expect(screen.getByTestId('project-popover-counts')).toHaveTextContent('1 tab, 1,234 panels');
    expect(p).toHaveTextContent('Double-click to rename');
  });

  it('goes when the pointer leaves, and there is only ever one', async () => {
    await ready();
    rest(row('a'));
    wait(300);
    expect(popover()).toHaveAttribute('data-project-id', 'a');
    leave(row('a'));
    expect(popover()).toBeNull();
    rest(row('b'));
    wait(300);
    expect(screen.getAllByTestId('project-popover')).toHaveLength(1);
    expect(popover()).toHaveAttribute('data-project-id', 'b');
    expect(screen.getByTestId('project-popover-counts')).toHaveTextContent('2 tabs, 3 panels');
  });

  it('opens at once with a delay of 0', async () => {
    knobs.delay = 0;
    await ready();
    rest(row('a'));
    expect(popover()).toHaveAttribute('data-project-id', 'a');
  });

  it('never opens with projects.popoverEnabled off', async () => {
    knobs.enabled = false;
    await ready();
    rest(row('a'));
    wait(5000);
    expect(popover()).toBeNull();
  });

  it('does not open over the move handle or an action button, which keep their own tooltips', async () => {
    await ready();
    for (const el of [screen.getByTestId('project-grip-a'), screen.getByTestId('project-edit-a'), screen.getByTestId('project-delete-a')]) {
      rest(el);
      wait(1000);
      expect(popover(), el.getAttribute('data-testid') ?? '').toBeNull();
    }
    // And moving onto one puts away a popover already open.
    rest(row('a'));
    wait(300);
    expect(popover()).not.toBeNull();
    rest(screen.getByTestId('project-edit-a'));
    expect(popover()).toBeNull();
  });

  it('a press puts it away until the pointer leaves the row', async () => {
    await ready();
    rest(row('a'));
    wait(300);
    fireEvent.pointerDown(row('a'));
    expect(popover()).toBeNull();
    rest(row('a'));
    wait(1000);
    expect(popover()).toBeNull();
    leave(row('a'));
    rest(row('a'));
    wait(300);
    expect(popover()).not.toBeNull();
  });

  it('double-clicking the row still renames the project, and the popover goes', async () => {
    await ready();
    rest(row('a'));
    wait(300);
    fireEvent.doubleClick(screen.getByTestId('project-switch-a'));
    expect(screen.getByTestId('project-rename-input-a')).toBeInTheDocument();
    expect(popover()).toBeNull();
  });
});
