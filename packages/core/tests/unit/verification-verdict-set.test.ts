import { describe, expect, it } from 'vitest';

import {
  buildArtifactVerdict,
  buildCoexistenceVerdict,
  buildSetVerdict,
  COEXISTENCE_STEPS,
  combinationsOf,
  declareArtifactSet,
  isCoexistenceVerdictPassing,
  isVerdictPassingForCombinations,
  RUNNER_LIMITED_STEPS,
  VERIFICATION_STEPS,
} from '../../src/index.js';
import type { ReleaseArtifact, VerificationCombination, VerificationStep } from '../../src/index.js';

/**
 * 042 FR-014/FR-015/FR-016 — a verdict certifies the whole declared SET, not one installer.
 * 058 FR-028/FR-030 — and now every artifact-and-scope COMBINATION: each has its own verdict, and an
 * absent verdict for any combination is a failure.
 *
 * The third step state is the point of the first half of this file. An archive has no install step
 * and no uninstaller, and both available alternatives are wrong: running the fixed step list would
 * fail a good release, and marking those steps passed would make the verdict assert an uninstall
 * that never ran. 020 FR-027 already refuses to conflate absence with success for a missing verdict;
 * `not-applicable` applies the same rule to a step. `unproven` (058) is the fourth state, and is
 * allowed for exactly the steps the spec names as runner-limited.
 */

const VERSION = '1.2.3';

const SETUP: ReleaseArtifact = {
  role: 'setup',
  filename: `throng-setup-${VERSION}.exe`,
  label: 'Installer',
  audience: 'Most people',
  scopes: ['per-user', 'machine'],
  applicableSteps: ['install', 'launch', 'version-match', 'uninstall', 'residue-scan'],
  sha256: null,
};

const ARCHIVE: ReleaseArtifact = {
  role: 'archive',
  filename: `throng-${VERSION}.zip`,
  label: 'Archive',
  audience: 'Extract and run',
  scopes: [],
  applicableSteps: ['launch', 'version-match', 'residue-scan'],
  sha256: null,
};

const SHA_SETUP = 'a'.repeat(64);
const SHA_ARCHIVE = 'b'.repeat(64);

function allPassed(artifact: { applicableSteps: readonly VerificationStep[] }): Partial<Record<VerificationStep, boolean>> {
  return Object.fromEntries(artifact.applicableSteps.map((s) => [s, true]));
}

describe('buildArtifactVerdict — the step states (042 FR-015)', () => {
  it('records every applicable step that passed as passed', () => {
    const v = buildArtifactVerdict(SETUP, SHA_SETUP, allPassed(SETUP));
    expect(v.steps['install']).toBe('passed');
    expect(v.steps['uninstall']).toBe('passed');
    expect(v.passed).toBe(true);
  });

  it('records a step outside the artifact’s applicable list as not-applicable, never as passed', () => {
    const v = buildArtifactVerdict(ARCHIVE, SHA_ARCHIVE, allPassed(ARCHIVE));
    expect(v.steps['install']).toBe('not-applicable');
    expect(v.steps['uninstall']).toBe('not-applicable');
    expect(v.passed).toBe(true);
  });

  it('a not-applicable step does not make the verdict fail — an archive is not broken for lacking an uninstaller', () => {
    expect(buildArtifactVerdict(ARCHIVE, SHA_ARCHIVE, allPassed(ARCHIVE)).failedStep).toBeNull();
  });

  it('an applicable step that did not pass fails the verdict, naming the first one in run order', () => {
    const v = buildArtifactVerdict(SETUP, SHA_SETUP, { ...allPassed(SETUP), install: false });
    expect(v.passed).toBe(false);
    expect(v.failedStep).toBe('install');
  });

  it('an applicable step with NO result is a failure, not a skip — absence is not success (020 FR-027)', () => {
    const v = buildArtifactVerdict(SETUP, SHA_SETUP, { install: true, launch: true });
    expect(v.passed).toBe(false);
    expect(v.failedStep).toBe('version-match');
  });

  it('binds to the bytes it certifies', () => {
    expect(buildArtifactVerdict(SETUP, SHA_SETUP, allPassed(SETUP)).sha256).toBe(SHA_SETUP);
  });
});

