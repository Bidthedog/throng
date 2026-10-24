/**
 * What drawing the rows costs per capture (055 SC-010, defect D5): a sparkline reads its colour once per
 * capture rather than once per row, is drawn only while it is on screen, says when it has too little
 * history, Hide idle hands the idle rule only the samples it reads, and none of them is redrawn while the
 * pointer is over the list (FR-095).
 *
 * Layer: component — the real `Breakdown` over the real session; the canvas, `getComputedStyle` and
 * `IntersectionObserver` are the platform seams jsdom lacks, stubbed and counted.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceNode } from '@throng/core';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { __resetSession, ingestFrame, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { frame, metrics, node, proc } from '../helpers/resource-fixtures.js';
import { NOT_MEASURED } from '@throng/core';

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

describe('a sparkline with too little history shows a spinner (FR-091, FR-114)', () => {
  it('spins, wordless, in the sparkline’s own box until the second point, then draws the line', () => {
    mount(scene(3), 1);
    const building = screen.getByTestId('sparkline-building-x:100:1');
    expect(building).toHaveTextContent('');
    expect(building).not.toHaveAttribute('title');
    expect(building).toHaveClass('sparkline');
    const spinner = building.querySelector('[role="progressbar"]');
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveAttribute('aria-label', 'Loading');
    expect(screen.queryByTestId('sparkline-x:100:1')).toBeNull();

    feed(scene(3));

    expect(screen.queryByTestId('sparkline-building-x:100:1')).toBeNull();
    expect(screen.getByTestId('sparkline-x:100:1')).toBeInTheDocument();
  });
});

describe('a figure that never will be measured draws no sparkline at all (T180, FR-107)', () => {
  it('an editor panel, with no process under it, has neither a flat line nor a spinner beside its "-"', () => {
    const editor = node({ id: 'n:ed', kind: 'panel', label: 'notes.md', panelKind: 'editor', estimated: true, own: metrics({ cpu: NOT_MEASURED, gpu: NOT_MEASURED, ioRead: NOT_MEASURED, ioWrite: NOT_MEASURED, network: NOT_MEASURED, memory: 4 * 1024 * 1024 }), owner: { projectId: 'p1', tabId: 'big', panelId: 'ed' } });
    const tab = node({ id: 't:big', kind: 'tab', label: 'Tab', children: [editor], owner: { projectId: 'p1', tabId: 'big' } });
    const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab], owner: { projectId: 'p1' } });
    const root = node({ id: 'root', kind: 'root', label: 'throng', owner: { component: 'ui' }, children: [node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] })] });
    for (let i = 0; i < 3; i += 1) feed(root);
    render(createElement(Breakdown));
    act(() => setView({ focusPath: ['root', 'c:projects', 'p:p1', 't:big'] }));

    expect(screen.queryByTestId('sparkline-n:ed')).toBeNull();
    expect(screen.queryByTestId('sparkline-building-n:ed')).toBeNull();
    expect(screen.getByTestId('sparkline-none-n:ed')).toBeInTheDocument();
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

describe('sparklines hold still while the pointer is over the list (FR-095)', () => {
  it('draws nothing for a capture that arrives under the pointer, and catches up when it leaves', () => {
    mount(scene(5));
    const list = screen.getByTestId('breakdown');

    fireEvent.mouseEnter(list);
    platform.strokes = 0;
    feed(scene(5));
    feed(scene(5));
    expect(platform.strokes).toBe(0);

    fireEvent.mouseLeave(list);
    expect(platform.strokes).toBeGreaterThanOrEqual(5);

    // …and they are live again afterwards.
    platform.strokes = 0;
    feed(scene(5));
    expect(platform.strokes).toBeGreaterThanOrEqual(5);
  });
});
