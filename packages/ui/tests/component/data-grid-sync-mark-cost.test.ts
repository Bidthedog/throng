/**
 * 073 T075 — moving the sync mark in a big grid changes the row it leaves and the row it lands on, and nothing else. The
 * mark moves once a frame while either view scrolls, so a grid that remounted or rewrote its window each time would make
 * scrolling a large CSV in step slow (the maintainer's report). Rows and cells are memoised on what they draw, so a mark
 * move is two class changes: no row or cell is created, removed or rewritten, and every other row keeps its DOM node.
 *
 * Layer: component — the shared grid over 10,000 rows, watched with a MutationObserver.
 */
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataGrid, type DataGridProps } from '../../src/renderer/grid/data-grid.js';

afterEach(() => void vi.restoreAllMocks());

function mount(over: Partial<DataGridProps> = {}) {
  const props: DataGridProps = {
    testId: 'grid',
    rowCount: 10_000,
    colCount: 6,
    getCell: (r, c) => `r${r}c${c}`,
    editable: true,
    columnWidths: {},
    zoom: 1,
    onColumnWidthChange: () => {},
    ...over,
  };
  const utils = render(createElement(DataGrid, props));
  const root = utils.container;
  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.data-grid__row')];
  /** What one re-render changed: the rows whose attributes moved, and every node added or removed anywhere. */
  function changes(next: Partial<DataGridProps>): { attributeRows: number[]; childListChanges: number; kept: boolean } {
    const before = rows();
    const seen = new Set<Element>();
    let childList = 0;
    const mo = new MutationObserver(() => {});
    mo.observe(root, { subtree: true, attributes: true, childList: true });
    utils.rerender(createElement(DataGrid, { ...props, ...next }));
    for (const r of mo.takeRecords()) {
      if (r.type === 'childList') childList += r.addedNodes.length + r.removedNodes.length;
      else if (r.target instanceof HTMLElement) seen.add(r.target.closest('.data-grid__row') ?? r.target);
    }
    mo.disconnect();
    const after = rows();
    return {
      attributeRows: [...seen].map((el) => Number(el.getAttribute('aria-rowindex')) - 2).sort((a, b) => a - b),
      childListChanges: childList,
      kept: before.length === after.length && before.every((el, i) => el === after[i]),
    };
  }
  return { rows, changes };
}

describe('a sync mark that moves changes two rows of a 10,000-row grid', () => {
  it('the window is many rows (the bounds below are not vacuous)', () => {
    expect(mount({ syncMarkRow: { row: 3, on: true } }).rows().length).toBeGreaterThan(10);
  });

  it('moving the mark from one visible row to another changes those two rows and creates or removes nothing', () => {
    const m = mount({ syncMarkRow: { row: 3, on: true } });
    expect(m.changes({ syncMarkRow: { row: 7, on: true } })).toEqual({ attributeRows: [3, 7], childListChanges: 0, kept: true });
  });

  it('fading the mark (on to off) changes the one row that carries it', () => {
    const m = mount({ syncMarkRow: { row: 3, on: true } });
    expect(m.changes({ syncMarkRow: { row: 3, on: false } })).toEqual({ attributeRows: [3], childListChanges: 0, kept: true });
  });

  it('a mark appearing, and one going, each change one row', () => {
    const m = mount({ syncMarkRow: null });
    expect(m.changes({ syncMarkRow: { row: 5, on: true } })).toEqual({ attributeRows: [5], childListChanges: 0, kept: true });
    expect(m.changes({ syncMarkRow: null })).toEqual({ attributeRows: [5], childListChanges: 0, kept: true });
  });

  it('a mark moving to a row outside the rendered window changes only the row it leaves', () => {
    const m = mount({ syncMarkRow: { row: 3, on: true } });
    expect(m.changes({ syncMarkRow: { row: 9_000, on: true } })).toEqual({ attributeRows: [3], childListChanges: 0, kept: true });
  });

  it('a hundred mark moves each change at most two rows', () => {
    const m = mount({ syncMarkRow: { row: 0, on: true } });
    for (let i = 1; i <= 100; i += 1) {
      const c = m.changes({ syncMarkRow: { row: i % 20, on: true } });
      expect(c.attributeRows.length).toBeLessThanOrEqual(2);
      expect(c.childListChanges).toBe(0);
      expect(c.kept).toBe(true);
    }
  });
});
