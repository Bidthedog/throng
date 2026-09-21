/**
 * #419 — the explorer leaves a row that is already in full view where it is.
 *
 * The real-layout half (two scrollbars, a list at its bottom, a double-click that has to land) is
 * `explorer-bottom-click.e2e.ts`. This is the decision on its own: which reveal requests reach
 * react-arborist's scroll and which are answered by "it is already on screen".
 */
import { describe, expect, it, vi } from 'vitest';
import {
  guardVisibleRowScroll,
  rowFullyVisible,
  type ScrollableTree,
} from '../../src/renderer/explorer/visible-row-scroll.js';

const ROW = 24;

function tree(scrollTop: number, clientHeight: number) {
  const inner = vi.fn(() => Promise.resolve());
  const api: ScrollableTree = {
    scrollTo: inner,
    idToIndex: { top: 0, middle: 10, last: 59, above: 43 },
    rowHeight: ROW,
    listEl: { current: { scrollTop, clientHeight } as HTMLElement },
  };
  guardVisibleRowScroll(api);
  return { api, inner };
}

describe('rowFullyVisible', () => {
  it('is true only for a row entirely inside the real viewport', () => {
    const el = { scrollTop: 100, clientHeight: 200 } as HTMLElement;
    expect(rowFullyVisible(el, 5, ROW)).toBe(true); // 120–144
    expect(rowFullyVisible(el, 4, ROW)).toBe(false); // 96–120, its top is above
    expect(rowFullyVisible(el, 12, ROW)).toBe(false); // 288–312, its bottom is below
  });
});

describe('guardVisibleRowScroll (#419)', () => {
  it('does not scroll to the last row of a list already at its true bottom', async () => {
    // 60 rows of 24 = 1440; a 400px viewport less a horizontal scrollbar leaves 392, so the true
    // bottom is 1048 — past react-window's idea of the last offset (1040), which is the defect.
    const { api, inner } = tree(1048, 392);
    await api.scrollTo('last');
    await api.scrollTo({ id: 'last' });
    expect(inner).not.toHaveBeenCalled();
  });

  it('still scrolls to a row that is off screen or cut by an edge', async () => {
    const { api, inner } = tree(1048, 392);
    await api.scrollTo('top');
    await api.scrollTo('above'); // 1032–1056: cut by the viewport's top edge at 1048
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('passes through what it cannot place', async () => {
    const { api, inner } = tree(0, 392);
    await api.scrollTo('unknown-id');
    expect(inner).toHaveBeenCalledWith('unknown-id', undefined);
  });

  it('still reveals a visible row horizontally (#220), without the vertical scroll', async () => {
    const { api, inner } = tree(0, 392);
    const horizontal = vi.fn();
    api.get = (id) => ({ id });
    api.scrollToNodeHorizontally = horizontal;
    await api.scrollTo('middle');
    expect(inner).not.toHaveBeenCalled();
    expect(horizontal).toHaveBeenCalledWith({ id: 'middle' });
  });

  it('wraps once however many times it is installed', async () => {
    const { api, inner } = tree(0, 392);
    guardVisibleRowScroll(api);
    await api.scrollTo('middle');
    await api.scrollTo('last');
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
