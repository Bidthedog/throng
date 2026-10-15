/**
 * The time-series charts (055 FR-060, FR-067, research R10): one uPlot per metric for the node in
 * focus, stacked by its children.
 *
 * Layer: component, with uPlot MOCKED at the module seam — uPlot draws to a canvas jsdom does not have,
 * and what is ours to prove is how it is driven: how many charts, what data, when it is rebuilt versus
 * fed, where its colours come from, and that it is torn down. What the canvas looks like is not
 * assertable here at all and is not claimed.
 */
import { act, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { TimeseriesCharts } from '../../../src/renderer/resources/charts/timeseries.js';
import { __resetSession, ingestFrame, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

const fake = vi.hoisted(() => {
  interface Opts {
    series: { label?: string; stroke?: unknown; fill?: unknown }[];
    bands?: unknown[];
    axes?: { stroke?: unknown; grid?: { stroke?: unknown } }[];
  }
  const instances: FakeUPlot[] = [];
  class FakeUPlot {
    opts: Opts;
    data: number[][];
    destroyed = false;
    setDataCalls: number[][][] = [];
    redraws = 0;
    constructor(opts: Opts, data: number[][], target?: HTMLElement) {
      this.opts = opts;
      this.data = data;
      target?.appendChild(document.createElement('canvas'));
      instances.push(this);
    }
    setData(data: number[][]): void {
      this.data = data;
      this.setDataCalls.push(data);
    }
    setSize(): void {}
    redraw(): void {
      this.redraws += 1;
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  return { instances, FakeUPlot };
});

vi.mock('uplot', () => ({ default: fake.FakeUPlot }));

const root = document.documentElement;

beforeEach(() => {
  fake.instances.length = 0;
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  root.style.setProperty('--throng-colour-accent', 'rgb(1, 2, 3)');
  root.style.setProperty('--throng-colour-success', 'rgb(4, 5, 6)');
  root.style.setProperty('--throng-colour-textMuted', 'rgb(7, 8, 9)');
  root.style.setProperty('--throng-colour-border', 'rgb(10, 11, 12)');
});
afterEach(() => {
  root.removeAttribute('style');
  Reflect.deleteProperty(window, 'throng');
  __resetSession();
});

const metrics = ['cpu', 'memory', 'gpu', 'io'] as const;
const feed = (tick: number, opts = {}): void => {
  act(() => ingestFrame(frame(tick, sampleHierarchy(opts))));
};
const live = (): InstanceType<typeof fake.FakeUPlot>[] => fake.instances.filter((i) => !i.destroyed);

describe('one chart per metric, stacked by the focused node’s children (FR-060)', () => {
  it('creates a uPlot for CPU, memory, GPU and I/O, each with a band per child and one for the node itself', () => {
    feed(1);
    feed(2);
    render(createElement(TimeseriesCharts, { focusId: 'x:200:1' }));

    expect(live()).toHaveLength(4);
    // The shell's own use, plus its one child (node.exe): two bands, over the time axis.
    for (const chart of live()) expect(chart.opts.series).toHaveLength(3);
    expect(live().map((c) => c.opts.series[1]?.label)).toEqual(['pwsh.exe', 'pwsh.exe', 'pwsh.exe', 'pwsh.exe']);
    expect(live().map((c) => c.opts.series[2]?.label)).toEqual(['node.exe', 'node.exe', 'node.exe', 'node.exe']);
  });

  it('gives each chart a name for assistive technology and a test handle', () => {
    feed(1);
    const { getByTestId } = render(createElement(TimeseriesCharts, { focusId: 'x:200:1' }));
    for (const m of metrics) expect(getByTestId(`timeseries-${m}`).getAttribute('aria-label')).toMatch(/over time/i);
    expect(getByTestId('timeseries-io').getAttribute('aria-label')).toMatch(/I\/O/);
  });

  it('feeds stacked (cumulative) series, so the top band is the node’s rolled-up figure', () => {
    feed(1, { nodeCpu: 20 });
    feed(2, { nodeCpu: 30 });
    render(createElement(TimeseriesCharts, { focusId: 'x:200:1' }));

    const cpu = live()[0]!;
    expect(cpu.data[0]).toHaveLength(2);
    // bottom band: the shell’s own 1%; top band: 1 + node’s 20 then 30.
    expect(cpu.data[1]).toEqual([1, 1]);
    expect(cpu.data[2]).toEqual([21, 31]);
    // x is seconds since the epoch, ascending.
    expect(cpu.data[0]![1]! - cpu.data[0]![0]!).toBeGreaterThan(0);
  });

  it('declares the bands so a series fills down to the one beneath it', () => {
    feed(1);
    render(createElement(TimeseriesCharts, { focusId: 'x:200:1' }));
    // Two series: the lowest fills to the axis itself, the upper one fills down to it (uPlot series 2 → 1).
    expect(live()[0]!.opts.bands).toEqual([expect.objectContaining({ series: [2, 1] })]);
  });
});

describe('a frame appends; it never re-creates the chart', () => {
  it('feeds each new frame with setData and constructs nothing', () => {
    feed(1);
    render(createElement(TimeseriesCharts, { focusId: 'x:200:1' }));
    expect(fake.instances).toHaveLength(4);

    feed(2);
    feed(3);
    feed(4);

    expect(fake.instances).toHaveLength(4);
    expect(live()[0]!.setDataCalls.length).toBeGreaterThanOrEqual(3);
    expect(live()[0]!.data[0]).toHaveLength(4);
  });

  it('keeps an ended child’s band, falling to zero from the frame it ended', () => {
    feed(1, { nodeCpu: 20 });
    render(createElement(TimeseriesCharts, { focusId: 'x:200:1' }));
    feed(2, { withNode: false });
    feed(3, { withNode: false });

    expect(fake.instances).toHaveLength(4); // same series: same charts
    const cpu = live()[0]!;
    expect(cpu.opts.series).toHaveLength(3);
    // The child’s cumulative band collapses onto the shell’s own after it ended.
    expect(cpu.data[2]).toEqual([21, 1, 1]);
  });

  it('rebuilds the charts when the focus moves to a node with different children', () => {
    feed(1);
    const view = render(createElement(TimeseriesCharts, { focusId: 'x:200:1' }));
    const before = [...fake.instances];

    view.rerender(createElement(TimeseriesCharts, { focusId: 'n:n1' }));

    expect(before.every((i) => i.destroyed)).toBe(true);
    expect(live()).toHaveLength(4);
    // Terminal panel: the shell and the terminal buffers.
    expect(live()[0]!.opts.series.map((s) => s.label).slice(1)).toEqual(['pwsh.exe', 'Terminal buffers']);
  });
});

describe('colour comes from the theme (FR-067)', () => {
  it('reads each series’ colour from a theme variable, not from a literal', () => {
    feed(1);
    render(createElement(TimeseriesCharts, { focusId: 'x:200:1' }));

    const series = live()[0]!.opts.series;
    expect((series[1]!.stroke as () => string)()).toBe('rgb(1, 2, 3)'); // accent
    expect((series[2]!.stroke as () => string)()).toBe('rgb(4, 5, 6)'); // success
    // Axes and grid use the muted text and border tokens too.
    const axes = live()[0]!.opts.axes!;
    expect((axes[0]!.stroke as () => string)()).toBe('rgb(7, 8, 9)');
    expect((axes[0]!.grid!.stroke as () => string)()).toBe('rgb(10, 11, 12)');
  });

  it('re-reads them on a theme change and redraws', async () => {
    feed(1);
    window.throng = {
      config: {
        get: () => Promise.resolve({ settings: {}, theme: THRONG_THEME }),
        onChange: (cb: (p: unknown) => void) => {
          pushTheme = (theme) => cb({ settings: {}, theme });
          return () => {};
        },
      },
    } as unknown as typeof window.throng;
    let pushTheme: (theme: unknown) => void = () => {};
    render(createElement(ConfigProvider, null, createElement(TimeseriesCharts, { focusId: 'x:200:1' })));
    await waitFor(() => expect(live()).toHaveLength(4));
    const chart = live()[0]!;
    expect((chart.opts.series[1]!.stroke as () => string)()).toBe('rgb(1, 2, 3)');
    const redrawsBefore = chart.redraws;

    // The theme provider applies the new tokens to the root; a new theme object then arrives.
    root.style.setProperty('--throng-colour-accent', 'rgb(200, 100, 50)');
    act(() => pushTheme({ ...THRONG_THEME, name: 'Another' }));

    await waitFor(() => expect(chart.redraws).toBeGreaterThan(redrawsBefore));
    expect((chart.opts.series[1]!.stroke as () => string)()).toBe('rgb(200, 100, 50)');
  });
});

describe('teardown', () => {
  it('destroys every chart on unmount', () => {
    feed(1);
    const view = render(createElement(TimeseriesCharts, { focusId: 'x:200:1' }));
    expect(live()).toHaveLength(4);

    view.unmount();

    expect(live()).toHaveLength(0);
    expect(fake.instances).toHaveLength(4);
  });

  it('draws nothing, and builds nothing, before the first frame has arrived', () => {
    const { queryByTestId } = render(createElement(TimeseriesCharts, { focusId: 'root' }));
    expect(fake.instances).toHaveLength(0);
    expect(queryByTestId('timeseries-cpu')).not.toBeNull();
  });
});
