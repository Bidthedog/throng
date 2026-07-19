import { describe, expect, it } from 'vitest';

import { verdictFromSteps, isVerdictPassingFor } from '../../src/index.js';

/**
 * 020 FR-023–FR-027 / FR-024a — the verification verdict binds to one exact package, names the
 * first failed step, and an ABSENT verdict is a failure (never a pass).
 */
const V = '1.0.0';
const SHA = 'a'.repeat(64);
const ALL_PASS = {
  'interrupted-install': true,
  install: true,
  launch: true,
  'version-match': true,
  'self-contained': true,
  shortcut: true,
  'no-service': true,
  'core-journey': true,
  reattach: true,
  'checksum-match': true,
  'no-write': true,
  uninstall: true,
  'residue-scan': true,
} as const;

describe('verdictFromSteps (020 FR-024/025)', () => {
  it('passes when every step passed', () => {
    const v = verdictFromSteps(V, SHA, ALL_PASS);
    expect(v).toEqual({ version: V, installerSha256: SHA, passed: true, failedStep: null });
  });

  it('names the FIRST failed step', () => {
    const v = verdictFromSteps(V, SHA, { ...ALL_PASS, 'checksum-match': false, uninstall: false });
    expect(v.passed).toBe(false);
    expect(v.failedStep).toBe('checksum-match');
  });

  it('names a failing deep-journey step (self-contained / shortcut / no-service / core-journey / no-write)', () => {
    expect(verdictFromSteps(V, SHA, { ...ALL_PASS, 'self-contained': false }).failedStep).toBe('self-contained');
    expect(verdictFromSteps(V, SHA, { ...ALL_PASS, shortcut: false }).failedStep).toBe('shortcut');
    expect(verdictFromSteps(V, SHA, { ...ALL_PASS, 'no-service': false }).failedStep).toBe('no-service');
    expect(verdictFromSteps(V, SHA, { ...ALL_PASS, 'core-journey': false }).failedStep).toBe('core-journey');
    expect(verdictFromSteps(V, SHA, { ...ALL_PASS, 'no-write': false }).failedStep).toBe('no-write');
  });

  it('treats a missing step result as a failure', () => {
    const { launch: _omit, ...missingLaunch } = ALL_PASS;
    void _omit;
    const v = verdictFromSteps(V, SHA, missingLaunch);
    expect(v.passed).toBe(false);
    expect(v.failedStep).toBe('launch');
  });
});

describe('isVerdictPassingFor (020 FR-027/024a — absence is failure, binds to the package)', () => {
  const passing = verdictFromSteps(V, SHA, ALL_PASS);

  it('an absent verdict is a failure, never a pass', () => {
    expect(isVerdictPassingFor(null, V, SHA)).toBe(false);
    expect(isVerdictPassingFor(undefined, V, SHA)).toBe(false);
  });

  it('a passing verdict for the exact package passes', () => {
    expect(isVerdictPassingFor(passing, V, SHA)).toBe(true);
  });

  it('a verdict for a DIFFERENT version or sha does not count', () => {
    expect(isVerdictPassingFor(passing, '1.0.1', SHA)).toBe(false);
    expect(isVerdictPassingFor(passing, V, 'b'.repeat(64))).toBe(false);
  });

  it('a failing verdict does not pass', () => {
    const failing = verdictFromSteps(V, SHA, { ...ALL_PASS, 'residue-scan': false });
    expect(isVerdictPassingFor(failing, V, SHA)).toBe(false);
  });
});
