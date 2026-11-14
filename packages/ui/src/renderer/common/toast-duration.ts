/**
 * 068 research D11 — the toast duration a window actually arms.
 *
 * The user's `toastDurationMs` in every real run. `?toastMs=` overrides it, and ONLY the E2E harness
 * sets that — main appends it from `THRONG_E2E_TOAST_MS` (see `rendererQuery` and `prefsQuery` in
 * main.ts). The suite's specs assert toasts after async work that can outlast the shipped 3 s on a
 * loaded runner; the shipped default and its pause rules are proven at the component layer instead.
 *
 * A bad, zero or absent value falls back to the setting rather than to NaN: a duration of NaN would
 * expire every toast at once.
 */
export function effectiveToastDurationMs(setting: number, search: string = window.location.search): number {
  const raw = Number(new URLSearchParams(search).get('toastMs'));
  return Number.isFinite(raw) && raw > 0 ? raw : setting;
}

/**
 * 068 FR-021 — whether the pointer over a toast holds it. True in every real run.
 *
 * `?toastHold=off` turns the POINTER hold off (keyboard focus still holds), and only the E2E harness
 * sets it, from `THRONG_E2E_TOAST_HOLD`. Playwright retries a click by moving the pointer onto the
 * target; when a toast covers that point, the hold pauses the toast for as long as the pointer stays,
 * so it never leaves and the click never lands — measured on gate run 43340046866, where a startup
 * notice held over the panel-type form's Confirm failed four editor specs. The hold itself is proven
 * at the component layer (`notice-toast-timer.test.ts`).
 */
export function toastPointerHoldEnabled(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get('toastHold') !== 'off';
}
