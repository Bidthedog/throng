/**
 * 066 T026 — the dev seam `THRONG_TEST_PANEL_THROW`, main's half.
 *
 * Set, every panel body throws while rendering, so quickstart's hand check can see the per-panel
 * boundary's banner and its fatal `panel` record without breaking a real panel. A packaged throng
 * ignores it: a variable left in a user's environment must never break their panels.
 *
 * The answer travels in the theme bootstrap reply every preload already asks for synchronously before
 * first paint, and the preload exposes it as `window.throng.testPanelThrow` (read by
 * `renderer/workspace/test-panel-throw.tsx`). A sandboxed preload does not see main's environment.
 */

/** On for any non-empty value but `0`/`false`, and only in a development build. */
export function testPanelThrowEnabled(env: NodeJS.ProcessEnv, isPackaged: boolean): boolean {
  if (isPackaged) return false;
  const value = (env.THRONG_TEST_PANEL_THROW ?? '').trim().toLowerCase();
  return value !== '' && value !== '0' && value !== 'false';
}