describe('the 058 steps and the unproven outcome (data-model.md, StepOutcome)', () => {
  it('knows the six new verification steps', () => {
    for (const step of [
      'standard-account-install',
      'second-account',
      'in-use-upgrade',
      'not-elevated-launch',
      'silent-elevation-refused',
      'install-labels',
    ]) {
      expect(VERIFICATION_STEPS).toContain(step);
    }
  });

  it('lists only the second account’s GUI half and the launch integrity check as runner-limited', () => {
    // not-elevated-launch: a hosted runner is an administrator with UAC off, so its desktop is not medium.
    expect([...RUNNER_LIMITED_STEPS].sort()).toEqual(['not-elevated-launch', 'second-account']);
  });

  it('allows unproven on not-elevated-launch, and still fails it anywhere else', () => {
    const v = buildArtifactVerdict(
      { role: 'setup', id: 'setup-machine', applicableSteps: ['launch', 'not-elevated-launch'] as const },
      SHA_SETUP,
      { launch: true, 'not-elevated-launch': 'unproven' },
    );
    expect(v.steps['not-elevated-launch']).toBe('unproven');
    expect(v.passed).toBe(true);
  });

  const machine = { role: 'msi', id: 'msi-machine', applicableSteps: ['launch', 'second-account'] as const };

  it('records unproven on a runner-limited step, and still passes', () => {
    const v = buildArtifactVerdict(machine, SHA_SETUP, { launch: true, 'second-account': 'unproven' });
    expect(v.steps['second-account']).toBe('unproven');
    expect(v.passed).toBe(true);
    expect(v.failedStep).toBeNull();
  });

  it('treats unproven on any other step as failed', () => {
    const v = buildArtifactVerdict(machine, SHA_SETUP, { launch: 'unproven', 'second-account': true });
    expect(v.steps['launch']).toBe('failed');
    expect(v.passed).toBe(false);
    expect(v.failedStep).toBe('launch');
  });

  it('keeps the reason an unproven step gave, so the release can report the gap', () => {
    const v = buildArtifactVerdict(
      machine,
      SHA_SETUP,
      { launch: true, 'second-account': 'unproven' },
      { 'second-account': 'the runner has no interactive desktop for a second account' },
    );
    expect(v.unprovenReasons?.['second-account']).toMatch(/interactive desktop/);
  });

  it('identifies a verdict by its combination, falling back to the role for an artifact without scopes', () => {
    expect(buildArtifactVerdict(machine, SHA_SETUP, allPassed(machine)).combination).toBe('msi-machine');
    expect(buildArtifactVerdict(ARCHIVE, SHA_ARCHIVE, allPassed(ARCHIVE)).combination).toBe('archive');
  });
});

describe('buildSetVerdict (042 FR-016)', () => {
  it('passes only when every verdict passed', () => {
    const verdict = buildSetVerdict(VERSION, [
      buildArtifactVerdict(SETUP, SHA_SETUP, allPassed(SETUP)),
      buildArtifactVerdict(ARCHIVE, SHA_ARCHIVE, allPassed(ARCHIVE)),
    ]);
    expect(verdict.passed).toBe(true);
  });

  it('fails when any one verdict failed, and names the step', () => {
    const verdict = buildSetVerdict(VERSION, [
      buildArtifactVerdict(SETUP, SHA_SETUP, allPassed(SETUP)),
      buildArtifactVerdict(ARCHIVE, SHA_ARCHIVE, { ...allPassed(ARCHIVE), launch: false }),
    ]);
    expect(verdict.passed).toBe(false);
    expect(verdict.failedStep).toBe('launch');
  });
});

