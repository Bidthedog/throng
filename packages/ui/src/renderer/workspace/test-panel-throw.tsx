/**
 * The dev seam `THRONG_TEST_PANEL_THROW` (066 T026) — the quickstart's hand check for the per-panel
 * boundary. When it is set, every TYPED panel body throws while rendering, so the boundary's banner and
 * the fatal `panel` record in `main.log` can be seen without breaking a real panel. An untyped panel —
 * the panel-type selection screen — never throws: it is where the banner's *Clear panel type* lands, and
 * crashing it again would put the same banner straight back (manual test MT-01).
 *
 * Main reads the environment variable (inert when `app.isPackaged`, like the other `THRONG_TEST_*`
 * seams) and the preload exposes it as `window.throng.testPanelThrow`.
 */
export function panelThrowRequested(): boolean {
  return window.throng?.testPanelThrow === true;
}

/** Rendered inside the boundary, before the body: throws for a typed panel when the seam is set. */
export function TestPanelThrow({ typed }: { typed: boolean }): null {
  if (typed && panelThrowRequested()) throw new Error('THRONG_TEST_PANEL_THROW: this panel was told to throw');
  return null;
}
