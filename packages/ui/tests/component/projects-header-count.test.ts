/**
 * #715 — the Projects pane's own total, and its attention total while the pane is collapsed.
 *
 * Layer: component — the REAL `ProjectsPanel` and the REAL collapsed-rail summary over the REAL projects
 * store, with the attention store standing in for main (`setAttentionMarks`). What the header and the
 * rail render, and when, is rendered DOM; the rail's place in the shell is `app.tsx` mounting it inside
 * `CollapsedRail`, which the last test pins.
 *
 * ANTI-VACUITY CONTROL: count the shown rows rather than every project and the total test fails (a
 * minimised category hides `b` and `c`); draw the total mark from one project and the summed test fails;
 * put the mark on the expanded header and the expanded test fails.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement, type ReactElement } from 'react';
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
import { ProjectsRailSummary } from '../../src/renderer/sidebar/projects-summary.js';
import { __resetAttentionStore, setAttentionMarks } from '../../src/renderer/attention/attention-store.js';
import { __resetMarkCycles } from '../../src/renderer/attention/mark-cycle.js';
import { makeMark } from './attention-fixtures.js';

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
const category = (id: string, name: string, minimised = false): ProjectCategoryDto => ({
  id, name, isDefault: id === 'default', minimised, createdAt: NOW, updatedAt: NOW,
});
const project = (id: string, categoryId: string): ProjectDto => ({
  id, name: id, colour: '#3b82f6', rootFolder: `C:/c/${id}`, isActive: false,
  createdAt: NOW, updatedAt: NOW, hiddenPaths: [], categoryId,
});

/** `a` in the default category, `b` and `c` hidden under a MINIMISED one, `d` in an expanded one. */
let projects: ProjectDto[];
let onChanged: (() => void) | null;

function mount(child: ReactElement): void {
  const categories = [category('default', 'Default'), category('min', 'Minimised', true), category('open', 'Open')];
  const bridge = {
    invoke: vi.fn(async (method: string): Promise<unknown> => {
      switch (method) {
        case 'projects.list': return { projects };
        case 'projects.categories.list': return { categories };
        default: throw new Error(`unexpected RPC: ${method}`);
      }
    }),
  } as unknown as ThrongBridge;
  Reflect.set(window, 'throng', {
    editor: { subWorkspaceFiles: () => Promise.resolve([]) },
    projects: {
      onChanged: (cb: () => void) => {
        onChanged = cb;
        return () => { onChanged = null; };
      },
      notifyChanged: () => {},
    },
    panels: { publishIdentities: () => {} },
  });
  render(
    createElement(ProjectsProvider, { client: new ProjectsClient(bridge) },
      createElement(WorkspaceProvider, { client: new WorkspaceClient(bridge), activeProjectId: null },
        createElement(NotificationProvider, null,
          createElement(ConfirmProvider, null,
            createElement(ContextMenuProvider, null, child))))),
  );
}

beforeAll(() => { globalThis.ResizeObserver = ImmediateResizeObserver; });
afterAll(() => { Reflect.deleteProperty(globalThis, 'ResizeObserver'); });
beforeEach(() => {
  projects = [project('a', 'default'), project('b', 'min'), project('c', 'min'), project('d', 'open')];
  onChanged = null;
  __resetAttentionStore();
  __resetMarkCycles();
});
afterEach(() => { __resetAttentionStore(); Reflect.deleteProperty(window, 'throng'); });

const pill = () => screen.getByTestId('projects-count');
const totalMark = () => screen.queryByTestId('attention-projects-total');

/** A project added or removed elsewhere: main says so, and the store re-reads the list. */
async function changeProjects(next: ProjectDto[]): Promise<void> {
  projects = next;
  await act(async () => { onChanged?.(); });
}

