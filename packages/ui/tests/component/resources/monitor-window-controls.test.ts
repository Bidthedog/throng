/**
 * The monitor's own window controls (055 US5, FR-056, FR-058): Maximise and Restore, Minimise with its
 * animation toward the status-bar item, and Close.
 *
 * Layer: component — the real shell over the real store and session, body replaced by a stub. jsdom has
 * no `Element.animate` and no layout, so both are supplied here: the claim is WHAT the animation is asked
 * to do (one call, toward the item's rectangle, then close when it finishes; none under reduced motion),
 * and not what Chromium paints — which is not assertable at this layer and is not claimed.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { ResourceMonitorHost } from '../../../src/renderer/resources/monitor-modal.js';
import { __resetMonitorStore, openMonitor, setStatusItemElement } from '../../../src/renderer/resources/monitor-store.js';
import { __resetSession, getView } from '../../../src/renderer/resources/monitor-session.js';
import { installResourcesBridge } from '../helpers/resource-bridge.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

vi.mock('../../../src/renderer/resources/monitor-body.js', () => ({
  default: () => createElement('div', { 'data-testid': 'monitor-body' }),
}));

const DIALOG_RECT = { left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650, x: 100, y: 50 } as DOMRect;
const ITEM_RECT = { left: 600, top: 900, width: 80, height: 20, right: 680, bottom: 920, x: 600, y: 900 } as DOMRect;

let bridge: ReturnType<typeof installResourcesBridge>;
let animate: ReturnType<typeof vi.fn>;
let finish: () => void;
let reducedMotion = false;

beforeEach(() => {
  bridge = installResourcesBridge(null);
  __resetMonitorStore();
  __resetSession();
  reducedMotion = false;
  animate = vi.fn(() => {
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { finished, cancel: vi.fn() };
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: reducedMotion && query.includes('prefers-reduced-motion'), addEventListener: () => {}, removeEventListener: () => {} }),
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('data-testid') === 'monitor-dialog' ? DIALOG_RECT : ITEM_RECT;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  Reflect.deleteProperty(window, 'matchMedia');
  Reflect.deleteProperty(window, 'throng');
  setStatusItemElement(null);
  __resetMonitorStore();
  __resetSession();
});

async function open(): Promise<void> {
  const item = document.createElement('button');
  document.body.appendChild(item);
  setStatusItemElement(item);
  render(createElement(ResourceMonitorHost));
  act(() => openMonitor());
  await act(async () => bridge.pushDetail(frame(1, sampleHierarchy())));
  await screen.findByTestId('monitor-body');
}

const dialog = (): HTMLElement => screen.getByTestId('monitor-dialog');

describe('Maximise and Restore', () => {
  it('is an icon control that fills the window, and becomes Restore', async () => {
    await open();
    const button = screen.getByTestId('monitor-maximise');
    const icons = THRONG_THEME.icons as Record<string, string>;
    expect(button).toHaveAttribute('title', 'Maximise');
    expect(button).toHaveTextContent(icons.panelMaximise!);
    expect(dialog()).toHaveAttribute('data-maximised', 'false');

    fireEvent.click(button);

    expect(dialog()).toHaveAttribute('data-maximised', 'true');
    expect(getView().maximised).toBe(true);
    expect(screen.getByTestId('monitor-maximise')).toHaveAttribute('title', 'Restore');
    expect(screen.getByTestId('monitor-maximise')).toHaveTextContent(icons.panelRestore!);
  });

  it('Restore returns the previous size', async () => {
    await open();
    fireEvent.click(screen.getByTestId('monitor-maximise'));
    fireEvent.click(screen.getByTestId('monitor-maximise'));
    expect(dialog()).toHaveAttribute('data-maximised', 'false');
    expect(getView().maximised).toBe(false);
  });

  it('is remembered for as long as throng runs, so a reopened monitor is as it was left (FR-057)', async () => {
    await open();
    fireEvent.click(screen.getByTestId('monitor-maximise'));
    fireEvent.click(screen.getByTestId('monitor-close'));
    await waitFor(() => expect(screen.queryByTestId('monitor-dialog')).toBeNull());

    act(() => openMonitor());
    await screen.findByTestId('monitor-dialog');

    expect(dialog()).toHaveAttribute('data-maximised', 'true');
  });
});

describe('Minimise', () => {
  it('is an icon control titled Minimise', async () => {
    await open();
    const icons = THRONG_THEME.icons as Record<string, string>;
    const button = screen.getByTestId('monitor-minimise');
    expect(button).toHaveAttribute('title', 'Minimise');
    expect(button).toHaveTextContent(icons.windowMinimise!);
  });

  it('runs ONE animation toward the status-bar item, and closes when it finishes', async () => {
    await open();

    fireEvent.click(screen.getByTestId('monitor-minimise'));

    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    expect(options.duration).toBe(220);
    // From where it is, to the item's rectangle: centre to centre, scaled to the item's size.
    const last = keyframes[keyframes.length - 1] as { transform: string; opacity: string | number };
    expect(last.transform).toMatch(/^translate\(140px, 560px\) scale\(0\.1, 0\.0333/);
    // Still on screen while it moves.
    expect(screen.queryByTestId('monitor-dialog')).not.toBeNull();

    await act(async () => {
      finish();
    });
    await waitFor(() => expect(screen.queryByTestId('monitor-dialog')).toBeNull());
  });

  it('ignores a second press while it is moving', async () => {
    await open();
    fireEvent.click(screen.getByTestId('monitor-minimise'));
    fireEvent.click(screen.getByTestId('monitor-minimise'));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('closes at once, with no animation, under prefers-reduced-motion', async () => {
    reducedMotion = true;
    await open();

    fireEvent.click(screen.getByTestId('monitor-minimise'));

    expect(animate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('monitor-dialog')).toBeNull());
  });

  it('closes at once when the status bar has no item to move toward', async () => {
    await open();
    setStatusItemElement(null);

    fireEvent.click(screen.getByTestId('monitor-minimise'));

    expect(animate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('monitor-dialog')).toBeNull());
  });

  it('is the same as Close for what it leaves behind: the session is discarded', async () => {
    await open();
    fireEvent.click(screen.getByTestId('monitor-minimise'));
    await act(async () => {
      finish();
    });
    await waitFor(() => expect(bridge.unsubscribed.length).toBe(bridge.subscribed.length));
  });
});

describe('the controls as a set', () => {
  it('are titled icon controls in the order minimise, maximise, close — the last in the Tab order', async () => {
    await open();
    const buttons = Array.from(screen.getByTestId('monitor-window-controls').querySelectorAll('button'));
    expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual(['monitor-minimise', 'monitor-maximise', 'monitor-close']);
    for (const b of buttons) {
      expect(b.getAttribute('title')).toBeTruthy();
      expect(b.querySelector('.icon')).not.toBeNull();
    }
  });
});
