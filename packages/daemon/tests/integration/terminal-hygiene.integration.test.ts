import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTerminalDaemon, rpcCall, openEventsSocket, waitFor, type TerminalDaemon } from './terminal-harness.js';

// Resource hygiene (FR-021): a closed events socket is dropped, so a sub-workspace window closing never
// leaks a subscriber. Layer: integration — the socket close is observed by the real pipe server.

describe('terminal resource hygiene', () => {
  let daemon: TerminalDaemon;
  beforeEach(async () => {
    daemon = await startTerminalDaemon();
  });
  afterEach(async () => {
    await rpcCall(daemon.pipeName, 'terminal.killAll', {}).catch(() => {});
    await daemon.stop();
  });

  // MOVED DOWN: the bounded reattach scrollback (MAX_SCROLLBACK) is proved in
  // packages/daemon/tests/unit/terminal-service-wiring.test.ts with a fake host emitting 800 KB.

  it('drops a closed events socket — no leaked subscriber (FR-021)', async () => {
    expect(daemon.events.sinkCount).toBe(0);
    const sub = await openEventsSocket(daemon.pipeName);
    await waitFor(() => daemon.events.sinkCount === 1, 4000, 'the daemon to register the new events subscriber');
    expect(daemon.events.sinkCount).toBe(1);

    sub.close(); // the window/view closes
    // Throws if it never drops, so this IS the assertion: the subscriber was released, not leaked.
    await waitFor(() => daemon.events.sinkCount === 0, 4000, 'the closed events socket to be dropped');
  });
});
