import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Telling other windows they are blurred must never be able to kill the main process.
 *
 * ══ WHAT WENT WRONG ══
 *
 * `broadcastBlurred` fans a message out to every other BrowserWindow, and one of its two callers is
 * the preferences window's `closed` handler — so it runs DURING SHUTDOWN, while the other windows
 * are being torn down around it. It skipped `w.isDestroyed()`, which is not enough: a window reports
 * itself alive for a moment after its `webContents` has gone, and either can be destroyed between
 * the check and the send.
 *
 *     TypeError: Object has been destroyed
 *         at WebContents.send (electron/js2c/browser_init)
 *         at broadcastBlurred (preferences-window.js:34)
 *         at BrowserWindow.<anonymous> (preferences-window.js:97)
 *
 * An uncaught throw inside a BrowserWindow event handler takes the WHOLE MAIN PROCESS with it —
 * exit code 7, mid-quit. Everything the shutdown had left to do, including the settings and layout
 * drain that `terminate-all-drain.e2e.ts` exists to protect, simply never runs. Same failure class
 * as `window-parent-tdz.test.ts`, at the other end of the app's life.
 *
 * Observed twice per full local E2E run, invisibly, until the E2E harness started reporting an
 * Electron app that dies while a test is still using it (#240). Playwright had only ever said
 * "Target page, context or browser has been closed", which names nothing.
 *
 * ══ WHY A SOURCE GUARD ══
 *
 * The crash needs a window to die inside the gap between the liveness check and the send, so a
 * behavioural test would be timing-dependent — the very thing that let this hide for so long. The
 * property that matters is static and can be asserted exactly: the send is guarded on both objects
 * AND wrapped, so that losing the race is caught rather than fatal.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL('../../src/main/preferences-window.ts', import.meta.url)),
  'utf8',
);

/** `broadcastBlurred`'s body, from its signature to the closing brace of the function. */
function broadcastBlurredBody(): string {
  const start = SOURCE.indexOf('function broadcastBlurred');
  expect(start, 'broadcastBlurred has been renamed — update this guard').toBeGreaterThan(-1);
  const end = SOURCE.indexOf('\n}', start);
  return SOURCE.slice(start, end);
}

describe('broadcastBlurred cannot take the main process down during shutdown', () => {
  it('checks the webContents for destruction, not only the window', () => {
    // `w.isDestroyed()` alone is what the crash got past.
    expect(broadcastBlurredBody()).toMatch(/webContents\.isDestroyed\(\)/);
  });

  it('wraps the send, because the window can die between the check and the send', () => {
    const body = broadcastBlurredBody();
    const send = body.indexOf('webContents.send');
    const tryAt = body.indexOf('try {');
    expect(tryAt, 'the send must sit inside a try').toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(tryAt);
    expect(body).toMatch(/catch/);
  });
});
