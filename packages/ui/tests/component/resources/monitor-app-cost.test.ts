/**
 * What the monitor window's SHELL costs per capture and per keystroke (055 SC-010, defects D3, D5):
 * it re-renders for neither, it saves the view at most every 250 ms, and it starts loading the body's
 * chunk when it mounts rather than when the first frame arrives.
 *
 * Layer: component — the shell is the window's real root; the title bar and the lazy body are replaced
 * at their module seams, the title bar by a render counter (the shell re-rendering is what re-renders
 * it) and the body by a flag set when its module is first imported.
 */
import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorApp } from '../../../src/renderer/resources/monitor-app.js';
import { __resetSession, setView } from '../../../src/renderer/resources/monitor-session.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

const probe = vi.hoisted(() => ({ bodyImported: false, titleBarRenders: 0 }));

vi.mock('../../../src/renderer/resources/monitor-body.js', () => {
  probe.bodyImported = true;
  return { default: () => null };
});
vi.mock('../../../src/renderer/title-bar/title-bar.js', () => ({
  TitleBar: () => {
    probe.titleBarRenders += 1;
    return null;
  },
}));

let bridge: ResourcesBridge;

beforeEach(() => {
  bridge = installResourcesBridge(null);
  probe.titleBarRenders = 0;
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'throng');
  __resetSession();
});

async function mountWindow(): Promise<void> {
  render(createElement(MonitorApp));
  await screen.findByTestId('monitor-window');
  await act(async () => {});
}

// FIRST in the file on purpose: the mocked module is evaluated once, the first time anything asks for it.
describe('the body’s chunk (D5)', () => {
  it('is requested when the window mounts, before any frame has arrived', async () => {
    // Anti-vacuity: nothing has asked for the module yet.
    expect(probe.bodyImported).toBe(false);
    render(createElement(MonitorApp));
    await screen.findByTestId('monitor-window');
    expect(screen.getByTestId('monitor-window')).toHaveAttribute('data-state', 'loading');
    await vi.waitFor(() => expect(probe.bodyImported).toBe(true));
  });
});

describe('the shell stays out of the way (D3)', () => {
  it('does not re-render for a capture after the first, nor for a change of view', async () => {
    await mountWindow();
    await act(async () => bridge.pushDetail(frame(1, sampleHierarchy())));
    const rendered = probe.titleBarRenders;

    for (let tick = 2; tick <= 6; tick += 1) await act(async () => bridge.pushDetail(frame(tick, sampleHierarchy())));
    act(() => setView({ filterText: 'node' }));
    act(() => setView({ metric: 'memory' }));

    expect(probe.titleBarRenders).toBe(rendered);
  });
});

describe('saving the view (D1, SC-010)', () => {
  it('saves at once, then at most every 250 ms, and always ends on the latest view', async () => {
    await mountWindow();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = bridge.savedViews.length;

    for (const text of ['n', 'no', 'nod', 'node']) act(() => setView({ filterText: text }));
    // The first change goes out at once; the rest wait for the interval.
    expect(bridge.savedViews.length).toBe(before + 1);
    expect(bridge.savedViews.at(-1)).toMatchObject({ filterText: 'n' });

    act(() => void vi.advanceTimersByTime(249));
    expect(bridge.savedViews.length).toBe(before + 1);
    act(() => void vi.advanceTimersByTime(2));
    expect(bridge.savedViews.length).toBe(before + 2);
    expect(bridge.savedViews.at(-1)).toMatchObject({ filterText: 'node' });

    // Nothing more changed: nothing more is sent.
    act(() => void vi.advanceTimersByTime(1000));
    expect(bridge.savedViews.length).toBe(before + 2);
  });
});
