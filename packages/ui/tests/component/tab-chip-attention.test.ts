/**
 * The attention mark on the tab strip (057 US2, FR-010, FR-011; Principle XII).
 *
 * Layer: component — the REAL `TabGroup`, mounted as `new-tab-rename-focus.test.ts` mounts it. jsdom has
 * no layout, so the strip's geometry is stood in for (every chip 100 wide, the track 250 wide), and the
 * claim is about which side `syncStrip`'s measurement puts a tab on, not about pixels.
 *
 * ANTI-VACUITY CONTROL: derive the overflow marks from ALL tabs instead of the hidden ones and the
 * "visible marked tab" case fails; read only the active tab's panels for the chip and the "other tab"
 * case fails.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addTab, createDefaultLayout, DEFAULT_APP_SETTINGS, type WorkspaceLayout } from '@throng/core';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { SubWorkspacesClient } from '../../src/renderer/state/subworkspaces-client.js';
import { DocumentClient } from '../../src/renderer/state/document-client.js';
import { FileOpUndoClient } from '../../src/renderer/state/fileop-undo-client.js';
import { PanelNameClient } from '../../src/renderer/state/panel-name-client.js';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { WorkspaceProvider } from '../../src/renderer/state/workspace-store.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { TabGroup } from '../../src/renderer/workspace/tab-group.js';
import { __resetAttentionStore, setAttentionMarks } from '../../src/renderer/attention/attention-store.js';
import { hiddenTabIds } from '../../src/renderer/attention/hidden-tabs.js';
import { makeMark } from './attention-fixtures.js';

const PROJECT = 'proj-tabs';
const TAB_WIDTH = 100;
const VIEWPORT = 250;

function layoutOf(tabCount: number): WorkspaceLayout {
  let layout = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  for (let i = 2; i <= tabCount; i += 1) layout = addTab(layout, { tab: `t${i}`, panel: `p${i}` });
  return { ...layout, activeTabId: 't1' };
}

function mount(tabCount: number): void {
  Reflect.set(window, 'throng', {
    panel: { notifyDestroyed: vi.fn(), notifyRenamed: vi.fn(), notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    config: { get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS }), onChange: () => () => {} },
  });
  const layout = layoutOf(tabCount);
  const bridge: ThrongBridge = {
    invoke<T>(method: string, params?: unknown): Promise<T> {
      switch (method) {
        case 'workspace.load': return Promise.resolve({ layout, restored: true } as T);
        case 'workspace.save': return Promise.resolve({ ok: true } as T);
        case 'workspace.loadSubWorkspaces':
        case 'subworkspace.list': return Promise.resolve({ subWorkspaces: [] } as T);
        case 'projects.list': return Promise.resolve({ projects: [] } as T);
        case 'projects.categories.list': return Promise.resolve({ categories: [] } as T);
        case 'panelName.claim': return Promise.resolve({ granted: (params as { desired: string }).desired, adjusted: false } as T);
        default: return Promise.resolve({} as T);
      }
    },
  };
  const services: Services = {
    bridge,
    projects: new ProjectsClient(bridge),
    workspace: new WorkspaceClient(bridge),
    subWorkspaces: new SubWorkspacesClient(bridge),
    documents: new DocumentClient(bridge),
    fileOpUndo: new FileOpUndoClient(bridge),
    panelNames: new PanelNameClient(bridge),
  };
  render(
    createElement(ConfigProvider, null,
      createElement(ServicesProvider, { services },
        createElement(ProjectsProvider, { client: services.projects },
          createElement(WorkspaceProvider, { client: services.workspace, activeProjectId: PROJECT },
            createElement(NotificationProvider, null,
              createElement(ConfirmProvider, null,
                createElement(ContextMenuProvider, null, createElement(Fragment, null, createElement(TabGroup, null))))))))),
  );
}

/* ─── geometry: jsdom has none, so the strip is given one ─────────────────────────────────── */

let restoreGeometry: Array<() => void> = [];
function stubProto(name: 'offsetLeft' | 'offsetWidth' | 'clientWidth' | 'scrollWidth', get: (el: HTMLElement) => number | undefined): void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  Object.defineProperty(HTMLElement.prototype, name, {
    configurable: true,
    get(this: HTMLElement) {
      return get(this) ?? (original?.get ? (original.get.call(this) as number) : 0);
    },
  });
  restoreGeometry.push(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  });
}
class ImmediateResizeObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(target: Element): void { this.cb([{ target } as ResizeObserverEntry], this); }
  unobserve(): void {}
  disconnect(): void {}
}
const isChip = (el: HTMLElement): boolean => el.classList.contains('tab-chip');
const isTrack = (el: HTMLElement): boolean => el.classList.contains('tab-strip__track');

