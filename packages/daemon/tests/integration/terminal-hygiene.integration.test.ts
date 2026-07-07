import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTerminalDaemon, rpcCall, openEventsSocket, waitFor, CMD, type TerminalDaemon } from './terminal-harness.js';

// Resource hygiene (T131/T132): under sustained output a session's reattach scrollback
// stays BOUNDED (the daemon keeps only a fixed tail, ~64 KB — so memory is flat no
// matter how much a shell prints), and a closed events socket is dropped so a
// sub-workspace window closing never leaks a subscriber (FR-021).

const SCROLLBACK_CAP = 64 * 1024; // MAX_SCROLLBACK in terminal-service.ts

describe('terminal resource hygiene', () => {
  let daemon: TerminalDaemon;
  beforeEach(async () => {
    daemon = await startTerminalDaemon();
  });
  afterEach(async () => {
    await rpcCall(daemon.pipeName, 'terminal.killAll', {}).catch(() => {});
    await daemon.stop();
  });

  it('keeps reattach scrollback bounded under sustained output (memory stays flat)', async () => {
    await rpcCall(daemon.pipeName, 'terminal.attach', {
      panelId: 'flat',
      projectId: 'p',
      launch: { file: CMD, args: [], cwd: 'C:\\' },
      cols: 80,
      rows: 24,
    });
    // Emit far more than the cap: ~20k lines of 40 chars ≈ 800 KB of output.
    await rpcCall(daemon.pipeName, 'terminal.write', {
      panelId: 'flat',
      data: 'for /L %i in (1,1,20000) do @echo XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\r\n',
    });

    // Poll the reattach scrollback: it must GROW to near the cap then stay capped.
    let scrollback = '';
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const res = await rpcCall(daemon.pipeName, 'terminal.attach', {
        panelId: 'flat',
        projectId: 'p',
        launch: { file: CMD, args: [], cwd: 'C:\\' },
        cols: 80,
        rows: 24,
      });
      scrollback = String(res.result.scrollback ?? '');
      if (scrollback.length >= SCROLLBACK_CAP / 2) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    expect(scrollback.length).toBeGreaterThan(1000); // output really flowed
    expect(scrollback.length).toBeLessThanOrEqual(SCROLLBACK_CAP); // and stayed bounded
    await rpcCall(daemon.pipeName, 'terminal.kill', { panelId: 'flat' });
  });

  it('drops a closed events socket — no leaked subscriber (FR-021)', async () => {
    expect(daemon.events.sinkCount).toBe(0);
    const sub = await openEventsSocket(daemon.pipeName);
    await waitFor(() => daemon.events.sinkCount === 1, 4000);
    expect(daemon.events.sinkCount).toBe(1);

    sub.close(); // the window/view closes
    const dropped = await waitFor(() => daemon.events.sinkCount === 0, 4000);
    expect(dropped).toBe(true); // the subscriber was released, not leaked
  });
});
