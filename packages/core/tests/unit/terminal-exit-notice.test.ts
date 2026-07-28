import { describe, it, expect } from 'vitest';
import { shouldSurfaceExit } from '@throng/core';

/**
 * 025 follow-up — which terminal ends deserve a notice.
 *
 * This exists because the first attempt at this shipped broken. It gated on the daemon's
 * `unexpected` flag, which means "throng did not kill this" (`unexpected = !userKilled`) — so
 * typing `exit`, the most deliberate end there is, arrives marked unexpected and the notice kept
 * appearing. There was no test, which is why nobody noticed until it was used.
 */
describe('shouldSurfaceExit', () => {
  it('stays silent for a clean exit — whoever asked for it', () => {
    // Typing `exit` reaches the app as code 0 AND unexpected:true. The code is what matters.
    expect(shouldSurfaceExit(0)).toBe(false);
  });

  it('surfaces a non-zero exit, which is a real failure', () => {
    expect(shouldSurfaceExit(1)).toBe(true);
    expect(shouldSurfaceExit(127)).toBe(true);
    expect(shouldSurfaceExit(-1)).toBe(true);
  });

  it('surfaces an exit whose code could not be read — silence must be earned, not assumed', () => {
    expect(shouldSurfaceExit(null)).toBe(true);
    expect(shouldSurfaceExit(undefined)).toBe(true);
  });
});
