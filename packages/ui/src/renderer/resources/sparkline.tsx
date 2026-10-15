/**
 * A row's sparkline (055 FR-060): one metric's recent history as a tiny canvas polyline — no library, and
 * no inline artwork (SC-002). One point is not a trend, so with fewer than two it says it is building its
 * history (FR-091) rather than show nothing.
 *
 * ══ WHAT IT COSTS, PER CAPTURE ══
 *
 * With four hundred rows, anything a sparkline does per capture it does four hundred times (D5):
 *
 *  - NO REACT WORK. A sparkline is drawn into its canvas by ONE listener on the session, not by four
 *    hundred components re-rendering: the row mounts a canvas once and `paintAll` walks the canvases that
 *    are on screen after each ingest. (A component per row subscribing to the ingest counter drew 900
 *    elements per capture only to find the DOM unchanged.) What a sparkline's component DOES follow is
 *    whether it has two points yet, which flips once;
 *  - the stroke is the theme's — the element's CSS `color` is `var(--throng-colour-accent)` (theme.css) —
 *    and is READ ONCE PER CAPTURE, for all of them (`getComputedStyle` forces a style recalculation); a
 *    theme switch reaches the canvas with the next capture;
 *  - only a sparkline that is ON SCREEN is drawn (one shared `IntersectionObserver`; the rows below the
 *    fold of a long list cost nothing), and a hidden one does not even gather its points.
 */
import { memo, useCallback, useSyncExternalStore, type ReactElement } from 'react';
import { metricNumber, type FigureId } from './figures.js';
import { getHistory, getSessionSnapshot, subscribeSession } from './monitor-session.js';

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

/** The stroke colour, read from the first canvas drawn after each capture and reused for the rest. */
const stroke: { frame: unknown; colour: string } = { frame: undefined, colour: '' };

function strokeColour(canvas: HTMLCanvasElement): string {
  const frame = getSessionSnapshot().frame;
  if (stroke.frame !== frame || stroke.colour === '') {
    stroke.colour = window.getComputedStyle(canvas).color;
    stroke.frame = frame;
  }
  return stroke.colour;
}

function draw(canvas: HTMLCanvasElement, points: readonly SparklinePoint[], width: number, height: number): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const ratio = window.devicePixelRatio || 1;
  const pixelW = Math.round(width * ratio);
  const pixelH = Math.round(height * ratio);
  // Assigning a size clears the canvas and reallocates it: only when it actually changed.
  if (canvas.width !== pixelW) canvas.width = pixelW;
  if (canvas.height !== pixelH) canvas.height = pixelH;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = strokeColour(canvas);
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ── the canvases on the page ─────────────────────────────────────────────────────────────────────

interface Painted {
  readonly nodeId: string;
  readonly metric: FigureId;
  /** The CSS box it is drawn in: a row's sparkline is small, the right column's line graph larger. */
  readonly width: number;
  readonly height: number;
  /** Whether the canvas is in view. Without an observer (a platform that has none) every one is. */
  visible: boolean;
}

const canvases = new Map<HTMLCanvasElement, Painted>();
let observer: IntersectionObserver | null = null;
let unsubscribe: (() => void) | null = null;

function paint(canvas: HTMLCanvasElement, p: Painted): void {
  if (!p.visible) return;
  const points = sparklinePoints(getHistory(p.nodeId).map((h) => metricNumber(h.rolled, p.metric)), p.width, p.height);
  if (points !== null) draw(canvas, points, p.width, p.height);
}

/** Regions whose sparklines are held still: the list the pointer is over (FR-095). */
const heldRoots = new Set<Element>();

const isHeld = (canvas: HTMLCanvasElement): boolean => {
  for (const root of heldRoots) if (root.contains(canvas)) return true;
  return false;
};

/**
 * Stop redrawing the sparklines inside `root` for each capture, as the figures beside them are held; the
 * returned function lets them go and catches them up at once.
 */
export function holdSparklines(root: Element): () => void {
  heldRoots.add(root);
  return () => {
    heldRoots.delete(root);
    paintAll();
  };
}

/** After each ingest: redraw every sparkline that is on screen. The one subscription all of them share. */
function paintAll(): void {
  for (const [canvas, p] of canvases) {
    if (heldRoots.size > 0 && isHeld(canvas)) continue;
    paint(canvas, p);
  }
}

function onIntersect(entries: readonly { target: Element; isIntersecting: boolean }[]): void {
  for (const entry of entries) {
    const p = canvases.get(entry.target as HTMLCanvasElement);
    if (p === undefined || p.visible === entry.isIntersecting) continue;
    p.visible = entry.isIntersecting;
    // Scrolling into view draws it now, rather than at the next capture.
    paint(entry.target as HTMLCanvasElement, p);
  }
}

function attach(canvas: HTMLCanvasElement, nodeId: string, metric: FigureId, width: number, height: number): () => void {
  const watching = typeof IntersectionObserver !== 'undefined';
  const painted: Painted = { nodeId, metric, width, height, visible: !watching };
  canvases.set(canvas, painted);
  unsubscribe ??= subscribeSession(paintAll);
  if (watching) {
    observer ??= new IntersectionObserver(onIntersect);
    observer.observe(canvas);
  }
  paint(canvas, painted);
  return () => {
    observer?.unobserve(canvas);
    canvases.delete(canvas);
    if (canvases.size === 0) {
      observer?.disconnect();
      observer = null;
      unsubscribe?.();
      unsubscribe = null;
    }
  };
}

/** Whether `nodeId` has the two points a line needs; the one thing a sparkline re-renders for. */
export function useHasLine(nodeId: string): boolean {
  const snapshot = useCallback((): boolean => getHistory(nodeId).length >= 2, [nodeId]);
  return useSyncExternalStore(subscribeSession, snapshot, snapshot);
}

/**
 * A node's recent history for one metric as a canvas polyline, redrawn by the session's one listener. The
 * row's sparkline and the right column's line graph (`line-graph.tsx`) are this at two sizes; a caller
 * decides what to show before there are two points to draw (`useHasLine`).
 */
export function PlotCanvas({
  nodeId,
  metric,
  width,
  height,
  className,
  testId,
}: {
  nodeId: string;
  metric: FigureId;
  width: number;
  height: number;
  className: string;
  testId: string;
}): ReactElement {
  // A ref callback with a cleanup (React 19): attached when the canvas mounts, released when it goes — or
  // when the node, the metric or the size behind it changes, which re-attaches it under the new ones.
  const ref = useCallback(
    (canvas: HTMLCanvasElement | null) => (canvas === null ? undefined : attach(canvas, nodeId, metric, width, height)),
    [nodeId, metric, width, height],
  );
  return <canvas ref={ref} className={className} data-testid={testId} width={width} height={height} aria-hidden="true" />;
}

function SparklineView({ nodeId, metric }: { nodeId: string; metric: FigureId }): ReactElement {
  const hasLine = useHasLine(nodeId);
  if (!hasLine) {
    return (
      <span className="sparkline sparkline--building" data-testid={`sparkline-building-${nodeId}`} title="Building history…">
        Building history…
      </span>
    );
  }
  return <PlotCanvas nodeId={nodeId} metric={metric} width={W} height={H} className="sparkline" testId={`sparkline-${nodeId}`} />;
}

export const Sparkline = memo(SparklineView);
