/**
 * The left column (055 US2, FR-020b/c, FR-024, FR-032, FR-046, FR-060, FR-067, FR-080, FR-096): the first
 * view, the breadcrumb, the rows and what each says about its node. What the SELECTED node is made of is
 * the right column's (`share-bars.test.ts`, `detail-pane.test.ts`).
 *
 * Layer: component — the real `Breakdown` over the real session store, fed frames the way the window's
 * shell feeds them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPONENT_DESCRIPTIONS, NOT_MEASURED, ROLE_DESCRIPTIONS, formatGrouped, unavailable, type ResourceNode } from '@throng/core';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import {
  __resetSession,
  getView,
  ingestFrame,
  setView,
  startSession,
} from '../../../src/renderer/resources/monitor-session.js';
import { GIB, MIB, frame, metrics, node, proc, sampleHierarchy } from '../helpers/resource-fixtures.js';

beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
});
afterEach(() => {
  __resetSession();
});

function feed(root: ResourceNode, ticks = 1): void {
  for (let tick = 1; tick <= ticks; tick += 1) act(() => ingestFrame(frame(tick, root)));
}

function mount(): void {
  render(createElement(Breakdown));
}

const row = (id: string): HTMLElement => screen.getByTestId(`breakdown-row-${id}`);

describe('the first view (FR-103, FR-020c)', () => {
  it('lists the four components and nothing else (US2 scenario 23)', () => {
    feed(sampleHierarchy());
    mount();

    const components = screen.getByTestId('breakdown-section-components');
    expect(screen.queryByTestId('breakdown-section-projects')).toBeNull();
    for (const id of ['c:ui', 'c:daemon', 'c:helpers', 'c:projects']) expect(within(components).getByTestId(`breakdown-row-${id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('breakdown-row-p:p1')).toBeNull();
    expect(screen.queryByTestId('breakdown-row-p:p2')).toBeNull();
  });

  it('lists the projects once Projects is opened with a double-click', () => {
    feed(sampleHierarchy());
    mount();

    fireEvent.doubleClick(row('c:projects'));

    expect(getView().focusPath).toEqual(['root', 'c:projects']);
    expect(row('p:p1')).toBeInTheDocument();
    expect(row('p:p2')).toBeInTheDocument();
  });

  it('orders projects active, then loaded, then unloaded, and greys the unloaded ones in italics', () => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects'] }));

    const projects = within(screen.getByTestId('breakdown-section-children'))
      .getAllByTestId(/^breakdown-row-p:[^-]*$/)
      .map((el) => el.getAttribute('data-node-id'));
    expect(projects).toEqual(['p:p1', 'p:p2']);
    expect(row('p:p1')).toHaveAttribute('data-project-state', 'active');
    expect(row('p:p2')).toHaveAttribute('data-project-state', 'unloaded');
    expect(row('p:p2').className).toContain('breakdown-row--unloaded');
    expect(row('p:p1').className).not.toContain('breakdown-row--unloaded');
  });

  it('gives an unloaded project’s row the project list’s grey italic style, from theme tokens', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
    const rule = /\.breakdown-row--unloaded[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/font-style:\s*italic/);
    expect(rule).toMatch(/color:\s*var\(--throng-colour-textMuted\)/);
  });

  it('lists a project with nothing measured, though it takes no share of anything', () => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects'] }));

    expect(row('p:p2')).toBeInTheDocument();
    expect(row('p:p1')).toBeInTheDocument();
  });
});

describe('drilling and the breadcrumb (FR-060, FR-096)', () => {
  beforeEach(() => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1'], metric: 'memory' }));
  });

  it('lists the children of the focused node as rows, and nothing else of them (the right column has the rest)', () => {
    expect(row('n:n1')).toBeInTheDocument();
    expect(row('n:n2')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="treemap"], [data-testid="breakdown-focus-summary"]')).toHaveLength(0);
  });

  it('opens a row on a double-click, and the breadcrumb follows (a click only selects: FR-088)', () => {
    fireEvent.click(row('n:n1'));
    expect(getView().focusPath).toEqual(['root', 'c:projects', 'p:p1', 't:t1']);

    fireEvent.doubleClick(row('n:n1'));

    expect(getView().focusPath).toEqual(['root', 'c:projects', 'p:p1', 't:t1', 'n:n1']);
    const crumbs = screen.getByTestId('breadcrumb');
    expect(within(crumbs).getByTestId('breadcrumb-segment-n:n1')).toHaveAttribute('aria-current', 'location');
  });

  it('returns to a level when its breadcrumb segment is clicked', () => {
    fireEvent.doubleClick(row('n:n1'));
    fireEvent.click(screen.getByTestId('breadcrumb-segment-p:p1'));

    expect(getView().focusPath).toEqual(['root', 'c:projects', 'p:p1']);
    // …and the tab is a row again.
    expect(row('t:t1')).toBeInTheDocument();
  });

  it('names every segment from throng down to the node in focus', () => {
    const labels = within(screen.getByTestId('breadcrumb'))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual(['throng', 'Projects', 'Alpha', 'Build']);
  });
});

describe('many small contributors (Edge Cases, Very large trees)', () => {
  it('keeps every one of them as a row, however many there are', () => {
    const big = [1, 2, 3, 4, 5].map((n) => proc(1000 + n, `big${n}.exe`, metrics({ memory: 1 * GIB })));
    const tiny = Array.from({ length: 35 }, (_, i) => proc(2000 + i, `tiny${i}.exe`, metrics({ memory: 1 * MIB })));
    const panel = node({
      id: 'n:many',
      kind: 'panel',
      label: 'Busy',
      panelKind: 'terminal',
      children: [...big, ...tiny],
      owner: { projectId: 'p1', tabId: 't1', panelId: 'many' },
    });
    const tab = node({ id: 't:many', kind: 'tab', label: 'Many', children: [panel], owner: { projectId: 'p1', tabId: 'many' } });
    const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab], owner: { projectId: 'p1' } });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
    feed(node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } }));
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:many', 'n:many'], metric: 'memory' }));

    for (const p of [...big, ...tiny]) expect(row(`x:${p.process!.key}`)).toBeInTheDocument();
  });
});

describe('the rows', () => {
  it('draws a sparkline for a process once it has history, and none before', () => {
    feed(sampleHierarchy(), 1);
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1'] }));
    expect(screen.queryByTestId('sparkline-x:300:1')).toBeNull();

    feed(sampleHierarchy(), 3);
    const spark = screen.getByTestId('sparkline-x:300:1');
    // A canvas, not inline artwork (SC-002): hidden from assistive technology, drawn once per ingest.
    expect(spark.tagName.toLowerCase()).toBe('canvas');
    expect(spark).toHaveAttribute('aria-hidden', 'true');
  });

  it('strokes the sparkline with the theme colour it reads from the element, and moves to every point', () => {
    const calls: string[] = [];
    const strokes: string[] = [];
    const ctx = {
      setTransform: () => undefined,
      clearRect: () => undefined,
      beginPath: () => calls.push('begin'),
      moveTo: () => calls.push('move'),
      lineTo: () => calls.push('line'),
      stroke: () => calls.push('stroke'),
      set strokeStyle(v: string) {
        strokes.push(v);
      },
      set lineWidth(_v: number) {},
      set lineJoin(_v: string) {},
    };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const style = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ color: 'rgb(1, 2, 3)', getPropertyValue: () => '' } as unknown as CSSStyleDeclaration);
    try {
      feed(sampleHierarchy(), 1);
      mount();
      act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1'] }));
      feed(sampleHierarchy(), 3);

      expect(strokes).toContain('rgb(1, 2, 3)');
      expect(calls.filter((c) => c === 'move')).toHaveLength(calls.filter((c) => c === 'stroke').length);
      expect(calls).toContain('line');
    } finally {
      spy.mockRestore();
      style.mockRestore();
    }
  });

  it('shows processes nested under their parents, to any depth, once a panel is in focus', () => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1'] }));

    expect(row('x:200:1')).toHaveAttribute('aria-level', '1');
    expect(row('x:300:1')).toHaveAttribute('aria-level', '2');
    expect(row('b:n1')).toHaveAttribute('aria-level', '1');
  });

  it('writes an estimate with "~" and a not-measured figure as "-", each explained by its title (FR-107, US2 scenario 27)', () => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1'] }));

    expect(row('n:n2')).toHaveAttribute('data-estimated', 'true');
    const memory = within(row('n:n2')).getByTestId('breakdown-row-n:n2-memory');
    expect(memory).toHaveTextContent(/^~40 MB$/);
    expect(memory).toHaveAttribute('title', 'Memory: Estimated');
    // No "estimated" tag anywhere on the row: the "~" is the mark.
    expect(row('n:n2')).not.toHaveTextContent(/estimated/i);
    // An editor panel’s CPU is not measured, and says so rather than 0 (FR-024).
    const cpu = within(row('n:n2')).getByTestId('breakdown-row-n:n2-cpu');
    expect(cpu).toHaveTextContent(/^-$/);
    expect(cpu).toHaveAttribute('title', 'CPU: Not measured');
  });

  it('writes an unavailable figure as "-" with its reason in the title, never as a bare number', () => {
    const tree = sampleHierarchy();
    const dead = unavailable('The daemon is not running');
    const daemon = node({ id: 'c:daemon', kind: 'component', label: 'Daemon', own: metrics({ cpu: dead, memory: dead }), owner: { component: 'daemon' } });
    feed({ ...tree, children: tree.children.map((c) => (c.id === 'c:daemon' ? daemon : c)), rolled: { ...tree.rolled, partial: { cpu: 'The daemon is not running' } } });
    mount();

    expect(within(row('c:daemon')).getByTestId('breakdown-row-c:daemon-cpu')).toHaveTextContent(/^-$/);
    expect(within(row('c:daemon')).getByTestId('breakdown-row-c:daemon-cpu')).toHaveAttribute('title', 'CPU: The daemon is not running');
    expect(within(row('c:daemon')).getByTestId('breakdown-row-c:daemon-cpu')).toHaveAttribute('data-unavailable', 'true');
    // Root is the focus, not a row: its partial total, and the reason, are the right column's (`detail-pane.test.ts`).
    expect(screen.queryByTestId('breakdown-row-root')).toBeNull();
  });

  it('bands CPU and memory on every node by its rolled-up figure (FR-046)', () => {
    // 90% CPU on the shell would be critical; make the node process do it.
    feed(sampleHierarchy({ nodeCpu: 90 }));
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1'] }));

    const cpu = within(row('x:200:1')).getByTestId('breakdown-row-x:200:1-cpu');
    // The shell's ROLLED cpu includes its child: 1 + 90.
    expect(cpu).toHaveAttribute('data-band', 'critical');
    // A title names the column and never the figure or its band (FR-095): those are the cell's text and mark.
    expect(cpu.getAttribute('title')).toBe('CPU');
    expect(within(row('x:300:1')).getByTestId('breakdown-row-x:300:1-cpu')).toHaveAttribute('data-band', 'critical');
    // GPU is not banded.
    expect(within(row('x:300:1')).getByTestId('breakdown-row-x:300:1-gpu')).not.toHaveAttribute('data-band');
  });

  it('writes every quantity digit-grouped with a unit (FR-032)', () => {
    const big = proc(500, 'big.exe', metrics({ memory: 3_000 * GIB, cpu: 1234.5 }));
    const panel = node({ id: 'n:big', kind: 'panel', label: 'Big', panelKind: 'terminal', children: [big] });
    const tab = node({ id: 't:big', kind: 'tab', label: 'T', children: [panel] });
    const project = node({ id: 'p:big', kind: 'project', label: 'P', projectState: 'active', children: [tab] });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
    feed(node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } }));
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:big', 't:big', 'n:big'] }));

    expect(within(row('x:500:1')).getByTestId('breakdown-row-x:500:1-memory')).toHaveTextContent(`${formatGrouped(3000)} GB`);
    expect(within(row('x:500:1')).getByTestId('breakdown-row-x:500:1-cpu')).toHaveTextContent(`${formatGrouped(1234.5)}%`);
  });

  it('drops a process that ended at the next capture while Hide ended is on, as it is by default (FR-105)', () => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1'] }));
    expect(row('x:300:1')).toBeInTheDocument();

    act(() => ingestFrame(frame(2, sampleHierarchy({ withNode: false }))));

    expect(screen.queryByTestId('breakdown-row-x:300:1')).toBeNull();
  });

  it('keeps a process that ended in its place, greyed and struck through, with no figures, with Hide ended off (FR-065a)', () => {
    feed(sampleHierarchy());
    act(() => ingestFrame(frame(2, sampleHierarchy({ withNode: false }))));
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1'], hideEnded: false }));

    const ended = row('x:300:1');
    expect(ended).toHaveAttribute('data-ended', 'true');
    expect(ended.className).toContain('breakdown-row--ended');
    expect(ended).toHaveTextContent(/ended/i);
    // Its figures read "ended", not zero.
    expect(within(ended).getByTestId('breakdown-row-x:300:1-cpu')).toHaveTextContent(/ended/i);
  });

  it('renders a limitation in place with its reason, including a terminal whose OS pid is not known yet (FR-080)', () => {
    const limitation = node({
      id: 'l:agent-pid-unknown',
      kind: 'limitation',
      label: 'Shell process not yet known',
      reason: 'The terminal runs in the de-elevation agent, which has not reported its process id yet',
      owner: { projectId: 'p1', tabId: 't1', panelId: 'n1' },
    });
    const panel = node({ id: 'n:n1', kind: 'panel', label: 'Shell', panelKind: 'terminal', children: [limitation], owner: { projectId: 'p1', tabId: 't1', panelId: 'n1' } });
    const tab = node({ id: 't:t1', kind: 'tab', label: 'Build', children: [panel] });
    const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab] });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
    feed(node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } }));
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1'] }));

    const r = row('l:agent-pid-unknown');
    expect(r).toHaveTextContent('Shell process not yet known');
    expect(r).toHaveTextContent('has not reported its process id yet');
    expect(r).toHaveAttribute('data-kind', 'limitation');
  });

  it('shows a not-measured metric as such, never as zero', () => {
    const tree = sampleHierarchy();
    feed(tree);
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1'] }));
    const gpu = within(row('n:n2')).getByTestId('breakdown-row-n:n2-gpu');
    expect(gpu).toHaveTextContent(/^-$/);
    expect(gpu).toHaveAttribute('title', 'GPU: Not measured');
    expect(NOT_MEASURED).toBeDefined();
  });
});

describe('what throng’s own rows are for (FR-102, US2 scenario 22)', () => {
  it('titles each component row with why it exists, and no figure', () => {
    feed(sampleHierarchy());
    mount();
    for (const id of ['ui', 'daemon', 'helpers', 'projects'] as const) {
      expect(row(`c:${id}`)).toHaveAttribute('title', COMPONENT_DESCRIPTIONS[id]);
    }
    expect(row('c:daemon').getAttribute('title')).toMatch(/keeps your terminals running when throng's windows close/);
  });

  it('titles a row for one of throng’s own processes with its role, and a user’s process with its name', () => {
    const tree = sampleHierarchy();
    const withRole = (n: ResourceNode): ResourceNode => (n.id === 'x:30:1' ? { ...n, role: 'conhost' } : { ...n, children: n.children.map(withRole) });
    feed(withRole(tree));
    mount();
    act(() => setView({ focusPath: ['root', 'c:helpers'] }));
    expect(row('x:30:1')).toHaveAttribute('title', ROLE_DESCRIPTIONS.conhost);

    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1'] }));
    expect(row('x:200:1')).toHaveAttribute('title', 'pwsh.exe');
  });
});

describe('the Total row (FR-104, US2 scenario 24)', () => {
  const TAB = ['root', 'c:projects', 'p:p1', 't:t1'];
  const total = (): HTMLElement => screen.getByTestId('breakdown-total-children');

  it('ends the list with the listed node’s own rolled-up figures, one per column', () => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: TAB }));

    // The tab holds the shell (90 MB), node (300 MB), the buffers (12 MB) and the editor (40 MB).
    expect(within(total()).getByTestId('breakdown-total-children-memory')).toHaveTextContent('442 MB');
    expect(within(total()).getByTestId('breakdown-total-children-cpu')).toHaveTextContent(`${formatGrouped(13)}%`);
    expect(total()).toHaveTextContent('Total');
    // It is the last thing in the section, after the rows.
    const section = screen.getByTestId('breakdown-section-children');
    expect(section.lastElementChild).toBe(total());
  });

  it('ends the top level too, with throng’s whole figure', () => {
    feed(sampleHierarchy());
    mount();
    // UI 200 + Daemon 80 + Helpers 6 + Projects 442.
    expect(within(screen.getByTestId('breakdown-total-components')).getByTestId('breakdown-total-components-memory')).toHaveTextContent('728 MB');
  });

  it('is unchanged by the filter, and says how many of the rows it counts are hidden', () => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: TAB }));
    expect(screen.queryByTestId('breakdown-total-children-hidden')).toBeNull();

    act(() => setView({ filterText: 'Notes' }));

    expect(within(total()).getByTestId('breakdown-total-children-memory')).toHaveTextContent('442 MB');
    expect(within(total()).getByTestId('breakdown-total-children-hidden')).toHaveTextContent('includes 1 hidden');
  });

  it('is not selectable, has no actions and no sparkline', () => {
    feed(sampleHierarchy(), 3);
    mount();
    act(() => setView({ focusPath: TAB }));

    expect(total()).not.toHaveAttribute('role', 'treeitem');
    expect(total()).not.toHaveAttribute('tabindex');
    expect(total().querySelector('canvas, [data-testid^="sparkline"]')).toBeNull();
    fireEvent.click(total());
    expect(document.querySelectorAll('.breakdown-row--selected')).toHaveLength(0);
  });
});

describe('colour (FR-067)', () => {
  it('draws nothing from a literal colour: the 055 stylesheet names theme variables only', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
    const start = css.indexOf('══ 055 — the Resource Monitor');
    const end = css.indexOf('── 055 end ──');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = css.slice(start, end);
    // A colour-bearing declaration never holds a hex, rgb()/hsl() or a named colour.
    const colourDecls = [...section.matchAll(/(?:^|[;{\s])((?:color|background(?:-color)?|fill|stroke|border(?:-[a-z]+)*|outline(?:-color)?|text-decoration-color)\s*:[^;}]*)/gm)].map((m) => m[1] ?? '');
    expect(colourDecls.length).toBeGreaterThan(10);
    for (const decl of colourDecls) {
      expect(decl, decl).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
      expect(decl, decl).not.toMatch(/:\s*(red|green|blue|white|black|gray|grey|orange|yellow)\b/i);
    }
  });

  it('rows carry no inline colour: their only inline style is how deep they are nested', () => {
    feed(sampleHierarchy());
    mount();
    for (const el of screen.getAllByRole('treeitem')) {
      expect(el.getAttribute('style') ?? '').toMatch(/^--breakdown-depth: \d+;?$/);
    }
  });
});
