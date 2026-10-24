/**
 * The four figures the status-bar item can show (055 FR-040) — which they are, how each is read off a
 * `Metrics`, which band it falls in, and which survive a narrow bar (FR-045).
 */
import {
  NETWORK_ELEVATION_REQUIRED,
  NETWORK_TRACE_FAILED,
  bandFor,
  isUnavailable,
  type MachineInfo,
  type MetricValue,
  type Metrics,
  type ResourceNode,
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
  return typeof v === 'number' ? null : networkReason(v);
}

/**
 * Why Network reads "-", in FR-113's words. A failed trace is "Network unavailable"; one that needs
 * elevation is "Elevate to show". A figure that is merely NOT MEASURED says the same as the machine it is
 * on: unelevated, elevating is what would measure it; elevated, it is simply not measured (T182) — never
 * "unavailable", which would claim the trace failed.
 */
function networkReason(v: Exclude<MetricValue, number>, unelevated = false): string {
  if (isUnavailable(v)) return v.reason === NETWORK_ELEVATION_REQUIRED ? 'Elevate to show' : 'Network unavailable';
  return unelevated ? 'Elevate to show' : 'Not measured';
}

/**
 * Whether throng is running unelevated, as the capture says: the root's Network is unavailable for want of
 * elevation, or a part of it is (FR-113). `null` (no capture yet) is not evidence of either.
 */
export function isUnelevated(root: { readonly rolled: Metrics } | null): boolean {
  if (root === null) return false;
  const v = root.rolled.network;
  return (isUnavailable(v) && v.reason === NETWORK_ELEVATION_REQUIRED) || root.rolled.partial?.network === NETWORK_ELEVATION_REQUIRED;
}

/**
 * A partial total's reason as words (FR-044): the network trace's two codes read as its "-" title does
 * (FR-113); any other reason is already a sentence and is left alone.
 */
function partialReason(reason: string | undefined): string | undefined {
  if (reason === NETWORK_ELEVATION_REQUIRED) return 'Elevate to show';
  if (reason === NETWORK_TRACE_FAILED) return 'Network unavailable';
  return reason;
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
  /**
   * The monitor's hover title for the figure (FR-107): its column, and why it reads "-" or "~". Set by
   * {@link monitorFigure}; never the figure itself (FR-095).
   */
  readonly title?: string;
  /** Why it reads "-" (the reason) or "~" ("Estimated"), for a surface that words its own title. */
  readonly note?: string;
}

/** What the monitor writes for a figure that is not a number (FR-107): the reason is the title's. */
export const NOT_SHOWN_TEXT = '-';
/** What the monitor writes before an estimate (FR-107). */
export const ESTIMATE_MARK = '~';

/**
 * A figure as the monitor writes it (FR-107): "-" for one that is not measured or unavailable, its reason
 * in the title; "~" before an estimate — a node's estimate is its memory (R9) — with "Estimated" in the
 * title. Network's reasons are FR-113's words. The status bar keeps its own wording.
 */
export function monitorFigure(f: Figure, estimated: boolean, unelevated = false): Figure {
  const label = FIGURE_LABEL[f.id];
  if (typeof f.value !== 'number') {
    if (f.id === 'network') {
      const note = networkReason(f.value, unelevated);
      return { ...f, text: NOT_SHOWN_TEXT, title: note, note };
    }
    const note = isUnavailable(f.value) ? f.value.reason : 'Not measured';
    return { ...f, text: NOT_SHOWN_TEXT, title: `${label}: ${note}`, note };
  }
  if (estimated && f.id === 'memory') return { ...f, text: `${ESTIMATE_MARK}${f.text}`, title: `${label}: Estimated`, note: 'Estimated' };
  return { ...f, title: f.partial !== undefined ? `${label} — partial: ${f.partial}` : label };
}

/** A metric of `m` as the monitor charts and orders it: I/O is read plus write. */
export function metricValue(m: Metrics, id: FigureId): MetricValue {
  return id === 'io' ? combineIo(m).value : m[id];
}

/**
 * Whether a figure has no line to draw, ever (T180, FR-107): it is unavailable, or it is not measured on a
 * node with no process anywhere under it — an editor or preview panel, Terminal buffers — which nothing
 * will ever measure. A not-measured figure on a process (a first sighting has no rate yet) WILL become a
 * number, so it is loading, not missing.
 */
export function neverDrawn(value: MetricValue, node: ResourceNode): boolean {
  if (typeof value === 'number') return false;
  return isUnavailable(value) || !hasProcess(node);
}

function hasProcess(node: ResourceNode): boolean {
  return node.kind === 'process' || node.children.some(hasProcess);
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
      partial: partialReason(io.partial),
    };
  }
  const value = m[id];
  return {
    id,
    value,
    text: formatMetric(id, value),
    // Network, like I/O, has no threshold of its own: its heat is against the session's peak (FR-094).
    band: id === 'network' ? undefined : bandFor(id, value, thresholds, machine),
    partial: partialReason(m.partial?.[id]),
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
