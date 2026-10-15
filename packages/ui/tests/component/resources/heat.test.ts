/**
 * The colour of a tile is how much of the machine its node takes (055 FR-094, SC-010 scenario 15): the
 * tile carries the number core's `heatFor` gives it as `--heat`, the stylesheet turns that into a colour
 * from the theme's success, warning and danger, and a key beside the tiles shows the scale.
 *
 * Layer: component for what the tile carries (a number is assertable in jsdom; a mixed colour is not,
 * since jsdom computes no `color-mix()`), and the stylesheet read as text for the mixing itself — the same
 * seam the literal-colour guard in `breakdown.test.ts` uses. `heatFor`'s own stops are core's unit test.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceNode } from '@throng/core';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { __resetSession, ingestFrame, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { GIB, MACHINE, MIB, frame, metrics, node, proc } from '../helpers/resource-fixtures.js';

vi.mock('../../../src/renderer/resources/charts/timeseries.js', () => ({ Timeseries: () => null, default: () => null }));

const PANEL = ['root', 'c:projects', 'p:p1', 't:big', 'n:big'];
const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');

function scene(procs: Record<number, ReturnType<typeof metrics>>): ResourceNode {
  const kids = Object.entries(procs).map(([pid, m]) => proc(Number(pid), `p${pid}.exe`, m));
  const panel = node({ id: 'n:big', kind: 'panel', label: 'Busy', panelKind: 'terminal', children: kids, owner: { projectId: 'p1', tabId: 'big', panelId: 'big' } });
  const tab = node({ id: 't:big', kind: 'tab', label: 'Tab', children: [panel], owner: { projectId: 'p1', tabId: 'big' } });
  const project = node({ id: 'p:p1', kind: 'project', label: 'Alpha', projectState: 'active', children: [tab], owner: { projectId: 'p1' } });
  const projects = node({ id: 'c:projects', kind: 'component', label: 'Projects', children: [project] });
  return node({ id: 'root', kind: 'root', label: 'throng', children: [projects], owner: { component: 'ui' } });
}

beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
});
afterEach(() => __resetSession());

const heatOf = (id: string): number | null => {
  const v = screen.getByTestId(`treemap-tile-${id}`).style.getPropertyValue('--heat');
  return v === '' ? null : Number(v);
};

function mount(root: ResourceNode, metric: 'cpu' | 'memory' | 'io', machine = MACHINE): void {
  act(() => ingestFrame(frame(1, root, { machine })));
  render(createElement(Breakdown));
  act(() => setView({ focusPath: PANEL, metric }));
}

describe('a tile’s fill follows its share of the machine', () => {
  it('draws about 1% CPU in the low colour and 80% or more in the high one', () => {
    mount(scene({ 11: metrics({ cpu: 1 }), 12: metrics({ cpu: 90 }) }), 'cpu');
    expect(heatOf('x:11:1')).toBeLessThan(0.05);
    expect(heatOf('x:12:1')).toBe(1);
  });

  it('reaches the middle of the scale at the warning threshold', () => {
    mount(scene({ 11: metrics({ cpu: 50 }), 12: metrics({ cpu: 1 }) }), 'cpu');
    expect(heatOf('x:11:1')).toBeCloseTo(0.5, 2);
  });

  it('colours by share of installed RAM when sized by memory', () => {
    mount(scene({ 11: metrics({ memory: 100 * MIB }), 12: metrics({ memory: 15 * GIB }) }), 'memory');
    expect(heatOf('x:11:1')).toBeLessThan(0.05);
    expect(heatOf('x:12:1')).toBe(1);
  });

  it('colours I/O against the highest rate reached this session', () => {
    // The root’s total is 1,000 B/s in the first capture and falls to 500 in the second: the peak stays 1,000.
    act(() => ingestFrame(frame(1, scene({ 11: metrics({ ioRead: 600 }), 12: metrics({ ioRead: 400 }) }))));
    render(createElement(Breakdown));
    act(() => setView({ focusPath: PANEL, metric: 'io' }));
    act(() => ingestFrame(frame(2, scene({ 11: metrics({ ioRead: 500 }), 12: metrics({ ioRead: 1 }) }))));
    // 500 of a 1,000 peak is 50%: the warning threshold.
    expect(heatOf('x:11:1')).toBeCloseTo(0.5, 2);
    expect(heatOf('x:12:1')).toBeLessThan(0.01);
  });

  it('draws a node whose figure cannot be measured neutral — no heat at all', () => {
    // No installed-RAM figure: memory has nothing to be a share of.
    mount(scene({ 11: metrics({ memory: 100 * MIB }) }), 'memory', { ...MACHINE, installedRamBytes: 0 });
    expect(heatOf('x:11:1')).toBeNull();
    expect(screen.getByTestId('treemap-tile-x:11:1')).toHaveAttribute('data-heat', 'none');
  });
});

describe('the key to the scale', () => {
  it('sits beside the tiles and names the thresholds the colours turn at', () => {
    mount(scene({ 11: metrics({ cpu: 5 }) }), 'cpu');
    const key = screen.getAllByTestId('treemap-key')[0]!;
    expect(key.getAttribute('aria-label')).toMatch(/Tile colour: share of all processors/);
    expect(key).toHaveTextContent(/Amber 50%/);
    expect(key).toHaveTextContent(/Red \d+%/);
  });

  it('follows the metric: memory is a share of installed memory', () => {
    mount(scene({ 11: metrics({ memory: 5 * MIB }) }), 'memory');
    expect(screen.getAllByTestId('treemap-key')[0]!.getAttribute('aria-label')).toMatch(/share of installed memory/);
  });
});

describe('the stylesheet mixes the theme’s colours from --heat (FR-094, FR-067)', () => {
  const tileRule = /\.treemap__tile\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  it('passes through the theme’s success, warning and danger colours with color-mix()', () => {
    expect(tileRule).toMatch(/color-mix\(/);
    expect(tileRule).toMatch(/var\(--heat/);
    for (const token of ['success', 'warning', 'danger']) expect(tileRule, token).toContain(`var(--throng-colour-${token})`);
  });

  it('gives a tile with no measured figure a neutral fill', () => {
    const rule = /\.treemap__tile\[data-heat='none'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/background:\s*var\(--throng-colour-/);
  });

  it('keeps the selected tile’s fill and puts the accent edge on top of it', () => {
    const rule = /\.treemap__tile\[data-selected='true'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/box-shadow:[^;]*inset[^;]*var\(--throng-colour-accent\)/);
    expect(rule).not.toMatch(/background/);
  });
});
