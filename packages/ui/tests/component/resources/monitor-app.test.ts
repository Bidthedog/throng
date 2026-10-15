/**
 * The Resource Monitor WINDOW's app (055 FR-081, FR-084, FR-085, FR-087, SC-002): the Preferences title
 * bar titled "Resource Monitor", Minimise handed to main, Esc and X closing the window, the view read
 * on mount and saved on change, and the detail subscription's lifetime.
 *
 * Layer: component — `MonitorApp` is the window's real root (it mounts its own providers); the lazy body
 * is replaced at its module seam (it has its own tests: breakdown, detail pane, toolbar, keyboard). The
 * process boundary is `window.throng`: `resources` from the bridge helper, `window` stubbed here.
 *
 * ANTI-VACUITY: remove `restoreView` from the mount effect and "applies the stored view" goes red;
 * remove the `restored` guard on the save effect and "does not overwrite the stored view" goes red.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { MonitorApp } from '../../../src/renderer/resources/monitor-app.js';
import { __resetSession, getHistory, getSessionSnapshot, getView, setView } from '../../../src/renderer/resources/monitor-session.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

vi.mock('../../../src/renderer/resources/monitor-body.js', () => ({
  default: () => createElement('div', { 'data-testid': 'monitor-body' }, 'body'),
}));

let bridge: ResourcesBridge;
let windowBridge: { minimize: ReturnType<typeof vi.fn>; maximize: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
let reducedMotion = false;

beforeEach(() => {
  bridge = installResourcesBridge(null);
  windowBridge = {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
  };
  Object.assign((window as unknown as { throng: Record<string, unknown> }).throng, {
    window: { ...windowBridge, isMaximized: () => Promise.resolve(false), onMaximizeChange: () => () => {} },
  });
  reducedMotion = false;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: reducedMotion && query.includes('prefers-reduced-motion'), addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  Reflect.deleteProperty(window, 'matchMedia');
  __resetSession();
});

/** The window mounted and its stored view read. */
async function mountWindow(): Promise<void> {
  render(createElement(MonitorApp));
  await screen.findByTestId('monitor-window');
  await act(async () => {});
}

const win = (): HTMLElement => screen.getByTestId('monitor-window');

