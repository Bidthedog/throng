import { describe, expect, it } from 'vitest';
import { DaemonClient } from '../../src/main/daemon-client.js';

describe('DaemonClient when the daemon is unavailable (FR-010)', () => {
  it('resolves to an unavailable outcome within the ping timeout, never throwing', async () => {
    const client = new DaemonClient({
      // A pipe with no listening server.
      pipeName: `\\\\.\\pipe\\throng-absent-${process.pid}`,
      window: { width: 1, height: 1 },
      pingTimeoutMs: 1000,
      attachTimeoutMs: 15000,
    });

    const start = Date.now();
    const status = await client.getStatus();
    const elapsed = Date.now() - start;

    expect(status.available).toBe(false);
    if (!status.available) {
      expect(typeof status.reason).toBe('string');
      expect(status.reason.length).toBeGreaterThan(0);
    }
    // Must not hang: resolves well within (timeout + slack).
    expect(elapsed).toBeLessThan(3000);
  });
});
