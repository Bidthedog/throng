/**
 * The four figures the status-bar item can show (055 FR-040) — which they are, how each is read off a
 * `Metrics`, which band it falls in, and which survive a narrow bar (FR-045).
 */
import {
  NETWORK_ELEVATION_REQUIRED,
  bandFor,
  isUnavailable,
  type MachineInfo,
  type MetricValue,
  type Metrics,
  type UsageBand,
  type UsageThresholds,
} from '@throng/core';
import { METRIC_LABEL, combineIo, formatMetric, formatRate } from './format.js';

/** The figures the monitor shows for a node (FR-113 adds Network); the status bar shows the first four. */
export type FigureId = 'cpu' | 'memory' | 'gpu' | 'io' | 'network';

/** The status bar's figures: Network is the monitor's alone (FR-113 — the status bar is unchanged). */
export type StatusFigureId = Exclude<FigureId, 'network'>;

/** Left to right, as the monitor's columns draw them. */
export const FIGURE_ORDER: readonly FigureId[] = ['cpu', 'memory', 'gpu', 'io', 'network'];

/** Left to right, as the status bar draws them. */
export const STATUS_FIGURE_ORDER: readonly StatusFigureId[] = ['cpu', 'memory', 'gpu', 'io'];

/** First to go as the bar narrows, last to come back (FR-045). */
export const DROP_ORDER: readonly StatusFigureId[] = ['gpu', 'io', 'memory', 'cpu'];

/** The status bar's glyphs and the toolbar's Order by controls (the status bar draws the first four). */
export const FIGURE_ICON: Readonly<Record<FigureId, string>> = {
  cpu: 'resourceCpu',
  memory: 'resourceMemory',
  gpu: 'resourceGpu',
  io: 'resourceIo',
  network: 'resourceNetwork',
};

export const FIGURE_LABEL: Readonly<Record<FigureId, string>> = {
  cpu: METRIC_LABEL.cpu,
  memory: METRIC_LABEL.memory,
  gpu: METRIC_LABEL.gpu,
  io: METRIC_LABEL.io,
  network: METRIC_LABEL.network,
};

/** What each figure counts, for the hover title (FR-012: the label says what is measured). */
export const FIGURE_HINT: Readonly<Record<FigureId, string>> = {
  cpu: 'share of the whole machine',
  memory: 'private working set',
  gpu: 'busiest engine',
  io: 'all file and device I/O, read plus write',
  network: 'bytes sent plus received, TCP and UDP',
};

/**
 * Why Network cannot be shown for `m`, as a hover title — "Elevate to show" while throng is not elevated,
 * "Network unavailable" when the trace failed — or `null` when it is measured (FR-113, FR-099).
 */
export function networkUnavailableTitle(m: Metrics): string | null {
  const v = m.network;
  if (typeof v === 'number') return null;
  return isUnavailable(v) && v.reason === NETWORK_ELEVATION_REQUIRED ? 'Elevate to show' : 'Network unavailable';
}

/**
 * The metric the rows are actually ordered by: the chosen one, except that a chosen Network orders by CPU
 * for as long as Network is not measured (derived from FR-099) — the choice is kept, to return to.
 */
export function orderMetric(chosen: FigureId, root: { readonly rolled: Metrics } | null): FigureId {
  return chosen === 'network' && root !== null && networkUnavailableTitle(root.rolled) !== null ? 'cpu' : chosen;
}

export interface Figure {
  readonly id: FigureId;
  readonly value: MetricValue;
  readonly text: string;
  readonly band: UsageBand | undefined;
  /** Why the total is missing a part (FR-044), if it is. */
  readonly partial: string | undefined;
}

/** A metric of `m` as the monitor charts and orders it: I/O is read plus write. */
export function metricValue(m: Metrics, id: FigureId): MetricValue {
  return id === 'io' ? combineIo(m).value : m[id];
}

/** The number behind {@link metricValue}, or 0 for a figure that is not one (it has no height to draw). */
export function metricNumber(m: Metrics, id: FigureId): number {
  const v = metricValue(m, id);
  return typeof v === 'number' ? v : 0;
}

/** One figure of `m`: I/O is read plus write, the others are the metric itself. */
export function figureOf(
  id: FigureId,
  m: Metrics,
  thresholds: UsageThresholds,
  machine: Pick<MachineInfo, 'installedRamBytes'>,
): Figure {
  if (id === 'io') {
    const io = combineIo(m);
    return {
      id,
      value: io.value,
      text: typeof io.value === 'number' ? formatRate(io.value) : formatMetric('ioRead', io.value),
      band: undefined,
      partial: io.partial,
    };
  }
  const value = m[id];
  return {
    id,
    value,
    text: formatMetric(id, value),
    // Network, like I/O, has no threshold of its own: its heat is against the session's peak (FR-094).
    band: id === 'network' ? undefined : bandFor(id, value, thresholds, machine),
    partial: m.partial?.[id],
  };
}

/** One component's four figures as a single line of the hover breakdown. */
export function breakdownLine(label: string, m: Metrics): string {
  const parts = STATUS_FIGURE_ORDER.map((id) => {
    if (id === 'io') {
      const { value } = combineIo(m);
      const text = typeof value === 'number' ? formatRate(value) : isUnavailable(value) ? 'Unavailable' : 'Not measured';
      return `${FIGURE_LABEL[id]} ${text}`;
    }
    const value = m[id];
    const text = typeof value === 'number' ? formatMetric(id, value) : isUnavailable(value) ? 'Unavailable' : 'Not measured';
    return `${FIGURE_LABEL[id]} ${text}`;
  });
  return `${label}: ${parts.join(', ')}`;
}

/** Pixels the item adds around its figures (padding) and between them. */
export const ITEM_CHROME_PX = 12;
export const FIGURE_GAP_PX = 8;

/**
 * Which figures fit in `budget` pixels, dropping in {@link DROP_ORDER} (FR-045). `widths` are the widest
 * each figure has been seen; a figure never seen counts as zero wide, so an unmeasured bar shows all.
 * Returns the survivors in display order — possibly none, which leaves the icon alone.
 */
export function fitFigures(budget: number, widths: Readonly<Partial<Record<StatusFigureId, number>>>): StatusFigureId[] {
  for (let dropped = 0; dropped <= DROP_ORDER.length; dropped += 1) {
    const gone = new Set<StatusFigureId>(DROP_ORDER.slice(0, dropped));
    const kept = STATUS_FIGURE_ORDER.filter((id) => !gone.has(id));
    if (kept.length === 0) return [];
    const need =
      kept.reduce((sum, id) => sum + (widths[id] ?? 0), 0) + FIGURE_GAP_PX * (kept.length - 1) + ITEM_CHROME_PX;
    if (need <= budget) return kept;
  }
  return [];
}
