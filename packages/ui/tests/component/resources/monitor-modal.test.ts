/**
 * The Resource Monitor modal's SHELL (055 FR-050 – FR-052, SC-002): that it opens at once, is exclusive,
 * closes on Esc and the X, and owns the detail subscription's lifetime.
 *
 * Layer: component — the shell is real; the lazy body is replaced at its module seam (it has its own
 * tests: breakdown, detail pane, toolbar, keyboard). Chords are pressed through the real
 * `KeybindingsHandler`, because "every window chord is suppressed" is a claim about THAT listener.
 *
 * ANTI-VACUITY: delete the `isMonitorOpen()` gate at the top of the dispatcher's `onKeyDown` and the
 * "suppressed" tests go red while "the toggle still works" stays green; delete the `inert` effect and
 * the "workspace behind is inert" test goes red alone.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLayout, type Panel, type WorkspaceLayout } from '@throng/core';
import { KeybindingsHandler } from '../../../src/renderer/app.js';
import { ResourceMonitorHost } from '../../../src/renderer/resources/monitor-modal.js';
import {
  __resetMonitorStore,
  closeMonitor,
  isMonitorOpen,
  openMonitor,
} from '../../../src/renderer/resources/monitor-store.js';
import { __resetSession, getHistory, getSessionSnapshot, getView, setView } from '../../../src/renderer/resources/monitor-session.js';
import { setActivePane } from '../../../src/renderer/workspace/active-pane.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';
import { mountWorkspace, type MountedWorkspace } from '../helpers/mount-workspace.js';

// The body is another task's component and another test's subject; the shell is asked only to host it.
vi.mock('../../../src/renderer/resources/monitor-body.js', () => ({
  default: () => createElement('div', { 'data-testid': 'monitor-body' }, 'body'),
}));

let bridge: ResourcesBridge;

beforeEach(() => {
  bridge = installResourcesBridge(null);
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  __resetMonitorStore();
  __resetSession();
});

/** A workspace stand-in beside the host, in the same parent — the host's siblings are what goes inert. */
function mountHost(): void {
  render(
    createElement(
      Fragment,
      null,
      createElement('div', { 'data-testid': 'workspace' }, createElement('button', { 'data-testid': 'behind' }, 'behind')),
      createElement(ResourceMonitorHost),
    ),
  );
}

const dialog = (): HTMLElement => screen.getByRole('dialog');

describe('stale figures (FR-044, T095)', () => {
  const NOW = 1_700_000_100_000;

  it('says how old the figures are while the collector is failing, and recovers on the next good frame', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(NOW);
      mountHost();
      act(() => openMonitor());
      await act(async () => bridge.pushDetail(frame(1, sampleHierarchy(), { at: NOW - 2000 })));
      expect(screen.queryByTestId('monitor-stale')).toBeNull();

      // A stale frame keeps the last good reading's time.
      await act(async () => bridge.pushDetail(frame(2, sampleHierarchy(), { at: NOW - 14_000, stale: true, staleSince: NOW - 14_000 })));
      const stale = screen.getByTestId('monitor-stale');
      expect(stale).toHaveTextContent('Figures from 14 s ago');
      expect(stale).toHaveAttribute('role', 'status');

      // The next good frame clears it, with no reopening.
      await act(async () => bridge.pushDetail(frame(3, sampleHierarchy(), { at: NOW })));
      expect(screen.queryByTestId('monitor-stale')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not a second notice: the one inline notice stays free for what has an action', async () => {
    mountHost();
    act(() => openMonitor());
    await act(async () => bridge.pushDetail(frame(2, sampleHierarchy(), { stale: true, staleSince: Date.now() - 5000 })));
    expect(screen.getByTestId('monitor-stale')).toBeInTheDocument();
    expect(screen.queryByTestId('monitor-notice')).toBeNull();
  });
});

