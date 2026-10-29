/**
 * The status-bar item's popover (055 FR-115): CPU, Memory, GPU and I/O together, each throng's total, its
 * split by component (FR-042) and a mini line graph of the total. It replaces the native hover title, which
 * the browser closes and reopens whenever its text changes — at every capture.
 *
 * ══ IT UPDATES IN PLACE ══
 *
 * It renders from the summary the item already reads, so a capture re-renders its text and redraws its
 * graphs without remounting. It never moves: every line it can ever show is reserved (the stale line, each
 * figure's note), its width is fixed in CSS and its position is measured once per open, not per capture.
 *
 * ══ A FLOATING SURFACE ══
 *
 * Portaled to the body (the status bar clips), placed by the shared {@link useAnchoredPosition} (it flips
 * above the bar and clamps), held invisible until placed. Unlike the attention popover it takes the pointer
 * (`pointer-events: auto`): it stays open while the pointer is over it, so a click inside it is its own and
 * must not reach the item (the caller renders it as the item's sibling for that reason).
 *
 * The graphs are canvases drawn from the {@link StatusPoint} ring: CPU, Memory and GPU as a percentage of
 * the machine (0 – 100), I/O on a scale fitted to the ring's peak. Fewer than two points shows the spinner
 * (FR-114); a figure whose latest share is absent — no capacity to divide by — shows only its number.
 */
import { useLayoutEffect, useRef, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { isUnavailable, type ComponentId } from '@throng/core';
import type { ResourceSummary } from '@throng/ipc-contract';
import { useAnchoredPosition } from '../common/use-anchored-position.js';
import { FIGURE_LABEL, componentFigureText, type Figure, type StatusFigureId } from './figures.js';
import { LoadingSpinner } from './sparkline.js';
import { ioScale, seriesOf, type StatusPoint } from './status-history.js';

const COMPONENT_LABEL: Readonly<Record<ComponentId, string>> = {
  ui: 'UI',
  daemon: 'Daemon',
  helpers: 'Helpers',
  projects: 'Projects',
};

/** The CSS box of one mini graph (`.status-popover__plot` in theme.css). */
const GRAPH_W = 340;
const GRAPH_H = 28;

/** What a figure's note line says, if anything: why it is unavailable, or why a total is partial (FR-044). */
function noteFor(f: Figure): string {
  if (isUnavailable(f.value)) return f.value.reason;
  return f.partial !== undefined ? `Partial: ${f.partial}` : '';
}

function totalText(f: Figure): string {
  return f.band ? `${f.text} (${f.band})` : f.text;
}

/** Draw `series` into `canvas`: absent points break the line; shares are 0 – 100, I/O is 0 – `ceiling`. */
function drawSeries(canvas: HTMLCanvasElement, series: readonly (number | undefined)[], ceiling: number): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  // The box it is drawn in (100% of the popover's width): a buffer of any other size is stretched into it.
  const width = canvas.clientWidth || GRAPH_W;
  const ratio = window.devicePixelRatio || 1;
  const pixelW = Math.round(width * ratio);
  const pixelH = Math.round(GRAPH_H * ratio);
  if (canvas.width !== pixelW) canvas.width = pixelW;
  if (canvas.height !== pixelH) canvas.height = pixelH;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, GRAPH_H);
  ctx.beginPath();
  let pen = false;
  series.forEach((v, i) => {
    if (v === undefined) {
      pen = false;
      return;
    }
    const x = (i / Math.max(1, series.length - 1)) * width;
    const fraction = ceiling > 0 ? Math.min(1, Math.max(0, v / ceiling)) : 0;
    const y = GRAPH_H - 1 - fraction * (GRAPH_H - 2);
    if (pen) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
  });
  ctx.strokeStyle = window.getComputedStyle(canvas).color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function MiniGraph({ id, points }: { id: StatusFigureId; points: readonly StatusPoint[] }): ReactElement | null {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const series = seriesOf(points, id);
  // Shares are a percentage of the machine; I/O is fitted to the recent peak.
  const ceiling = id === 'io' ? ioScale(series) : 100;
  const known = points.length >= 2 && series[series.length - 1] !== undefined;

  useLayoutEffect(() => {
    if (ref.current && known) drawSeries(ref.current, series, ceiling);
  });

  if (points.length < 2) {
    return (
      <div className="status-popover__building" data-testid={`status-popover-${id}-building`}>
        <LoadingSpinner />
      </div>
    );
  }
  // No capacity to divide by (or no reading): the number alone, in the graph's reserved box.
  if (!known) return <div className="status-popover__plot status-popover__plot--none" aria-hidden="true" />;
  return <canvas ref={ref} className="status-popover__plot" data-testid={`status-popover-${id}-graph`} width={GRAPH_W} height={GRAPH_H} aria-hidden="true" />;
}

export interface StatusPopoverProps {
  readonly anchor: HTMLElement | null;
  readonly summary: ResourceSummary;
  readonly figures: readonly (Figure & { readonly id: StatusFigureId })[];
  readonly points: readonly StatusPoint[];
  readonly id: string;
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
}

export function StatusPopover({ anchor, summary, figures, points, id, onPointerEnter, onPointerLeave }: StatusPopoverProps): ReactElement | null {
  // Constant: the popover's size does not depend on a capture, so a capture never re-places it.
  const { ref, pos } = useAnchoredPosition<HTMLDivElement>(anchor, 'status');
  if (!anchor) return null;

  return createPortal(
    <div
      ref={ref}
      id={id}
      className="status-popover"
      data-testid="status-popover"
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <p className="status-popover__action" data-testid="status-popover-action">
        Click to open the Resource Monitor
      </p>
      <p className="status-popover__stale" data-testid="status-popover-stale">
        {summary.stale ? 'Last reading — the latest collection failed' : ' '}
      </p>
      {figures.map((f) => (
        <section key={f.id} className="status-popover__figure" data-testid={`status-popover-${f.id}`} data-band={f.band}>
          <div className="status-popover__head">
            <span className="status-popover__name">{FIGURE_LABEL[f.id]}</span>
            <span className="status-popover__total" data-testid={`status-popover-${f.id}-total`}>
              {totalText(f)}
            </span>
          </div>
          <ul className="status-popover__split" data-testid={`status-popover-${f.id}-split`}>
            {summary.components.map((c) => (
              <li key={c.id} className="status-popover__part">
                <span className="status-popover__part-name">{COMPONENT_LABEL[c.id]}</span>{' '}
                <span className="status-popover__part-value">{componentFigureText(f.id, c.rolled)}</span>
              </li>
            ))}
          </ul>
          <MiniGraph id={f.id} points={points} />
          <p className="status-popover__note" data-testid={`status-popover-${f.id}-note`}>
            {noteFor(f) || ' '}
          </p>
        </section>
      ))}
    </div>,
    document.body,
  );
}
