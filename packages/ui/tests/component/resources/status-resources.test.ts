/**
 * The status-bar resource item (055 US1, FR-040 – FR-046, FR-051, FR-032, FR-044).
 *
 * Layer: component — what the item renders for a summary, which figures survive a narrow bar, and what
 * a click calls. Nothing here needs a real window: widths are stubbed (jsdom has no layout), and the
 * real measurement of a real bar is the E2E's (T041).
 *
 * ANTI-VACUITY: delete the `<StatusResources />` element from the real bar in `status-bar.tsx` and the
 * "mounts before the daemon indicator" test fails; every other test mounts the item directly, so they
 * would not notice — that test is the one that pins the mount.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_MEASURED, formatGrouped, unavailable } from '@throng/core';
import type { ProjectDto } from '@throng/ipc-contract';
import { ProjectsClient } from '../../../src/renderer/state/projects-client.js';
import { ProjectsProvider } from '../../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../../src/renderer/common/notification.js';
import { StatusBar } from '../../../src/renderer/statusbar/status-bar.js';
import { StatusResources } from '../../../src/renderer/resources/status-resources.js';
import { __resetMonitorStore } from '../../../src/renderer/resources/monitor-store.js';
import type { ThrongBridge } from '../../../src/renderer/state/bridge.js';
import { installResourcesBridge } from '../helpers/resource-bridge.js';
import { GIB, MACHINE, MIB, metrics, summary } from '../helpers/resource-fixtures.js';

/* ── layout stubs: jsdom measures nothing ─────────────────────────────────────────────────────── */

const widths = { bar: 1000, figure: 60 };
const observers: (() => void)[] = [];

class FakeResizeObserver {
  constructor(cb: () => void) {
    observers.push(cb);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const realClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  widths.bar = 1000;
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('throng-status-bar') ? widths.bar : 0;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const id = this.getAttribute('data-testid') ?? '';
    const width = /^status-resources-(cpu|memory|gpu|io)$/.test(id) ? widths.figure : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (realClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realClientWidth);
  HTMLElement.prototype.getBoundingClientRect = realRect;
  Reflect.deleteProperty(window, 'throng');
  __resetMonitorStore();
});

function resize(bar: number): void {
  widths.bar = bar;
  act(() => observers.forEach((cb) => cb()));
}

/** The item inside a real-classed bar, as the real bar lays it out. */
function mountItem(): void {
  render(
    createElement(
      'footer',
      { className: 'throng-status-bar', 'data-testid': 'bar' },
      createElement('span', { className: 'throng-status-bar__right' }, createElement(StatusResources)),
    ),
  );
}

const TOTAL = metrics({ cpu: 12.5, memory: 5 * GIB, gpu: 3, ioRead: 1_500_000, ioWrite: 500_000 });

/** Rest the pointer on the item: its popover opens (FR-115). */
function openPopover(): void {
  fireEvent.pointerEnter(screen.getByTestId('status-resources'));
}

function ids(): string[] {
  return screen
    .queryAllByTestId(/^status-resources-(cpu|memory|gpu|io)$/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('status-resources-', ''));
}

