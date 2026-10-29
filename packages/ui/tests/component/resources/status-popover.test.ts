/**
 * The status-bar popover (055 FR-115, FR-042, FR-044): resting the pointer on the item, or focusing it,
 * opens a popover — not a native title — with CPU, Memory, GPU and I/O, each a total, its split by
 * component and a mini graph; it updates in place at a capture, stays while the pointer is over the item or
 * the popover, and closes on leaving both or on Esc.
 *
 * Layer: component — what it renders and how it opens and closes. Canvas drawing is stubbed (jsdom has
 * none); the visual proof is MT-16.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_MEASURED, formatGrouped, unavailable } from '@throng/core';
import { StatusResources } from '../../../src/renderer/resources/status-resources.js';
import { __resetMonitorStore } from '../../../src/renderer/resources/monitor-store.js';
import { installResourcesBridge } from '../helpers/resource-bridge.js';
import { GIB, MACHINE, metrics, summary } from '../helpers/resource-fixtures.js';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set lineJoin(_v: string) {},
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'throng');
  __resetMonitorStore();
});

const TOTAL = metrics({ cpu: 12.5, memory: 5 * GIB, gpu: 3, ioRead: 1_500_000, ioWrite: 500_000 });

async function mountItem(initial = summary(TOTAL, { tick: 1 })) {
  const bridge = installResourcesBridge(initial);
  render(createElement('footer', { className: 'throng-status-bar' }, createElement(StatusResources)));
  await waitFor(() => expect(screen.getByTestId('status-resources')).toHaveAttribute('data-state', 'ready'));
  return bridge;
}

const item = (): HTMLElement => screen.getByTestId('status-resources');
const popover = (): HTMLElement => screen.getByTestId('status-popover');

/** Focus the item the way the keyboard does: jsdom matches `:focus-visible` only for real keyboard focus, so say so. */
function keyboardFocus(): void {
  const real = Element.prototype.matches;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' ? true : real.call(this, selector);
  });
  fireEvent.focus(item());
}

function openByPointer(): void {
  fireEvent.pointerEnter(item());
}

describe('the item carries no native title (FR-115)', () => {
  it('has no title on the item or any figure, and is named "Open Resource Monitor"', async () => {
    await mountItem();
    expect(item()).toHaveAttribute('aria-label', 'Open Resource Monitor');
    expect(item()).not.toHaveAttribute('title');
    expect(item().querySelector('[title]')).toBeNull();
  });

  it('is named the same before the first reading', () => {
    installResourcesBridge(null);
    render(createElement('footer', { className: 'throng-status-bar' }, createElement(StatusResources)));
    expect(item()).toHaveAttribute('aria-label', 'Open Resource Monitor');
    expect(item()).not.toHaveAttribute('title');
  });
});

