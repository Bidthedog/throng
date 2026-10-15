/**
 * A context menu opened over the monitor keeps the keyboard (055 FR-068).
 *
 * The monitor traps focus, and its trap pulls focus back from anything outside the dialog — except
 * another dialog. A context menu is neither a dialog nor inside this one (the provider renders it
 * beside the app), so the trap took focus off the menu and gave it back to the row: Enter then DRILLED
 * into the row instead of choosing the menu item the user had arrowed to.
 *
 * Layer: component — the real modal, real focus trap, real body and real ContextMenuProvider; only the
 * chart wrapper and the project command are stubbed. Whether a real window delivers the key is not
 * claimed.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../../src/renderer/context-menu-provider.js';
import { ResourceMonitorHost } from '../../../src/renderer/resources/monitor-modal.js';
import { __resetMonitorStore, openMonitor } from '../../../src/renderer/resources/monitor-store.js';
import { __resetSession, getView } from '../../../src/renderer/resources/monitor-session.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

const unload = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/sidebar/use-unload-project.js', () => ({ useUnloadProject: () => unload }));
vi.mock('../../../src/renderer/resources/charts/timeseries.js', () => ({
  TimeseriesCharts: () => createElement('div', { 'data-testid': 'timeseries-stub' }),
}));

let bridge: ResourcesBridge;
// jsdom lays nothing out, so `offsetParent` is always null — which the trap reads as "hidden" and so
// finds nothing to hold. Every connected element is laid out for this file.
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');

beforeEach(() => {
  bridge = installResourcesBridge(null);
  unload.mockClear();
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

describe('a context menu opened from a row', () => {
  it('keeps focus: the trap does not pull it back to the row', async () => {
    await openModal();
    const row = screen.getByTestId('breakdown-row-p:p1');
    row.focus();

    fireEvent.contextMenu(row);

    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    // And it stays there across the next tick, which is when the trap's guard would have run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it('Enter chooses the menu item, and does not drill into the row', async () => {
    await openModal();
    const row = screen.getByTestId('breakdown-row-p:p1');
    row.focus();
    fireEvent.contextMenu(row);
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));

    // Arrow to Unload Project (Kill All Below leads, then the two Unload rows), then Enter.
    for (let i = 0; i < 4 && (document.activeElement as HTMLElement).getAttribute('data-testid') !== 'menu-item-Unload Project'; i += 1) {
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    }
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute('data-testid')).toBe('menu-item-Unload Project');
    fireEvent.keyDown(focused, { key: 'Enter' });

    expect(unload).toHaveBeenCalledTimes(1);
    expect(unload.mock.calls[0]![0]).toEqual({ id: 'p1', name: 'Alpha' });
    // Nothing drilled.
    expect(getView().focusPath).toEqual(['root']);
  });

  it('the trap still holds against the application behind the dialog', async () => {
    await openModal();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const row = screen.getByTestId('breakdown-row-p:p1');
    row.focus();

    outside.focus();

    await waitFor(() => expect(document.activeElement).not.toBe(outside));
    outside.remove();
  });
});
