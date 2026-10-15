/**
 * The modal session store (055 FR-033, FR-033a, FR-057, FR-065a): rolling history per node, ended
 * entries, and the view state that outlives a close.
 *
 * Layer: unit — pure module state fed whole frames; the DOM is not needed to say which entries survive
 * a frame. The component tests (`breakdown`, `detail-pane`, `monitor-modal`) prove what is DRAWN.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { historyLength } from '@throng/core';
import {
  __resetSession,
  endSession,
  getHistory,
  getIoPeak,
  getSessionSnapshot,
  getView,
  ingestFrame,
  isEnded,
  MAX_STACK_SERIES,
  reconfigureSession,
  resolveFocusPath,
  setView,
  stackedSeries,
  startSession,
} from '../../../src/renderer/resources/monitor-session.js';
import { MIB, flatten, frame, metrics, node, proc, sampleHierarchy } from '../../component/helpers/resource-fixtures.js';
import type { ResourceNode } from '@throng/core';

beforeEach(() => {
  __resetSession();
});
afterEach(() => {
  __resetSession();
});

const settings = (intervalSeconds = 2, historyMinutes = 5) => ({ intervalSeconds, historyMinutes });
const byId = (root: ResourceNode | null, id: string): ResourceNode | undefined =>
  root === null ? undefined : flatten(root).find((n) => n.id === id);

describe('rolling history (FR-033, FR-033a)', () => {
  it('keeps ceil(historyMinutes × 60 / interval) points per node, never more than 150', () => {
    expect(historyLength(settings(2, 5))).toBe(150);
    startSession(settings(2, 1)); // 30 points
    for (let tick = 1; tick <= 40; tick += 1) ingestFrame(frame(tick, sampleHierarchy()));

    const points = getHistory('root');
    expect(points).toHaveLength(30);
    // Oldest dropped: ticks 11…40 remain.
    expect(points[0]?.tick).toBe(11);
    expect(points.at(-1)?.tick).toBe(40);
  });

  it('keeps the window for every node, not only the root', () => {
    startSession(settings(2, 1));
    for (let tick = 1; tick <= 35; tick += 1) ingestFrame(frame(tick, sampleHierarchy()));
    expect(getHistory('x:300:1')).toHaveLength(30);
    expect(getHistory('p:p1')).toHaveLength(30);
  });

  it('shrinks the window when the interval or history setting changes mid-session', () => {
    startSession(settings(2, 5)); // 150
    for (let tick = 1; tick <= 100; tick += 1) ingestFrame(frame(tick, sampleHierarchy()));
    expect(getHistory('root')).toHaveLength(100);

    reconfigureSession(settings(2, 1)); // 30
    expect(getHistory('root')).toHaveLength(30);
    expect(getHistory('root')[0]?.tick).toBe(71);
  });

  it('starts empty on every open and is discarded on close', () => {
    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy()));
    expect(getHistory('root')).toHaveLength(1);
    expect(getSessionSnapshot().tree).not.toBeNull();

    endSession();
    expect(getHistory('root')).toHaveLength(0);
    expect(getSessionSnapshot().tree).toBeNull();
    expect(getSessionSnapshot().frame).toBeNull();

    startSession(settings());
    expect(getHistory('root')).toHaveLength(0);
  });
});

describe('a stale frame (FR-044, T095)', () => {
  it('is shown, but adds no point: it repeats a reading already recorded, at a later tick', () => {
    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy()));
    const before = getHistory('p:p1').length;

    ingestFrame(frame(2, sampleHierarchy(), { stale: true, staleSince: 1_700_000_002_000 }));

    expect(getHistory('p:p1')).toHaveLength(before);
    expect(getSessionSnapshot().frame?.stale).toBe(true);
  });

  it('resumes recording on the next good frame', () => {
    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy()));
    ingestFrame(frame(2, sampleHierarchy(), { stale: true }));
    ingestFrame(frame(3, sampleHierarchy()));

    expect(getHistory('p:p1').map((p) => p.tick)).toEqual([1, 3]);
  });
});

describe('ended entries (FR-065a)', () => {
  it('keeps a process that vanishes in its place, ended, with its history, outside every roll-up', () => {
    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy({ nodeCpu: 40 })));
    ingestFrame(frame(2, sampleHierarchy({ withNode: false })));

    const tree = getSessionSnapshot().tree;
    const ended = byId(tree, 'x:300:1');
    expect(ended, 'the killed process disappeared from the tree').toBeDefined();
    expect(isEnded('x:300:1')).toBe(true);
    // At its LAST place: still the first child of its shell.
    expect(byId(tree, 'x:200:1')?.children[0]?.id).toBe('x:300:1');
    // Its history is still there, one live point.
    expect(getHistory('x:300:1')).toHaveLength(1);
    // The live roll-ups (the new frame's own) no longer include it: the shell is its own 1% alone.
    expect(byId(tree, 'x:200:1')?.rolled.cpu).toBe(1);
    expect(byId(tree, 'root')?.rolled.cpu).toBe(3 + 1 + 0 + 1);
    // …and its own figures are cleared, not zero, so nothing can sum or size it by accident.
    expect(ended?.rolled.cpu).toEqual({ kind: 'notMeasured' });
  });

  it('keeps it across every later frame, and adds no new points to it', () => {
    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy()));
    ingestFrame(frame(2, sampleHierarchy({ withNode: false })));
    ingestFrame(frame(3, sampleHierarchy({ withNode: false })));
    ingestFrame(frame(4, sampleHierarchy({ withNode: false })));

    expect(isEnded('x:300:1')).toBe(true);
    expect(byId(getSessionSnapshot().tree, 'x:300:1')).toBeDefined();
    expect(getHistory('x:300:1')).toHaveLength(1);
  });

  it('never marks a process that moved elsewhere in the tree as ended', () => {
    // The same process id turns up under a different parent: lineage re-attributed it. It is live.
    const before = sampleHierarchy();
    const after = sampleHierarchy({ withNode: false });
    const moved = byId(before, 'x:300:1')!;
    const shell = byId(after, 'x:200:1')!;
    const ui = byId(after, 'c:ui')!;
    const patched: ResourceNode = {
      ...after,
      children: after.children.map((c) =>
        c.id === 'c:ui' ? { ...ui, children: [...ui.children, moved] } : c,
      ),
    };
    expect(shell.children).toHaveLength(0);

    startSession(settings());
    ingestFrame(frame(1, before));
    ingestFrame(frame(2, patched));

    expect(isEnded('x:300:1')).toBe(false);
  });

  it('never shows a process it never saw live', () => {
    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy({ withNode: false })));
    ingestFrame(frame(2, sampleHierarchy({ withNode: false })));

    expect(byId(getSessionSnapshot().tree, 'x:300:1')).toBeUndefined();
    expect(isEnded('x:300:1')).toBe(false);
  });

  it('clears ended entries on close and does not restore them on reopen', () => {
    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy()));
    ingestFrame(frame(2, sampleHierarchy({ withNode: false })));
    expect(isEnded('x:300:1')).toBe(true);

    endSession();
    expect(isEnded('x:300:1')).toBe(false);

    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy({ withNode: false })));
    expect(byId(getSessionSnapshot().tree, 'x:300:1')).toBeUndefined();
  });

  it('ends a vanished process whole: its descendants end with it, in their places', () => {
    // Kill All Below on the shell: the shell and the node under it both vanish from the next frame.
    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy()));
    const after = sampleHierarchy();
    const terminalPanel = byId(after, 'n:n1')!;
    const gutted: ResourceNode = {
      ...after,
      children: after.children.map((c) =>
        c.id !== 'c:projects'
          ? c
          : {
              ...c,
              children: c.children.map((p) =>
                p.id !== 'p:p1'
                  ? p
                  : {
                      ...p,
                      children: p.children.map((t) => ({
                        ...t,
                        children: t.children.map((n) =>
                          n.id === terminalPanel.id ? { ...n, children: n.children.filter((k) => k.kind !== 'process') } : n,
                        ),
                      })),
                    },
              ),
            },
      ),
    };
    ingestFrame(frame(2, gutted));

    const tree = getSessionSnapshot().tree;
    expect(isEnded('x:200:1')).toBe(true);
    expect(isEnded('x:300:1')).toBe(true);
    // The node still hangs under the shell it hung under.
    expect(byId(tree, 'x:200:1')?.children.map((c) => c.id)).toEqual(['x:300:1']);
    // The panel (a UI element) stays, in its shell-exited state (FR-066).
    expect(byId(tree, 'n:n1')).toBeDefined();
  });
});

describe('view state (FR-057)', () => {
  it('survives a close and a reopen, until the module is reloaded', () => {
    setView({ metric: 'memory', filterText: 'node', narrowTo: 'p:p1', hideIdle: true });
    startSession(settings());
    endSession();
    startSession(settings());

    expect(getView()).toMatchObject({ metric: 'memory', filterText: 'node', narrowTo: 'p:p1', hideIdle: true });
  });

  it('has sensible first-open defaults: CPU, no filter, nothing hidden, at the root', () => {
    expect(getView()).toEqual({
      metric: 'cpu',
      filterText: '',
      narrowTo: null,
      hideIdle: false,
      focusPath: ['root'],
    });
  });

  it('resolves a focus path to the nearest surviving ancestor', () => {
    const root = sampleHierarchy();
    const path = ['root', 'c:projects', 'p:p1', 't:t1', 'n:n2'];
    expect(resolveFocusPath(path, root)).toEqual(path);

    const noEditor = sampleHierarchy({ withEditor: false });
    expect(resolveFocusPath(path, noEditor)).toEqual(['root', 'c:projects', 'p:p1', 't:t1']);

    // Everything but the root gone: the root.
    expect(resolveFocusPath(['root', 'p:gone', 'x:1'], root)).toEqual(['root']);
    // No tree yet: the path is kept as it was, to be resolved against the first frame.
    expect(resolveFocusPath(path, null)).toEqual(path);
  });

  // A narrowing the toolbar can no longer show (its <select> has no such option, so it reads "Everything")
  // but which still filtered everything out: an empty monitor with nothing to explain it.
  it('drops a narrowing to a node that is not in the tree when the first frame arrives', () => {
    setView({ narrowTo: 'p:gone', focusPath: ['root', 'c:projects', 'p:gone'] });
    startSession(settings());

    ingestFrame(frame(1, sampleHierarchy()));

    expect(getView().narrowTo).toBeNull();
    // The focus walks to its nearest survivor: the Projects component is still there, the project is not.
    expect(resolveFocusPath(getView().focusPath, getSessionSnapshot().tree)).toEqual(['root', 'c:projects']);
  });

  it('keeps a narrowing to a node that is still there', () => {
    setView({ narrowTo: 'p:p1' });
    startSession(settings());

    ingestFrame(frame(1, sampleHierarchy()));

    expect(getView().narrowTo).toBe('p:p1');
  });

  it('drops a narrowing when its node disappears from a later frame', () => {
    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy()));
    setView({ narrowTo: 'p:p2' });
    expect(getView().narrowTo).toBe('p:p2');

    const without = (n: ResourceNode): ResourceNode => ({ ...n, children: n.children.filter((c) => c.id !== 'p:p2').map(without) });
    ingestFrame(frame(2, without(sampleHierarchy())));

    expect(getView().narrowTo).toBeNull();
  });

  it('keeps a focus on an ENDED process, which is still in its place', () => {
    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy()));
    ingestFrame(frame(2, sampleHierarchy({ withNode: false })));
    const path = ['root', 'c:projects', 'p:p1', 't:t1', 'n:n1', 'x:200:1', 'x:300:1'];

    expect(resolveFocusPath(path, getSessionSnapshot().tree)).toEqual(path);
  });
});

describe('the I/O peak the tiles are coloured against (FR-094)', () => {
  const withIo = (read: number, write: number): ResourceNode => {
    const busy = proc(7, 'busy.exe', metrics({ ioRead: read, ioWrite: write }));
    return node({ id: 'root', kind: 'root', label: 'throng', children: [busy], owner: { component: 'ui' } });
  };

  it('is the highest read-plus-write rate throng has reached since the window opened', () => {
    startSession(settings());
    expect(getIoPeak()).toBe(0);
    ingestFrame(frame(1, withIo(100, 50)));
    ingestFrame(frame(2, withIo(10, 5)));
    expect(getIoPeak()).toBe(150);
    ingestFrame(frame(3, withIo(400, 100)));
    expect(getIoPeak()).toBe(500);
  });

  it('does not count a stale frame, which only repeats an old reading', () => {
    startSession(settings());
    ingestFrame(frame(1, withIo(100, 0)));
    ingestFrame(frame(2, withIo(9000, 0), { stale: true }));
    expect(getIoPeak()).toBe(100);
  });

  it('starts again with each window and is dropped on close', () => {
    startSession(settings());
    ingestFrame(frame(1, withIo(100, 0)));
    startSession(settings());
    expect(getIoPeak()).toBe(0);
    ingestFrame(frame(1, withIo(100, 0)));
    endSession();
    expect(getIoPeak()).toBe(0);
  });
});

describe('a stacked chart over many contributors (Edge Cases, Very large trees; T103)', () => {
  const panelWith = (count: number, size: (i: number) => number = (i) => i + 1, reverse = false): ResourceNode => {
    const made = Array.from({ length: count }, (_, i) => proc(100 + i, `p${i}.exe`, metrics({ memory: size(i) * MIB })));
    const kids = reverse ? made.reverse() : made;
    const panel = node({ id: 'n:big', kind: 'panel', label: 'Busy', panelKind: 'terminal', children: kids, owner: { projectId: 'p1', tabId: 't', panelId: 'big' } });
    const tab = node({ id: 't:big', kind: 'tab', label: 'Tab', children: [panel], owner: { projectId: 'p1', tabId: 'big' } });
    const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab], owner: { projectId: 'p1' } });
    const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
    return node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } });
  };

  it('keeps the largest as bands and groups the rest into one “N others” band that keeps the total', () => {
    startSession(settings());
    ingestFrame(frame(1, panelWith(20)));
    ingestFrame(frame(2, panelWith(20)));

    const chart = stackedSeries('n:big', 'memory');

    expect(chart.series).toHaveLength(MAX_STACK_SERIES);
    const others = chart.series.at(-1)!;
    expect(others.label).toBe(`${20 - (MAX_STACK_SERIES - 1)} others`);
    // The biggest contributor is a band of its own; the smallest are inside “others”.
    expect(chart.series.map((s) => s.id)).toContain('x:119:1');
    expect(chart.series.map((s) => s.id)).not.toContain('x:100:1');
    // Nothing is lost: the stack still sums to the node's rolled figure at every tick.
    const total = (20 * 21) / 2 * MIB;
    chart.ticks.forEach((_, i) => expect(chart.series.reduce((sum, s) => sum + s.values[i]!, 0)).toBe(total));
  });

  it('keeps the bands in a stable order by id, whatever their sizes (D4)', () => {
    startSession(settings());
    // The collector hands children over in no particular order.
    ingestFrame(frame(1, panelWith(20, undefined, true)));
    const ids = (): string[] => stackedSeries('n:big', 'memory').series.map((s) => s.id);
    const first = ids();

    // The sizes reverse: a ranking by area would reorder the bands; an order by id does not.
    ingestFrame(frame(2, panelWith(20, (i) => 20 - i)));
    const second = ids();

    const bands = (all: string[]): string[] => all.filter((id) => id !== 'others');
    expect(bands(first)).toEqual([...bands(first)].sort());
    expect(bands(second)).toEqual([...bands(second)].sort());
    expect(first.at(-1)).toBe('others');
    expect(second).toHaveLength(first.length);
  });

  it('does not group a single leftover — one band is just that band', () => {
    startSession(settings());
    ingestFrame(frame(1, panelWith(MAX_STACK_SERIES + 1)));

    const chart = stackedSeries('n:big', 'memory');

    expect(chart.series).toHaveLength(MAX_STACK_SERIES + 1);
    expect(chart.series.some((s) => /others/.test(s.label))).toBe(false);
  });

  it('leaves a small fan-out exactly as it was', () => {
    startSession(settings());
    ingestFrame(frame(1, panelWith(5)));
    expect(stackedSeries('n:big', 'memory').series).toHaveLength(5);
  });
});

describe('the series behind a stacked chart (FR-060)', () => {
  it('stacks the focused node’s children, aligned to its own ticks, an ended child included as zero', () => {
    startSession(settings());
    ingestFrame(frame(1, sampleHierarchy({ nodeCpu: 20 })));
    ingestFrame(frame(2, sampleHierarchy({ nodeCpu: 30 })));
    ingestFrame(frame(3, sampleHierarchy({ withNode: false })));

    const stack = stackedSeries('x:200:1', 'cpu');
    expect(stack.ticks).toEqual([1, 2, 3]);
    const child = stack.series.find((s) => s.id === 'x:300:1');
    expect(child?.values).toEqual([20, 30, 0]);
    expect(child?.ended).toBe(true);
    // The shell's own use is a band of its own, so the stack sums to the shell's rolled figure.
    const own = stack.series.find((s) => s.id === 'x:200:1');
    expect(own?.values).toEqual([1, 1, 1]);
  });
});