describe('opening and closing (FR-115)', () => {
  it('is not there until the pointer enters or the item is focused', async () => {
    await mountItem();
    expect(screen.queryByTestId('status-popover')).toBeNull();
  });

  it('opens on pointer enter', async () => {
    await mountItem();
    openByPointer();
    expect(popover()).toBeInTheDocument();
  });

  it('does not open on a focus the keyboard did not give: a click\'s focus, or one restored when the window returns', async () => {
    await mountItem();
    // `:focus-visible` is what separates keyboard focus from the script- or pointer-given kind (as the marks do).
    const real = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? false : real.call(this, selector);
    });
    fireEvent.focus(item());
    expect(screen.queryByTestId('status-popover')).toBeNull();
  });

  it('opens on focus [derived], and closes on blur', async () => {
    await mountItem();
    keyboardFocus();
    expect(popover()).toBeInTheDocument();
    fireEvent.blur(item());
    await waitFor(() => expect(screen.queryByTestId('status-popover')).toBeNull());
  });

  it('first line names the click action', async () => {
    await mountItem();
    openByPointer();
    expect(screen.getByTestId('status-popover-action')).toHaveTextContent('Click to open the Resource Monitor');
    expect(popover().firstElementChild).toBe(screen.getByTestId('status-popover-action'));
  });

  it('stays open while the pointer crosses from the item to the popover, and closes on leaving both', async () => {
    await mountItem();
    openByPointer();
    fireEvent.pointerLeave(item());
    fireEvent.pointerEnter(popover());
    await new Promise((r) => setTimeout(r, 250));
    expect(popover()).toBeInTheDocument();

    fireEvent.pointerLeave(popover());
    await waitFor(() => expect(screen.queryByTestId('status-popover')).toBeNull());
  });

  it('closes on leaving the item when the pointer does not reach the popover', async () => {
    await mountItem();
    openByPointer();
    fireEvent.pointerLeave(item());
    await waitFor(() => expect(screen.queryByTestId('status-popover')).toBeNull());
  });

  it('closes on Esc and stays closed through a capture until the pointer re-enters [derived]', async () => {
    const bridge = await mountItem();
    openByPointer();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('status-popover')).toBeNull();

    act(() => bridge.pushSummary(summary(TOTAL, { tick: 2 })));
    expect(screen.queryByTestId('status-popover')).toBeNull();

    fireEvent.pointerLeave(item());
    openByPointer();
    expect(popover()).toBeInTheDocument();
  });

  it('stays closed after Esc until focus returns [derived]', async () => {
    await mountItem();
    keyboardFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('status-popover')).toBeNull();
    fireEvent.blur(item());
    fireEvent.focus(item());
    expect(popover()).toBeInTheDocument();
  });

  it('a click still opens the monitor', async () => {
    const bridge = await mountItem();
    openByPointer();
    fireEvent.click(item());
    expect(bridge.opens()).toBe(1);
  });

  it('a click inside the popover does not open the monitor', async () => {
    const bridge = await mountItem();
    openByPointer();
    fireEvent.click(popover());
    expect(bridge.opens()).toBe(0);
  });

  it('does not open before there is a reading', () => {
    installResourcesBridge(null);
    render(createElement('footer', { className: 'throng-status-bar' }, createElement(StatusResources)));
    fireEvent.pointerEnter(item());
    expect(screen.queryByTestId('status-popover')).toBeNull();
  });
});

describe('content (FR-115, FR-042, FR-032)', () => {
  it('holds CPU, Memory, GPU and I/O in that order, each with a digit-grouped total', async () => {
    await mountItem();
    openByPointer();
    const sections = within(popover()).getAllByTestId(/^status-popover-(cpu|memory|gpu|io)$/);
    expect(sections.map((s) => s.getAttribute('data-testid'))).toEqual([
      'status-popover-cpu',
      'status-popover-memory',
      'status-popover-gpu',
      'status-popover-io',
    ]);
    expect(screen.getByTestId('status-popover-cpu-total')).toHaveTextContent(`${formatGrouped(12.5)}%`);
    expect(screen.getByTestId('status-popover-memory-total')).toHaveTextContent(`${formatGrouped(5)} GB`);
    expect(screen.getByTestId('status-popover-gpu-total')).toHaveTextContent(`${formatGrouped(3)}%`);
    expect(screen.getByTestId('status-popover-io-total')).toHaveTextContent(`${formatGrouped(1.9)} MB/s`);
  });

  it('splits each total by UI, Daemon, Helpers and Projects', async () => {
    await mountItem();
    openByPointer();
    const split = screen.getByTestId('status-popover-memory-split');
    expect(split).toHaveTextContent(/UI\s*200 MB/);
    expect(split).toHaveTextContent(/Daemon\s*80 MB/);
    expect(split).toHaveTextContent(/Helpers\s*6 MB/);
    expect(split).toHaveTextContent(/Projects\s*430 MB/);
    expect(screen.getByTestId('status-popover-cpu-split')).toHaveTextContent(/Projects\s*13%/);
  });

  it('carries the band in words, not only a colour (FR-046)', async () => {
    await mountItem(summary(metrics({ cpu: 85, memory: 10 * GIB }), { tick: 1 }));
    openByPointer();
    expect(screen.getByTestId('status-popover-cpu-total')).toHaveTextContent(/critical/);
    expect(screen.getByTestId('status-popover-memory-total')).toHaveTextContent(/warning/);
  });

  it('says a total is unavailable, with its reason, rather than showing zero (FR-044)', async () => {
    await mountItem(summary({ ...TOTAL, gpu: unavailable('The GPU counters could not be read') }, { tick: 1 }));
    openByPointer();
    expect(screen.getByTestId('status-popover-gpu-total')).toHaveTextContent('Unavailable');
    expect(screen.getByTestId('status-popover-gpu-note')).toHaveTextContent('The GPU counters could not be read');
  });

  it('says a metric nobody measured is not measured (FR-012)', async () => {
    await mountItem(summary({ ...TOTAL, gpu: NOT_MEASURED }, { tick: 1 }));
    openByPointer();
    expect(screen.getByTestId('status-popover-gpu-total')).toHaveTextContent('Not measured');
  });

  it('says the figures are the last reading when stale (FR-044)', async () => {
    await mountItem(summary(TOTAL, { tick: 1, stale: true }));
    openByPointer();
    expect(screen.getByTestId('status-popover-stale')).toHaveTextContent(/last reading/i);
  });

  it('reserves the stale and note lines when there is nothing to say, so nothing moves', async () => {
    await mountItem();
    openByPointer();
    expect(screen.getByTestId('status-popover-stale')).toBeInTheDocument();
    expect(screen.getByTestId('status-popover-stale').textContent?.trim()).toBe('');
    expect(screen.getByTestId('status-popover-cpu-note')).toBeInTheDocument();
  });

  it('has no native title anywhere inside it', async () => {
    await mountItem();
    openByPointer();
    expect(popover().querySelector('[title]')).toBeNull();
  });
});

