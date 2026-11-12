import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 051 FR-015a (R8) — the app-close "Terminate all" choice leaves nothing behind: it asks the daemon to
 * escalate any end that fails, and gives the call a budget that covers an end and an escalation.
 *
 * Read from source: the handler is registered inside `main.ts`'s window setup, which has no seam a
 * unit test can drive without an Electron app, and the claim is only about what the call sends.
 */
const main = readFileSync(fileURLToPath(new URL('../../src/main/main.ts', import.meta.url)), 'utf8');

describe('067 — one shutdown at a time', () => {
  it('ignores a second close while one is in progress', () => {
    const handler = main.slice(main.indexOf("mainWindow.on('close', (e) => {"));
    const body = handler.slice(0, handler.indexOf("webContents.send('throng:appClose:begin')"));
    expect(body).toContain('if (activeShutdown) return;');
  });
});

describe('051 — app-close Terminate all', () => {
  it('sends killAll with escalate and the Unload budget, not the 2 s default', () => {
    // 067: the ending now happens in the shutdown steps the choice runs.
    const steps = main.slice(main.indexOf('const terminateSteps ='));
    const call = steps.slice(steps.indexOf("daemonClient.call('terminal.killAll'"));
    const args = call.slice(0, call.indexOf(');'));
    expect(args).toContain('escalate: true');
    expect(args).toContain('UNLOAD_RPC_TIMEOUT_MS');
  });
});