describe('isVerdictPassingForCombinations (058 FR-030)', () => {
  const setupUser: VerificationCombination = {
    id: 'setup-user',
    role: 'setup',
    scope: 'per-user',
    applicableSteps: SETUP.applicableSteps,
    verdictFile: 'verification-verdict-setup-user.json',
  };
  const setupMachine: VerificationCombination = {
    ...setupUser,
    id: 'setup-machine',
    scope: 'machine',
    applicableSteps: [...SETUP.applicableSteps, 'second-account'],
    verdictFile: 'verification-verdict-setup-machine.json',
  };
  const archive: VerificationCombination = {
    id: 'archive',
    role: 'archive',
    scope: null,
    applicableSteps: ARCHIVE.applicableSteps,
    verdictFile: 'verification-verdict-archive.json',
  };
  const combinations = [setupUser, setupMachine, archive];
  const actual = { setup: SHA_SETUP, archive: SHA_ARCHIVE };

  const verdictFor = (c: VerificationCombination, results = allPassed(c), sha = actual[c.role as 'setup' | 'archive']) =>
    buildArtifactVerdict(c, sha, results);
  const good = buildSetVerdict(VERSION, combinations.map((c) => verdictFor(c)));

  it('passes when every combination has a passing verdict bound to the real bytes', () => {
    expect(isVerdictPassingForCombinations(good, VERSION, combinations, actual)).toBe(true);
  });

  it('treats an absent verdict as a failure (020 FR-027)', () => {
    expect(isVerdictPassingForCombinations(null, VERSION, combinations, actual)).toBe(false);
    expect(isVerdictPassingForCombinations(undefined, VERSION, combinations, actual)).toBe(false);
  });

  it('REFUSES a verdict missing one combination — the machine-wide scope cannot ride on the per-user one', () => {
    const partial = buildSetVerdict(VERSION, [verdictFor(setupUser), verdictFor(archive)]);
    expect(isVerdictPassingForCombinations(partial, VERSION, combinations, actual)).toBe(false);
  });

  it('refuses when a verdict binds to different bytes than the ones being published', () => {
    expect(isVerdictPassingForCombinations(good, VERSION, combinations, { ...actual, archive: 'c'.repeat(64) })).toBe(
      false,
    );
  });

  it('refuses a verdict recorded for another version', () => {
    expect(isVerdictPassingForCombinations(good, '9.9.9', combinations, actual)).toBe(false);
  });

  it('refuses a failed step', () => {
    const bad = buildSetVerdict(VERSION, [
      verdictFor(setupUser),
      verdictFor(setupMachine, { ...allPassed(setupMachine), 'second-account': false }),
      verdictFor(archive),
    ]);
    expect(isVerdictPassingForCombinations(bad, VERSION, combinations, actual)).toBe(false);
  });

  it('refuses a verdict that marks an APPLICABLE step not-applicable — a skipped check in an exemption’s clothes', () => {
    const forged = buildSetVerdict(VERSION, [
      {
        ...verdictFor(setupUser),
        steps: { install: 'not-applicable', launch: 'passed', 'version-match': 'passed', uninstall: 'passed', 'residue-scan': 'passed' },
      },
      verdictFor(setupMachine),
      verdictFor(archive),
    ]);
    expect(isVerdictPassingForCombinations(forged, VERSION, combinations, actual)).toBe(false);
  });

  it('accepts unproven on a runner-limited step', () => {
    const ok = buildSetVerdict(VERSION, [
      verdictFor(setupUser),
      verdictFor(setupMachine, { ...allPassed(setupMachine), 'second-account': 'unproven' }),
      verdictFor(archive),
    ]);
    expect(isVerdictPassingForCombinations(ok, VERSION, combinations, actual)).toBe(true);
  });

  it('refuses unproven on a step that is not runner-limited, even if the verdict claims it passed', () => {
    const forged = buildSetVerdict(VERSION, [
      verdictFor(setupUser),
      { ...verdictFor(setupMachine), steps: { ...verdictFor(setupMachine).steps, launch: 'unproven' } },
      verdictFor(archive),
    ]);
    expect(isVerdictPassingForCombinations(forged, VERSION, combinations, actual)).toBe(false);
  });
});

describe('the shipped declaration verifies to the end state (042 FR-015)', () => {
  it('every combination can produce a passing verdict from its own applicable steps', () => {
    for (const combination of combinationsOf(declareArtifactSet(VERSION))) {
      const v = buildArtifactVerdict(combination, 'd'.repeat(64), allPassed(combination));
      expect(v.passed).toBe(true);
      expect(v.combination).toBe(combination.id);
    }
  });
});

describe('CoexistenceVerdict (058 FR-031)', () => {
  const copies = [{ id: 'setup-user', installRoot: 'C:/a', version: VERSION }];
  const allTrue = Object.fromEntries(COEXISTENCE_STEPS.map((s) => [s, true]));

  it('names the seven coexistence steps, including the reattach across copies (FR-021)', () => {
    expect([...COEXISTENCE_STEPS]).toEqual([
      'all-installed',
      'each-launches-own-version',
      'second-launch-refused',
      'same-data-folder',
      'reattach-across-copies',
      'reinstall-one-leaves-others',
      'uninstall-one-leaves-others',
    ]);
  });

  it('passes when every step passed', () => {
    const v = buildCoexistenceVerdict(VERSION, copies, allTrue);
    expect(v.passed).toBe(true);
    expect(isCoexistenceVerdictPassing(v, VERSION)).toBe(true);
  });

  it('fails on a failed step, naming it', () => {
    const v = buildCoexistenceVerdict(VERSION, copies, { ...allTrue, 'same-data-folder': false });
    expect(v.passed).toBe(false);
    expect(v.failedStep).toBe('same-data-folder');
    expect(isCoexistenceVerdictPassing(v, VERSION)).toBe(false);
  });

  it('fails on a step with no result — absence is not success', () => {
    const v = buildCoexistenceVerdict(VERSION, copies, { 'all-installed': true });
    expect(v.passed).toBe(false);
    expect(v.failedStep).toBe('each-launches-own-version');
  });

  it('is never passing when absent or recorded for another version', () => {
    expect(isCoexistenceVerdictPassing(null, VERSION)).toBe(false);
    expect(isCoexistenceVerdictPassing(buildCoexistenceVerdict('9.9.9', copies, allTrue), VERSION)).toBe(false);
  });

  it('does not trust the passed flag over the steps', () => {
    const v = buildCoexistenceVerdict(VERSION, copies, allTrue);
    const forged = { ...v, steps: { ...v.steps, 'all-installed': 'failed' as const } };
    expect(isCoexistenceVerdictPassing(forged, VERSION)).toBe(false);
  });
});
