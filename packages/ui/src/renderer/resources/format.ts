/**
 * How the resource monitor writes a quantity (055 FR-032): every amount is digit-grouped through the
 * shared `formatGrouped` and carries a unit that keeps it readable (B, KB, MB, GB; B/s … GB/s; %).
 * Nothing here calls `toLocaleString` or builds a separator by hand (constitution, *Digit-grouped
 * quantities*).
 *
 * A figure that is not a number is never written as one: an unreadable source reads `Unavailable`
 * (FR-044), a metric no validated method measures reads `Not measured` (FR-012). Neither is zero.
 */
import {
  formatGrouped,
  isNotMeasured,
  isUnavailable,
  type MetricName,
  type MetricValue,
  type Metrics,
} from '@throng/core';

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** One decimal below ten of a unit, none above — enough to tell 1.5 GB from 1.9 GB, no more. */
function scaled(value: number): number {
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
}

export function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs >= GIB) return `${formatGrouped(scaled(bytes / GIB))} GB`;
  if (abs >= MIB) return `${formatGrouped(scaled(bytes / MIB))} MB`;
  if (abs >= KIB) return `${formatGrouped(scaled(bytes / KIB))} KB`;
  return `${formatGrouped(Math.round(bytes))} B`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** A share is always shown to one decimal: 0.3% and 12.5% are different stories, and 13% would hide both. */
export function formatPercent(percent: number): string {
  return `${formatGrouped(Math.round(percent * 10) / 10)}%`;
}

/** How long something has run: the two largest units that are not zero — `3 d 4 h`, `2 h 05 min`, `12 min 5 s`, `5 s`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (days > 0) return `${formatGrouped(days)} d ${hours} h`;
  if (hours > 0) return `${hours} h ${pad(minutes)} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}

export const UNAVAILABLE_TEXT = 'Unavailable';
export const NOT_MEASURED_TEXT = 'Not measured';

/** The figure for one metric of one node, as text. `ioRead`/`ioWrite` are rates. */
export function formatMetric(name: MetricName, value: MetricValue): string {
  if (typeof value === 'number') {
    switch (name) {
      case 'cpu':
      case 'gpu':
        return formatPercent(value);
      case 'memory':
        return formatBytes(value);
      case 'ioRead':
      case 'ioWrite':
        return formatRate(value);
    }
  }
  return isUnavailable(value) ? UNAVAILABLE_TEXT : NOT_MEASURED_TEXT;
}

/** A user-facing metric name, as the status bar, the toolbar and the hover titles use it. */
export const METRIC_LABEL: Readonly<Record<MetricName | 'io', string>> = {
  cpu: 'CPU',
  memory: 'Memory',
  gpu: 'GPU',
  ioRead: 'I/O read',
  ioWrite: 'I/O write',
  io: 'I/O',
};

/**
 * Read and write combined — the "I/O" the status bar and the metric choice show. Both numbers add; one
 * number beside an unreadable half is shown with the half's reason as `partial`; neither number carries
 * the unreadable half's state through, so a total is never presented as zero.
 */
export function combineIo(m: Pick<Metrics, 'ioRead' | 'ioWrite' | 'partial'>): { value: MetricValue; partial?: string } {
  const parts = [m.ioRead, m.ioWrite];
  const numbers = parts.filter((p): p is number => typeof p === 'number');
  const missing = parts.find(isUnavailable);
  const carried = m.partial?.ioRead ?? m.partial?.ioWrite;
  if (numbers.length > 0) {
    const partial = missing?.reason ?? carried;
    return { value: numbers.reduce((a, b) => a + b, 0), ...(partial !== undefined ? { partial } : {}) };
  }
  if (missing) return { value: missing };
  return { value: parts.find(isNotMeasured) ?? m.ioRead };
}

/** The text for `partial` figures: the number, then why it is not the whole story. */
export function partialNote(reason: string): string {
  return `partial — ${reason}`;
}
