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
import type { ResourceNode } from '@throng/core';
import { LineGraphs } from '../../../src/renderer/resources/line-graph.js';
import { __resetSession, focusOn, ingestFrame, setSelection, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { useSubject } from '../../../src/renderer/resources/use-subject.js';
import { MIB, frame, metrics, node, proc } from '../helpers/resource-fixtures.js';

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

const METRICS = ['cpu', 'memory', 'gpu', 'io'] as const;

describe('a graph per metric (FR-097)', () => {
  it('has one for CPU, Memory, GPU and I/O, each named for the item it plots', () => {
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

describe('with too little history (FR-091)', () => {
  it('says “Building history…” for each metric until the second point, and draws nothing', () => {
    mount(1);
    for (const metric of METRICS) {
      expect(within(screen.getByTestId(`line-graph-${metric}`)).getByTestId(`line-graph-${metric}-building`)).toHaveTextContent('Building history…');
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
