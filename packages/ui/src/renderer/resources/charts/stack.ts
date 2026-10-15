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

/** Two charts are the same chart, only longer, when they stack the same bands in the same order. */
export function stackKey(chart: StackedChart): string {
  return chart.series.map((s) => s.id).join('|');
}
