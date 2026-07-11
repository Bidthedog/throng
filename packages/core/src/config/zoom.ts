/**
 * Shared zoom range & mapping (012, FR-011 / contracts/zoom.md). One authoritative
 * source for BOTH the app-wide global zoom (the main process's `setZoomLevel` path,
 * refactored onto these constants for DRY) and the per-panel-type zoom, so the two
 * mechanisms use an identical step and identical minimum/maximum bounds — a zoom at
 * a bound is a no-op for either. Pure; zero OS/DOM (Principle II).
 */

/** One keypress step, identical to the app-wide global-zoom step. */
export const ZOOM_STEP = 0.5;

/** Minimum / maximum zoom level (== ∓ the global-zoom limit). */
export const ZOOM_MIN_LEVEL = -5;
export const ZOOM_MAX_LEVEL = 5;

/** Clamp a raw level into the shared bounds (hand-edited JSON included). */
export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(Math.max(level, ZOOM_MIN_LEVEL), ZOOM_MAX_LEVEL);
}

/**
 * Electron's zoom-level → scale ratio (`1.2 ** level`). The per-type effective font
 * size is `baseFontPx × zoomFactor(level)`; because the app-wide global zoom already
 * rescales the whole page, the on-screen size composes automatically (FR-008).
 */
export function zoomFactor(level: number): number {
  return 1.2 ** level;
}

/**
 * Step a level by `presses` (>0 in, <0 out) of {@link ZOOM_STEP}, clamped to the
 * shared bounds. At a bound the returned level is unchanged, so the caller applies
 * no change (the no-op / soft-signal behaviour of FR-011).
 */
export function stepZoomLevel(level: number, presses: number): number {
  return clampZoomLevel(level + presses * ZOOM_STEP);
}
