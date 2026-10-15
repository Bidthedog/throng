/**
 * Keyboard use of the monitor (055 FR-068): arrows through the breakdown, Right/Enter in, Left/Backspace
 * out, Tab between regions, and the arrows left alone in the filter field.
 *
 * Layer: component — the real modal, real body, real focus trap and real `userEvent` Tab navigation;
 * only the chart library's wrapper is stubbed. Whether a real window delivers these keys is not claimed.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { ResourceMonitorHost } from '../../../src/renderer/resources/monitor-modal.js';
import { __resetMonitorStore, openMonitor } from '../../../src/renderer/resources/monitor-store.js';
import { __resetSession, getSelection, getView, setView } from '../../../src/renderer/resources/monitor-session.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

// Unload Project is the project list's command; this file is about the keyboard.
vi.mock('../../../src/renderer/sidebar/use-unload-project.js', () => ({ useUnloadProject: () => vi.fn() }));
vi.mock('../../../src/renderer/resources/charts/timeseries.js', () => ({
  TimeseriesCharts: () => createElement('div', { 'data-testid': 'timeseries-stub' }),
}));

let bridge: ResourcesBridge;

// jsdom has no layout, so `offsetParent` is always null — which the focus trap reads as "hidden" and so
// finds nothing to Tab between. Every connected element is laid out for the purposes of this file.
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');

beforeEach(() => {
  bridge = installResourcesBridge(null);
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.isConnected ? this.parentElement : null;
    },
  });
});
afterEach(() => {
  if (realOffsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent);
  Reflect.deleteProperty(window, 'throng');
  __resetMonitorStore();
  __resetSession();
});

async function openModal(): Promise<void> {
  // The body's actions need the confirmation dialog, the context menu and the settings, as in the app.
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(ConfirmProvider, null, createElement(ContextMenuProvider, null, createElement(ResourceMonitorHost))),
    ),
  );
  act(() => openMonitor());
  await act(async () => bridge.pushDetail(frame(1, sampleHierarchy())));
  await screen.findByTestId('breakdown');
}

const row = (id: string): HTMLElement => screen.getByTestId(`breakdown-row-${id}`);
const active = (): string | null => document.activeElement?.getAttribute('data-node-id') ?? null;
const key = (target: Element, k: string, init: KeyboardEventInit = {}): boolean =>
  fireEvent.keyDown(target, { key: k, code: k, ...init });

/** First view, CPU order: Projects (13), UI (3), Daemon (1), Helpers (0); then Alpha, Beta. */
const FIRST_VIEW = ['c:projects', 'c:ui', 'c:daemon', 'c:helpers', 'p:p1', 'p:p2'];

describe('moving between nodes (FR-068)', () => {
  beforeEach(async () => {
    await openModal();
  });

  it('starts on the first node, the only row in the Tab order', () => {
    const tabbable = FIRST_VIEW.filter((id) => row(id).getAttribute('tabindex') === '0');
    expect(tabbable).toEqual(['c:projects']);
  });

  it('Down and Up move focus one node at a time, through both sections', () => {
    row('c:projects').focus();
    for (const id of FIRST_VIEW.slice(1)) {
      key(document.activeElement!, 'ArrowDown');
      expect(active()).toBe(id);
    }
    // At the end it stays.
    key(document.activeElement!, 'ArrowDown');
    expect(active()).toBe('p:p2');

    for (const id of [...FIRST_VIEW].reverse().slice(1)) {
      key(document.activeElement!, 'ArrowUp');
      expect(active()).toBe(id);
    }
    key(document.activeElement!, 'ArrowUp');
    expect(active()).toBe('c:projects');
  });

  it('keeps the focused row the one in the Tab order (a roving stop)', () => {
    row('c:projects').focus();
    key(document.activeElement!, 'ArrowDown');
    expect(row('c:ui')).toHaveAttribute('tabindex', '0');
    expect(row('c:projects')).toHaveAttribute('tabindex', '-1');
  });

  it('consumes the arrows, so the dialog behind them does not scroll', () => {
    row('c:projects').focus();
    expect(key(document.activeElement!, 'ArrowDown')).toBe(false);
  });

  it('shows a focused node’s values exactly as hovering it would', () => {
    row('c:projects').focus();
    key(document.activeElement!, 'ArrowDown');
    const readout = screen.getByTestId('breakdown-readout');
    expect(readout.textContent).toBe(row('c:ui').getAttribute('title'));
    expect(readout.textContent).toMatch(/CPU/);
  });

  it('selects what it focuses, so the detail pane follows the keyboard', () => {
    row('c:projects').focus();
    key(document.activeElement!, 'ArrowDown');
    expect(getSelection()).toBe('c:ui');
    expect(screen.getByTestId('detail-name')).toHaveTextContent('UI');
  });
});

