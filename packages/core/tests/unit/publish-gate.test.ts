import { describe, expect, it } from 'vitest';

import { evaluatePublishGate } from '../../src/index.js';

/**
 * 020 FR-028/031/034 — publishing is refused unless version-real AND verified AND signed-off, and
 * an already-published version is refused. Each refusal names the single unmet condition.
 */
const ALL_GOOD = {
  isRealVersion: true,
  versionsAligned: true,
  isVerified: true,
  isSignedOff: true,
  isAlreadyPublished: false,
};

describe('evaluatePublishGate (020 FR-028/031/034)', () => {
  it('allows when every gate is satisfied', () => {
    expect(evaluatePublishGate(ALL_GOOD)).toEqual({ allowed: true, reason: null });
  });

  it('refuses a placeholder version, naming it', () => {
    const r = evaluatePublishGate({ ...ALL_GOOD, isRealVersion: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/version/i);
  });

  it('refuses an already-published version, naming it', () => {
    const r = evaluatePublishGate({ ...ALL_GOOD, isAlreadyPublished: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/already been published/i);
  });

  it('refuses an unverified installer, naming it', () => {
    const r = evaluatePublishGate({ ...ALL_GOOD, isVerified: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not verified/i);
  });

  it('refuses a missing QA sign-off, naming it', () => {
    const r = evaluatePublishGate({ ...ALL_GOOD, isSignedOff: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/sign-off/i);
  });

  // 020 FR-030/033 / SC-002 — the sign-off and release bind to the exact package: the installer
  // filename, internal package version, reported app version and release tag must all agree, so a
  // sign-off/release for a different build cannot satisfy the gate.
  it('refuses when the four version representations do not all match, naming it', () => {
    const r = evaluatePublishGate({ ...ALL_GOOD, versionsAligned: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/version/i);
  });

  it('never allows when any single gate is unmet', () => {
    for (const key of ['isRealVersion', 'versionsAligned', 'isVerified', 'isSignedOff'] as const) {
      expect(evaluatePublishGate({ ...ALL_GOOD, [key]: false }).allowed).toBe(false);
    }
    expect(evaluatePublishGate({ ...ALL_GOOD, isAlreadyPublished: true }).allowed).toBe(false);
  });
});
