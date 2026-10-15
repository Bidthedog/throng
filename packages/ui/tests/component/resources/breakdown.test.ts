/**
 * The breakdown (055 US2, FR-020b/c, FR-024, FR-032, FR-046, FR-060, FR-067, FR-080): the first view,
 * the treemap, the breadcrumb, the rows and what each says about its node.
 *
 * Layer: component — the real `Breakdown` over the real session store, fed frames the way the modal
 * shell feeds them. Charts are not involved (they sit in their own pane, `timeseries.test.ts`), so the
 * `resources/charts` seam is stubbed here only so nothing in the import graph can reach uPlot.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_MEASURED, formatGrouped, unavailable, type ResourceNode } from '@throng/core';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import {
  __resetSession,
  getView,
  ingestFrame,
  setView,
  startSession,
} from '../../../src/renderer/resources/monitor-session.js';
import { GIB, MIB, frame, metrics, node, proc, sampleHierarchy } from '../helpers/resource-fixtures.js';

vi.mock('../../../src/renderer/resources/charts/timeseries.js', () => ({
  Timeseries: () => null,
  default: () => null,
}));

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
const tile = (id: string): HTMLElement => screen.getByTestId(`treemap-tile-${id}`);

describe('the first view (FR-020b, FR-020c)', () => {
  it('shows usage per component AND per project at once', () => {
    feed(sampleHierarchy());
    mount();

    const components = screen.getByTestId('breakdown-section-components');
    const projects = screen.getByTestId('breakdown-section-projects');
    for (const id of ['c:ui', 'c:daemon', 'c:helpers', 'c:projects']) expect(within(components).getByTestId(`breakdown-row-${id}`)).toBeInTheDocument();
    for (const id of ['p:p1', 'p:p2']) expect(within(projects).getByTestId(`breakdown-row-${id}`)).toBeInTheDocument();
  });

  it('orders projects active, then loaded, then unloaded, and greys the unloaded ones in italics', () => {
    feed(sampleHierarchy());
    mount();

    const projects = within(screen.getByTestId('breakdown-section-projects'))
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

  it('gives a project with nothing measured no share of the treemap, but still lists it', () => {
    feed(sampleHierarchy());
    mount();

    expect(screen.queryByTestId('treemap-tile-p:p2')).toBeNull();
    expect(row('p:p2')).toBeInTheDocument();
    expect(tile('p:p1')).toBeInTheDocument();
  });
});

describe('the treemap (FR-060)', () => {
  beforeEach(() => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1'], metric: 'memory' }));
  });

  it('draws one tile per child of the focused node, sized by the chosen metric', () => {
    // Shell = 90 + 300 + 12 MiB buffers, Notes = 40 MiB.
    const shell = tile('n:n1');
    const notes = tile('n:n2');
    const area = (el: HTMLElement): number => Number(el.getAttribute('data-width')) * Number(el.getAttribute('data-height'));
    expect(area(shell) / area(notes)).toBeCloseTo((402 * MIB) / (40 * MIB), 0);
    expect(Number(shell.getAttribute('data-value'))).toBe(402 * MIB);
  });

  it('re-sizes the same tiles when the metric changes', () => {
    act(() => setView({ metric: 'cpu' }));
    // CPU: Shell = 1 + 12, Notes = not measured → no share.
    expect(screen.queryByTestId('treemap-tile-n:n2')).toBeNull();
    expect(Number(tile('n:n1').getAttribute('data-value'))).toBe(13);
  });

  it('opens a tile from its drill-down button, and the breadcrumb follows (a click only selects: FR-088)', () => {
    fireEvent.click(tile('n:n1'));
    expect(getView().focusPath).toEqual(['root', 'c:projects', 'p:p1', 't:t1']);

    fireEvent.click(screen.getByTestId('treemap-tile-open-n:n1'));

    expect(getView().focusPath).toEqual(['root', 'c:projects', 'p:p1', 't:t1', 'n:n1']);
    const crumbs = screen.getByTestId('breadcrumb');
    expect(within(crumbs).getByTestId('breadcrumb-segment-n:n1')).toHaveAttribute('aria-current', 'location');
  });

  it('returns to a level when its breadcrumb segment is clicked', () => {
    fireEvent.click(screen.getByTestId('treemap-tile-open-n:n1'));
    fireEvent.click(screen.getByTestId('breadcrumb-segment-p:p1'));

    expect(getView().focusPath).toEqual(['root', 'c:projects', 'p:p1']);
    // …and the tab is a tile again.
    expect(tile('t:t1')).toBeInTheDocument();
  });

  it('names every segment from throng down to the node in focus', () => {
    const labels = within(screen.getByTestId('breadcrumb'))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual(['throng', 'Projects', 'Alpha', 'Build']);
  });
});

describe('many small contributors (Edge Cases, Very large trees)', () => {
  it('groups the small ones into one “N others” tile and keeps them all in the rows', () => {
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

    for (const p of big) expect(tile(`x:${p.process!.key}`)).toBeInTheDocument();
    const others = screen.getByTestId('treemap-tile-others-children');
    // Its name is the accessible label (a small cell may be too small to print it), and the hover text.
    expect(others).toHaveAttribute('aria-label', '35 others');
    expect(others.getAttribute('title')).toContain('35 others');
    expect(screen.queryByTestId(`treemap-tile-x:${tiny[0]!.process!.key}`)).toBeNull();
    // Nothing is lost: every one of them is still a row.
    expect(row(`x:${tiny[0]!.process!.key}`)).toBeInTheDocument();
    expect(row(`x:${tiny[34]!.process!.key}`)).toBeInTheDocument();
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

  it('marks an estimated figure as estimated, on the row and in its title', () => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1'] }));

    expect(row('n:n2')).toHaveAttribute('data-estimated', 'true');
    expect(within(row('n:n2')).getByTestId('breakdown-row-n:n2-memory')).toHaveTextContent(/estimated/i);
    // An editor panel’s CPU is not measured, and says so rather than 0 (FR-024).
    expect(within(row('n:n2')).getByTestId('breakdown-row-n:n2-cpu')).toHaveTextContent('Not measured');
  });

  it('carries a partial figure’s reason on the figure, never as a bare number', () => {
    const tree = sampleHierarchy();
    const dead = unavailable('The daemon is not running');
    const daemon = node({ id: 'c:daemon', kind: 'component', label: 'Daemon', own: metrics({ cpu: dead, memory: dead }), owner: { component: 'daemon' } });
    feed({ ...tree, children: tree.children.map((c) => (c.id === 'c:daemon' ? daemon : c)), rolled: { ...tree.rolled, partial: { cpu: 'The daemon is not running' } } });
    mount();

    expect(within(row('c:daemon')).getByTestId('breakdown-row-c:daemon-cpu')).toHaveTextContent('Unavailable');
    const rootRow = screen.queryByTestId('breakdown-row-root');
    expect(rootRow).toBeNull(); // root is the focus, not a row — the partial note is on the readout below
    expect(screen.getByTestId('breakdown-focus-summary').textContent).toContain('The daemon is not running');
  });

  it('bands CPU and memory on every node by its rolled-up figure, with the band in the title (FR-046)', () => {
    // 90% CPU on the shell would be critical; make the node process do it.
    feed(sampleHierarchy({ nodeCpu: 90 }));
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1'] }));

    const cpu = within(row('x:200:1')).getByTestId('breakdown-row-x:200:1-cpu');
    // The shell's ROLLED cpu includes its child: 1 + 90.
    expect(cpu).toHaveAttribute('data-band', 'critical');
    expect(cpu.getAttribute('title')).toContain('critical');
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

  it('keeps a process that ended in its place, greyed and struck through, with no figures (FR-065a)', () => {
    feed(sampleHierarchy());
    act(() => ingestFrame(frame(2, sampleHierarchy({ withNode: false }))));
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1'] }));

    const ended = row('x:300:1');
    expect(ended).toHaveAttribute('data-ended', 'true');
    expect(ended.className).toContain('breakdown-row--ended');
    expect(ended).toHaveTextContent(/ended/i);
    // Its figures read "ended", not zero.
    expect(within(ended).getByTestId('breakdown-row-x:300:1-cpu')).toHaveTextContent(/ended/i);
    // And it is not a tile: it takes no share.
    expect(screen.queryByTestId('treemap-tile-x:300:1')).toBeNull();
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
    expect(gpu).toHaveTextContent('Not measured');
    expect(NOT_MEASURED).toBeDefined();
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

  it('tiles are filled from variables, not inline colours', () => {
    feed(sampleHierarchy());
    mount();
    for (const el of screen.getAllByTestId(/^treemap-tile-/)) {
      expect(el.getAttribute('style') ?? '').not.toMatch(/#[0-9a-f]{3,8}|rgb|hsl|fill|stroke|background|color/i);
    }
  });

  it('draws tiles as HTML cells placed by the layout, with no inline artwork (SC-002)', () => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1'], metric: 'memory' }));

    const el = tile('n:n1');
    expect(el.tagName.toLowerCase()).toBe('div');
    expect(document.querySelector('.treemap svg')).toBeNull();
    // Placed by the layout alone, and its fill handed to the stylesheet as a number (`--heat`, FR-094);
    // that the cell is positioned is the stylesheet's (`.treemap__tile`).
    expect(el.getAttribute('style')).toMatch(/^left: [\d.]+(px)?; top: [\d.]+(px)?; width: [\d.]+px; height: [\d.]+px;( --heat: [\d.]+;)?$/);
    expect(parseFloat(el.style.width)).toBe(Number(el.getAttribute('data-width')));
    expect(parseFloat(el.style.height)).toBe(Number(el.getAttribute('data-height')));
    expect(el).toHaveAttribute('role', 'button');
    expect(el.getAttribute('aria-label')).toMatch(/^Shell, /);
    expect(el.getAttribute('title')).toBeTruthy();
  });

  it('opens a tile on Enter, and labels one that is big enough with its name and figure', () => {
    feed(sampleHierarchy());
    mount();
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:t1'], metric: 'memory' }));

    const el = tile('n:n1');
    expect(el.querySelector('.treemap__label')?.textContent).toBe('Shell');
    expect(el.querySelector('.treemap__value')?.textContent).toBeTruthy();
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(getView().focusPath).toEqual(['root', 'c:projects', 'p:p1', 't:t1', 'n:n1']);
  });
});
