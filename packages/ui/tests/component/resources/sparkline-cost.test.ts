/**
 * What drawing the rows costs per capture (055 SC-010, defect D5): a sparkline reads its colour once per
 * capture rather than once per row, is drawn only while it is on screen, says when it has too little
 * history, and Hide idle hands the idle rule only the samples it reads. The treemap measures its box
 * before its first layout rather than laying out for a guess and again for the truth.
 *
 * Layer: component — the real `Breakdown` over the real session; the canvas, `getComputedStyle`,
 * `IntersectionObserver` and `getBoundingClientRect` are the platform seams jsdom lacks, stubbed and counted.
 */
import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceNode } from '@throng/core';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { __resetSession, ingestFrame, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { frame, metrics, node, proc } from '../helpers/resource-fixtures.js';

const idle = vi.hoisted(() => ({ lengths: [] as number[] }));
vi.mock('@throng/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@throng/core')>();
  return {
    ...actual,
    isIdle: (...args: Parameters<typeof actual.isIdle>) => {
      idle.lengths.push(args[0].length);
      return actual.isIdle(...args);
    },
  };
});
vi.mock('../../../src/renderer/resources/charts/timeseries.js', () => ({ Timeseries: () => null, default: () => null }));

const PANEL = ['root', 'c:projects', 'p:p1', 't:big', 'n:big'];

function scene(count: number, cpu = (i: number): number => 1 + (i % 5)): ResourceNode {
  const kids = Array.from({ length: count }, (_, i) => proc(100 + i, `p${i}.exe`, metrics({ cpu: cpu(i) })));
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

const platform = { strokes: 0, colourReads: 0 };
let observed: Element[] = [];
let report: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => undefined;

class FakeIntersectionObserver {
  constructor(cb: (entries: { target: Element; isIntersecting: boolean }[]) => void) {
    report = cb;
  }
  observe(el: Element): void {
    observed.push(el);
  }
  unobserve(el: Element): void {
    observed = observed.filter((o) => o !== el);
  }
  disconnect(): void {
    observed = [];
  }
}

function stubCanvas(): void {
  const ctx = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => {
      platform.strokes += 1;
    },
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set lineJoin(_v: string) {},
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    if (el instanceof HTMLCanvasElement) platform.colourReads += 1;
    return real(el, pseudo);
  });
}

beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  platform.strokes = 0;
  platform.colourReads = 0;
  observed = [];
  idle.lengths = [];
  tick = 0;
  stubCanvas();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetSession();
});

function mount(root: ResourceNode, frames = 3): void {
  for (let i = 0; i < frames; i += 1) feed(root);
  render(createElement(Breakdown));
  act(() => setView({ focusPath: PANEL }));
}

describe('a sparkline reads its colour once per capture, not once per row (D5)', () => {
  it('asks the platform for the stroke colour at most once for thirty rows', () => {
    mount(scene(30));
    platform.colourReads = 0;

    feed(scene(30));

    expect(screen.getAllByTestId(/^sparkline-x:/)).toHaveLength(30);
    expect(platform.colourReads).toBeLessThanOrEqual(1);
    expect(platform.strokes).toBeGreaterThanOrEqual(30);
  });
});

describe('a sparkline is drawn only while it is on screen (D5)', () => {
  beforeEach(() => vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver));

  it('draws nothing for rows nobody can see, then the ones that scroll into view', () => {
    mount(scene(30));
    expect(platform.strokes).toBe(0);
    expect(observed.length).toBeGreaterThanOrEqual(30);

    act(() => report(observed.slice(0, 4).map((target) => ({ target, isIntersecting: true }))));
    expect(platform.strokes).toBe(4);

    // The next capture redraws only those four.
    platform.strokes = 0;
    feed(scene(30));
    expect(platform.strokes).toBe(4);

    // One scrolls away: it is left alone from then on.
    act(() => report([{ target: observed[0]!, isIntersecting: false }]));
    platform.strokes = 0;
    feed(scene(30));
    expect(platform.strokes).toBe(3);
  });
});

describe('a sparkline with too little history says so (FR-091)', () => {
  it('reads “Building history…” until the second point, then draws the line', () => {
    mount(scene(3), 1);
    const building = screen.getByTestId('sparkline-building-x:100:1');
    expect(building).toHaveTextContent('Building history…');
    expect(screen.queryByTestId('sparkline-x:100:1')).toBeNull();

    feed(scene(3));

    expect(screen.queryByTestId('sparkline-building-x:100:1')).toBeNull();
    expect(screen.getByTestId('sparkline-x:100:1')).toBeInTheDocument();
  });
});

describe('Hide idle hands the idle rule only the samples it reads (D5)', () => {
  it('passes at most three samples per process however long the history is', () => {
    mount(scene(5), 40);
    act(() => setView({ hideIdle: true }));
    feed(scene(5));

    expect(idle.lengths.length).toBeGreaterThan(0);
    expect(Math.max(...idle.lengths)).toBeLessThanOrEqual(3);
  });
});

describe('the treemap measures its box before its first layout (D5)', () => {
  it('lays the tiles out in the box it measured, not in a guess', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = this.classList.contains('treemap') ? { width: 400, height: 100 } : { width: 0, height: 0 };
      return { ...box, x: 0, y: 0, top: 0, left: 0, right: box.width, bottom: box.height, toJSON: () => ({}) } as DOMRect;
    });
    const only = proc(100, 'only.exe', metrics({ cpu: 3 }));
    const panel = node({ id: 'n:big', kind: 'panel', label: 'Busy', panelKind: 'terminal', children: [only], owner: { projectId: 'p1', tabId: 'big', panelId: 'big' } });
    const tab = node({ id: 't:big', kind: 'tab', label: 'Tab', children: [panel], owner: { projectId: 'p1', tabId: 'big' } });
    const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab], owner: { projectId: 'p1' } });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
    mount(node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } }), 1);

    const only1 = screen.getByTestId('treemap-tile-x:100:1');
    expect(only1.getAttribute('data-width')).toBe('400');
    expect(only1.getAttribute('data-height')).toBe('100');
  });
});