beforeAll(() => { globalThis.ResizeObserver = ImmediateResizeObserver; });
afterAll(() => { Reflect.deleteProperty(globalThis, 'ResizeObserver'); });
beforeEach(() => {
  __resetAttentionStore();
  stubProto('offsetLeft', (el) => (isChip(el) ? [...(el.parentElement?.querySelectorAll('.tab-chip') ?? [])].indexOf(el) * TAB_WIDTH : undefined));
  stubProto('offsetWidth', (el) => (isChip(el) ? TAB_WIDTH : undefined));
  stubProto('clientWidth', (el) => (isTrack(el) ? VIEWPORT : undefined));
  stubProto('scrollWidth', (el) => (isTrack(el) ? 6 * TAB_WIDTH : undefined));
});
afterEach(() => {
  __resetAttentionStore();
  for (const undo of restoreGeometry) undo();
  restoreGeometry = [];
  Reflect.deleteProperty(window, 'throng');
});

async function ready(): Promise<void> {
  await waitFor(() => screen.getByTestId('tab-t1'));
}

/** Scroll the track to `x`, as the browser would, and let `syncStrip` measure. */
function scrollTrackTo(x: number): void {
  const track = screen.getByTestId('tabstrip-track');
  Object.defineProperty(track, 'scrollLeft', { configurable: true, value: x, writable: true });
  act(() => {
    fireEvent.scroll(track);
  });
}

describe('a tab chip (FR-010)', () => {
  it('marks while any of its panels is marked, and only that tab', async () => {
    mount(3);
    await ready();
    expect(screen.queryByTestId('attention-tab-t2')).toBeNull();
    act(() => setAttentionMarks([makeMark('p2', PROJECT, { title: 'Build' })]));
    expect(screen.getByTestId('attention-tab-t2')).toHaveAttribute('aria-label', expect.stringContaining('Build'));
    expect(screen.queryByTestId('attention-tab-t1')).toBeNull();
    expect(screen.queryByTestId('attention-tab-t3')).toBeNull();
    expect(screen.getByTestId('tab-t2')).toContainElement(screen.getByTestId('attention-tab-t2'));
  });

  it('takes the Failed kind when a panel in the tab is Failed', async () => {
    mount(2);
    await ready();
    act(() => setAttentionMarks([makeMark('p2', PROJECT, { kind: 'failed', signal: 'processExited', detail: '1' })]));
    expect(screen.getByTestId('attention-tab-t2')).toHaveAttribute('data-kind', 'failed');
  });

  it('clears with the mark', async () => {
    mount(2);
    await ready();
    act(() => setAttentionMarks([makeMark('p2', PROJECT)]));
    expect(screen.getByTestId('attention-tab-t2')).toBeInTheDocument();
    act(() => setAttentionMarks([]));
    expect(screen.queryByTestId('attention-tab-t2')).toBeNull();
  });
});

describe('the overflow controls (FR-011)', () => {
  it('shows a marked-hidden indicator on the RIGHT when a marked tab is scrolled out on that side', async () => {
    mount(6);
    await ready();
    await waitFor(() => screen.getByTestId('tabstrip-actions'));
    act(() => setAttentionMarks([makeMark('p5', PROJECT)])); // x 400–500: beyond the 250 viewport
    expect(screen.getByTestId('attention-overflow-right')).toBeInTheDocument();
    expect(screen.queryByTestId('attention-overflow-left')).toBeNull();
  });

  it('shows none while the marked tab is in view (its own chip is marked instead)', async () => {
    mount(6);
    await ready();
    await waitFor(() => screen.getByTestId('tabstrip-actions'));
    act(() => setAttentionMarks([makeMark('p2', PROJECT)])); // x 100–200: visible
    expect(screen.queryByTestId('attention-overflow-right')).toBeNull();
    expect(screen.queryByTestId('attention-overflow-left')).toBeNull();
    expect(screen.getByTestId('attention-tab-t2')).toBeInTheDocument();
  });

  it('moves to the LEFT control once the marked tab is scrolled out on the left', async () => {
    mount(6);
    await ready();
    await waitFor(() => screen.getByTestId('tabstrip-actions'));
    act(() => setAttentionMarks([makeMark('p1', PROJECT)]));
    expect(screen.queryByTestId('attention-overflow-left')).toBeNull();
    scrollTrackTo(350); // t1 (0–100), t2 and t3 are now wholly off the left edge
    await waitFor(() => expect(screen.getByTestId('attention-overflow-left')).toBeInTheDocument());
    expect(screen.queryByTestId('attention-overflow-right')).toBeNull();
  });

  it('takes the Failed kind from a hidden Failed tab', async () => {
    mount(6);
    await ready();
    await waitFor(() => screen.getByTestId('tabstrip-actions'));
    act(() => setAttentionMarks([makeMark('p5', PROJECT), makeMark('p6', PROJECT, { kind: 'failed', signal: 'processExited', detail: '2' })]));
    expect(screen.getByTestId('attention-overflow-right')).toHaveAttribute('data-kind', 'failed');
  });
});

