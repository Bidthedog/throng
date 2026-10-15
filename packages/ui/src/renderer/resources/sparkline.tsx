/**
 * A row's sparkline (055 FR-060): one metric's recent history as a tiny canvas polyline — no library, and
 * no inline artwork (SC-002). Draws nothing until there are two points, because one point is not a trend.
 *
 * The stroke is the theme's: the element's CSS `color` is `var(--throng-colour-accent)` (theme.css), read
 * back with `getComputedStyle` when it is drawn, so a theme's value reaches the canvas without a literal
 * colour here. It is drawn once per ingest `version`, not per render, and is not redrawn for a theme
 * switch alone (the next frame, two seconds on, is).
 */
import { memo, useLayoutEffect, useRef, type ReactElement } from 'react';
import { metricNumber, type FigureId } from './figures.js';
import { getHistory } from './monitor-session.js';

/** The CSS box (`.sparkline` in theme.css); the canvas's backing store is this times the pixel ratio. */
const W = 90;
const H = 18;
const LINE_WIDTH = 1.5;

export interface SparklinePoint {
  readonly x: number;
  readonly y: number;
}

export function sparklinePoints(values: readonly number[], width: number, height: number): SparklinePoint[] | null {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  return values.map((v, i) => ({
    x: (i / (values.length - 1)) * width,
    // A flat series is a line through the middle, not a line along the floor that reads as "zero".
    y: span === 0 ? height / 2 : height - 1 - ((v - lo) / span) * (height - 2),
  }));
}

function draw(canvas: HTMLCanvasElement, points: readonly SparklinePoint[]): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const ratio = window.devicePixelRatio || 1;
  const pixelW = Math.round(W * ratio);
  const pixelH = Math.round(H * ratio);
  // Assigning a size clears the canvas and reallocates it: only when it actually changed.
  if (canvas.width !== pixelW) canvas.width = pixelW;
  if (canvas.height !== pixelH) canvas.height = pixelH;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = window.getComputedStyle(canvas).color;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** `version` is the session's ingest counter: the line is redrawn once per frame, not per render. */
function SparklineView({ nodeId, metric, version }: { nodeId: string; metric: FigureId; version: number }): ReactElement | null {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const points = sparklinePoints(getHistory(nodeId).map((p) => metricNumber(p.rolled, metric)), W, H);
  const hasLine = points !== null;
  useLayoutEffect(() => {
    if (ref.current !== null && points !== null) draw(ref.current, points);
    // `version` stands for the history the points were read from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, metric, nodeId, hasLine]);
  if (points === null) return null;
  return <canvas ref={ref} className="sparkline" data-testid={`sparkline-${nodeId}`} width={W} height={H} aria-hidden="true" />;
}

export const Sparkline = memo(SparklineView);