describe('drilling in and out (FR-068)', () => {
  beforeEach(async () => {
    await openModal();
  });

  it('Right drills into the focused node, and focus lands on its first child', async () => {
    row('c:projects').focus();
    key(document.activeElement!, 'ArrowRight');

    expect(getView().focusPath).toEqual(['root', 'c:projects']);
    await waitFor(() => expect(active()).toBe('p:p1'));
  });

  it('Enter drills in too', async () => {
    row('c:projects').focus();
    key(document.activeElement!, 'Enter');
    expect(getView().focusPath).toEqual(['root', 'c:projects']);
    await waitFor(() => expect(active()).toBe('p:p1'));
  });

  it('Left goes up one level and puts focus back on the node it came from', async () => {
    row('c:projects').focus();
    key(document.activeElement!, 'ArrowRight');
    await waitFor(() => expect(active()).toBe('p:p1'));

    key(document.activeElement!, 'ArrowLeft');

    expect(getView().focusPath).toEqual(['root']);
    await waitFor(() => expect(active()).toBe('c:projects'));
  });

  it('Backspace goes up one level too', async () => {
    row('c:projects').focus();
    key(document.activeElement!, 'ArrowRight');
    await waitFor(() => expect(active()).toBe('p:p1'));

    key(document.activeElement!, 'Backspace');

    expect(getView().focusPath).toEqual(['root']);
  });

  it('does nothing going up from the root', () => {
    row('c:projects').focus();
    key(document.activeElement!, 'ArrowLeft');
    expect(getView().focusPath).toEqual(['root']);
  });

  it('walks all the way down to a process with Right alone, and all the way back with Left', async () => {
    // Each level's busiest child is its first row, so Right five times reaches the shell’s process.
    const down = ['p:p1', 't:t1', 'n:n1', 'x:200:1', 'x:300:1'];
    row('c:projects').focus();
    for (const id of down) {
      key(document.activeElement!, 'ArrowRight');
      await waitFor(() => expect(active()).toBe(id));
    }
    expect(getView().focusPath).toEqual(['root', 'c:projects', 'p:p1', 't:t1', 'n:n1', 'x:200:1']);

    for (const id of ['x:200:1', 'n:n1', 't:t1', 'p:p1', 'c:projects']) {
      key(document.activeElement!, 'ArrowLeft');
      await waitFor(() => expect(active()).toBe(id));
    }
    expect(getView().focusPath).toEqual(['root']);
  });
});

describe('in the filter field the arrows edit text (FR-068)', () => {
  beforeEach(async () => {
    await openModal();
  });

  it('leaves arrows and Backspace to the field: nothing drills, nothing moves, nothing is consumed', () => {
    const field = screen.getByTestId('monitor-filter') as HTMLInputElement;
    field.focus();
    const before = { ...getView(), focusPath: [...getView().focusPath] };

    for (const k of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Backspace', 'Enter']) {
      expect(key(field, k), `${k} was consumed in the filter field`).toBe(true);
    }
    expect(getView().focusPath).toEqual(before.focusPath);
    expect(getSelection()).toBeNull();
  });

  it('really edits: Backspace in the field deletes a character and does not go up', async () => {
    const user = userEvent.setup();
    act(() => setView({ focusPath: ['root', 'c:projects'] }));
    const field = screen.getByTestId('monitor-filter') as HTMLInputElement;
    await user.type(field, 'nod{Backspace}');
    expect(field.value).toBe('no');
    expect(getView().focusPath).toEqual(['root', 'c:projects']);
  });
});

describe('Tab moves between the modal’s regions (FR-068)', () => {
  it('goes filter → breakdown → chart → detail → controls, and round again', async () => {
    await openModal();
    const user = userEvent.setup();
    const regionOf = (el: Element | null): string | null => el?.closest('[data-region]')?.getAttribute('data-region') ?? null;

    screen.getByTestId('monitor-filter').focus();
    const order: string[] = [regionOf(document.activeElement) ?? '?'];
    for (let i = 0; i < 40 && order.at(-1) !== 'window'; i += 1) {
      await user.tab();
      const region = regionOf(document.activeElement) ?? '?';
      if (region !== order.at(-1)) order.push(region);
    }

    // The window controls (minimise, maximise, close) close the cycle; then Tab wraps to the filter.
    expect(order.slice(0, 6)).toEqual(['filter', 'breakdown', 'chart', 'detail', 'controls', 'window']);
    // The window region holds several controls, so leaving it takes more than one Tab.
    for (let i = 0; i < 6 && regionOf(document.activeElement) === 'window'; i += 1) await user.tab();
    expect(regionOf(document.activeElement)).toBe('filter');
  });

  it('puts a single stop in the breakdown, whatever its size', async () => {
    await openModal();
    const stops = screen
      .getByTestId('breakdown')
      .querySelectorAll('[tabindex="0"], button:not([tabindex="-1"]), a[href], input, select');
    expect(stops).toHaveLength(1);
  });
});
