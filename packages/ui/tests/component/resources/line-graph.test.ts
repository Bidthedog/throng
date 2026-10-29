/**
 * The small line graphs in the right column (055 FR-097, FR-091): one per metric — CPU, Memory, GPU and
 * I/O — of the selected item's own usage, each with its current value, drawn on a canvas like the rows'
 * sparklines, and saying it is building its history until it has two points to draw.
 *
 * Layer: component — the real graphs over the real session; the canvas is the platform seam jsdom lacks,
 * stubbed and counted.
 */
import { act, render, screen, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_ELEVATION_REQUIRED, NOT_MEASURED, unavailable, type ResourceNode } from '@throng/core';
import { LineGraphs } from '../../../src/renderer/resources/line-graph.js';
import { __resetSession, focusOn, ingestFrame, setSelection, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { useSubject } from '../../../src/renderer/resources/use-subject.js';
import { MIB, frame, metrics, node, proc, withNetwork } from '../helpers/resource-fixtures.js';

const PANEL = ['root', 'c:projects', 'p:p1', 't:big', 'n:big'];

function Graphs(): ReactElement | null {
  const subject = useSubject();
  return subject === null ? null : createElement(LineGraphs, { subject });
}

function scene(cpus: Record<number, number>): ResourceNode {
  const kids = Object.entries(cpus).map(([pid, cpu]) => proc(Number(pid), `p${pid}.exe`, metrics({ cpu, memory: 40 * MIB })));
  const panel = node({ id: 'n:big', kind: 'panel', label: 'Busy', panelKind: 'terminal', children: kids, owner: { projectId: 'p1', tabId: 'big', panelId: 'big' } });
  const tab = node({ id: 't:big', kind: 'tab', label: 'Tab', children: [panel], owner: { projectId: 'p1', tabId: 'big' } });
  const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab], owner: { projectId: 'p1' } });
  const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
  return node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } });
}

let tick = 0;
const feed = (root: ResourceNode): void => {
  tick += 1;
  act(() => ingestFrame(frame(tick, root)));
};

let strokes = 0;
beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  tick = 0;
  strokes = 0;
  const ctx = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => {
      strokes += 1;
    },
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set lineJoin(_v: string) {},
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  vi.restoreAllMocks();
  __resetSession();
});

function mount(frames: number): void {
  for (let i = 0; i < frames; i += 1) feed(scene({ 11: 20 + i }));
  render(createElement(Graphs));
  act(() => focusOn(PANEL));
}

const METRICS = ['cpu', 'memory', 'gpu', 'io', 'network'] as const;