describe('opening (FR-050, FR-051, SC-002)', () => {
  it('is in the DOM within 100 ms of the open call, in its loading state', () => {
    mountHost();
    expect(screen.queryByRole('dialog')).toBeNull();

    const started = performance.now();
    act(() => openMonitor());
    const elapsed = performance.now() - started;

    expect(dialog()).toBeInTheDocument();
    expect(elapsed).toBeLessThan(100);
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    expect(dialog()).toHaveAttribute('data-state', 'loading');
    // Nothing collected yet: the body is not asked to draw anything.
    expect(screen.queryByTestId('monitor-body')).toBeNull();
  });

  it('renders the first frame asynchronously, when it arrives (FR-051)', async () => {
    mountHost();
    act(() => openMonitor());
    expect(dialog()).toHaveAttribute('data-state', 'loading');

    await act(async () => bridge.pushDetail(frame(1, sampleHierarchy())));

    await waitFor(() => expect(dialog()).toHaveAttribute('data-state', 'ready'));
    expect(await screen.findByTestId('monitor-body')).toBeInTheDocument();
  });

  it('opens in the main window when another window asked for it', () => {
    mountHost();
    expect(isMonitorOpen()).toBe(false);

    act(() => bridge.fireOpenRequest());

    expect(isMonitorOpen()).toBe(true);
    expect(dialog()).toBeInTheDocument();
  });

  it('takes the keyboard on open and gives it back on close', () => {
    mountHost();
    const behind = screen.getByTestId('behind');
    behind.focus();
    expect(document.activeElement).toBe(behind);

    act(() => openMonitor());
    expect(dialog().contains(document.activeElement)).toBe(true);

    act(() => closeMonitor());
    expect(document.activeElement).toBe(behind);
  });
});

describe('exclusive (FR-050)', () => {
  it('makes the workspace behind it inert while open, and live again after', () => {
    mountHost();
    expect(screen.getByTestId('workspace')).not.toHaveAttribute('inert');

    act(() => openMonitor());
    expect(screen.getByTestId('workspace')).toHaveAttribute('inert');

    act(() => closeMonitor());
    expect(screen.getByTestId('workspace')).not.toHaveAttribute('inert');
  });

  it('keeps a modifier chord typed inside it from reaching the window’s other key handlers', () => {
    mountHost();
    act(() => openMonitor());
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    try {
      // Ctrl+S would save the editor behind it; the close button stands in for anything focused here.
      fireEvent.keyDown(screen.getByTestId('monitor-close'), { key: 's', code: 'KeyS', ctrlKey: true });
      expect(reached).not.toHaveBeenCalled();
      // An ordinary key is left alone — the filter field and the breakdown need theirs.
      fireEvent.keyDown(screen.getByTestId('monitor-close'), { key: 'a', code: 'KeyA' });
      expect(reached).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', reached);
    }
  });
});

describe('closing (FR-052)', () => {
  it('closes on Escape', () => {
    mountHost();
    act(() => openMonitor());

    fireEvent.keyDown(dialog(), { key: 'Escape', code: 'Escape' });

    expect(isMonitorOpen()).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves Escape to an open context menu, which closes first', () => {
    mountHost();
    act(() => openMonitor());
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    try {
      fireEvent.keyDown(dialog(), { key: 'Escape', code: 'Escape' });
      expect(isMonitorOpen()).toBe(true);
    } finally {
      menu.remove();
    }
  });

  it('closes on the X at the top right — a themeable icon control titled Close', () => {
    mountHost();
    act(() => openMonitor());

    const close = screen.getByTestId('monitor-close');
    expect(close).toHaveAttribute('title', 'Close');
    expect(close).toHaveAttribute('aria-label', 'Close');
    expect(close.querySelector('.icon')).not.toBeNull();
    fireEvent.click(close);

    expect(isMonitorOpen()).toBe(false);
  });
});

