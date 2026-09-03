import { describe, expect, it } from 'vitest';

import {
  buildArtifactVerdict,
  buildSetVerdict,
  declareArtifactSet,
  isVerdictPassingForSet,
} from '../../src/index.js';
import type { ReleaseArtifact, VerificationStep } from '../../src/index.js';

/**
 * 042 FR-014/FR-015/FR-016 — a verdict certifies the whole declared SET, not one installer.
 *
 * The third step state is the point of this file. An archive has no install step and no
 * uninstaller, and both available alternatives are wrong: running the fixed step list would fail a
 * good release, and marking those steps passed would make the verdict assert an uninstall that
 * never ran. 020 FR-027 already refuses to conflate absence with success for a missing verdict;
 * `not-applicable` applies the same rule to a step.
 */

const VERSION = '1.2.3';

const SETUP: ReleaseArtifact = {
  role: 'setup',
  filename: `throng-setup-${VERSION}.exe`,
  label: 'Installer',
  applicableSteps: ['install', 'launch', 'version-match', 'uninstall', 'residue-scan'],
  sha256: null,
};

const ARCHIVE: ReleaseArtifact = {
  role: 'archive',
  filename: `throng-${VERSION}.zip`,
  label: 'Archive',
  applicableSteps: ['launch', 'version-match', 'residue-scan'],
  sha256: null,
};

const SHA_SETUP = 'a'.repeat(64);
const SHA_ARCHIVE = 'b'.repeat(64);

function allPassed(artifact: ReleaseArtifact): Partial<Record<VerificationStep, boolean>> {
  return Object.fromEntries(artifact.applicableSteps.map((s) => [s, true]));
}

describe('buildArtifactVerdict — the three step states (042 FR-015)', () => {
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

describe('buildSetVerdict (042 FR-016)', () => {
  it('passes only when every artifact passed', () => {
    const verdict = buildSetVerdict(VERSION, [
      buildArtifactVerdict(SETUP, SHA_SETUP, allPassed(SETUP)),
      buildArtifactVerdict(ARCHIVE, SHA_ARCHIVE, allPassed(ARCHIVE)),
    ]);
    expect(verdict.passed).toBe(true);
  });

  it('fails when any one artifact failed, and names the step', () => {
    const verdict = buildSetVerdict(VERSION, [
      buildArtifactVerdict(SETUP, SHA_SETUP, allPassed(SETUP)),
      buildArtifactVerdict(ARCHIVE, SHA_ARCHIVE, { ...allPassed(ARCHIVE), launch: false }),
    ]);
    expect(verdict.passed).toBe(false);
    expect(verdict.failedStep).toBe('launch');
  });
});

describe('isVerdictPassingForSet (042 FR-016)', () => {
  const set = { version: VERSION, artifacts: [SETUP, ARCHIVE] };
  const actual = { setup: SHA_SETUP, archive: SHA_ARCHIVE };
  const good = buildSetVerdict(VERSION, [
    buildArtifactVerdict(SETUP, SHA_SETUP, allPassed(SETUP)),
    buildArtifactVerdict(ARCHIVE, SHA_ARCHIVE, allPassed(ARCHIVE)),
  ]);

  it('passes when every declared role has a passing verdict bound to the real bytes', () => {
    expect(isVerdictPassingForSet(good, VERSION, set, actual)).toBe(true);
  });

  it('treats an absent verdict as a failure (020 FR-027)', () => {
    expect(isVerdictPassingForSet(null, VERSION, set, actual)).toBe(false);
    expect(isVerdictPassingForSet(undefined, VERSION, set, actual)).toBe(false);
  });

  it('REFUSES a verdict covering only some of the declared set — a partial pass is not a pass', () => {
    const partial = buildSetVerdict(VERSION, [buildArtifactVerdict(SETUP, SHA_SETUP, allPassed(SETUP))]);
    expect(isVerdictPassingForSet(partial, VERSION, set, actual)).toBe(false);
  });

  it('refuses when an artifact’s verdict binds to different bytes than the ones being published', () => {
    expect(isVerdictPassingForSet(good, VERSION, set, { setup: SHA_SETUP, archive: 'c'.repeat(64) })).toBe(false);
  });

  it('refuses a verdict recorded for another version', () => {
    expect(isVerdictPassingForSet(good, '9.9.9', set, actual)).toBe(false);
  });

  it('refuses a verdict that marks an APPLICABLE step not-applicable — a skipped check in an exemption’s clothes', () => {
    const forged = buildSetVerdict(VERSION, [
      {
        ...buildArtifactVerdict(SETUP, SHA_SETUP, allPassed(SETUP)),
        steps: { install: 'not-applicable', launch: 'passed', 'version-match': 'passed', uninstall: 'passed', 'residue-scan': 'passed' },
      },
      buildArtifactVerdict(ARCHIVE, SHA_ARCHIVE, allPassed(ARCHIVE)),
    ]);
    expect(isVerdictPassingForSet(forged, VERSION, set, actual)).toBe(false);
  });
});

describe('the shipped declaration verifies to the end state (042 FR-015)', () => {
  it('every declared artifact can produce a passing verdict from its own applicable steps', () => {
    const set = declareArtifactSet(VERSION);
    for (const artifact of set.artifacts) {
      const v = buildArtifactVerdict(artifact, 'd'.repeat(64), allPassed(artifact));
      expect(v.passed).toBe(true);
    }
  });
});
