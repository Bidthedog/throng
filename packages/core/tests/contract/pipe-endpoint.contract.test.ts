import { describe, expect, it } from 'vitest';

import { defaultPipeName } from '../../src/index.js';

/**
 * 020 FR-013 — the cross-boundary pipe-endpoint contract.
 *
 * The daemon composition root and the UI composition root BOTH derive their default pipe
 * name from this ONE core function, given the same injected user token. That is what makes
 * the two ends rendezvous per user instead of colliding on a machine-wide constant. The
 * contract both boundaries rely on:
 *
 *   - same user token  → identical pipe name (the daemon and UI agree)
 *   - different tokens → different pipe names (two OS users never collide)
 *   - the derivation is pure (no env / OS dependency), so both boundaries compute it the same
 *     way in their own process.
 */
describe('pipe-endpoint cross-boundary contract (020 FR-013)', () => {
  it('the daemon and UI derive the SAME pipe for one user token', () => {
    const token = 'alice';
    // Model the two boundaries: each independently calls the shared core derivation.
    const daemonSide = defaultPipeName(token);
    const uiSide = defaultPipeName(token);
    expect(uiSide).toBe(daemonSide);
  });

  it('two different OS users derive DIFFERENT pipes (no collision)', () => {
    expect(defaultPipeName('alice')).not.toBe(defaultPipeName('bob'));
  });

  it('is pure — the derivation does not read process.env', () => {
    const before = process.env.THRONG_PIPE_NAME;
    try {
      process.env.THRONG_PIPE_NAME = '\\\\.\\pipe\\something-else';
      // The DEFAULT derivation ignores the override entirely; the override is applied by the
      // settings readers, not by defaultPipeName.
      expect(defaultPipeName('alice')).toBe(defaultPipeName('alice'));
      expect(defaultPipeName('alice').includes('something-else')).toBe(false);
    } finally {
      if (before === undefined) delete process.env.THRONG_PIPE_NAME;
      else process.env.THRONG_PIPE_NAME = before;
    }
  });
});
