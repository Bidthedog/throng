/**
 * The "?" helpers (055 FR-119): a small themeable icon control beside Order by, Hide idle, Hide ended, the
 * capture interval, Held folders, the Total row and the "-" / "~" markers, each opening one or two short
 * sentences from one copy table. Each has an accessible name and NO hover title (sixth feedback); it opens on click, Enter or
 * Space and closes on Esc, a second click or a click elsewhere [derived].
 *
 * Layer: component — the real helpers in the real toolbar, list and Held folders over the real session.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THRONG_THEME } from '@throng/core';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { HeldFolders } from '../../../src/renderer/resources/held-folders.js';
import { HELPER_COPY, HELPER_TOPICS, type HelperTopic } from '../../../src/renderer/resources/helper-copy.js';
import { InfoHelper } from '../../../src/renderer/resources/info-helper.js';
import { ConfigProvider } from '../../../src/renderer/config/config-store.js';
import { __resetSession, ingestFrame, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { ToolbarControls } from '../../../src/renderer/resources/toolbar.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

beforeEach(() => {
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  act(() => ingestFrame(frame(1, sampleHierarchy())));
  window.throng = {
    config: {
      get: () => Promise.resolve({ settings: { resourceMonitor: {} }, theme: THRONG_THEME }),
      onChange: () => () => {},
      writePatch: () => Promise.resolve({ ok: true }),
    },
  } as unknown as typeof window.throng;
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'throng');
  __resetSession();
});

const helper = (topic: HelperTopic): HTMLElement => screen.getByTestId(`info-helper-${topic}`);
const popover = (): HTMLElement => screen.getByTestId('info-helper-popover');

async function mountAll(): Promise<void> {
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(Fragment, null, createElement(ToolbarControls), createElement(Breakdown), createElement(HeldFolders)),
    ),
  );
  await waitFor(() => expect(screen.getByTestId('monitor-interval')).toBeInTheDocument());
}

describe('the copy table (FR-119)', () => {
  it('has one or two short sentences for every topic', () => {
    expect([...HELPER_TOPICS].sort()).toEqual(['heldFolders', 'hideEnded', 'hideIdle', 'interval', 'marks', 'orderBy', 'totalRow']);
    for (const topic of HELPER_TOPICS) {
      const copy = HELPER_COPY[topic];
      expect(copy.title.length, topic).toBeGreaterThan(0);
      const sentences = copy.text.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, `${topic}: ${copy.text}`).toBeGreaterThanOrEqual(1);
      expect(sentences.length, `${topic}: ${copy.text}`).toBeLessThanOrEqual(2);
    }
  });
});

describe('where the helpers are', () => {
  it('sit beside Order by, Hide idle, Hide ended and the capture interval in the toolbar', async () => {
    await mountAll();
    const controls = within(screen.getByTestId('monitor-controls'));
    for (const topic of ['orderBy', 'hideIdle', 'hideEnded', 'interval'] as const) {
      expect(controls.getByTestId(`info-helper-${topic}`), topic).toBeInTheDocument();
    }
  });

  it('sit beside Held folders, the Total row and the "-" / "~" markers', async () => {
    await mountAll();
    expect(within(screen.getByTestId('held-folders')).getByTestId('info-helper-heldFolders')).toBeInTheDocument();
    expect(within(screen.getByTestId('breakdown-total-components')).getByTestId('info-helper-totalRow')).toBeInTheDocument();
    expect(within(screen.getByTestId('breakdown')).getByTestId('info-helper-marks')).toBeInTheDocument();
  });

  it('are in the Tab order right after what they explain', async () => {
    await mountAll();
    const order = within(screen.getByTestId('monitor-controls'))
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-testid'));
    expect(order.indexOf('info-helper-hideIdle')).toBe(order.indexOf('monitor-hide-idle') + 1);
    expect(order.indexOf('info-helper-hideEnded')).toBe(order.indexOf('monitor-hide-ended') + 1);
  });
});

describe('each helper is a themeable icon control (FR-119)', () => {
  it.each(HELPER_TOPICS.map((t) => [t]))('%s has an accessible name and no native title and the theme\'s help glyph', async (topic) => {
    await mountAll();
    const el = helper(topic);
    expect(el.tagName).toBe('BUTTON');
    expect(el).not.toHaveAttribute('title');
    expect(el.querySelector('[title]')).toBeNull();
    expect(el).toHaveAttribute('aria-label', HELPER_COPY[topic].title);
    expect(screen.getByRole('button', { name: HELPER_COPY[topic].title })).toBe(el);
    expect(el).toHaveTextContent((THRONG_THEME.icons as Record<string, string>).help!);
    expect(el).toHaveAttribute('aria-expanded', 'false');
    expect(el).not.toHaveAttribute('aria-pressed');
  });
});

describe('opening and closing [derived]', () => {
  it.each(HELPER_TOPICS.map((t) => [t]))('%s opens its sentences on click', async (topic) => {
    await mountAll();
    expect(screen.queryByTestId('info-helper-popover')).toBeNull();
    fireEvent.click(helper(topic));
    expect(popover()).toHaveTextContent(HELPER_COPY[topic].text);
    expect(helper(topic)).toHaveAttribute('aria-expanded', 'true');
  });

  it('is a disclosure a screen reader can follow: aria-expanded, and its words described by the popover while open', async () => {
    await mountAll();
    expect(helper('orderBy')).not.toHaveAttribute('aria-describedby');
    fireEvent.click(helper('orderBy'));
    const id = popover().getAttribute('id');
    expect(id).toBeTruthy();
    expect(helper('orderBy')).toHaveAttribute('aria-describedby', id);
    fireEvent.click(helper('orderBy'));
    expect(helper('orderBy')).not.toHaveAttribute('aria-describedby');
    expect(helper('orderBy')).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when the thing it floats beside scrolls, rather than hang where it was', async () => {
    await mountAll();
    fireEvent.click(helper('heldFolders'));
    expect(popover()).toBeInTheDocument();
    fireEvent.scroll(screen.getByTestId('held-folders'));
    expect(screen.queryByTestId('info-helper-popover')).toBeNull();
  });

  it('opens on Enter and on Space', async () => {
    await mountAll();
    const user = userEvent.setup();
    helper('orderBy').focus();
    await user.keyboard('{Enter}');
    expect(popover()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('info-helper-popover')).toBeNull();
    await user.keyboard(' ');
    expect(popover()).toBeInTheDocument();
  });

  it('closes on Esc, and the focus stays on the helper', async () => {
    await mountAll();
    const user = userEvent.setup();
    await user.click(helper('hideIdle'));
    expect(popover()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('info-helper-popover')).toBeNull();
    expect(document.activeElement).toBe(helper('hideIdle'));
  });

  it('handles Esc itself, so the window does not close with it', async () => {
    await mountAll();
    fireEvent.click(helper('orderBy'));
    const notPrevented = fireEvent.keyDown(helper('orderBy'), { key: 'Escape' });
    expect(notPrevented).toBe(false);
  });

  it('closes on a second click', async () => {
    await mountAll();
    const user = userEvent.setup();
    await user.click(helper('interval'));
    await user.click(helper('interval'));
    expect(screen.queryByTestId('info-helper-popover')).toBeNull();
  });

  it('closes on a click elsewhere', async () => {
    await mountAll();
    const user = userEvent.setup();
    await user.click(helper('hideEnded'));
    await user.click(screen.getByTestId('monitor-metric-memory'));
    expect(screen.queryByTestId('info-helper-popover')).toBeNull();
  });

  it('shows one at a time: opening another closes the first', async () => {
    await mountAll();
    const user = userEvent.setup();
    await user.click(helper('hideIdle'));
    await user.click(helper('hideEnded'));
    expect(screen.getAllByTestId('info-helper-popover')).toHaveLength(1);
    expect(popover()).toHaveTextContent(HELPER_COPY.hideEnded.text);
  });

  it('does not act on what it explains: pressing it leaves Hide idle as it was', async () => {
    await mountAll();
    fireEvent.click(helper('hideIdle'));
    expect(screen.getByTestId('monitor-hide-idle')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('dismissal (FR-119, sixth feedback)', () => {
  it('closes when the window loses focus: a click in any other throng window', async () => {
    await mountAll();
    fireEvent.click(helper('orderBy'));
    expect(popover()).toBeInTheDocument();
    fireEvent.blur(window);
    expect(screen.queryByTestId('info-helper-popover')).toBeNull();
  });

  it('closes when the page is hidden', async () => {
    await mountAll();
    fireEvent.click(helper('orderBy'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      fireEvent(document, new Event('visibilitychange'));
      expect(screen.queryByTestId('info-helper-popover')).toBeNull();
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('closes on a press anywhere in the monitor, in the capture phase, even where the target stops propagation', async () => {
    await mountAll();
    fireEvent.click(helper('hideIdle'));
    const stopper = document.createElement('div');
    stopper.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(stopper);
    fireEvent.pointerDown(stopper);
    expect(screen.queryByTestId('info-helper-popover')).toBeNull();
    stopper.remove();
  });

  it('marks the window while a helper is open, so the title bar can give up its drag region, and clears it on every way out', async () => {
    await mountAll();
    expect(document.documentElement).not.toHaveAttribute('data-helper-open');
    fireEvent.click(helper('orderBy'));
    expect(document.documentElement).toHaveAttribute('data-helper-open');
    fireEvent.click(helper('orderBy'));
    expect(document.documentElement).not.toHaveAttribute('data-helper-open');

    fireEvent.click(helper('orderBy'));
    fireEvent.keyDown(helper('orderBy'), { key: 'Escape' });
    expect(document.documentElement).not.toHaveAttribute('data-helper-open');

    fireEvent.click(helper('orderBy'));
    cleanup();
    expect(document.documentElement).not.toHaveAttribute('data-helper-open');
  });

  it('keeps the mark while a second helper replaces the first, and clears it when the last closes', async () => {
    await mountAll();
    const user = userEvent.setup();
    await user.click(helper('hideIdle'));
    await user.click(helper('hideEnded'));
    expect(document.documentElement).toHaveAttribute('data-helper-open');
    await user.keyboard('{Escape}');
    expect(document.documentElement).not.toHaveAttribute('data-helper-open');
  });

  it('gives the title bar\'s drag region up while the mark is there: a drag region delivers no DOM press, so it could never dismiss', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/title-bar/title-bar.css'), 'utf8').replace(/\r\n/g, '\n');
    const rule = /\[data-helper-open\][^{]*\{([^}]*)\}/.exec(css);
    expect(rule, 'no rule for an open helper').not.toBeNull();
    expect(rule?.[0]).toContain('.title-bar');
    expect(rule?.[0]).toContain('.title-bar__drag-zone');
    expect(rule?.[1]).toMatch(/-webkit-app-region:\s*no-drag/);
  });
});

describe('placement: superscript and close to its subject (sixth feedback)', () => {
  const rule = (selector: string): string => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8').replace(/\r\n/g, '\n');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  };

  it('raises the "?" and makes it small, with no margin of its own pushing it away', () => {
    const body = rule('.info-helper');
    expect(body).toMatch(/vertical-align:\s*(super|top)/);
    expect(body).toMatch(/margin:\s*0/);
    expect(Number(/width:\s*(\d+)px/.exec(body)?.[1])).toBeLessThanOrEqual(14);
    expect(Number(/height:\s*(\d+)px/.exec(body)?.[1])).toBeLessThanOrEqual(14);
  });

  it('sits right after its subject at every call site: no gap, no spacer text between them', async () => {
    await mountAll();
    for (const topic of ['heldFolders', 'totalRow'] as const) {
      const previous = helper(topic).previousSibling;
      // The subject's own text may end in one space at most; nothing wider than the glyph is added.
      expect(previous?.textContent ?? '', topic).not.toMatch(/\s{2,}/);
    }
  });
});

describe('the popup\'s look (FR-119: the app\'s standard popup style, no glow)', () => {
  it('is a floating surface in the attention popover\'s style, not a glow', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8').replace(/\r\n/g, '\n');
    const shared = /\n((?:\.[\w-]+,\n)*\.attention-popover(?:,\n\.[\w-]+)*)\s*\{/.exec(css)?.[1] ?? '';
    expect(shared).toContain('.info-helper-popover');
    expect(shared).toContain('.monitor-help');
    expect(shared).toContain('.status-popover');
  });

  it('renders in the body, so no scroll container clips it', async () => {
    await mountAll();
    fireEvent.click(helper('heldFolders'));
    expect(popover().parentElement).toBe(document.body);
  });
});

describe('InfoHelper on its own', () => {
  it('renders nothing but its control until opened', () => {
    render(createElement(InfoHelper, { topic: 'marks' }));
    expect(helper('marks')).toBeInTheDocument();
    expect(screen.queryByTestId('info-helper-popover')).toBeNull();
  });
});