describe('the Projects pane header, expanded (#715)', () => {
  it('shows a count pill holding every project, hidden rows included', async () => {
    mount(createElement(ProjectsPanel));
    await waitFor(() => expect(pill()).toHaveTextContent('4'));
    expect(pill()).toHaveClass('throng-count-pill');
    expect(pill().closest('header')).toHaveClass('panel__header');
  });

  it('updates the pill when a project is added or removed', async () => {
    mount(createElement(ProjectsPanel));
    await waitFor(() => expect(pill()).toHaveTextContent('4'));
    await changeProjects([...projects, project('e', 'open')]);
    await waitFor(() => expect(pill()).toHaveTextContent('5'));
    await changeProjects(projects.filter((p) => p.id !== 'a' && p.id !== 'b'));
    await waitFor(() => expect(pill()).toHaveTextContent('3'));
  });

  it('groups a large total by the locale (constitution 5.4.0)', async () => {
    projects = Array.from({ length: 1234 }, (_, i) => project(`p${i}`, 'min'));
    mount(createElement(ProjectsPanel));
    await waitFor(() => expect(pill()).toHaveTextContent((1234).toLocaleString()));
  });

  it('carries no attention mark while expanded, even with a project marked — the rows show their own', async () => {
    mount(createElement(ProjectsPanel));
    await waitFor(() => expect(pill()).toHaveTextContent('4'));
    act(() => setAttentionMarks([makeMark('p1', 'a'), makeMark('p2', 'd', { raisedAt: 2 })]));
    expect(screen.getByTestId('attention-project-a')).not.toBeNull();
    expect(totalMark()).toBeNull();
  });
});

describe('the Projects pane, collapsed (#715)', () => {
  // The maintainer, 2026-11-24: the project count is not useful on the collapsed rail, so it carries only the
  // attention total. The count stays on the expanded header.
  it('shows no project count, only the attention total', async () => {
    mount(createElement(ProjectsRailSummary));
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    await waitFor(() => expect(totalMark()).not.toBeNull());
    expect(screen.queryByTestId('projects-count')).toBeNull();
  });

  it('sums the marked panels over every project into the minimised category header’s mark', async () => {
    mount(createElement(ProjectsRailSummary));
    act(() => setAttentionMarks([makeMark('p1', 'a'), makeMark('p2', 'b', { raisedAt: 2 }), makeMark('p3', 'd', { raisedAt: 3 })]));
    await waitFor(() => expect(totalMark()?.querySelector('.throng-attention-mark__count')).toHaveTextContent('3'));
    const el = totalMark()!;
    expect(el).toHaveClass('throng-attention-mark');
    expect(el).toHaveAttribute('data-kind', 'attention');
    expect(el).toHaveAttribute('data-numbered', 'true');
    expect(el.querySelector('.throng-attention-mark__count')).toHaveTextContent('3');
    // The popover a category header opens, grouped by project, across every category.
    fireEvent.mouseEnter(el);
    expect(screen.getAllByTestId(/^attention-popover-group-/).map((g) => g.getAttribute('data-project-id'))).toEqual(['a', 'b', 'd']);
    act(() => setAttentionMarks([]));
    expect(totalMark()).toBeNull();
  });

  it('goes Failed by the same rule: any Failed panel beneath it', async () => {
    mount(createElement(ProjectsRailSummary));
    act(() => setAttentionMarks([makeMark('p1', 'a'), makeMark('p2', 'c', { kind: 'failed', signal: 'processExited', detail: '1', raisedAt: 2 })]));
    await waitFor(() => expect(totalMark()).toHaveAttribute('data-kind', 'failed'));
  });

  it('shows 9+ above nine', async () => {
    mount(createElement(ProjectsRailSummary));
    act(() => setAttentionMarks(Array.from({ length: 12 }, (_, i) => makeMark(`q${i}`, i % 2 === 0 ? 'a' : 'd', { raisedAt: i }))));
    await waitFor(() => expect(totalMark()?.querySelector('.throng-attention-mark__count')).toHaveTextContent('9+'));
  });

  it('blinks on the shared clock, as every mark does', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount(createElement(ProjectsRailSummary));
      act(() => setAttentionMarks([makeMark('p1', 'a')]));
      await waitFor(() => expect(totalMark()).not.toBeNull());
      expect(totalMark()).not.toHaveAttribute('data-blink-dim');
      act(() => { vi.advanceTimersByTime(1000); });
      expect(totalMark()).toHaveAttribute('data-blink-dim');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the pills hold their width (#715, as 057 FR-133)', () => {
  it('gives the pane-header pill a minimum width', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
    const rule = /\.panel__count\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/min-width:\s*26px/);
  });

  it('mounts the collapsed summary in the Projects pane’s rail', () => {
    const app = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/app.tsx'), 'utf8');
    expect(app).toMatch(/testId="pane-rail-left"[^>]*>\s*<ProjectsRailSummary \/>\s*<\/CollapsedRail>/);
  });
});
