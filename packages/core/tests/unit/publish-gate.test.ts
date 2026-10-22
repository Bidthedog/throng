import { describe, expect, it } from 'vitest';

import {
  buildArtifactVerdict,
  buildCoexistenceVerdict,
  COEXISTENCE_STEPS,
  combinationsOf,
  declareArtifactSet,
  evaluatePublishGate,
  evaluateVerification,
} from '../../src/index.js';
import type {
  StepResult,
  VerificationCombination,
  VerificationEvidence,
  VerificationStep,
} from '../../src/index.js';

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
    expect(evaluatePublishGate(ALL_GOOD)).toEqual({ allowed: true, reason: null, reportedGaps: [] });
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

/**
 * 058 FR-030 — publication is refused unless EVERY combination's verdict passed, and the refusal
 * names the combination that did not. The evidence is evaluated by `evaluateVerification`; the gate
 * carries its refusal, and the gaps it reports, through.
 */
describe('evaluatePublishGate — the verification matrix (058 FR-030)', () => {
  const VERSION = '1.2.3';
  const combinations = combinationsOf(declareArtifactSet(VERSION));
  const SHA = { setup: 'a'.repeat(64), msi: 'b'.repeat(64), portable: 'c'.repeat(64), archive: 'd'.repeat(64) };

  const passing = (c: VerificationCombination, results: Partial<Record<VerificationStep, StepResult>> = {}) =>
    buildArtifactVerdict(
      c,
      SHA[c.role],
      { ...Object.fromEntries(c.applicableSteps.map((s) => [s, true])), ...results },
      { 'second-account': 'the runner has no desktop for a second account' },
    );
  const allVerdicts = () => combinations.map((c) => passing(c));
  const coexistence = buildCoexistenceVerdict(
    VERSION,
    [],
    Object.fromEntries(COEXISTENCE_STEPS.map((s) => [s, true])),
  );
  const evidence = (over: Partial<VerificationEvidence> = {}): VerificationEvidence => ({
    version: VERSION,
    combinations,
    verdicts: allVerdicts(),
    coexistence,
    actualSha256ByRole: SHA,
    ...over,
  });
  const gateFor = (e: VerificationEvidence) => {
    const v = evaluateVerification(e);
    return evaluatePublishGate({
      ...ALL_GOOD,
      isVerified: v.passed,
      verificationRefusal: v.refusal,
      reportedGaps: v.reportedGaps,
    });
  };

  it('passes when all six combinations and the coexistence run passed', () => {
    const r = gateFor(evidence());
    expect(r.allowed).toBe(true);
    expect(r.reportedGaps).toEqual([]);
  });

  it('refuses a missing combination verdict, naming the combination id', () => {
    const r = gateFor(evidence({ verdicts: allVerdicts().filter((v) => v.combination !== 'msi-machine') }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('msi-machine');
  });

  it('refuses a failed step, naming `<combination>: <step>`', () => {
    const verdicts = combinations.map((c) =>
      c.id === 'setup-machine' ? passing(c, { 'in-use-upgrade': false }) : passing(c),
    );
    const r = gateFor(evidence({ verdicts }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('setup-machine: in-use-upgrade');
  });

  it('refuses an unproven step that is not runner-limited, as it would a failed one', () => {
    const forged = allVerdicts().map((v) =>
      v.combination === 'msi-user' ? { ...v, steps: { ...v.steps, launch: 'unproven' as const } } : v,
    );
    const r = gateFor(evidence({ verdicts: forged }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('msi-user: launch');
  });

  it('refuses a missing coexistence verdict, naming coexistence', () => {
    const r = gateFor(evidence({ coexistence: null }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/coexistence/);
  });

  it('refuses a failing coexistence verdict, naming the step', () => {
    const failing = buildCoexistenceVerdict(
      VERSION,
      [],
      Object.fromEntries(COEXISTENCE_STEPS.map((s) => [s, s !== 'reattach-across-copies'])),
    );
    const r = gateFor(evidence({ coexistence: failing }));
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('coexistence: reattach-across-copies');
  });

  it('allows unproven on a runner-limited step, and LISTS it in reportedGaps — never silently accepted', () => {
    const verdicts = combinations.map((c) =>
      c.id === 'msi-machine' ? passing(c, { 'second-account': 'unproven' }) : passing(c),
    );
    const r = gateFor(evidence({ verdicts }));
    expect(r.allowed).toBe(true);
    expect(r.reportedGaps).toEqual([
      {
        combination: 'msi-machine',
        step: 'second-account',
        reason: 'the runner has no desktop for a second account',
      },
    ]);
  });

  it('still says "not verified" when refusing, so the message stays recognisable', () => {
    expect(gateFor(evidence({ coexistence: null })).reason).toMatch(/not verified/i);
  });
});
