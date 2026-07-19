import { describe, expect, it } from 'vitest';

import { defaultPipeName, sanitisePipeToken } from '../../src/index.js';

/**
 * 020 FR-013 — per-user IPC endpoint.
 *
 * The daemon's pipe was a machine-wide constant, so two OS users on one machine collided
 * on it (a reachable-by-ordinary-users defect, not just a developer nicety). The default
 * pipe name is now derived per user; these pin the derivation's guarantees.
 */
describe('per-user pipe endpoint (020 FR-013)', () => {
  const PREFIX = '\\\\.\\pipe\\';

  it('derives a valid Windows pipe name with the throng prefix and .daemon suffix', () => {
    const name = defaultPipeName('alice');
    expect(name.startsWith(`${PREFIX}throng.`)).toBe(true);
    expect(name.endsWith('.daemon')).toBe(true);
    // The pipe-specific segment (after the \\.\pipe\ prefix) MUST NOT contain a backslash.
    expect(name.slice(PREFIX.length).includes('\\')).toBe(false);
  });

  it('is deterministic for one token', () => {
    expect(defaultPipeName('alice')).toBe(defaultPipeName('alice'));
  });

  it('produces different names for different user tokens (no cross-user collision)', () => {
    expect(defaultPipeName('alice')).not.toBe(defaultPipeName('bob'));
  });

  it('does not collide when sanitisation would flatten distinct tokens', () => {
    // 'a.b' and 'a_b' both sanitise to 'a_b'; the raw-token hash keeps them distinct.
    expect(defaultPipeName('a.b')).not.toBe(defaultPipeName('a_b'));
  });

  it('sanitises an awkward username to a safe pipe segment', () => {
    expect(sanitisePipeToken('DOMAIN\\User Name.x')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('falls back to a usable name for an empty token', () => {
    const name = defaultPipeName('');
    expect(name.startsWith(`${PREFIX}throng.`)).toBe(true);
    expect(name.endsWith('.daemon')).toBe(true);
  });
});
