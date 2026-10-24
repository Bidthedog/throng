/**
 * The divider between the monitor's two columns (055 FR-111): dragged with the pointer captured, or moved
 * 5% per Left or Right while focused. The ratio is clamped so each column keeps a quarter of the width, and
 * it is part of the view, so the monitor reopens with it where it was left (FR-087).
 *
 * A drag reads the columns' box once, at pointer-down, and then only does arithmetic per move: nothing is
 * measured per input beyond the render it causes (Principle XII).
 */
import { useRef, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import { SPLIT_MAX, SPLIT_MIN, SPLIT_STEP, clampSplit, getView, setView, useSplitRatio } from './monitor-session.js';

export function ColumnDivider(): ReactElement {
  const splitRatio = useSplitRatio();
  const drag = useRef<{ left: number; width: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const columns = e.currentTarget.closest('.monitor-body__columns');
    const box = columns?.getBoundingClientRect();
    if (box === undefined || box.width <= 0) return;
    drag.current = { left: box.left, width: box.width };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null) return;
    setView({ splitRatio: clampSplit((e.clientX - d.left) / d.width) });
  };
  const end = (e: PointerEvent<HTMLDivElement>): void => {
    if (drag.current === null) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === 'ArrowLeft' ? -SPLIT_STEP : e.key === 'ArrowRight' ? SPLIT_STEP : 0;
    if (step === 0) return;
    e.preventDefault();
    setView({ splitRatio: clampSplit(getView().splitRatio + step) });
  };

  return (
    <div
      className="column-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the columns"
      aria-valuemin={SPLIT_MIN * 100}
      aria-valuemax={SPLIT_MAX * 100}
      aria-valuenow={Math.round(splitRatio * 100)}
      tabIndex={0}
      data-testid="monitor-divider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={() => (drag.current = null)}
      onKeyDown={onKeyDown}
    />
  );
}
