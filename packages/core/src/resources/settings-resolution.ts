import type { UsageThresholds } from './bands.js';

/** The `resourceMonitor.*` leaves as stored (077: durations in ms) — each already clamped to its own range. */
export interface ResourceMonitorRaw {
  readonly captureIntervalMs: number;
  readonly historyMs: number;
  readonly cpuWarningPercent: number;
  readonly cpuCriticalPercent: number;
  readonly memoryWarningPercent: number;
  readonly memoryCriticalPercent: number;
  readonly popoverDelayMs: number;
}

export interface ResolvedResourceMonitorSettings {
  readonly intervalSeconds: number;
  readonly historyMinutes: number;
  /** True when the stored interval was below the history window's minimum (FR-004b). */
  readonly intervalRaised: boolean;
  readonly thresholds: UsageThresholds;
  readonly popoverDelayMs: number;
}

/**
 * 077 FR-017 — the capture interval's slider, in ms: its descriptor declares it, and the modal's interval menu offers
 * the same stops, so the two never disagree.
 */
export const CAPTURE_INTERVAL_MS = { min: 2000, max: 60_000, step: 1000 } as const;

/** FR-004b: the history window decides the fastest capture, so no node keeps more than 150 points. */
const BANDS: readonly { readonly upToMinutes: number; readonly minSeconds: number }[] = [
  { upToMinutes: 5, minSeconds: 2 },
  { upToMinutes: 10, minSeconds: 5 },
  { upToMinutes: 20, minSeconds: 15 },
  { upToMinutes: 30, minSeconds: 30 },
];


export function minimumIntervalFor(historyMinutes: number): number {
  for (const band of BANDS) if (historyMinutes <= band.upToMinutes) return band.minSeconds;
  return BANDS[BANDS.length - 1]!.minSeconds;
}

/**
 * The interval to STORE when the history window is set to `historyMinutes` (FR-004b): the window's minimum when
 * the stored interval is under it, else `undefined` — a slower interval the user chose stands, and so does one
 * that already meets the minimum. The resolver raises what is IN FORCE regardless; this raises what is SHOWN
 * and stored at the moment the window changes, so the setting does not sit below its minimum until touched.
 */
export function raisedIntervalFor(historyMinutes: number, storedIntervalSeconds: number): number | undefined {
  const min = minimumIntervalFor(historyMinutes);
  return storedIntervalSeconds < min ? min : undefined;
}

export function allowedIntervals(historyMinutes: number): number[] {
  const min = minimumIntervalFor(historyMinutes);
  // 077 FR-017 — every stop the Preferences slider has, from the window's minimum up.
  const out: number[] = [];
  for (let ms = Math.max(CAPTURE_INTERVAL_MS.min, min * 1000); ms <= CAPTURE_INTERVAL_MS.max; ms += CAPTURE_INTERVAL_MS.step) out.push(ms / 1000);
  return out;
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
  const historyMinutes = raw.historyMs / 60_000;
  const min = minimumIntervalFor(historyMinutes);
  // 077 FR-016 — no cap of its own: the bounds guard holds the stored interval to its descriptor's range.
  const stored = raw.captureIntervalMs / 1000;
  return {
    intervalSeconds: Math.max(stored, min),
    historyMinutes,
    intervalRaised: stored < min,
    thresholds: {
      cpuWarning: belowCritical(raw.cpuWarningPercent, raw.cpuCriticalPercent),
      cpuCritical: raw.cpuCriticalPercent,
      memoryWarning: belowCritical(raw.memoryWarningPercent, raw.memoryCriticalPercent),
      memoryCritical: raw.memoryCriticalPercent,
    },
    popoverDelayMs: raw.popoverDelayMs,
  };
}
