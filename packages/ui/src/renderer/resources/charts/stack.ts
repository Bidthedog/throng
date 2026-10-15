/**
 * Data for a stacked time-series (055 FR-060): uPlot stacks nothing itself, so each series is handed
 * pre-summed — the first band alone, the second band on top of it, and so on — and the bands between
 * consecutive series are what is filled. The top series is therefore the node's rolled-up figure.
 */
import type { StackedChart } from '../monitor-session.js';

/** `[x, band 1, band 1 + 2, band 1 + 2 + 3, …]`, x in seconds since the epoch. */
export function stackData(chart: StackedChart): number[][] {
  const x = chart.at.map((ms) => ms / 1000);
  const running = new Array<number>(x.length).fill(0);
  const columns = chart.series.map((s) => {
    for (let i = 0; i < running.length; i += 1) running[i] = (running[i] ?? 0) + (s.values[i] ?? 0);
    return [...running];
  });
  return [x, ...columns];
}

/**
 * Two charts are the same chart, only longer or about another node, when they stack as many bands: the
 * options hold nothing else that differs (a band's colour is its place, its name is the legend's — not
 * uPlot's). So only a change in the number of bands rebuilds a chart; anything else is fed with `setData`.
 */
export function stackKey(chart: StackedChart): string {
  return String(chart.series.length);
}