describe('updating in place (FR-115)', () => {
  it('re-renders at a capture without remounting, closing or reopening', async () => {
    const bridge = await mountItem();
    openByPointer();
    const before = popover();
    const cpu = screen.getByTestId('status-popover-cpu-total');

    act(() => bridge.pushSummary(summary(metrics({ cpu: 40, memory: 2 * GIB }), { tick: 2 })));

    expect(popover()).toBe(before);
    expect(screen.getByTestId('status-popover-cpu-total')).toBe(cpu);
    expect(cpu).toHaveTextContent(`${formatGrouped(40)}%`);
  });
});

describe('mini graphs (FR-115, FR-114)', () => {
  it('shows the spinner until there are two points, then the graph', async () => {
    const bridge = await mountItem(summary(TOTAL, { tick: 1 }));
    openByPointer();
    expect(within(screen.getByTestId('status-popover-cpu')).getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByTestId('status-popover-cpu-graph')).toBeNull();

    act(() => bridge.pushSummary(summary(TOTAL, { tick: 2 })));
    expect(screen.getByTestId('status-popover-cpu-graph')).toBeInTheDocument();
    expect(within(screen.getByTestId('status-popover-cpu')).queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('status-popover-io-graph')).toBeInTheDocument();
  });

  it('sizes its canvas buffer to the box it is drawn in, so a line is never stretched', async () => {
    const real = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('status-popover__plot') ? 300 : 0;
      },
    });
    try {
      const bridge = await mountItem(summary(TOTAL, { tick: 1 }));
      act(() => bridge.pushSummary(summary(TOTAL, { tick: 2 })));
      openByPointer();
      const canvas = screen.getByTestId('status-popover-cpu-graph') as HTMLCanvasElement;
      expect(canvas.width).toBe(300 * (window.devicePixelRatio || 1));
    } finally {
      if (real) Object.defineProperty(HTMLElement.prototype, 'clientWidth', real);
    }
  });

  it('keeps the points since the window opened even while the popover is closed', async () => {
    const bridge = await mountItem(summary(TOTAL, { tick: 1 }));
    act(() => bridge.pushSummary(summary(TOTAL, { tick: 2 })));
    openByPointer();
    expect(screen.getByTestId('status-popover-cpu-graph')).toBeInTheDocument();
  });

  it('shows only its number where the machine capacity is not known', async () => {
    const noRam = { ...MACHINE, installedRamBytes: 0 };
    const bridge = await mountItem(summary(TOTAL, { tick: 1, machine: noRam }));
    act(() => bridge.pushSummary(summary(TOTAL, { tick: 2, machine: noRam })));
    openByPointer();
    expect(screen.getByTestId('status-popover-memory-total')).toBeInTheDocument();
    expect(screen.queryByTestId('status-popover-memory-graph')).toBeNull();
    expect(within(screen.getByTestId('status-popover-memory')).queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('status-popover-cpu-graph')).toBeInTheDocument();
  });
});
