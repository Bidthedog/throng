import { describe, expect, it } from 'vitest';
import { testPanelThrowEnabled } from '../../src/main/test-panel-throw-seam.js';

/**
 * 066 T026 (main half) — the dev seam `THRONG_TEST_PANEL_THROW` reaches the renderer only in a
 * development build: a packaged throng ignores it, whatever the environment says.
 */
describe('THRONG_TEST_PANEL_THROW', () => {
  it.each([
    [{ THRONG_TEST_PANEL_THROW: '1' }, false, true],
    [{ THRONG_TEST_PANEL_THROW: 'true' }, false, true],
    [{ THRONG_TEST_PANEL_THROW: '1' }, true, false],
    [{ THRONG_TEST_PANEL_THROW: '' }, false, false],
    [{ THRONG_TEST_PANEL_THROW: '0' }, false, false],
    [{}, false, false],
  ])('env %j, packaged %s → %s', (env, packaged, expected) => {
    expect(testPanelThrowEnabled(env, packaged)).toBe(expected);
  });
});
