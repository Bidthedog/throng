import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { CMD, openEventsSocket, rpcCall, startTerminalDaemon, waitFor, type TerminalDaemon } from './terminal-harness.js';

/**
 * Layer: integration — that `terminal.subscribe` on a real socket reaches the service. What the service then does with
 * it is proved in `terminal-output-subscription.test.ts`.
 */

let daemon: TerminalDaemon;
let cwd: string;

beforeEach(async () => {
  daemon = await startTerminalDaemon();
  cwd = mkdtempSync(join(tmpdir(), 'throng-subscribe-'));
});

afterEach(async () => {
  await daemon.stop();
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('a UI main reconnecting to a daemon that kept running (061 FR-005a)', () => {
  it('goes on receiving output for the view it names, with no re-attach', async () => {
    const before = await openEventsSocket(daemon.pipeName);
    await rpcCall(daemon.pipeName, 'terminal.attach', {
      panelId: 'p',
      projectId: 'proj',
      viewId: 'v1',
      launch: { file: CMD, args: [], cwd },
      cols: 80,
      rows: 24,
    });
    before.close();
    await waitFor(() => daemon.events.sinkCount === 0, 8000, 'the daemon to see the socket go');

    const after = await openEventsSocket(daemon.pipeName, { views: [{ panelId: 'p', viewId: 'v1' }] });
    await rpcCall(daemon.pipeName, 'terminal.write', { panelId: 'p', data: 'echo AFTER_BLIP_61\r\n' });

    await waitFor(
      () => after.notifications.some((n) => n.method === 'terminal.output' && String(n.params.data).includes('AFTER_BLIP_61')),
      8000,
      'output after the reconnect',
    );

    await rpcCall(daemon.pipeName, 'terminal.kill', { panelId: 'p' });
    await waitFor(() => !daemon.lockManager.hasOpenTerminals('proj'), 8000, "the project's terminal lock to be released");
    after.close();
  });
});