describe('the detail subscription (FR-003)', () => {
  it('subscribes when it opens and unsubscribes when it closes', async () => {
    mountHost();
    expect(bridge.subscribed).toHaveLength(0);

    await act(async () => openMonitor());
    await waitFor(() => expect(bridge.subscribed).toHaveLength(1));
    expect(bridge.detailListeners()).toBe(1);

    await act(async () => closeMonitor());
    expect(bridge.unsubscribed).toEqual(bridge.subscribed);
    expect(bridge.detailListeners()).toBe(0);
  });

  it('still unsubscribes when it is closed before the subscription came back', async () => {
    mountHost();
    act(() => openMonitor());
    act(() => closeMonitor());

    await waitFor(() => expect(bridge.unsubscribed).toEqual(bridge.subscribed));
    expect(bridge.subscribed).toHaveLength(1);
  });

  it('feeds each frame to the session, and discards the session on close (FR-033)', async () => {
    mountHost();
    await act(async () => openMonitor());
    await act(async () => bridge.pushDetail(frame(1, sampleHierarchy())));
    expect(getHistory('root')).toHaveLength(1);
    expect(getSessionSnapshot().tree).not.toBeNull();

    await act(async () => closeMonitor());

    expect(getHistory('root')).toHaveLength(0);
    expect(getSessionSnapshot().tree).toBeNull();
  });

  it('keeps the view across a close and a reopen (FR-057)', async () => {
    mountHost();
    await act(async () => openMonitor());
    act(() => setView({ metric: 'memory', filterText: 'node' }));
    await act(async () => closeMonitor());
    await act(async () => openMonitor());

    expect(getView()).toMatchObject({ metric: 'memory', filterText: 'node' });
  });
});

/* ── the exclusive gate, through the real window dispatcher ─────────────────────────────────── */

const PROJECT = 'proj';
const editor = (id: string): Panel => ({ type: 'panel', id, originProjectId: PROJECT, title: id, kind: 'editor', config: { filePath: `D:/proj/${id}.ts` } });

function twoPanels(): WorkspaceLayout {
  const l = createDefaultLayout(PROJECT, { tab: 't1', panel: 'p1' });
  l.tabs[0].root = { type: 'split', orientation: 'row', sizes: [0.5, 0.5], children: [editor('p1'), editor('p2')] };
  l.tabs[0].activePanelId = 'p1';
  return l;
}

const FOCUS_RIGHT = { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true, shiftKey: true, altKey: true };
const TOGGLE = { key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true, altKey: true };

describe('every window chord but the monitor’s own is suppressed while it is open (FR-050)', () => {
  let m: MountedWorkspace | undefined;

  async function mountWindow(): Promise<void> {
    setActivePane('workspace');
    m = await mountWorkspace(twoPanels(), {
      extras: [
        createElement(KeybindingsHandler, { key: 'keys', onToggleProjects: () => {}, onToggleExplorer: () => {}, onRevealLeft: () => {}, onRevealRight: () => {} }),
        createElement(ResourceMonitorHost, { key: 'host' }),
      ],
      throng: { resources: (window as unknown as { throng: { resources: unknown } }).throng.resources },
    });
  }
  const active = (): string | undefined => m!.ws().layout!.tabs[0].activePanelId;

  afterEach(() => {
    m?.unmount();
    m = undefined;
  });

  it('control: with the monitor closed the chord moves the active panel', async () => {
    await mountWindow();
    act(() => void fireEvent.keyDown(document.body, FOCUS_RIGHT));
    expect(active()).toBe('p2');
  });

  it('with the monitor open the same chord does nothing, and is consumed', async () => {
    await mountWindow();
    act(() => openMonitor());

    let notTaken = true;
    act(() => {
      notTaken = fireEvent.keyDown(screen.getByTestId('monitor-close'), FOCUS_RIGHT);
    });

    expect(active()).toBe('p1');
    expect(notTaken, 'the chord should be consumed, not left to whatever holds focus').toBe(false);
  });

  it('the monitor’s own chord still works: it closes the monitor, and opens it again', async () => {
    await mountWindow();
    act(() => openMonitor());

    act(() => void fireEvent.keyDown(screen.getByTestId('monitor-close'), TOGGLE));
    expect(isMonitorOpen()).toBe(false);

    act(() => void fireEvent.keyDown(document.body, TOGGLE));
    expect(isMonitorOpen()).toBe(true);
  });

  it('opens the monitor from the chord when it is closed', async () => {
    await mountWindow();
    expect(isMonitorOpen()).toBe(false);

    act(() => void fireEvent.keyDown(document.body, TOGGLE));

    expect(isMonitorOpen()).toBe(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
