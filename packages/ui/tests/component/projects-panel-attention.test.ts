/**
 * The attention mark on the Projects pane (057 US1, FR-012, FR-013, FR-014; US1 AS7).
 *
 * Layer: component — the REAL `ProjectsPanel` with the REAL `listRows`, the store standing in for main
 * (`setAttentionMarks`). Which row wears a mark, and which header, is a question about rendered DOM; how
 * it is painted on a filled row is layout and rides the manual plan (FR-017).
 *
 * ANTI-VACUITY CONTROL: render the mark only for the ACTIVE project and the unloaded and hidden-row
 * tests fail; derive the header's mark from its visible rows instead of its members and the minimised
 * test fails.
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

/**
 * `a` is in the default category, `b` and `c` in a MINIMISED one (neither loaded, so both are hidden
 * rows under its header), `d` in an expanded one. Nothing is loaded: every row is unloaded.
 */
function mountPanel(): void {
  const projects = [project('a', 'default'), project('b', 'min'), project('c', 'min'), project('d', 'open')];
  const categories = [category('default', 'Default'), category('min', 'Minimised', true), category('open', 'Open')];
  const bridge = {
    invoke: vi.fn(async (method: string): Promise<unknown> => {
      switch (method) {
        case 'projects.list': return { projects };
        case 'projects.categories.list': return { categories };
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
beforeEach(() => { __resetAttentionStore(); });
afterEach(() => { __resetAttentionStore(); Reflect.deleteProperty(window, 'throng'); });

async function ready(): Promise<void> {
  await waitFor(() => screen.getByTestId('project-item-a'));
}
const mark = (id: string) => screen.queryByTestId(`attention-project-${id}`);
const headerMark = (id: string) => screen.queryByTestId(`attention-category-${id}`);

describe('a project row (FR-012)', () => {
  it('shows nothing while no panel is marked', async () => {
    mountPanel();
    await ready();
    expect(mark('a')).toBeNull();
    expect(headerMark('default')).toBeNull();
  });

  it('marks an UNLOADED project that has a marked panel — the layout is not loaded, the mark is main’s', async () => {
    mountPanel();
    await ready();
    expect(screen.getByTestId('project-item-d')).toHaveAttribute('data-loaded', 'false');
    act(() => setAttentionMarks([makeMark('p9', 'd', { title: 'Build', projectName: 'd' })]));
    expect(mark('d')).not.toBeNull();
    expect(mark('d')).toHaveAttribute('aria-label', expect.stringContaining('Build'));
    // And only that row.
    expect(mark('a')).toBeNull();
  });

  // FR-092 (Session 2026-10-19) supersedes the earlier placement in the name row: the mark takes the
  // colour dot's place, on every row, so it sits in the same spot whether or not the row is highlighted.
  it('shows the mark where the colour dot was, and the dot again once it clears (FR-092)', async () => {
    mountPanel();
    await ready();
    const row = screen.getByTestId('project-item-a');
    expect(row.querySelector('.project-item__dot')).not.toBeNull();
    act(() => setAttentionMarks([makeMark('p9', 'a')]));
    const placed = mark('a')!;
    expect(row.querySelector('.project-item__dot')).toBeNull();
    // In the dot's slot: a direct child of the switch, ahead of the labels.
    expect(placed.parentElement).toHaveClass('project-item__switch');
    expect(placed.nextElementSibling).toHaveClass('project-item__labels');
    expect(placed.closest('.project-item__name-row')).toBeNull();
    act(() => setAttentionMarks([]));
    expect(row.querySelector('.project-item__dot')).not.toBeNull();
  });

  it('opens a popover on hover instead of a native tooltip, naming each marked panel (FR-097)', async () => {
    mountPanel();
    await ready();
    act(() => setAttentionMarks([makeMark('p1', 'a', { title: 'Build' }), makeMark('p2', 'a', { title: 'Tests', raisedAt: 2 })]));
    const placed = mark('a')!;
    // An EMPTY title, not an absent one: the mark sits inside the switch button, whose own title
    // ("Double-click to rename") a browser would otherwise show over the popover. An empty title on the
    // nearest element stops the ancestor's from applying.
    expect(placed.closest('.project-item__switch')).toHaveAttribute('title', 'Double-click to rename');
    expect(placed).toHaveAttribute('title', '');
    expect(placed).toHaveAttribute('aria-label', expect.stringContaining('Tests'));
    fireEvent.mouseEnter(placed);
    expect(screen.getAllByTestId(/^attention-popover-line-/)).toHaveLength(2);
    fireEvent.mouseLeave(placed);
    expect(screen.queryByTestId('attention-popover')).toBeNull();
  });

  it('shows how many marked panels the project holds, inside its mark; 9+ above nine (FR-131)', async () => {
    mountPanel();
    await ready();
    act(() => setAttentionMarks([makeMark('p1', 'a'), makeMark('p2', 'a', { raisedAt: 2 }), makeMark('p3', 'a', { raisedAt: 3 })]));
    expect(mark('a')!.querySelector('.throng-attention-mark__count')).toHaveTextContent('3');
    act(() => setAttentionMarks(Array.from({ length: 12 }, (_, i) => makeMark(`q${i}`, 'a', { raisedAt: i }))));
    expect(mark('a')!.querySelector('.throng-attention-mark__count')).toHaveTextContent('9+');
  });

  it('keeps blinking and Failed styling with a number: Failed wins when any is Failed (FR-131, FR-014)', async () => {
    mountPanel();
    await ready();
    act(() => setAttentionMarks([makeMark('p1', 'a'), makeMark('p2', 'a', { kind: 'failed', signal: 'processExited', detail: '1' })]));
    expect(mark('a')).toHaveClass('throng-attention-mark--failed');
    expect(mark('a')!.querySelector('.throng-attention-mark__count')).toHaveTextContent('2');
  });

  it('leaves an unmarked row’s dot alone while another row is marked (FR-092)', async () => {
    mountPanel();
    await ready();
    act(() => setAttentionMarks([makeMark('p9', 'd')]));
    expect(screen.getByTestId('project-item-a').querySelector('.project-item__dot')).not.toBeNull();
  });

  it('Failed wins on the row when one project holds an Attention and a Failed mark (US1 AS7)', async () => {
    mountPanel();
    await ready();
    act(() => setAttentionMarks([makeMark('p1', 'a'), makeMark('p2', 'a', { kind: 'failed', signal: 'processExited', detail: '1' })]));
    expect(mark('a')).toHaveAttribute('data-kind', 'failed');
  });

  it('clears when main clears the mark', async () => {
    mountPanel();
    await ready();
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    expect(mark('a')).not.toBeNull();
    act(() => setAttentionMarks([]));
    expect(mark('a')).toBeNull();
  });
});

describe('a project row’s context menu (FR-106, supersedes FR-082)', () => {
  const NEXT = 'Go to Next Marked Panel';
  const goTo = vi.fn();
  beforeEach(() => {
    goTo.mockReset();
    __resetMarkCycles();
  });

  async function mountWithBridge(): Promise<void> {
    mountPanel();
    // `mountPanel` installs a bare `window.throng`; the menu row goes through `attention.goTo`.
    Reflect.set(window.throng as object, 'attention', { goTo });
    await ready();
  }

  it('offers the command while the project has a marked panel, without the global chord', async () => {
    await mountWithBridge();
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    fireEvent.contextMenu(screen.getByTestId('project-item-a'));
    const row = await screen.findByText(NEXT);
    expect(row.closest('[role="menuitem"]')).not.toHaveTextContent('Ctrl+Shift+Alt+G');
  });

  it('does not offer it for a project with no marked panel — even while another project is marked', async () => {
    await mountWithBridge();
    act(() => setAttentionMarks([makeMark('p1', 'd')]));
    fireEvent.contextMenu(screen.getByTestId('project-item-a'));
    await screen.findByText('Rename');
    expect(screen.queryByText(NEXT)).toBeNull();
  });

  it('goes to THAT project’s next marked panel, on the same cycle as clicking its mark', async () => {
    await mountWithBridge();
    act(() => setAttentionMarks([
      makeMark('a1', 'a', { raisedAt: 1 }),
      makeMark('a2', 'a', { raisedAt: 2 }),
      makeMark('d1', 'd', { raisedAt: 3 }),
    ]));
    fireEvent.click(screen.getByTestId('attention-project-a'));
    fireEvent.contextMenu(screen.getByTestId('project-item-a'));
    fireEvent.click(await screen.findByText(NEXT));
    expect(goTo.mock.calls.map((c) => c[0])).toEqual(['a1', 'a2']);
  });
});

describe('a category header (FR-013)', () => {
  it('a minimised header marks for a marked project whose row it HIDES', async () => {
    mountPanel();
    await ready();
    expect(screen.queryByTestId('project-item-b')).toBeNull(); // hidden under the minimised header
    act(() => setAttentionMarks([makeMark('p1', 'b')]));
    expect(headerMark('min')).not.toBeNull();
  });

  it('a header takes the Failed kind from a member’s Failed mark (FR-014)', async () => {
    mountPanel();
    await ready();
    act(() => setAttentionMarks([makeMark('p1', 'c', { kind: 'failed', signal: 'processExited', detail: '2' })]));
    expect(headerMark('min')).toHaveAttribute('data-kind', 'failed');
  });

  it('opens a popover grouped by project, in list order, and carries no native title (FR-098)', async () => {
    mountPanel();
    await ready();
    act(() => setAttentionMarks([makeMark('p1', 'c', { projectName: 'c' }), makeMark('p2', 'b', { projectName: 'b' })]));
    const el = headerMark('min')!;
    expect(el).not.toHaveAttribute('title');
    fireEvent.mouseEnter(el);
    // Project list order is b then c, whatever order the marks were raised in.
    expect(screen.getAllByTestId(/^attention-popover-group-/).map((g) => g.getAttribute('data-project-id'))).toEqual(['b', 'c']);
  });

  it('counts the marked panels under every member, hidden rows included (FR-131)', async () => {
    mountPanel();
    await ready();
    act(() => setAttentionMarks([makeMark('p1', 'b'), makeMark('p2', 'b', { raisedAt: 2 }), makeMark('p3', 'c', { raisedAt: 3 })]));
    expect(headerMark('min')!.querySelector('.throng-attention-mark__count')).toHaveTextContent('3');
  });

  it('marks only the category holding the marked project', async () => {
    mountPanel();
    await ready();
    act(() => setAttentionMarks([makeMark('p1', 'b')]));
    expect(headerMark('default')).toBeNull();
    expect(headerMark('open')).toBeNull();
  });

  it('the default header marks for its own member', async () => {
    mountPanel();
    await ready();
    act(() => setAttentionMarks([makeMark('p1', 'a')]));
    expect(headerMark('default')).not.toBeNull();
  });
});
