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
  notesBindToVersion: true,
  artifactSetReconciles: true,
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
    for (const key of [
      'isRealVersion',
      'versionsAligned',
      'isVerified',
      'isSignedOff',
      'notesBindToVersion',
    ] as const) {
      expect(evaluatePublishGate({ ...ALL_GOOD, [key]: false }).allowed).toBe(false);
    }
    expect(evaluatePublishGate({ ...ALL_GOOD, isAlreadyPublished: true }).allowed).toBe(false);
  });
});

/**
 * 042 FR-005 — publication is refused, with no override, when the release notes are absent, empty
 * or bound to another version. The condition lives in the gate rather than as an early exit in the
 * workflow so that there is one refusal path, one message format, and one place a unit test can
 * reach it.
 */
describe('evaluatePublishGate — release notes (042 FR-005)', () => {
  it('refuses when the notes do not bind to the version being published, naming them', () => {
    const r = evaluatePublishGate({ ...ALL_GOOD, notesBindToVersion: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/notes/i);
  });

  it('allows when the notes bind', () => {
    expect(evaluatePublishGate({ ...ALL_GOOD, notesBindToVersion: true }).allowed).toBe(true);
  });

  it('refuses missing notes BEFORE asking about the human sign-off', () => {
    // A cheap, deterministic condition must not waste a human approval: a release whose notes were
    // never written should be refused before anyone is asked to certify the build.
    const r = evaluatePublishGate({ ...ALL_GOOD, notesBindToVersion: false, isSignedOff: false });
    expect(r.reason).toMatch(/notes/i);
    expect(r.reason).not.toMatch(/sign-off/i);
  });
});

/**
 * 042 FR-013/FR-016 — the set about to be published must be the set that was built and verified.
 */
describe('evaluatePublishGate — the artifact set (042 FR-013/FR-016)', () => {
  it('refuses when the built artifacts do not match the declared set, naming them', () => {
    const r = evaluatePublishGate({ ...ALL_GOOD, artifactSetReconciles: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/artifact/i);
  });

  it('refuses a mismatched set BEFORE asking about the human sign-off', () => {
    const r = evaluatePublishGate({ ...ALL_GOOD, artifactSetReconciles: false, isSignedOff: false });
    expect(r.reason).toMatch(/artifact/i);
    expect(r.reason).not.toMatch(/sign-off/i);
  });

  it('never allows when the set does not reconcile, whatever else is true', () => {
    expect(evaluatePublishGate({ ...ALL_GOOD, artifactSetReconciles: false }).allowed).toBe(false);
  });
});
