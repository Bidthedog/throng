/**
 * The monitor's help (055 FR-093): a "?" icon control in the toolbar opens a popover explaining
 * what the monitor is (FR-119: a short disclaimer and a line or two per part, in the app's popover style; the
 * detail lives in the "?" helpers, info-helper.test.ts). Esc or the button closes it; focus goes in on open and back to the button
 * on close; and it sits on the shared floating-surface rules (flips and clamps against the viewport).
 *
 * Layer: component — the real toolbar over the real config store (settings faked at `window.throng.config`).
 * That the popover is registered as a floating surface is `unit/floating-surfaces.test.ts`'s.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Fragment, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { HELP_DISCLAIMER, HELP_SECTIONS } from '../../../src/renderer/resources/helper-copy.js';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { __resetSession, ingestFrame, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { HelpControl, ToolbarControls } from '../../../src/renderer/resources/toolbar.js';
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
  render(createElement(ConfigProvider, null, createElement(Fragment, null, createElement(HelpControl), createElement(ToolbarControls))));
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
    expect(within(screen.getByTestId('monitor-controls')).queryByTestId('monitor-help')).toBeNull();
  });

  it('is closed until it is pressed', async () => {
    await mount();
    expect(screen.queryByTestId('monitor-help-panel')).toBeNull();
    expect(button()).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the panel (FR-093, FR-119)', () => {
  it('opens with a short disclaimer: the figures are representative of how throng\u2019s parts compare, not exact', async () => {
    await mount();
    fireEvent.click(button());
    expect(panel()).toHaveAttribute('role', 'dialog');
    expect(button()).toHaveAttribute('aria-pressed', 'true');
    const disclaimer = within(panel()).getByTestId('monitor-help-disclaimer');
    expect(disclaimer).toHaveTextContent(/representative/i);
    expect(disclaimer).toHaveTextContent(/not exact/i);
    expect(panel().firstElementChild).toBe(disclaimer);
  });

  it('then has one or two lines each on the toolbar, the filter, the left column, the right column and the hierarchy', async () => {
    await mount();
    fireEvent.click(button());
    const names = ['Toolbar', 'Filter', 'Left column', 'Right column', 'Hierarchy'];
    const headings = within(panel()).getAllByRole('heading');
    expect(headings.map((h) => h.textContent)).toEqual(names);
    for (const name of names) {
      const section = within(panel()).getByTestId(`monitor-help-section-${name.toLowerCase().replace(' ', '-')}`);
      const sentences = (section.querySelector('p')?.textContent ?? '').split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, name).toBeGreaterThanOrEqual(1);
      expect(sentences.length, name).toBeLessThanOrEqual(2);
    }
  });

  it('is short: the old reference sections (keys, mouse, bar colour, thresholds) are gone, their detail in the helpers', async () => {
    await mount();
    fireEvent.click(button());
    const text = panel().textContent ?? '';
    for (const heading of ['The keys', 'The mouse', 'Bar colour', 'Amber and red', 'Going to it', 'The divider']) {
      expect(within(panel()).queryByRole('heading', { name: heading }), heading).toBeNull();
    }
    expect(text.length).toBeLessThan(1200);
    expect(text).not.toMatch(/tile|chart|drill-down button/i);
  });

  it('names the hierarchy in the words the components\u2019 own hover titles use', async () => {
    await mount();
    fireEvent.click(button());
    const text = within(panel()).getByTestId('monitor-help-section-hierarchy').textContent ?? '';
    expect(text).toMatch(/Components/);
    expect(text).toMatch(/Projects/);
  });

  it('draws its words from the one copy table the helpers use', async () => {
    await mount();
    fireEvent.click(button());
    const text = panel().textContent ?? '';
    expect(text).toContain(HELP_DISCLAIMER);
    for (const section of HELP_SECTIONS) expect(text, section.title).toContain(section.text);
  });

  it('is in the popover style with no glow (FR-119)', async () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8').replace(/\r\n/g, '\n');
    // The panel's own rule is the last `.monitor-help {`; the first is the shared surface it is grouped into.
    const own = [...css.matchAll(/\n\.monitor-help\s*\{([^}]*)\}/g)].pop()?.[1] ?? '';
    expect(own).toMatch(/width:/);
    expect(own).not.toMatch(/color-mix/);
    expect(own).not.toMatch(/box-shadow/);
    expect(own).not.toMatch(/background/);
    // The surface itself is the attention popover's, shared in one rule.
    expect(/\n((?:\.[\w-]+,\n)*\.attention-popover(?:,\n\.[\w-]+)*)\s*\{/.exec(css)?.[1] ?? '').toContain('.monitor-help');
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
