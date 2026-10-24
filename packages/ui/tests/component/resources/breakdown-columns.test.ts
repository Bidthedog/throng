/**
 * The left list never scrolls sideways (055 FR-106, US2 scenario 26): when it is too narrow for every
 * column, figure columns drop off the right edge one at a time — the Order-by column last — and a marker
 * at the end of the header names what is hidden. Widening brings them back.
 *
 * Layer: component — the real `Breakdown` over the real session. jsdom has no layout, so the list's width
 * is handed to it the way a real window does: through the `ResizeObserver` it watches, stubbed here. Which
 * columns fit a width is core's `fitColumns` (its own unit test); what is claimed here is that the list
 * draws exactly that set — headers, cells and the Total alike — and says what it left out.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NAME_COLUMN_MIN_WIDTH } from '@throng/core';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { __resetSession, ingestFrame, setView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

type Observed = { el: Element; cb: ResizeObserverCallback };
let observed: Observed[] = [];
const realObserver = globalThis.ResizeObserver;

class StubObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(el: Element): void {
    observed.push({ el, cb: this.cb });
  }
  unobserve(): void {}
  disconnect(): void {
    observed = observed.filter((o) => o.cb !== this.cb);
  }
}

/** Make the list `width` pixels wide, as a window resize or the divider would. */
function resizeTo(width: number): void {
  act(() => {
    for (const { el, cb } of observed) {
      Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
      cb([{ target: el, contentRect: { width } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    }
  });
}

beforeEach(() => {
  observed = [];
  globalThis.ResizeObserver = StubObserver as unknown as typeof ResizeObserver;
  __resetSession();
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  act(() => ingestFrame(frame(1, sampleHierarchy())));
});
afterEach(() => {
  globalThis.ResizeObserver = realObserver;
  __resetSession();
});

const headerIds = (): string[] =>
  within(screen.getByTestId('breakdown-columns-components'))
    .queryAllByTestId(/^breakdown-column-/)
    .map((el) => el.getAttribute('data-column') ?? '');
const cellIds = (rowId: string): string[] =>
  Array.from(screen.getByTestId(`breakdown-row-${rowId}`).querySelectorAll('[data-metric]')).map((el) => el.getAttribute('data-metric') ?? '');
const marker = (): HTMLElement | null => screen.queryByTestId('breakdown-columns-hidden');

describe('columns that do not fit drop off the right (FR-106)', () => {
  it('shows every column, and no marker, when the list is wide enough', () => {
    render(createElement(Breakdown));
    resizeTo(1600);
    expect(headerIds()).toEqual(['trend', 'cpu', 'memory', 'gpu', 'io', 'network']);
    expect(cellIds('c:ui')).toEqual(['cpu', 'memory', 'gpu', 'io', 'network']);
    expect(marker()).toBeNull();
  });

  it('drops from the right one at a time as it narrows, the rows and the Total with the headers', () => {
    render(createElement(Breakdown));
    resizeTo(1600);
    const seen: string[][] = [];
    for (let width = 1600; width >= NAME_COLUMN_MIN_WIDTH; width -= 10) {
      resizeTo(width);
      const ids = headerIds();
      if (seen.length === 0 || seen.at(-1)!.length !== ids.length) seen.push(ids);
    }
    // Each step loses exactly one column, and it is the rightmost but the Order-by one (CPU).
    for (let i = 1; i < seen.length; i += 1) {
      const before = seen[i - 1]!;
      const rightmost = before.filter((id) => id !== 'cpu').at(-1) ?? 'cpu';
      expect(seen[i]).toEqual(before.filter((id) => id !== rightmost));
    }
    // The Order-by column is the last to go: alone before the name has the list to itself.
    expect(seen.at(-2)).toEqual(['cpu']);
    const visibleFigures = headerIds().filter((id) => id !== 'trend');
    expect(cellIds('c:ui')).toEqual(visibleFigures);
    expect(Array.from(screen.getByTestId('breakdown-total-components').querySelectorAll('[data-metric]')).map((el) => el.getAttribute('data-metric'))).toEqual(visibleFigures);
  });

  it('keeps the Order-by column to last', () => {
    act(() => setView({ metric: 'network' }));
    render(createElement(Breakdown));
    resizeTo(NAME_COLUMN_MIN_WIDTH + 100);
    expect(headerIds()).toContain('network');
  });

  it('marks the header when columns are hidden, naming them and saying how to see them', () => {
    render(createElement(Breakdown));
    resizeTo(NAME_COLUMN_MIN_WIDTH + 260);
    const m = marker();
    expect(m).not.toBeNull();
    const title = m!.getAttribute('title') ?? '';
    expect(title).toContain('Network');
    expect(title).toContain('Widen the list or the window to see them');
    // The marker is the header's last thing, at its right end.
    expect(screen.getByTestId('breakdown-columns-components').lastElementChild).toBe(m);
  });

  it('brings the columns back when the list is widened again', () => {
    render(createElement(Breakdown));
    resizeTo(NAME_COLUMN_MIN_WIDTH + 100);
    expect(headerIds()).not.toContain('network');
    resizeTo(1600);
    expect(headerIds()).toEqual(['trend', 'cpu', 'memory', 'gpu', 'io', 'network']);
    expect(marker()).toBeNull();
  });

  it('builds the grid from the visible columns, the name column first with its minimum width', () => {
    render(createElement(Breakdown));
    resizeTo(NAME_COLUMN_MIN_WIDTH + 100);
    const template = screen.getByTestId('breakdown').style.getPropertyValue('--breakdown-columns');
    expect(template.startsWith(`minmax(${NAME_COLUMN_MIN_WIDTH}px, 1fr)`)).toBe(true);
    // One track for the name and one per visible column — nothing for a dropped one to overflow into.
    expect(template.trim().split(/\s+(?![^(]*\))/)).toHaveLength(1 + headerIds().length);
  });

  it('never scrolls sideways: the list hides horizontal overflow, and every grid reads the template', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8');
    expect(/\.breakdown\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/overflow-x:\s*hidden/);
    for (const selector of ['.breakdown__columns', '.breakdown-row', '.breakdown-total']) {
      const body = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(body, selector).toMatch(/grid-template-columns:\s*var\(--breakdown-columns/);
    }
  });
});
