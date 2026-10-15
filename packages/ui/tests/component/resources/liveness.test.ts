/**
 * The monitor says it is alive (055 FR-091): one line — "Collecting the first reading…" before the first
 * capture, "Updated <time> · every <n> s" with a pulse on each capture after it, and FR-044's "Figures
 * from N s ago" while the collector is failing.
 *
 * Layer: component — the window's real root with the lazy body replaced at its module seam. That a pulse
 * is not PLAYED under reduced motion is the stylesheet's, and is guarded in `unit/resources/monitor-css.test.ts`.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { MonitorApp } from '../../../src/renderer/resources/monitor-app.js';
import { __resetSession } from '../../../src/renderer/resources/monitor-session.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

vi.mock('../../../src/renderer/resources/monitor-body.js', () => ({ default: () => null }));

let bridge: ResourcesBridge;

beforeEach(() => {
  bridge = installResourcesBridge(null);
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  __resetSession();
});

async function mountWindow(intervalSeconds?: number): Promise<void> {
  if (intervalSeconds !== undefined) {
    Reflect.set(window.throng as object, 'config', {
      get: () => Promise.resolve({ settings: { resourceMonitor: { captureIntervalSeconds: intervalSeconds, historyMinutes: 5 } }, theme: THRONG_THEME }),
      onChange: () => () => {},
    });
  }
  render(createElement(MonitorApp));
  await screen.findByTestId('monitor-window');
  await act(async () => {});
}

const push = (tick: number, over = {}): Promise<void> => act(async () => bridge.pushDetail(frame(tick, sampleHierarchy(), over)));

describe('before the first capture', () => {
  it('says it is collecting the first reading, in the same line that will carry the time', async () => {
    await mountWindow();
    const line = screen.getByTestId('monitor-loading');
    expect(line).toHaveTextContent('Collecting the first reading…');
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveClass('monitor-liveness');
  });
});

describe('after it (FR-091)', () => {
  it('reads “Updated <time> · every <n> s”, and the same element takes over from the collecting message', async () => {
    await mountWindow();
    const collecting = screen.getByTestId('monitor-loading');

    await push(1);

    expect(screen.queryByTestId('monitor-loading')).toBeNull();
    const line = screen.getByTestId('monitor-updated');
    expect(line).toHaveClass('monitor-liveness');
    expect(line.textContent).toBe(`Updated ${new Date(frame(1, sampleHierarchy()).at).toLocaleTimeString()} · every 2 s`);
    expect(line).toBe(collecting);
  });

  it('shows the capture interval in force', async () => {
    await mountWindow(4);
    await waitFor(() => expect(screen.getByTestId('monitor-loading')).toBeInTheDocument());
    await push(1);
    await waitFor(() => expect(screen.getByTestId('monitor-updated')).toHaveTextContent('every 4 s'));
  });

  it('changes with each capture and pulses once for each', async () => {
    await mountWindow();
    await push(1);
    const first = screen.getByTestId('monitor-liveness-pulse');
    const firstTime = screen.getByTestId('monitor-updated').textContent;
    expect(first).toHaveAttribute('data-tick', '1');

    await push(2);

    const second = screen.getByTestId('monitor-liveness-pulse');
    expect(second).toHaveAttribute('data-tick', '2');
    // A new element, so the animation plays again rather than being a class that never changes.
    expect(second).not.toBe(first);
    expect(screen.getByTestId('monitor-updated').textContent).not.toBe(firstTime);
  });

  it('does not make a live region of a line that changes every two seconds', async () => {
    await mountWindow();
    await push(1);
    expect(screen.getByTestId('monitor-updated')).not.toHaveAttribute('role');
  });
});

describe('while the collector is failing (FR-044)', () => {
  it('keeps its wording, in the same line, with no pulse', async () => {
    await mountWindow();
    await push(1, { at: Date.now() - 2000 });
    await push(2, { at: Date.now() - 14_000, stale: true, staleSince: Date.now() - 14_000 });

    const line = screen.getByTestId('monitor-stale');
    expect(line).toHaveTextContent(/^Figures from \d+ s ago$/);
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveClass('monitor-liveness');
    expect(screen.queryByTestId('monitor-liveness-pulse')).toBeNull();
    expect(screen.queryByTestId('monitor-updated')).toBeNull();
  });
});
