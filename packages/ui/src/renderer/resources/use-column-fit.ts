/**
 * Which of the left list's columns fit its width (055 FR-106, research R17): the list never scrolls
 * sideways — figure columns drop off the right edge one at a time, the Order-by column last, and come back
 * when the list is widened. WHICH columns fit is core's `fitColumns`; this measures the list and builds
 * the grid's track list from what fits, so a row cannot overflow by construction.
 *
 * ══ ON RESIZE ONLY (Principle XII) ══
 *
 * The width is read by a `ResizeObserver` — a window resize or the divider (FR-111) — and the answer is
 * re-worked when the Order-by metric changes, nothing else. State is set only when the visible set
 * actually changes, so dragging the divider across a column's worth of pixels re-renders the list once,
 * not once per pixel.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { NAME_COLUMN_MIN_WIDTH, fitColumns, type FitColumn } from '@throng/core';
import { FIGURE_ORDER, type FigureId } from './figures.js';
import { SPLIT_DEFAULT, clampSplit } from './monitor-session.js';

/** A column of the left list after the name: the trend sparkline, then the figures. */
export type ColumnId = 'trend' | FigureId;

export const COLUMN_ORDER: readonly ColumnId[] = ['trend', ...FIGURE_ORDER];

/** Each column's track, in pixels: wide enough for its widest figure ("1,023.9 MB/s" fits in 72). */
const TRACK_PX: Readonly<Record<ColumnId, number>> = { trend: 90, cpu: 56, memory: 64, gpu: 56, io: 72, network: 72 };

/** The grid's gap between tracks, and the row's own horizontal padding (theme.css `.breakdown-row`). */
const GAP_PX = 8;
const ROW_PADDING_PX = 12;

/** The divider's own grid track between the columns (theme.css `.monitor-body__columns`): not the left column's. */
export const DIVIDER_PX = 8;

/** Room left for the scrollbar a list that scrolls shows inside the left column, so it never costs a figure column. */
export const SCROLLBAR_SLACK_PX = 16;

const FIT: readonly FitColumn<ColumnId>[] = COLUMN_ORDER.map((id) => ({ id, width: TRACK_PX[id] + GAP_PX }));

/**
 * The width the left column needs to show EVERY figure column (CPU, Memory, GPU, I/O, Network — not the
 * trend, which is the first to go) beside the name column's minimum (FR-116). The tracks are fixed, so it
 * does not depend on what a cell reads, Network's "-" included.
 */
export const FIGURE_FIT_WIDTH_PX =
  ROW_PADDING_PX + NAME_COLUMN_MIN_WIDTH + FIGURE_ORDER.reduce((sum, id) => sum + TRACK_PX[id] + GAP_PX, 0) + SCROLLBAR_SLACK_PX;

/**
 * Where the divider opens when no position was restored (FR-116): the left column's share of
 * `columnsWidth` that holds {@link FIGURE_FIT_WIDTH_PX}, rounded UP to a whole percent so it is enough,
 * and held to the divider's range so the right column keeps its minimum. With no width to go by, the default.
 */
export function openingSplitRatio(columnsWidth: number): number {
  if (!Number.isFinite(columnsWidth) || columnsWidth <= 0) return SPLIT_DEFAULT;
  // The columns share what the divider's track leaves: the left is ratio × (width − divider).
  return clampSplit(Math.ceil((FIGURE_FIT_WIDTH_PX / Math.max(1, columnsWidth - DIVIDER_PX)) * 100) / 100);
}

export interface ColumnFit {
  /** The columns drawn, in display order. */
  readonly visible: readonly ColumnId[];
  /** The columns dropped, in display order — the header marker names them. */
  readonly hidden: readonly ColumnId[];
  /** The grid's `grid-template-columns`: the name first, at its minimum, then one track per visible column. */
  readonly template: string;
}

function templateFor(visible: readonly ColumnId[]): string {
  return [`minmax(${NAME_COLUMN_MIN_WIDTH}px, 1fr)`, ...visible.map((id) => `${TRACK_PX[id]}px`)].join(' ');
}

const ALL: ColumnFit = { visible: COLUMN_ORDER, hidden: [], template: templateFor(COLUMN_ORDER) };

function fit(width: number, orderBy: FigureId): ColumnFit {
  const { visible, hidden } = fitColumns(width - ROW_PADDING_PX, FIT, orderBy);
  return { visible, hidden, template: templateFor(visible) };
}

const same = (a: ColumnFit, b: ColumnFit): boolean => a.visible.length === b.visible.length && a.visible.every((id, i) => id === b.visible[i]);

/**
 * The columns that fit the element `ref` holds. `attached` says the element is in the DOM (the list
 * renders nothing before its first capture). Without a `ResizeObserver` every column is shown.
 */
export function useColumnFit(ref: RefObject<HTMLElement | null>, orderBy: FigureId, attached: boolean): ColumnFit {
  const [state, setState] = useState<ColumnFit>(ALL);
  const width = useRef<number | null>(null);
  const order = useRef(orderBy);
  order.current = orderBy;

  const refit = useRef((): void => {
    if (width.current === null) return;
    const next = fit(width.current, order.current);
    setState((prev) => (same(prev, next) ? prev : next));
  });

  useEffect(() => {
    const el = ref.current;
    if (!attached || el === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      width.current = el.clientWidth;
      refit.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, attached]);

  useEffect(() => refit.current(), [orderBy]);

  return state;
}
