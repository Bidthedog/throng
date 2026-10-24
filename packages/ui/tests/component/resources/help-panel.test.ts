/**
 * The monitor's help (055 FR-093): a "?" icon control in the toolbar opens a popover explaining
 * Components and Projects, what a tile's size and colour mean, the mouse, the keys, and amber and red with
 * the thresholds currently set. Esc or the button closes it; focus goes in on open and back to the button
 * on close; and it sits on the shared floating-surface rules (flips and clamps against the viewport).
 *
 * Layer: component — the real toolbar over the real config store (settings faked at `window.throng.config`).
 * That the popover is registered as a floating surface is `unit/floating-surfaces.test.ts`'s.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPONENT_DESCRIPTIONS, THRONG_THEME } from '@throng/core';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { __resetSession, ingestFrame, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { ToolbarControls } from '../../../src/renderer/resources/toolbar.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

function stubConfig(resourceMonitor: Record<string, number> = {}): void {
  window.throng = {
    config: {
      get: () => Promise.resolve({ settings: { resourceMonitor }, theme: THRONG_THEME }),
      onChange: () => () => {},
      writePatch: () => Promise.resolve({ ok: true }),
    },
  } as unknown as typeof window.throng;
}

beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  act(() => ingestFrame(frame(1, sampleHierarchy())));
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'throng');
  __resetSession();
});

async function mount(resourceMonitor: Record<string, number> = {}): Promise<void> {
  stubConfig(resourceMonitor);
  render(createElement(ConfigProvider, null, createElement(ToolbarControls)));
  await waitFor(() => expect(screen.getByTestId('monitor-interval')).toBeInTheDocument());
}

const button = (): HTMLElement => screen.getByTestId('monitor-help');
const panel = (): HTMLElement => screen.getByTestId('monitor-help-panel');

describe('the button (FR-093)', () => {
  it('is a titled, themeable “?” icon control in the toolbar', async () => {
    await mount();
    expect(button()).toHaveAttribute('title', 'Help');
    expect(button()).toHaveTextContent((THRONG_THEME.icons as Record<string, string>).help!);
    expect(button().querySelector('.icon')).not.toBeNull();
    expect(within(screen.getByTestId('monitor-controls')).getByTestId('monitor-help')).toBe(button());
  });

  it('is closed until it is pressed', async () => {
    await mount();
    expect(screen.queryByTestId('monitor-help-panel')).toBeNull();
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the panel (FR-093)', () => {
  it('explains Components and Projects, the two columns, sorting and bar colour, the mouse and the keys', async () => {
    await mount();
    fireEvent.click(button());

    const text = panel().textContent ?? '';
    expect(panel()).toHaveAttribute('role', 'dialog');
    expect(button()).toHaveAttribute('aria-pressed', 'true');
    for (const heading of ['Components and Projects', 'Two columns', 'Sorted by', 'Bar colour', 'The mouse', 'The keys', 'Amber and red']) {
      expect(within(panel()).getByRole('heading', { name: heading }), heading).toBeInTheDocument();
    }
    expect(text).toMatch(/Components.*throng itself/s);
    expect(text).toMatch(/Projects.*what each project is running/s);
    expect(text).toMatch(/Click a row to select it/);
    expect(text).toMatch(/Double-click a row to open it/);
    expect(text).not.toMatch(/tile|chart|drill-down button/i);
    expect(text).toMatch(/right-click or Shift\+F10/i);
    expect(text).toMatch(/Enter or Right/);
    expect(text).toMatch(/Left or Backspace/);
    expect(text).toMatch(/Esc/);
  });

  it('describes each component in the words its row’s hover title uses (FR-102)', async () => {
    await mount();
    fireEvent.click(button());
    const section = within(panel()).getByTestId('monitor-help-components');
    for (const id of ['ui', 'daemon', 'helpers', 'projects'] as const) {
      expect(section.textContent, id).toContain(COMPONENT_DESCRIPTIONS[id]);
    }
  });

  it('names the metric the rows are sorted by now, and what the bar colour is a share of', async () => {
    await mount();
    act(() => setView({ metric: 'memory' }));
    fireEvent.click(button());
    expect(within(panel()).getByTestId('monitor-help-sorted-by')).toHaveTextContent('Memory');
    expect(within(panel()).getByTestId('monitor-help-bar-colour')).toHaveTextContent(/installed memory/i);
  });

  it('shows the thresholds currently set in Preferences', async () => {
    await mount({ cpuWarningPercent: 40, cpuCriticalPercent: 70, memoryWarningPercent: 55, memoryCriticalPercent: 85 });
    fireEvent.click(button());
    const amberRed = within(panel()).getByTestId('monitor-help-bands');
    await waitFor(() => expect(amberRed).toHaveTextContent('40%'));
    expect(amberRed).toHaveTextContent('70%');
    expect(amberRed).toHaveTextContent('55%');
    expect(amberRed).toHaveTextContent('85%');
  });

  it('draws the Back glyph from the theme, not as a literal', async () => {
    await mount();
    fireEvent.click(button());
    expect(panel().querySelector('.icon')).not.toBeNull();
  });
});

describe('focus and closing (FR-093)', () => {
  it('moves focus into the panel when it opens', async () => {
    await mount();
    fireEvent.click(button());
    expect(panel().contains(document.activeElement)).toBe(true);
  });

  it('closes on Esc and puts focus back on the button, without closing the window', async () => {
    await mount();
    fireEvent.click(button());

    // The window closes on an Esc nobody handled; this one is handled (default prevented), so it does not.
    const notPrevented = fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(notPrevented).toBe(false);
    expect(screen.queryByTestId('monitor-help-panel')).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it('closes when the button is pressed again, focus staying on it', async () => {
    await mount();
    const user = userEvent.setup();
    await user.click(button());
    expect(panel()).toBeInTheDocument();

    await user.click(button());

    expect(screen.queryByTestId('monitor-help-panel')).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it('closes on a click anywhere else, and leaves focus where that click put it', async () => {
    await mount();
    const user = userEvent.setup();
    await user.click(button());

    await user.click(screen.getByTestId('monitor-metric-memory'));

    expect(screen.queryByTestId('monitor-help-panel')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('monitor-metric-memory'));
  });
});

describe('placement (the shared floating-surface rules: flip and clamp)', () => {
  it('opens below the button, and right-aligns to it rather than leave the window', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isPanel = this.getAttribute('data-testid') === 'monitor-help-panel';
      // The button sits at the right edge of the window; the panel is wider than the room to its right.
      const box = isPanel ? { left: 0, top: 0, width: 360, height: 300 } : this.getAttribute('data-testid') === 'monitor-help' ? { left: 960, top: 10, width: 26, height: 26 } : { left: 0, top: 0, width: 0, height: 0 };
      return { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}) } as DOMRect;
    });
    await mount();

    fireEvent.click(button());

    // Flipped to right-align with the button (986 − 360), and below it (36 + the gap).
    expect(panel().style.left).toBe('626px');
    expect(parseFloat(panel().style.top)).toBeGreaterThanOrEqual(36);
    expect(panel().style.visibility).not.toBe('hidden');
  });
});
