/**
 * 073 FR-040, FR-006a — a CSV's stored column widths and Reset Column Width's persisted removal.
 * Layer: component — the hook is React state plus a debounced write through `DocumentClient`; the daemon's
 * own storage of the map is integration's. A fake `documents` service shows what is written and when.
 */
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider, type Services } from '../../src/renderer/composition-root.js';
import { __resetColumnWidthCache, useGridColumnWidths } from '../../src/renderer/preview/providers/csv/column-widths.js';
import { settleLayoutSaves } from '../../src/renderer/state/layout-saves.js';

vi.mock('../../src/renderer/state/projects-store.js', () => ({
  useProjectsOptional: () => ({ projects: [{ id: 'proj', rootFolder: 'D:/proj' }] }),
}));

const FILE = 'D:/proj/data.csv';

describe('useGridColumnWidths', () => {
  let setGridColumnWidths: ReturnType<typeof vi.fn>;
  let wrapper: (p: { children: ReactNode }) => ReturnType<typeof createElement>;

  beforeEach(() => {
    vi.useFakeTimers();
    setGridColumnWidths = vi.fn(async () => ({}));
    const services = {
      documents: { getState: vi.fn(async () => null), setGridColumnWidths },
    } as unknown as Services;
    wrapper = ({ children }) => createElement(ServicesProvider, { services, children });
  });

  afterEach(() => {
    __resetColumnWidthCache();
    vi.useRealTimers();
  });

  it('resetWidth forgets one column\'s stored width and persists the removal', async () => {
    const { result } = renderHook(() => useGridColumnWidths('D:/proj', FILE), { wrapper });
    act(() => {
      result.current.setWidth(0, 200);
      result.current.setWidth(2, 300);
    });
    act(() => {
      result.current.resetWidth(0);
    });
    expect(result.current.widths).toEqual({ 2: 300 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(setGridColumnWidths).toHaveBeenCalledTimes(1);
    expect(setGridColumnWidths).toHaveBeenLastCalledWith('proj', 'data.csv', { 2: 300 });
  });

  /*
   * FR-040 (convergence T091) — a width is shared by every panel showing the file, a sub-workspace window's too. The
   * cache is per window, so a grid mounting for the file reads the stored widths again rather than trusting what this
   * window read before; a width this window has yet to write wins over the read.
   */
  it('a grid mounting for the file reads widths another window stored since', async () => {
    const getState = vi.fn(async () => ({ gridColumnWidths: { 0: 100 } }));
    const services = { documents: { getState, setGridColumnWidths } } as unknown as Services;
    const wrap = ({ children }: { children: ReactNode }) => createElement(ServicesProvider, { services, children });
    const first = renderHook(() => useGridColumnWidths('D:/proj', FILE), { wrapper: wrap });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(first.result.current.widths).toEqual({ 0: 100 });
    first.unmount();

    // Another window widened column A and stored it.
    getState.mockResolvedValue({ gridColumnWidths: { 0: 250 } });
    const second = renderHook(() => useGridColumnWidths('D:/proj', FILE), { wrapper: wrap });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(second.result.current.widths).toEqual({ 0: 250 });
  });

  it('a width this window has yet to write is kept over a stored one read meanwhile', async () => {
    const getState = vi.fn(async () => ({ gridColumnWidths: { 0: 100 } }));
    const services = { documents: { getState, setGridColumnWidths } } as unknown as Services;
    const wrap = ({ children }: { children: ReactNode }) => createElement(ServicesProvider, { services, children });
    const first = renderHook(() => useGridColumnWidths('D:/proj', FILE), { wrapper: wrap });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => first.result.current.setWidth(0, 300));
    const second = renderHook(() => useGridColumnWidths('D:/proj', FILE), { wrapper: wrap });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(second.result.current.widths).toEqual({ 0: 300 });
  });

  it('resetting the last stored width clears the file\'s map (null), not an empty one', async () => {
    const { result } = renderHook(() => useGridColumnWidths('D:/proj', FILE), { wrapper });
    act(() => {
      result.current.setWidth(1, 250);
    });
    act(() => {
      result.current.resetWidth(1);
    });
    expect(result.current.widths).toEqual({});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(setGridColumnWidths).toHaveBeenLastCalledWith('proj', 'data.csv', null);
  });

  /*
   * FR-040 — kept across a restart. The MT-04 walk-through (2026-11-21) closed throng moments after a drag and the
   * width came back at its default: the write waits out its debounce, and the window's shutdown drain (019 FR-010)
   * did not know about it, so the window closed with it unwritten.
   */
  it('the shutdown drain stores a width dragged moments before the window closes', async () => {
    const { result } = renderHook(() => useGridColumnWidths('D:/proj', FILE), { wrapper });
    act(() => {
      result.current.setWidth(1, 200);
    });
    await act(async () => {
      await settleLayoutSaves();
    });
    expect(setGridColumnWidths, 'the drain settled with the width still unwritten').toHaveBeenCalledWith('proj', 'data.csv', { 1: 200 });
    // And the debounce does not write it a second time.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(setGridColumnWidths).toHaveBeenCalledTimes(1);
  });
});
