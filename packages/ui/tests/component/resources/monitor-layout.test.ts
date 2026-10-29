/**
 * The monitor window's body (055 FR-111, FR-112, US2 scenarios 32 and 33): a full-width header — the
 * filter, the toolbar and the breadcrumb with Back — ruled off above the two columns and never scrolling
 * with them; and a divider between the columns, dragged or moved from the keyboard, its place kept in the
 * view.
 *
 * Layer: component — the real window root and real body over the real session; the bridge is faked. jsdom
 * has no layout, so a drag is given the columns' box the way a real window would report it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Fragment, Profiler, createElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Breakdown } from '../../../src/renderer/resources/breakdown.js';
import { ColumnDivider } from '../../../src/renderer/resources/column-divider.js';
import { DetailPane } from '../../../src/renderer/resources/detail-pane.js';
import { DIVIDER_PX, FIGURE_FIT_WIDTH_PX, openingSplitRatio } from '../../../src/renderer/resources/use-column-fit.js';
import { MonitorApp } from '../../../src/renderer/resources/monitor-app.js';
import { __resetSession, getView, ingestFrame, restoreView, startSession } from '../../../src/renderer/resources/monitor-session.js';
import { installResourcesBridge, type ResourcesBridge } from '../helpers/resource-bridge.js';
import { frame, sampleHierarchy } from '../helpers/resource-fixtures.js';

let bridge: ResourcesBridge;

beforeAll(async () => {
  await import('../../../src/renderer/resources/monitor-body.js');
});
beforeEach(() => {
  bridge = installResourcesBridge(null);
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
  __resetSession();
});

async function openWindow(): Promise<void> {
  render(createElement(MonitorApp));
  await act(async () => bridge.pushDetail(frame(1, sampleHierarchy())));
  await screen.findByTestId('breakdown');
}

/** A session with one frame in, for a test that mounts the columns without the window. */
function feedOnly(): void {
  startSession({ intervalSeconds: 2, historyMinutes: 5 });
  act(() => ingestFrame(frame(1, sampleHierarchy())));
}

const divider = (): HTMLElement => screen.getByRole('separator', { name: /resize/i });
const columns = (): HTMLElement => screen.getByTestId('monitor-body-columns');