describe('status-bar resource item (055 US1)', () => {
  it('shows a loading state until the first summary arrives (FR-051)', async () => {
    installResourcesBridge(null);
    mountItem();

    const item = screen.getByTestId('status-resources');
    expect(item).toHaveAttribute('data-state', 'loading');
    expect(ids()).toEqual([]);
    // Still a control: it opens the monitor even before there is anything to show.
    expect(screen.getByTestId('status-resources-icon')).toBeInTheDocument();
  });

  it('shows CPU, memory, GPU and I/O in that order, each an icon plus a digit-grouped value (FR-040, FR-032)', async () => {
    installResourcesBridge(summary(TOTAL));
    mountItem();

    await waitFor(() => expect(ids()).toEqual(['cpu', 'memory', 'gpu', 'io']));
    expect(screen.getByTestId('status-resources')).toHaveAttribute('data-state', 'ready');
    expect(screen.getByTestId('status-resources-cpu')).toHaveTextContent(`${formatGrouped(12.5)}%`);
    expect(screen.getByTestId('status-resources-memory')).toHaveTextContent(`${formatGrouped(5)} GB`);
    expect(screen.getByTestId('status-resources-gpu')).toHaveTextContent(`${formatGrouped(3)}%`);
    // I/O is read + write: 2,000,000 B/s is 1.9 MB/s.
    expect(screen.getByTestId('status-resources-io')).toHaveTextContent(`${formatGrouped(1.9)} MB/s`);
    // An icon in each figure — the figure is not a bare number.
    for (const id of ['cpu', 'memory', 'gpu', 'io']) {
      expect(screen.getByTestId(`status-resources-${id}`).querySelector('.icon')).not.toBeNull();
    }
  });

  it('groups digits in a large figure — through formatGrouped, not a hand-rolled comma (FR-032)', async () => {
    const big = 2_000 * GIB;
    installResourcesBridge(summary(metrics({ memory: big }), { machine: { ...MACHINE, installedRamBytes: 4_096 * GIB } }));
    mountItem();

    await waitFor(() => expect(screen.getByTestId('status-resources-memory')).toHaveTextContent(`${formatGrouped(2000)} GB`));
  });

  it('shows an unavailable figure as such and never as zero (FR-044)', async () => {
    installResourcesBridge(summary({ ...TOTAL, gpu: unavailable('The GPU counters could not be read') }));
    mountItem();

    await waitFor(() => expect(ids()).toContain('gpu'));
    const gpu = screen.getByTestId('status-resources-gpu');
    expect(gpu).toHaveTextContent('Unavailable');
    expect(gpu).not.toHaveTextContent('0');
    expect(gpu).toHaveAttribute('data-unavailable', 'true');
    // The reason is in the popover (FR-115, FR-044), not in a native title.
    openPopover();
    expect(screen.getByTestId('status-popover-gpu-note')).toHaveTextContent('The GPU counters could not be read');
  });

  it('shows a metric nobody measured as not measured, not as zero (FR-012)', async () => {
    installResourcesBridge(summary({ ...TOTAL, gpu: NOT_MEASURED }));
    mountItem();

    await waitFor(() => expect(ids()).toContain('gpu'));
    expect(screen.getByTestId('status-resources-gpu')).toHaveTextContent('Not measured');
  });

  it('marks stale figures as the previous reading, never as live (FR-044)', async () => {
    installResourcesBridge(summary(TOTAL, { stale: true }));
    mountItem();

    await waitFor(() => expect(ids()).toContain('cpu'));
    expect(screen.getByTestId('status-resources')).toHaveAttribute('data-stale', 'true');
    openPopover();
    expect(screen.getByTestId('status-popover-stale')).toHaveTextContent(/last reading/i);
  });

  it('marks a total as partial, with its reason, when the daemon is not running (FR-044)', async () => {
    const withoutDaemon = summary({ ...TOTAL, partial: { cpu: 'The daemon is not running', memory: 'The daemon is not running' } });
    installResourcesBridge({
      ...withoutDaemon,
      components: withoutDaemon.components.map((c) =>
        c.id === 'daemon' ? { ...c, rolled: metrics({ cpu: unavailable('The daemon is not running'), memory: unavailable('The daemon is not running') }) } : c,
      ),
    });
    mountItem();

    await waitFor(() => expect(ids()).toContain('cpu'));
    const cpu = screen.getByTestId('status-resources-cpu');
    expect(cpu).toHaveAttribute('data-partial', 'true');
    openPopover();
    expect(screen.getByTestId('status-popover-cpu-note')).toHaveTextContent('The daemon is not running');
    // The popover says the daemon's own row is unavailable rather than zero.
    expect(screen.getByTestId('status-popover-cpu-split')).toHaveTextContent(/Daemon\s*Unavailable/);
  });

  it('breaks each total down by UI, Daemon, Helpers and Projects in the popover (FR-042, FR-115)', async () => {
    installResourcesBridge(summary(TOTAL));
    mountItem();

    await waitFor(() => expect(ids()).toContain('cpu'));
    openPopover();
    for (const id of ['cpu', 'memory', 'gpu', 'io']) {
      const split = screen.getByTestId(`status-popover-${id}-split`);
      for (const component of ['UI', 'Daemon', 'Helpers', 'Projects']) expect(split).toHaveTextContent(component);
    }
    expect(screen.getByTestId('status-popover-cpu-split')).toHaveTextContent(new RegExp(`UI\\s*${formatGrouped(3)}%`));
    expect(screen.getByTestId('status-popover-memory-split')).toHaveTextContent(new RegExp(`UI\\s*${formatGrouped(200)} MB`));
  });

  it('keeps the breakdown complete when the bar has dropped every figure (FR-045)', async () => {
    installResourcesBridge(summary(TOTAL));
    mountItem();
    await waitFor(() => expect(ids()).toHaveLength(4));

    resize(260);
    expect(ids()).toEqual([]);
    openPopover();
    const text = screen.getByTestId('status-popover').textContent ?? '';
    for (const word of ['UI', 'Daemon', 'Helpers', 'Projects', 'CPU', 'Memory', 'GPU', 'I/O']) expect(text).toContain(word);
  });

  it('bands CPU and memory by usage and carries the band in the popover, not only the colour (FR-046)', async () => {
    // CPU 85% of the machine is critical; 10 of 16 GiB (62%) is a warning; GPU is not banded.
    installResourcesBridge(summary(metrics({ cpu: 85, memory: 10 * GIB, gpu: 99, ioRead: 0, ioWrite: 0 })));
    mountItem();

    await waitFor(() => expect(ids()).toHaveLength(4));
    expect(screen.getByTestId('status-resources-cpu')).toHaveAttribute('data-band', 'critical');
    openPopover();
    expect(screen.getByTestId('status-popover-cpu-total')).toHaveTextContent('critical');
    expect(screen.getByTestId('status-resources-memory')).toHaveAttribute('data-band', 'warning');
    expect(screen.getByTestId('status-popover-memory-total')).toHaveTextContent('warning');
    expect(screen.getByTestId('status-resources-gpu')).not.toHaveAttribute('data-band');
  });

  it('colours the bands from the theme tokens warning and danger, with no literal colour (FR-046, FR-067)', async () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
    const rules = css.match(/\.status-resources[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    const warning = rules.find((r) => r.includes("data-band='warning'") || r.includes('data-band="warning"'));
    const critical = rules.find((r) => r.includes("data-band='critical'") || r.includes('data-band="critical"'));
    expect(warning).toContain('var(--throng-colour-warning)');
    expect(critical).toContain('var(--throng-colour-danger)');
    for (const rule of rules) expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it('drops GPU, then I/O, then memory, then CPU as the bar narrows, and restores them in reverse (FR-045)', async () => {
    installResourcesBridge(summary(TOTAL));
    mountItem();

    // Budget = bar − 20 padding − 200 reserved for the project path. Four figures of 60 need 276.
    await waitFor(() => expect(ids()).toEqual(['cpu', 'memory', 'gpu', 'io']));
    resize(480);
    expect(ids()).toEqual(['cpu', 'memory', 'io']); // GPU first
    resize(400);
    expect(ids()).toEqual(['cpu', 'memory']); // then I/O
    resize(340);
    expect(ids()).toEqual(['cpu']); // then memory
    resize(260);
    expect(ids()).toEqual([]); // then CPU — the icon alone remains
    expect(screen.getByTestId('status-resources-icon')).toBeInTheDocument();

    // And back, in reverse.
    resize(340);
    expect(ids()).toEqual(['cpu']);
    resize(400);
    expect(ids()).toEqual(['cpu', 'memory']);
    resize(480);
    expect(ids()).toEqual(['cpu', 'memory', 'io']);
    resize(1000);
    expect(ids()).toEqual(['cpu', 'memory', 'gpu', 'io']);
  });

  it('measures with ONE ResizeObserver, however many figures there are (XII)', async () => {
    installResourcesBridge(summary(TOTAL));
    mountItem();
    await waitFor(() => expect(ids()).toHaveLength(4));
    expect(observers).toHaveLength(1);
  });

  it('opens the monitor window on a click, even with every figure dropped (FR-043, FR-045, FR-086)', async () => {
    const bridge = installResourcesBridge(summary(TOTAL));
    mountItem();
    await waitFor(() => expect(ids()).toHaveLength(4));
    resize(260);

    expect(bridge.opens()).toBe(0);
    fireEvent.click(screen.getByTestId('status-resources'));
    expect(bridge.opens()).toBe(1);
    // A window, not a dialog: nothing opens inside this one.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('follows the stream: a later summary replaces the figures, and an older tick is ignored', async () => {
    const bridge = installResourcesBridge(summary(TOTAL, { tick: 5 }));
    mountItem();
    await waitFor(() => expect(ids()).toHaveLength(4));

    act(() => bridge.pushSummary(summary(metrics({ cpu: 40, memory: 2 * GIB }), { tick: 6 })));
    expect(screen.getByTestId('status-resources-cpu')).toHaveTextContent(`${formatGrouped(40)}%`);

    act(() => bridge.pushSummary(summary(metrics({ cpu: 1, memory: 2 * GIB }), { tick: 4 })));
    expect(screen.getByTestId('status-resources-cpu')).toHaveTextContent(`${formatGrouped(40)}%`);
  });

  it('is named for assistive technology; its hover title is the popover (themeable icon control, FR-115)', async () => {
    installResourcesBridge(summary(metrics({ cpu: 1, memory: 100 * MIB })));
    mountItem();
    await waitFor(() => expect(ids()).toHaveLength(4));
    const item = screen.getByTestId('status-resources');
    expect(item.tagName).toBe('BUTTON');
    expect(item).toHaveAttribute('aria-label', 'Open Resource Monitor');
    expect(item).not.toHaveAttribute('title');
    openPopover();
    expect(screen.getByTestId('status-popover-action')).toHaveTextContent(/^Click to open the Resource Monitor/);
  });
});

/* ── the real bar: the mount, and the daemon indicator beside it ─────────────────────────────── */

function dto(id: string, name: string, rootFolder: string): ProjectDto {
  return {
    id,
    name,
    colour: '#4488cc',
    rootFolder,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    hiddenPaths: [],
  };
}

function realBar(): ReactElement {
  const bridge = {
    invoke<T>(method: string): Promise<T> {
      if (method === 'projects.list') return Promise.resolve({ projects: [dto('p1', 'Alpha', 'D:/work/alpha')] } as T);
      if (method === 'projects.categories.list') return Promise.resolve({ categories: [] } as T);
      return Promise.resolve({} as T);
    },
  } as ThrongBridge;
  return createElement(
    ProjectsProvider,
    { client: new ProjectsClient(bridge) },
    createElement(NotificationProvider, null, createElement(StatusBar)),
  );
}

describe('the real status bar (055 FR-041)', () => {
  it('mounts the item before the daemon indicator and leaves the indicator and the path alone', async () => {
    installResourcesBridge(summary(TOTAL));
    const throng = (window as unknown as { throng: Record<string, unknown> }).throng;
    throng.daemon = {
      state: () => Promise.resolve({ status: 'stopped' }),
      restart: () => Promise.resolve({ ok: true }),
      onState: () => () => {},
    };

    render(realBar());

    const item = await screen.findByTestId('status-resources');
    const daemon = await screen.findByTestId('status-daemon');
    // DOCUMENT_POSITION_FOLLOWING: the daemon indicator comes after the item.
    expect(item.compareDocumentPosition(daemon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('status-project')).toBeInTheDocument();
    // FR-041: the item adds none of the content 026 removed.
    expect(screen.queryByTestId('status-project-dot')).toBeNull();
    expect(screen.queryByTestId('status-context')).toBeNull();
  });
});
