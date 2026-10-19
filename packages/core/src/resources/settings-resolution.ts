import type { UsageThresholds } from './bands.js';

/** The six `resourceMonitor.*` leaves as stored — each already clamped to its own range. */
export interface ResourceMonitorRaw {
  readonly captureIntervalSeconds: number;
  readonly historyMinutes: number;
  readonly cpuWarningPercent: number;
  readonly cpuCriticalPercent: number;
  readonly memoryWarningPercent: number;
  readonly memoryCriticalPercent: number;
}

export interface ResolvedResourceMonitorSettings {
  readonly intervalSeconds: number;
  readonly historyMinutes: number;
  /** True when the stored interval was below the history window's minimum (FR-004b). */
  readonly intervalRaised: boolean;
  readonly thresholds: UsageThresholds;
}

export const MAX_INTERVAL_SECONDS = 60;

/** FR-004b: the history window decides the fastest capture, so no node keeps more than 150 points. */
const BANDS: readonly { readonly upToMinutes: number; readonly minSeconds: number }[] = [
  { upToMinutes: 5, minSeconds: 2 },
  { upToMinutes: 10, minSeconds: 5 },
  { upToMinutes: 20, minSeconds: 15 },
  { upToMinutes: 30, minSeconds: 30 },
];

/** The intervals the modal's control offers (FR-004a), before the window's minimum is applied. */
const INTERVAL_CHOICES = [2, 5, 10, 15, 30, 60] as const;

export function minimumIntervalFor(historyMinutes: number): number {
  for (const band of BANDS) if (historyMinutes <= band.upToMinutes) return band.minSeconds;
  return BANDS[BANDS.length - 1]!.minSeconds;
}

export function allowedIntervals(historyMinutes: number): number[] {
  const min = minimumIntervalFor(historyMinutes);
  return INTERVAL_CHOICES.filter((s) => s >= min);
}

/** Points per node a modal session keeps: one per capture across the window. */
export function historyLength(s: Pick<ResolvedResourceMonitorSettings, 'historyMinutes' | 'intervalSeconds'>): number {
  return Math.ceil((s.historyMinutes * 60) / s.intervalSeconds);
}

/** One below the critical, but never under 1%: a warning of 0 would colour every figure. */
const belowCritical = (warning: number, critical: number): number => (warning >= critical ? Math.max(1, critical - 1) : warning);

/**
 * The cross-field rules, resolved where the settings are read (research R11): the interval is raised
 * to the window's minimum and capped at 60 s; a warning at or above its critical is lowered to one
 * below it.
 */
export function resolveResourceMonitorSettings(raw: ResourceMonitorRaw): ResolvedResourceMonitorSettings {
  const min = minimumIntervalFor(raw.historyMinutes);
  const capped = Math.min(raw.captureIntervalSeconds, MAX_INTERVAL_SECONDS);
  return {
    intervalSeconds: Math.max(capped, min),
    historyMinutes: raw.historyMinutes,
    intervalRaised: capped < min,
    thresholds: {
      cpuWarning: belowCritical(raw.cpuWarningPercent, raw.cpuCriticalPercent),
      cpuCritical: raw.cpuCriticalPercent,
      memoryWarning: belowCritical(raw.memoryWarningPercent, raw.memoryCriticalPercent),
      memoryCritical: raw.memoryCriticalPercent,
    },
  };
}