describe('the window (FR-081, FR-084)', () => {
  it('is the Preferences title bar, titled Resource Monitor, with Minimise, Maximise and Close', async () => {
    await mountWindow();

    expect(screen.getByTestId('title-bar-identity')).toHaveTextContent('Resource Monitor');
    const icons = THRONG_THEME.icons as Record<string, string>;
    expect(screen.getByTestId('window-min')).toHaveTextContent(icons.windowMinimise!);
    expect(screen.getByTestId('window-max')).toBeInTheDocument();
    expect(screen.getByTestId('window-close')).toBeInTheDocument();
    expect(document.title).toContain('Resource Monitor');
    // No cog: this is not the main window.
    expect(screen.queryByTestId('title-bar-cog')).toBeNull();
  });

  it('draws its loading state at once, and the body when the first frame arrives (FR-051, SC-002)', async () => {
    await mountWindow();
    expect(win()).toHaveAttribute('data-state', 'loading');
    expect(screen.getByTestId('monitor-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('monitor-body')).toBeNull();

    await act(async () => bridge.pushDetail(frame(1, sampleHierarchy())));

    await waitFor(() => expect(win()).toHaveAttribute('data-state', 'ready'));
    expect(await screen.findByTestId('monitor-body')).toBeInTheDocument();
  });

  it('does not make the page behind it inert: it is a window, not a dialog (FR-086)', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div data-testid="elsewhere"></div>');
    await mountWindow();
    expect(screen.getByTestId('elsewhere')).not.toHaveAttribute('inert');
    expect(screen.queryByRole('dialog')).toBeNull();
    screen.getByTestId('elsewhere').remove();
  });
});

describe('Minimise (FR-085)', () => {
  it('asks main to shrink the window into the status bar, and does not send it to the taskbar', async () => {
    await mountWindow();

    fireEvent.click(screen.getByTestId('window-min'));

    expect(bridge.minimised).toEqual([{ reducedMotion: false }]);
    expect(windowBridge.minimize).not.toHaveBeenCalled();
  });

  it('passes the reduced-motion preference along', async () => {
    reducedMotion = true;
    await mountWindow();

    fireEvent.click(screen.getByTestId('window-min'));

    expect(bridge.minimised).toEqual([{ reducedMotion: true }]);
  });
});

describe('closing (FR-052)', () => {
  it('closes the window on Escape', async () => {
    await mountWindow();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(windowBridge.close).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to an open context menu, which closes first', async () => {
    await mountWindow();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    try {
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      expect(windowBridge.close).not.toHaveBeenCalled();
    } finally {
      menu.remove();
    }
  });

  it('closes the window on the X', async () => {
    await mountWindow();
    fireEvent.click(screen.getByTestId('window-close'));
    expect(windowBridge.close).toHaveBeenCalledTimes(1);
  });
});

describe('the view (FR-087)', () => {
  it('applies the stored view before the body is drawn', async () => {
    bridge.setStoredView({ metric: 'memory', filterText: 'node', narrowTo: 'p:p1', hideIdle: true, focusPath: ['root', 'c:projects'] });
    render(createElement(MonitorApp));
    await act(async () => bridge.pushDetail(frame(1, sampleHierarchy())));

    await screen.findByTestId('monitor-body');
    expect(getView()).toEqual({ metric: 'memory', filterText: 'node', narrowTo: 'p:p1', hideIdle: true, focusPath: ['root', 'c:projects'] });
  });

  it('starts from the defaults the first time (a stored view of null)', async () => {
    await mountWindow();
    expect(getView()).toMatchObject({ metric: 'cpu', filterText: '', narrowTo: null, hideIdle: false, focusPath: ['root'] });
  });

  it('ignores a stored field it cannot use rather than trusting it', async () => {
    bridge.setStoredView({ metric: 'bogus', filterText: 42, hideIdle: 'yes', focusPath: [] });
    await mountWindow();
    expect(getView()).toMatchObject({ metric: 'cpu', filterText: '', hideIdle: false, focusPath: ['root'] });
  });

  it('does not overwrite the stored view with the defaults before it has been read', async () => {
    bridge.setStoredView({ metric: 'gpu' });
    await mountWindow();
    expect(bridge.savedViews.every((v) => (v as { metric: string }).metric === 'gpu')).toBe(true);
  });

  it('saves the view on every change', async () => {
    await mountWindow();
    const before = bridge.savedViews.length;

    act(() => setView({ metric: 'io', filterText: 'node' }));

    expect(bridge.savedViews.length).toBe(before + 1);
    expect(bridge.savedViews.at(-1)).toMatchObject({ metric: 'io', filterText: 'node' });
    expect(bridge.savedViews.at(-1)).not.toHaveProperty('maximised');
  });
});

describe('stale figures (FR-044, T095)', () => {
  const NOW = 1_700_000_100_000;

  it('says how old the figures are while the collector is failing, and recovers on the next good frame', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(NOW);
      await mountWindow();
      await act(async () => bridge.pushDetail(frame(1, sampleHierarchy(), { at: NOW - 2000 })));
      expect(screen.queryByTestId('monitor-stale')).toBeNull();

      await act(async () => bridge.pushDetail(frame(2, sampleHierarchy(), { at: NOW - 14_000, stale: true, staleSince: NOW - 14_000 })));
      const stale = screen.getByTestId('monitor-stale');
      expect(stale).toHaveTextContent('Figures from 14 s ago');
      expect(stale).toHaveAttribute('role', 'status');

      await act(async () => bridge.pushDetail(frame(3, sampleHierarchy(), { at: NOW })));
      expect(screen.queryByTestId('monitor-stale')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not a second notice: the one inline notice stays free for what has an action', async () => {
    await mountWindow();
    await act(async () => bridge.pushDetail(frame(2, sampleHierarchy(), { stale: true, staleSince: Date.now() - 5000 })));
    expect(screen.getByTestId('monitor-stale')).toBeInTheDocument();
    expect(screen.queryByTestId('monitor-notice')).toBeNull();
  });
});

describe('the detail subscription (FR-003)', () => {
  it('subscribes when the window opens and unsubscribes when it closes', async () => {
    const view = render(createElement(MonitorApp));
    await waitFor(() => expect(bridge.subscribed).toHaveLength(1));
    expect(bridge.detailListeners()).toBe(1);

    view.unmount();

    expect(bridge.unsubscribed).toEqual(bridge.subscribed);
    expect(bridge.detailListeners()).toBe(0);
  });

  it('still unsubscribes when it is closed before the subscription came back', async () => {
    const view = render(createElement(MonitorApp));
    view.unmount();

    await waitFor(() => expect(bridge.unsubscribed).toEqual(bridge.subscribed));
    expect(bridge.subscribed).toHaveLength(1);
  });

  it('feeds each frame to the session, and discards the session on close (FR-033)', async () => {
    const view = render(createElement(MonitorApp));
    await act(async () => bridge.pushDetail(frame(1, sampleHierarchy())));
    expect(getHistory('root')).toHaveLength(1);
    expect(getSessionSnapshot().tree).not.toBeNull();

    view.unmount();

    expect(getHistory('root')).toHaveLength(0);
    expect(getSessionSnapshot().tree).toBeNull();
  });
});
