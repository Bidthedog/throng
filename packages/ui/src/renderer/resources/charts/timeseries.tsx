/**
 * The time-series charts (055 FR-060, FR-067, research R10): one uPlot per metric for the node in focus,
 * stacked by its children. In the lazy `resources` chunk with the other chart library — the monitor's
 * body is a dynamic import, so uPlot costs startup nothing (Principle XII).
 *
 * ══ FED, NOT REBUILT ══
 *
 * A frame appends a point: the chart is handed the longer data with `setData`. It is rebuilt only when
 * the bands themselves change (the focus moved, or a new process appeared under it), and torn down on
 * unmount — uPlot owns a canvas and listeners that React will not clean up.
 *
 * ══ COLOUR IS THE THEME'S ══
 *
 * A series' stroke is a function, so uPlot asks at DRAW time and the answer is whatever the theme's CSS
 * variable holds then. A theme change clears the cache and schedules one redraw; the new tokens are
 * applied by the theme provider after this component's own effects, which is why nothing is read
 * eagerly. No literal colour appears here (FR-067).
 */
import { useCallback, useEffect, useMemo, useRef, type ReactElement } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useActiveTheme } from '../../config/config-store.js';
import { FIGURE_LABEL, type FigureId } from '../figures.js';
import { formatBytes, formatPercent, formatRate } from '../format.js';
import { stackedSeries, useSession, type StackedChart } from '../monitor-session.js';
import { useElementSize } from '../use-size.js';
import { stackData, stackKey } from './stack.js';

/** Series colours, in order, as theme tokens: distinguishable in the light and dark themes alike. */
const SERIES_TOKENS = ['accent', 'success', 'syntaxNumber', 'syntaxType', 'syntaxFunction', 'syntaxKeyword', 'syntaxString', 'warning'] as const;

const FALLBACK = { width: 480, height: 140 } as const;

function formatAxis(metric: FigureId, value: number): string {
  switch (metric) {
    case 'cpu':
    case 'gpu':
      return formatPercent(value);
    case 'memory':
      return formatBytes(value);
    case 'io':
      return formatRate(value);
  }
}

/** The CSS variable a theme token is published as. */
function readToken(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--throng-colour-${token}`).trim();
}

function options(chart: StackedChart, metric: FigureId, colour: (token: string) => string, size: { width: number; height: number }): uPlot.Options {
  const token = (i: number): string => SERIES_TOKENS[i % SERIES_TOKENS.length]!;
  const series: uPlot.Series[] = [
    {},
    ...chart.series.map(
      (s, i): uPlot.Series => ({
        label: s.label,
        stroke: () => colour(token(i)),
        // Only the lowest band fills to the axis; the others fill down to the band beneath (below).
        fill: i === 0 ? () => `color-mix(in srgb, ${colour(token(i))} 35%, transparent)` : undefined,
        width: 1,
        points: { show: false },
      }),
    ),
  ];
  const bands: uPlot.Band[] = chart.series.slice(1).map((_, i) => ({
    // uPlot's series 0 is the x axis, so band k fills series k+2 down to series k+1.
    series: [i + 2, i + 1],
    fill: () => `color-mix(in srgb, ${colour(token(i + 1))} 35%, transparent)`,
  }));
  const axis = (): uPlot.Axis => ({
    stroke: () => colour('textMuted'),
    grid: { stroke: () => colour('border'), width: 1 },
    ticks: { stroke: () => colour('border'), width: 1 },
  });
  return {
    width: size.width,
    height: size.height,
    legend: { show: false },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    cursor: { show: false },
    scales: { y: { range: (_u, _min, max) => [0, Math.max(max * 1.1, 1)] } },
    axes: [axis(), { ...axis(), size: 64, values: (_u, splits) => splits.map((v) => formatAxis(metric, v)) }],
    series,
    bands,
  };
}

function Timeseries({ focusId, metric, version }: { focusId: string; metric: FigureId; version: number }): ReactElement {
  const theme = useActiveTheme();
  const host = useRef<HTMLDivElement | null>(null);
  const chart = useRef<uPlot | null>(null);
  const built = useRef('');
  const cache = useRef(new Map<string, string>());
  const [watch, size] = useElementSize<HTMLDivElement>(FALLBACK);

  const colour = useCallback((token: string): string => {
    let value = cache.current.get(token);
    if (value === undefined) {
      value = readToken(token);
      cache.current.set(token, value);
    }
    return value;
  }, []);

  // `version` is the session's ingest counter: the history this reads moved when it did.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stack = useMemo(() => stackedSeries(focusId, metric), [focusId, metric, version]);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // Feed the chart; rebuild it only when its bands changed.
  useEffect(() => {
    const target = host.current;
    if (target === null) return;
    if (stack.ticks.length === 0 || stack.series.length === 0) {
      chart.current?.destroy();
      chart.current = null;
      built.current = '';
      return;
    }
    const key = stackKey(stack);
    const data = stackData(stack);
    if (chart.current !== null && built.current === key) {
      chart.current.setData(data as uPlot.AlignedData);
      return;
    }
    chart.current?.destroy();
    chart.current = new uPlot(options(stack, metric, colour, sizeRef.current), data as uPlot.AlignedData, target);
    built.current = key;
  }, [stack, metric, colour]);

  // The element was resized.
  useEffect(() => {
    chart.current?.setSize({ width: size.width, height: size.height });
  }, [size.width, size.height]);

  // A theme change: forget the colours read, and redraw once the new tokens are on the root.
  useEffect(() => {
    cache.current.clear();
    const u = chart.current;
    if (u === null) return;
    const frame = requestAnimationFrame(() => u.redraw());
    return () => cancelAnimationFrame(frame);
  }, [theme]);

  // uPlot owns a canvas and listeners of its own.
  useEffect(
    () => () => {
      chart.current?.destroy();
      chart.current = null;
      built.current = '';
    },
    [],
  );

  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      host.current = el;
      return watch(el);
    },
    [watch],
  );

  return (
    <figure className="timeseries" data-testid={`timeseries-${metric}`} role="img" aria-label={`${FIGURE_LABEL[metric]} over time`}>
      <figcaption className="timeseries__title">{FIGURE_LABEL[metric]}</figcaption>
      <div ref={attach} className="timeseries__plot" />
    </figure>
  );
}

const METRICS: readonly FigureId[] = ['cpu', 'memory', 'gpu', 'io'];

/** The four charts for the node in focus. */
export function TimeseriesCharts({ focusId }: { focusId: string }): ReactElement {
  const { version } = useSession();
  return (
    <div className="timeseries-group" data-testid="timeseries">
      {METRICS.map((metric) => (
        <Timeseries key={metric} focusId={focusId} metric={metric} version={version} />
      ))}
    </div>
  );
}

export default TimeseriesCharts;