describe('the tab picker and the tab popover mark their rows', () => {
  it('the picker marks the row of a tab with a marked panel', async () => {
    mount(6);
    await ready();
    act(() => setAttentionMarks([makeMark('p4', PROJECT)]));
    await waitFor(() => screen.getByTestId('tabstrip-show-all'));
    fireEvent.click(screen.getByTestId('tabstrip-show-all'));
    const row = await screen.findByTestId('tabpicker-row-t4');
    expect(row).toContainElement(screen.getByTestId('attention-tab-picker-t4'));
    expect(screen.queryByTestId('attention-tab-picker-t3')).toBeNull();
  });

  it('the popover marks the panel row of a marked panel', async () => {
    mount(2);
    await ready();
    act(() => setAttentionMarks([makeMark('p2', PROJECT, { title: 'Build' })]));
    fireEvent.pointerEnter(screen.getByTestId('tab-t2'));
    const popover = await screen.findByTestId('tabstrip-popover', undefined, { timeout: 3000 });
    expect(popover).toContainElement(screen.getByTestId('attention-tab-popover-p2'));
  });
});

describe('cost on a 200-tab strip (Principle XII)', () => {
  /**
   * Long task = 50 ms (constitution XII). The two things that run on an input path are measured, and
   * the measurement is printed on every run so the bound is a decision rather than a guess.
   */
  const LONG_TASK_MS = 50;

  it('computing which side hides each of 200 tabs is far under a long task', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `t${i}`);
    const tabOffsets = ids.map((_, i) => ({ left: i * TAB_WIDTH, right: (i + 1) * TAB_WIDTH }));
    const samples: number[] = [];
    for (let n = 0; n < 3; n += 1) {
      const t0 = performance.now();
      const sides = hiddenTabIds({ tabOffsets, scrollLeft: 5000, viewportWidth: VIEWPORT }, ids);
      samples.push(performance.now() - t0);
      expect(sides.left.length).toBe(50); // tabs 0–49 end at or before x = 5000
      expect(sides.right.length).toBe(147); // tabs 53–199 start at or after x = 5250
    }
    process.stderr.write(`hiddenTabIds(200 tabs) ms: ${samples.map((s) => s.toFixed(3)).join(' / ')}\n`);
    expect(Math.max(...samples)).toBeLessThan(LONG_TASK_MS);
  });

  it('raising one mark re-renders the strip of 200 tabs within a long task', async () => {
    mount(200);
    await ready();
    await waitFor(() => expect(document.querySelectorAll('.tab-chip').length).toBe(200));
    const samples: number[] = [];
    for (let n = 0; n < 3; n += 1) {
      const t0 = performance.now();
      act(() => setAttentionMarks([makeMark(`p${100 + n}`, PROJECT)]));
      samples.push(performance.now() - t0);
      expect(screen.getByTestId(`attention-tab-t${100 + n}`)).toBeInTheDocument();
    }
    process.stderr.write(`mark update on 200 mounted tabs ms: ${samples.map((s) => s.toFixed(1)).join(' / ')}\n`);
    // Measured 3.6 / 1.9 / 1.5 ms (jsdom, workstation): an order of magnitude under the bound. The MEDIAN
    // is held to it, not the worst sample: a slower render slows every update, while a worker stalled by
    // the rest of a parallel suite slows one — measured once at 96 ms beside samples of a few ms.
    const median = [...samples].sort((a, b) => a - b)[1];
    expect(median).toBeLessThan(LONG_TASK_MS);
  }, 60_000);
});

describe('hiddenTabIds', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const offsets = ids.map((_, i) => ({ left: i * 100, right: (i + 1) * 100 }));

  it('splits tabs wholly off each edge, as stripCounts counts them', () => {
    expect(hiddenTabIds({ tabOffsets: offsets, scrollLeft: 100, viewportWidth: 200 }, ids)).toEqual({ left: ['a'], right: ['d'] });
  });

  it('counts a partly visible tab on neither side', () => {
    expect(hiddenTabIds({ tabOffsets: offsets, scrollLeft: 50, viewportWidth: 200 }, ids)).toEqual({ left: [], right: ['d'] });
  });

  it('is empty when nothing overflows', () => {
    expect(hiddenTabIds({ tabOffsets: offsets, scrollLeft: 0, viewportWidth: 400 }, ids)).toEqual({ left: [], right: [] });
  });
});