describe('the header spans both columns and does not scroll (FR-112, scenario 33)', () => {
  it('holds the filter, the toolbar and the breadcrumb with Back, above the two columns', async () => {
    await openWindow();
    const header = screen.getByTestId('monitor-body-header');
    expect(header.contains(screen.getByTestId('monitor-filter'))).toBe(true);
    expect(header.contains(screen.getByTestId('monitor-controls'))).toBe(true);
    expect(header.contains(screen.getByTestId('breadcrumb'))).toBe(true);
    expect(header.contains(screen.getByTestId('breakdown-back'))).toBe(true);
    // Not in either column: the columns are its siblings, after it.
    expect(header.contains(screen.getByTestId('breakdown'))).toBe(false);
    expect(header.contains(screen.getByTestId('detail-pane'))).toBe(false);
    expect(header.compareDocumentPosition(columns()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('the first row (FR-121): <filter> | Updated … (n s ago) | ?', () => {
  it('holds the filter, the "Updated" line and the help button, in that order, above the toolbar', async () => {
    await openWindow();
    const top = await screen.findByTestId('monitor-body-top');
    const filter = within(top).getByTestId('monitor-filter');
    const updated = within(top).getByTestId('monitor-updated');
    const help = within(top).getByTestId('monitor-help');
    const follows = (a: Element, b: Element): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(filter, updated)).toBe(true);
    expect(follows(updated, help)).toBe(true);
    // The toolbar is the second row and no longer carries the general "?".
    const controls = screen.getByTestId('monitor-controls');
    expect(top.contains(controls)).toBe(false);
    expect(follows(top, controls)).toBe(true);
    expect(within(controls).queryByTestId('monitor-help')).toBeNull();
  });

  it('keeps the help button\'s accessible name and behaviour', async () => {
    await openWindow();
    const help = await screen.findByTestId('monitor-help');
    expect(help).toHaveAttribute('title', 'Help');
    expect(help).toHaveAttribute('aria-label', 'Help');
    fireEvent.click(help);
    expect(screen.getByTestId('monitor-help-panel')).toBeInTheDocument();
    fireEvent.click(help);
    expect(screen.queryByTestId('monitor-help-panel')).toBeNull();
  });

  it('lays the row out in three columns: the filter at the left, the line centred, the help right-aligned', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8').replace(/\r\n/g, '\n');
    const row = /\.monitor-body__top\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(row).toMatch(/display:\s*grid/);
    expect(row).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/);
    expect(/\.monitor-body__updated\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/text-align:\s*center/);
    expect(/\.monitor-body__help\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/justify-self:\s*end/);
  });

  it('still says it is collecting before the first reading', async () => {
    render(createElement(MonitorApp));
    expect(await screen.findByTestId('monitor-loading')).toHaveTextContent('Collecting the first reading…');
  });
});

describe('the divider (FR-111, scenario 32)', () => {
  it('is a vertical separator, keyboard-reachable, at 45% to begin with', async () => {
    await openWindow();
    const d = divider();
    expect(d).toHaveAttribute('aria-orientation', 'vertical');
    expect(d).toHaveAttribute('tabindex', '0');
    expect(d).toHaveAttribute('aria-valuenow', '45');
    expect(d).toHaveAttribute('aria-valuemin', '25');
    expect(d).toHaveAttribute('aria-valuemax', '75');
  });

  it('moves 5% per Left or Right, and stops so each column keeps its minimum', async () => {
    await openWindow();
    fireEvent.keyDown(divider(), { key: 'ArrowRight' });
    expect(divider()).toHaveAttribute('aria-valuenow', '50');
    expect(getView().splitRatio).toBeCloseTo(0.5, 5);
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(divider(), { key: 'ArrowLeft' });
    expect(divider()).toHaveAttribute('aria-valuenow', '25');
    for (let i = 0; i < 20; i += 1) fireEvent.keyDown(divider(), { key: 'ArrowRight' });
    expect(divider()).toHaveAttribute('aria-valuenow', '75');
  });

  it('follows a drag with the pointer captured, clamped, and keeps where it was left in the view', async () => {
    await openWindow();
    const box = { left: 100, width: 1000, top: 0, height: 600, right: 1100, bottom: 600, x: 100, y: 0, toJSON: () => ({}) };
    columns().getBoundingClientRect = () => box as DOMRect;
    const captured: number[] = [];
    divider().setPointerCapture = (id: number) => void captured.push(id);
    divider().hasPointerCapture = (id: number) => captured.includes(id);
    divider().releasePointerCapture = () => void captured.splice(0);

    fireEvent.pointerDown(divider(), { pointerId: 7, clientX: 550, button: 0 });
    expect(captured).toEqual([7]);
    fireEvent.pointerMove(divider(), { pointerId: 7, clientX: 700 });
    expect(divider()).toHaveAttribute('aria-valuenow', '60');
    fireEvent.pointerMove(divider(), { pointerId: 7, clientX: 1090 });
    expect(divider()).toHaveAttribute('aria-valuenow', '75');
    fireEvent.pointerUp(divider(), { pointerId: 7, clientX: 1090 });

    expect(getView().splitRatio).toBeCloseTo(0.75, 5);
    // The columns are laid out from the ratio.
    expect(columns().style.getPropertyValue('--monitor-split-left')).toBe('75fr');
    expect(columns().style.getPropertyValue('--monitor-split-right')).toBe('25fr');
  });

  it('moving it re-renders neither column: the list and the detail do not depend on where it sits (review finding 5, Principle XII)', async () => {
    // A drag is a setView per pointermove. Were the columns subscribed to the WHOLE view, each pixel would
    // rebuild the breakdown model (buildBreakdown) and redraw the right column.
    feedOnly();
    let listRenders = 0;
    let detailRenders = 0;
    render(
      createElement(
        Fragment,
        null,
        createElement(Profiler, { id: 'list', onRender: () => void (listRenders += 1) }, createElement(Breakdown)),
        createElement(Profiler, { id: 'detail', onRender: () => void (detailRenders += 1) }, createElement(DetailPane)),
        createElement(ColumnDivider),
      ),
    );
    await screen.findByTestId('breakdown');
    const [list, detail] = [listRenders, detailRenders];
    for (let i = 0; i < 4; i += 1) fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(getView().splitRatio).toBeCloseTo(0.65, 5);
    expect(listRenders - list, 'the list re-rendered for the divider').toBe(0);
    expect(detailRenders - detail, 'the right column re-rendered for the divider').toBe(0);
  });

  describe('opening width (FR-116)', () => {
    const real = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    let width = 1000;
    beforeEach(() => {
      width = 1000;
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('monitor-body__columns') ? width : 0;
        },
      });
    });
    afterEach(() => {
      if (real) Object.defineProperty(HTMLElement.prototype, 'clientWidth', real);
    });

    it('without a restored position, opens where the left column shows every figure column', async () => {
      await openWindow();
      const now = Number(divider().getAttribute('aria-valuenow'));
      expect(now).toBe(Math.round(openingSplitRatio(1000) * 100));
      // The divider's own track comes out of the width before the columns share it.
      expect(now / 100 * (1000 - DIVIDER_PX)).toBeGreaterThanOrEqual(FIGURE_FIT_WIDTH_PX);
      expect(columns().style.getPropertyValue('--monitor-split-left')).toBe(`${now}fr`);
    });

    it('leaves the right column its minimum in a narrow window', async () => {
      width = 600;
      await openWindow();
      expect(divider()).toHaveAttribute('aria-valuenow', '75');
    });

    it('does not save the computed opening position as if the user chose it', async () => {
      await openWindow();
      expect(bridge.savedViews.length).toBeGreaterThan(0);
      for (const v of bridge.savedViews) expect(v, 'a saved view carries the computed ratio').not.toHaveProperty('splitRatio');
    });

    it('saves the position once the divider is moved', async () => {
      await openWindow();
      fireEvent.keyDown(divider(), { key: 'ArrowRight' });
      const expected = Math.round((openingSplitRatio(1000) + 0.05) * 100) / 100;
      expect(bridge.savedViews.at(-1)).toMatchObject({ splitRatio: expected });
    });

    it('recomputes the opening width on a reopen in a narrower window when the divider was never moved', async () => {
      const first = await openWindow().then(() => divider().getAttribute('aria-valuenow'));
      const saved = bridge.savedViews.at(-1);
      cleanup();
      __resetSession();
      width = 800;
      bridge.setStoredView(saved);
      await openWindow();
      expect(first).toBe(String(Math.round(openingSplitRatio(1000) * 100)));
      expect(divider()).toHaveAttribute('aria-valuenow', String(Math.round(openingSplitRatio(800) * 100)));
    });

    it('keeps a restored position, whatever the width', async () => {
      restoreView({ splitRatio: 0.6 });
      await openWindow();
      expect(divider()).toHaveAttribute('aria-valuenow', '60');
    });

    it('keeps a position the user chose, even a default-looking one', async () => {
      restoreView({ splitRatio: 0.45 });
      await openWindow();
      expect(divider()).toHaveAttribute('aria-valuenow', '45');
    });
  });

  it('is where it was left when the monitor is reopened: restored with the view, clamped', async () => {
    restoreView({ splitRatio: 0.6 });
    await openWindow();
    expect(divider()).toHaveAttribute('aria-valuenow', '60');
    act(() => restoreView({ splitRatio: 0.95 }));
    expect(getView().splitRatio).toBe(0.75);
    act(() => restoreView({ splitRatio: 'wide' }));
    expect(getView().splitRatio).toBe(0.75);
  });
});