describe('a graph per metric (FR-097)', () => {
  it('has one for CPU, Memory, GPU, I/O and Network, each named for the item it plots', () => {
    mount(3);
    for (const metric of METRICS) {
      expect(screen.getByTestId(`line-graph-${metric}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('line-graph-cpu')).toHaveAttribute('aria-label', 'CPU of Busy over time');
    expect(screen.getByTestId('line-graphs')).toHaveAttribute('aria-label', 'Usage over time: Busy');
  });

  it('draws each on a canvas once there are two points, with its current value beside it', () => {
    mount(3);
    for (const metric of METRICS) expect(screen.getByTestId(`line-graph-plot-${metric}`).tagName.toLowerCase()).toBe('canvas');
    expect(strokes).toBeGreaterThanOrEqual(4);
    // 20, 21, 22: the latest capture's figure.
    expect(screen.getByTestId('line-graph-cpu-value')).toHaveTextContent('22');
    expect(screen.getByTestId('line-graph-memory-value')).toHaveTextContent(/40/);
  });

  it('redraws for each capture, without a new canvas', () => {
    mount(3);
    const plot = screen.getByTestId('line-graph-plot-cpu');
    strokes = 0;
    feed(scene({ 11: 30 }));
    expect(strokes).toBeGreaterThanOrEqual(4);
    expect(screen.getByTestId('line-graph-plot-cpu')).toBe(plot);
    expect(screen.getByTestId('line-graph-cpu-value')).toHaveTextContent('30');
  });

  it('follows the selection to another item', () => {
    mount(3);
    act(() => setSelection('x:11:1'));
    expect(screen.getByTestId('line-graphs')).toHaveAttribute('aria-label', 'Usage over time: p11.exe');
  });
});

describe('a Y scale and the value with its band (FR-120)', () => {
  const scale = (metric: string, end: 'max' | 'min'): HTMLElement => screen.getByTestId(`line-graph-${metric}-scale-${end}`);

  it('has a Y scale in each figure\'s unit: zero at the foot, the plotted maximum at the top', () => {
    mount(3);
    // CPU 20, 21, 22 → %; Memory 40 MB each → bytes; I/O → a rate.
    expect(scale('cpu', 'max')).toHaveTextContent('22%');
    expect(scale('cpu', 'min')).toHaveTextContent('0%');
    expect(scale('memory', 'max')).toHaveTextContent('40 MB');
    expect(scale('memory', 'min')).toHaveTextContent('0 B');
    expect(scale('io', 'max')).toHaveTextContent('/s');
    expect(scale('network', 'min')).toHaveTextContent('0 B/s');
  });

  it('follows the maximum as the history moves', () => {
    mount(3);
    feed(scene({ 11: 60 }));
    expect(scale('cpu', 'max')).toHaveTextContent('60%');
  });

  it('draws the line from zero, so the scale\'s labels are the line\'s ends', () => {
    mount(3);
    expect(screen.getByTestId('line-graph-plot-cpu')).toHaveAttribute('data-from-zero', 'true');
  });

  it('puts the scale in the plot\'s box and not beside the building spinner or an unmeasured figure', () => {
    mount(1);
    expect(screen.queryByTestId('line-graph-cpu-scale-max')).toBeNull();
  });

  it('explains each figure on hover: what it counts, and why it is "-", "~" or partial (FR-107), never what it reads (FR-095)', () => {
    mount(3);
    const title = screen.getByTestId('line-graph-memory-value').getAttribute('title') ?? '';
    expect(title).toContain('Memory');
    expect(title).toContain('private working set');
    expect(title).not.toMatch(/\d/);
    expect(screen.getByTestId('line-graph-cpu-value').getAttribute('title')).toContain('share of the whole machine');
  });

  it('says an estimate is one in the title of its value', () => {
    const editor = node({ id: 'n:ed', kind: 'panel', label: 'notes.md', panelKind: 'editor', estimated: true, own: metrics({ cpu: NOT_MEASURED, gpu: NOT_MEASURED, ioRead: NOT_MEASURED, ioWrite: NOT_MEASURED, network: NOT_MEASURED, memory: 4 * MIB }), owner: { projectId: 'p1', tabId: 'ed', panelId: 'ed' } });
    const tab = node({ id: 't:ed', kind: 'tab', label: 'Tab', children: [editor], owner: { projectId: 'p1', tabId: 'ed' } });
    const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab], owner: { projectId: 'p1' } });
    const root = node({ id: 'root', kind: 'root', label: 'throng', children: [node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] })], owner: { component: 'ui' } });
    for (let i = 0; i < 3; i += 1) feed(root);
    render(createElement(Graphs));
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:ed', 'n:ed']));
    expect(screen.getByTestId('line-graph-memory-value').getAttribute('title')).toContain('Estimated');
  });

  it('carries a partial total\'s reason in the title (e.g. Network that needs elevation on part of the tree)', () => {
    const partial = (n: ResourceNode): ResourceNode => ({ ...n, rolled: { ...n.rolled, partial: { network: NETWORK_ELEVATION_REQUIRED } } });
    for (let i = 0; i < 3; i += 1) feed(partial(withNetwork(scene({ 11: 20 }), 2048)));
    render(createElement(Graphs));
    act(() => focusOn(PANEL));
    const panelRolledPartial = screen.getByTestId('line-graph-network-value').getAttribute('title') ?? '';
    expect(panelRolledPartial).toContain('Network');
    expect(panelRolledPartial).toContain('bytes sent plus received');
  });

  it('reads the band immediately to the left of the value, e.g. "Normal 22%"', () => {
    mount(3);
    const value = screen.getByTestId('line-graph-cpu-value');
    const band = screen.getByTestId('line-graph-cpu-band');
    expect(band).toHaveTextContent('Normal');
    expect(value).toHaveTextContent('22');
    // Band first, then the value, adjacent in the same line.
    expect(band.nextElementSibling).toBe(value);
    expect(band.parentElement).toHaveTextContent(/^Normal\s*22/);
  });

  it('names a warning and a critical band in words', () => {
    mount(3);
    feed(scene({ 11: 95 }));
    expect(screen.getByTestId('line-graph-cpu-band')).toHaveTextContent('Critical');
  });

  it('bands Memory too, and leaves the figures with no band (GPU, I/O, Network) as a bare value', () => {
    mount(3);
    expect(screen.getByTestId('line-graph-memory-band')).toHaveTextContent('Normal');
    for (const metric of ['gpu', 'io', 'network']) expect(screen.queryByTestId(`line-graph-${metric}-band`), metric).toBeNull();
  });

  it('says no band for an item that ended or a figure that is not measured', () => {
    feed(scene({ 11: 20, 12: 10 }));
    feed(scene({ 11: 20, 12: 10 }));
    feed(scene({ 11: 20 }));
    render(createElement(Graphs));
    act(() => focusOn(PANEL));
    act(() => setSelection('x:12:1'));
    expect(screen.getByTestId('line-graph-cpu-value')).toHaveTextContent('ended');
    expect(screen.queryByTestId('line-graph-cpu-band')).toBeNull();
  });
});

describe('with too little history (FR-091, FR-114)', () => {
  it('shows a centred spinner in each graph’s own box until the second point, no words, and draws nothing (FR-114)', () => {
    mount(1);
    for (const metric of METRICS) {
      const box = within(screen.getByTestId(`line-graph-${metric}`)).getByTestId(`line-graph-${metric}-building`);
      expect(box).toHaveTextContent('');
      expect(within(box).getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
      expect(screen.queryByTestId(`line-graph-plot-${metric}`)).toBeNull();
    }
    expect(strokes).toBe(0);
    // The current value is there all the same: one reading is still a reading.
    expect(screen.getByTestId('line-graph-cpu-value')).toHaveTextContent('20');
  });

  it('swaps to the line when the second point arrives', () => {
    mount(1);
    feed(scene({ 11: 25 }));
    expect(screen.queryByTestId('line-graph-cpu-building')).toBeNull();
    expect(screen.getByTestId('line-graph-plot-cpu')).toBeInTheDocument();
  });
});

describe('an item that has ended', () => {
  it('reads “ended” for its current value, and keeps what it drew', () => {
    feed(scene({ 11: 20, 12: 10 }));
    feed(scene({ 11: 20, 12: 10 }));
    feed(scene({ 11: 20 }));
    render(createElement(Graphs));
    act(() => focusOn(PANEL));
    act(() => setSelection('x:12:1'));
    expect(screen.getByTestId('line-graph-cpu-value')).toHaveTextContent('ended');
    expect(screen.getByTestId('line-graph-plot-cpu')).toBeInTheDocument();
  });
});

describe('Network (FR-113, T175)', () => {
  it('plots the network rate like the other figures, its value a rate', () => {
    for (let i = 0; i < 3; i += 1) feed(withNetwork(scene({ 11: 20 }), 2048 * (i + 1)));
    render(createElement(Graphs));
    act(() => focusOn(PANEL));
    expect(screen.getByTestId('line-graph-plot-network')).toBeInTheDocument();
    expect(screen.getByTestId('line-graph-network-value')).toHaveTextContent(/\/s/);
  });

  it('not measured YET (the first sighting has no rate) is loading, not unavailable: the spinner, not the empty box (review finding 7)', () => {
    feed(withNetwork(scene({ 11: 20 }), NOT_MEASURED));
    render(createElement(Graphs));
    act(() => focusOn(PANEL));
    expect(screen.queryByTestId('line-graph-network-none')).toBeNull();
    expect(within(screen.getByTestId('line-graph-network-building')).getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
  });

  it('never measured (an editor panel’s CPU): “-” with its reason, no spinner and no line of zeros (T180)', () => {
    const editor = node({ id: 'n:ed', kind: 'panel', label: 'notes.md', panelKind: 'editor', estimated: true, own: metrics({ cpu: NOT_MEASURED, gpu: NOT_MEASURED, ioRead: NOT_MEASURED, ioWrite: NOT_MEASURED, network: NOT_MEASURED, memory: 4 * MIB }), owner: { projectId: 'p1', tabId: 'ed', panelId: 'ed' } });
    const tab = node({ id: 't:ed', kind: 'tab', label: 'Tab', children: [editor], owner: { projectId: 'p1', tabId: 'ed' } });
    const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab], owner: { projectId: 'p1' } });
    const root = node({ id: 'root', kind: 'root', label: 'throng', children: [node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] })], owner: { component: 'ui' } });
    for (let i = 0; i < 3; i += 1) feed(root);
    render(createElement(Graphs));
    act(() => focusOn(['root', 'c:projects', 'p:p1', 't:ed', 'n:ed']));
    for (const metric of ['cpu', 'gpu', 'io', 'network'] as const) {
      expect(screen.getByTestId(`line-graph-${metric}-none`), metric).toBeInTheDocument();
      expect(screen.queryByTestId(`line-graph-plot-${metric}`), metric).toBeNull();
      expect(screen.queryByTestId(`line-graph-${metric}-building`), metric).toBeNull();
      expect(screen.getByTestId(`line-graph-${metric}-value`)).toHaveAttribute('title');
    }
    expect(screen.getByTestId('line-graph-cpu-value')).toHaveAttribute('title', 'CPU: Not measured');
    // Elevated (the root's Network is not "elevation-required"): a Network nothing measures is "Not measured" (T182).
    expect(screen.getByTestId('line-graph-network-value')).toHaveAttribute('title', 'Not measured');
    // Its memory is an estimate, and that is plotted.
    expect(screen.getByTestId('line-graph-plot-memory')).toBeInTheDocument();

    // Unelevated, the same panel's Network says what would measure it (T182, US2/AC34).
    const unelevated = { ...root, rolled: { ...root.rolled, network: unavailable(NETWORK_ELEVATION_REQUIRED) } };
    feed(unelevated);
    expect(screen.getByTestId('line-graph-network-value')).toHaveAttribute('title', 'Elevate to show');
  });

  it('unelevated: reads “-” titled “Elevate to show”, and draws no line of zeros', () => {
    for (let i = 0; i < 3; i += 1) feed(withNetwork(scene({ 11: 20 }), unavailable(NETWORK_ELEVATION_REQUIRED)));
    render(createElement(Graphs));
    act(() => focusOn(PANEL));
    const value = screen.getByTestId('line-graph-network-value');
    expect(value).toHaveTextContent(/^-$/);
    expect(value).toHaveAttribute('title', 'Elevate to show');
    expect(screen.queryByTestId('line-graph-plot-network')).toBeNull();
    // The others are unaffected.
    expect(screen.getByTestId('line-graph-plot-cpu')).toBeInTheDocument();
  });
});
