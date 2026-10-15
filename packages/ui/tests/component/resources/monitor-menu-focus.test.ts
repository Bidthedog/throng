/**
 * A context menu opened over the monitor keeps the keyboard (055 FR-068).
 *
 * The monitor used to trap focus as a modal, and the trap took focus off a context menu — which is
 * neither a dialog nor inside the dialog — and gave it back to the row: Enter then DRILLED into the row
 * instead of choosing the menu item the user had arrowed to. The monitor is a window now and traps
 * nothing (FR-086), but the claim stays: the menu keeps focus, and Enter chooses its item.
 *
 * Layer: component — the window's real root, real body and real ContextMenuProvider; only the chart
 * wrapper is stubbed. Whether a real window delivers the key is not claimed.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorApp } from '../../../src/renderer/resources/monitor-app.js';
import { __resetSession, getView } from '../../../src/renderer/resources/monitor-session.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

vi.mock('../../../src/renderer/resources/charts/timeseries.js', () => ({
  TimeseriesCharts: () => createElement('div', { 'data-testid': 'timeseries-stub' }),
}));

let bridge: ResourcesBridge;

beforeEach(() => {
  bridge = installResourcesBridge(null);
  bridge.setRouteAnswer(true);
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  __resetSession();
});

async function openWindow(): Promise<void> {
  render(createElement(MonitorApp));
  await act(async () => bridge.pushDetail(frame(1, sampleHierarchy())));
  await screen.findByTestId('breakdown');
}

describe('a context menu opened from a row', () => {
  it('keeps focus', async () => {
    await openWindow();
    const row = screen.getByTestId('breakdown-row-p:p1');
    row.focus();

    fireEvent.contextMenu(row);

    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    // And it stays there across the next tick.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it('Enter chooses the menu item, and does not drill into the row', async () => {
    await openWindow();
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

    // Routed to the main window, where the project list's own command runs.
    await waitFor(() => expect(bridge.routed).toEqual([{ action: 'unloadProject', id: 'p1', name: 'Alpha' }]));
    // Nothing drilled.
    expect(getView().focusPath).toEqual(['root']);
  });
});
