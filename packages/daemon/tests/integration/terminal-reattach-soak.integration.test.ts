import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CMD, openEventsSocket, rpcCall, startTerminalDaemon, waitFor } from './terminal-harness.js';

/**
 * Layer: integration. A real daemon and shell across 20 UI departures (062 SC-002). The window's part of a reattach is
 * proved once in E2E; what a soak can catch, a session lost on the nth return, is the daemon's. Tagged `regression`.
 */
describe('a terminal outlives the UI', () => {
  it('20 departures and returns keep one live shell', { tags: ['regression'], timeout: 120_000 }, async () => {
    const daemon = await startTerminalDaemon();
    const cwd = mkdtempSync(join(tmpdir(), 'throng-reattach-soak-'));
    const attach = (): Promise<unknown> =>
      rpcCall(daemon.pipeName, 'terminal.attach', {
        panelId: 'soak',
        projectId: 'proj',
        launch: { file: CMD, args: [], cwd },
        cols: 80,
        rows: 24,
      });
    try {
      for (let i = 0; i < 20; i += 1) {
        const events = await openEventsSocket(daemon.pipeName);
        await attach();
        const marker = `SOAK_${i}_END`;
        await rpcCall(daemon.pipeName, 'terminal.write', { panelId: 'soak', data: `echo ${marker}\r\n` });
        await waitFor(
          () => events.notifications.some((n) => n.method === 'terminal.output' && String(n.params.data).includes(marker)),
          8000,
          `round ${i} to reach the shell`,
        );
        events.close();
        const listed = (await rpcCall(daemon.pipeName, 'terminal.list', {})) as { result: { sessions: unknown[] } };
        expect(listed.result.sessions).toHaveLength(1);
      }
    } finally {
      await rpcCall(daemon.pipeName, 'terminal.killAll', {}).catch(() => undefined);
      await daemon.stop();
      rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
