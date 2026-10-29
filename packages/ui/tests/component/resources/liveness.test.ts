/**
 * The monitor says it is alive (055 FR-091): one line — "Collecting the first reading…" before the first
 * capture, "Updated <time> · every <n> s" with a pulse on each capture after it, and FR-044's "Figures
 * from N s ago" while the collector is failing.
 *
 * Layer: component — the window's real root and real body (the line lives in the body's first row, FR-121,
 * `monitor-layout.test.ts`). That a pulse
 * is not PLAYED under reduced motion is the stylesheet's, and is guarded in `unit/resources/monitor-css.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { MonitorApp } from '../../../src/renderer/resources/monitor-app.js';
import { __resetSession } from '../../../src/renderer/resources/monitor-session.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

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

const updated = (): Promise<HTMLElement> => screen.findByTestId('monitor-updated');

describe('after it (FR-091, FR-121)', () => {
  it('reads “Updated <date and time> (<n> s ago)”, and the collecting message gives way to it', async () => {
    await mountWindow();
    expect(screen.getByTestId('monitor-loading')).toBeInTheDocument();

    const at = Date.now() - 3000;
    await push(1, { at });

    const line = await updated();
    expect(screen.queryByTestId('monitor-loading')).toBeNull();
    expect(line).toHaveClass('monitor-liveness');
    expect(line.textContent).toBe(`Updated ${new Date(at).toLocaleString()} (3 s ago)`);
  });

  it('counts up each second without another capture', async () => {
    // The clock is faked before the line mounts, so its one-second timer is the fake one.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'], now: 1_700_000_000_000 });
    try {
      await mountWindow();
      await push(1, { at: Date.now() - 1000 });
      await updated();
      expect(screen.getByTestId('monitor-liveness-ago')).toHaveTextContent('1');
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByTestId('monitor-liveness-ago')).toHaveTextContent('4');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reserves the width of two digits for the count, so the row does not shift as it counts 1 to 59', async () => {
    await mountWindow();
    await push(1);
    await updated();
    const ago = screen.getByTestId('monitor-liveness-ago');
    expect(ago).toHaveClass('monitor-liveness__ago');
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8').replace(/\r\n/g, '\n');
    const rule = /\.monitor-liveness__ago\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/min-width:\s*2ch/);
    expect(rule).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(rule).toMatch(/text-align:\s*right/);
    expect(rule).toMatch(/display:\s*inline-block/);
  });

  it('changes with each capture and pulses once for each', async () => {
    await mountWindow();
    await push(1);
    const first = await screen.findByTestId('monitor-liveness-pulse');
    expect(first).toHaveAttribute('data-tick', '1');

    await push(2);

    const second = screen.getByTestId('monitor-liveness-pulse');
    expect(second).toHaveAttribute('data-tick', '2');
    // A new element, so the animation plays again rather than being a class that never changes.
    expect(second).not.toBe(first);
  });

  it('does not make a live region of a line that changes every second', async () => {
    await mountWindow();
    await push(1);
    expect(await updated()).not.toHaveAttribute('role');
  });
});

describe('while the collector is failing (FR-044)', () => {
  it('keeps its wording, in the same line, with no pulse', async () => {
    await mountWindow();
    await push(1, { at: Date.now() - 2000 });
    await push(2, { at: Date.now() - 14_000, stale: true, staleSince: Date.now() - 14_000 });

    const line = await screen.findByTestId('monitor-stale');
    expect(line).toHaveTextContent(/^Figures from \d+ s ago$/);
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveClass('monitor-liveness');
    expect(screen.queryByTestId('monitor-liveness-pulse')).toBeNull();
    expect(screen.queryByTestId('monitor-updated')).toBeNull();
  });
});
