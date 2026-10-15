/**
 * What the selected item is made of (055 FR-097, FR-094, FR-095): its children as ranked share bars, each
 * as long as its share of the item and coloured by how much of the machine it takes, with the figure beside
 * it; a click selects that child; and the bars hold their order and figures while the pointer is over them.
 *
 * Layer: component — the real bars over the real session, handed the subject the way the detail pane does.
 * A mixed colour is not assertable in jsdom (it computes no `color-mix()`), so what a bar carries is the
 * `--heat` number the stylesheet mixes from; `heat.test.ts` reads the stylesheet for the mixing itself.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ResourceNode } from '@throng/core';
import { ShareBars } from '../../../src/renderer/resources/share-bars.js';
import { __resetSession, focusOn, getSelection, ingestFrame, setSelection, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { useSubject } from '../../../src/renderer/resources/use-subject.js';
import { GIB, MIB, frame, metrics, node, proc } from '../helpers/resource-fixtures.js';

const PANEL = ['root', 'c:projects', 'p:p1', 't:big', 'n:big'];

function Bars(): ReactElement | null {
  const subject = useSubject();
  return subject === null ? null : createElement(ShareBars, { subject });
}

function scene(cpus: Record<number, number>, children: Record<number, ResourceNode[]> = {}, memory: Record<number, number> = {}): ResourceNode {
  const kids = Object.entries(cpus).map(([pid, cpu]) =>
    proc(Number(pid), `p${pid}.exe`, metrics({ cpu, memory: (memory[Number(pid)] ?? 0) * MIB }), children[Number(pid)] ?? []),
  );
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
function mountOn(root: ResourceNode, path: readonly string[] = PANEL): void {
  tick = 0;
  feed(root);
  render(createElement(Bars));
  act(() => focusOn(path));
}

const bars = (): string[] => screen.getAllByTestId(/^share-bar-x:/).map((b) => b.getAttribute('data-node-id') ?? '');
const heatOf = (id: string): number | null => {
  const v = screen.getByTestId(`share-bar-fill-${id}`).style.getPropertyValue('--heat');
  return v === '' ? null : Number(v);
};
const shareOf = (id: string): number => Number(screen.getByTestId(`share-bar-fill-${id}`).getAttribute('data-share'));

beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
});
afterEach(() => __resetSession());

describe('the children as ranked bars (FR-097)', () => {
  it('ranks them by the chosen metric, biggest first, each as long as its share of the item', () => {
    mountOn(scene({ 11: 10, 12: 60, 13: 30 }));
    expect(bars()).toEqual(['x:12:1', 'x:13:1', 'x:11:1']);
    expect(shareOf('x:12:1')).toBeCloseTo(0.6, 3);
    expect(shareOf('x:13:1')).toBeCloseTo(0.3, 3);
    expect(shareOf('x:11:1')).toBeCloseTo(0.1, 3);
    expect(screen.getByTestId('share-bar-fill-x:12:1').style.width).toBe('60%');
  });

  it('puts the figure beside each bar', () => {
    mountOn(scene({ 11: 60 }));
    expect(screen.getByTestId('share-bar-figure-x:11:1')).toHaveTextContent('60%');
  });

  it('measures a share against the item itself, so a process doing work of its own is not 100% children', () => {
    // 50% of its own and a child at 25%: the item is 75%, the child a third of it.
    const root = scene({ 11: 50 }, { 11: [proc(21, 'c21.exe', metrics({ cpu: 25 }))] });
    mountOn(root, [...PANEL, 'x:11:1']);
    expect(shareOf('x:21:1')).toBeCloseTo(1 / 3, 3);
  });

  it('follows the metric: by memory the order and the figures are memory’s', () => {
    mountOn(scene({ 11: 90, 12: 1 }, {}, { 11: 10, 12: 500 }));
    act(() => setView({ metric: 'memory' }));
    expect(bars()).toEqual(['x:12:1', 'x:11:1']);
    expect(screen.getByTestId('share-bar-figure-x:12:1')).toHaveTextContent(/500/);
  });

  it('draws no bar for a process that has ended, nor for one using nothing', () => {
    mountOn(scene({ 11: 40, 12: 20, 13: 0 }));
    feed(scene({ 11: 40, 13: 0 }));
    expect(bars()).toEqual(['x:11:1']);
  });

  it('says so when nothing under the item uses any of the metric', () => {
    mountOn(scene({ 11: 0 }));
    expect(screen.getByTestId('share-bars-empty')).toHaveTextContent('Nothing under it uses any CPU');
    expect(screen.queryByTestId('share-key')).toBeNull();
  });

  it('groups the small ones into one “N others” line, never a bar each for a hundred', () => {
    const cpus: Record<number, number> = {};
    for (let i = 0; i < 40; i += 1) cpus[100 + i] = 1 + i;
    mountOn(scene(cpus));
    expect(bars().length).toBeLessThanOrEqual(12);
    expect(screen.getByTestId('share-bars-others')).toHaveTextContent(/^\d+ others/);
  });

  it('names a bar and never values it in its hover title (FR-095)', () => {
    mountOn(scene({ 11: 60 }));
    expect(screen.getByTestId('share-bar-x:11:1')).toHaveAttribute('title', 'p11.exe');
  });
});

describe('a click on a bar selects that child (FR-097)', () => {
  it('selects it, so the column then describes that child', () => {
    mountOn(scene({ 11: 60, 12: 30 }));
    fireEvent.click(screen.getByTestId('share-bar-x:12:1'));
    expect(getSelection()).toBe('x:12:1');
  });
});

describe('the colour is how much of the machine it takes (FR-094)', () => {
  it('draws about 1% CPU in the low colour and 90% in the high one, whatever the bar’s length', () => {
    mountOn(scene({ 11: 1, 12: 90 }));
    expect(heatOf('x:11:1')).toBeLessThan(0.05);
    expect(heatOf('x:12:1')).toBe(1);
  });

  it('colours by share of installed RAM when sorted by memory', () => {
    mountOn(scene({ 11: 1, 12: 1 }, {}, { 11: 100, 12: (15 * GIB) / MIB }));
    act(() => setView({ metric: 'memory' }));
    expect(heatOf('x:11:1')).toBeLessThan(0.05);
    expect(heatOf('x:12:1')).toBe(1);
  });

  it('names the thresholds the colours turn at, in a key beside the bars', () => {
    mountOn(scene({ 11: 5 }, {}, { 11: 5 }));
    const key = screen.getByTestId('share-key');
    expect(key.getAttribute('aria-label')).toMatch(/Bar colour: share of all processors/);
    expect(key).toHaveTextContent(/Amber 50%/);
    expect(key).toHaveTextContent(/Red \d+%/);
    act(() => setView({ metric: 'memory' }));
    expect(screen.getByTestId('share-key').getAttribute('aria-label')).toMatch(/share of installed memory/);
  });
});

describe('the bars hold still while the pointer is over them (FR-095)', () => {
  const calm = (): ResourceNode => scene({ 11: 60, 12: 30, 13: 10 });
  const swapped = (): ResourceNode => scene({ 11: 5, 12: 30, 13: 70 });

  it('keeps their order and their figures until the pointer leaves, then catches up', () => {
    mountOn(calm());
    const region = screen.getByTestId('share-bars');
    fireEvent.mouseEnter(region);
    feed(swapped());
    expect(bars()).toEqual(['x:11:1', 'x:12:1', 'x:13:1']);
    expect(screen.getByTestId('share-bar-figure-x:13:1')).toHaveTextContent('10%');

    fireEvent.mouseLeave(region);
    expect(bars()).toEqual(['x:13:1', 'x:12:1', 'x:11:1']);
    expect(screen.getByTestId('share-bar-figure-x:13:1')).toHaveTextContent('70%');
  });

  it('moves on to the new item when a click on a bar chooses one, though the pointer is still over', () => {
    const root = scene({ 11: 60, 12: 30 }, { 11: [proc(21, 'c21.exe', metrics({ cpu: 40 })), proc(22, 'c22.exe', metrics({ cpu: 20 }))] });
    mountOn(root);
    fireEvent.mouseEnter(screen.getByTestId('share-bars'));
    fireEvent.click(screen.getByTestId('share-bar-x:11:1'));
    expect(bars()).toEqual(['x:21:1', 'x:22:1']);
  });

  it('is only the bars that hold: the rest of the column is not theirs to freeze', () => {
    mountOn(calm());
    fireEvent.mouseEnter(screen.getByTestId('share-bars'));
    act(() => setSelection(null));
    expect(within(screen.getByTestId('share-bars')).getAllByTestId(/^share-bar-x:/)).toHaveLength(3);
  });
});
