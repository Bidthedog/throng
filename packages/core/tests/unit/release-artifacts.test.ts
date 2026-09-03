import { describe, expect, it } from 'vitest';

import {
  declareArtifactSet,
  reconcileArtifactSet,
  resolveArtifact,
  VERIFICATION_STEPS,
} from '../../src/index.js';

/**
 * 042 FR-011/FR-012/FR-013 — a release has a DECLARED artifact set, and every consumer resolves
 * against it by role. The defect this replaces is three independent
 * `ls dist/installer/*.exe | head -n1` resolutions in `release.yml` that can each pick a different
 * file once a second `.exe`-producing target exists.
 */

const VERSION = '1.2.3';

describe('declareArtifactSet (042 FR-011)', () => {
  it('declares a non-empty set for the version', () => {
    const set = declareArtifactSet(VERSION);
    expect(set.version).toBe(VERSION);
    expect(set.artifacts.length).toBeGreaterThan(0);
  });

  it('carries the version in every filename, so a file separated from its context is identifiable', () => {
    for (const artifact of declareArtifactSet(VERSION).artifacts) {
      expect(artifact.filename).toContain(VERSION);
    }
  });

  it('gives every artifact a unique role', () => {
    const roles = declareArtifactSet(VERSION).artifacts.map((a) => a.role);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('gives every artifact a unique filename — two artifacts resolving to one file is the defect', () => {
    const names = declareArtifactSet(VERSION).artifacts.map((a) => a.filename);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every artifact a human label, so the release body can say which file a reader wants', () => {
    for (const artifact of declareArtifactSet(VERSION).artifacts) {
      expect(artifact.label.trim()).not.toBe('');
    }
  });

  it('declares no checksum — the digest is computed from the published bytes, not declared (020 FR-042a)', () => {
    for (const artifact of declareArtifactSet(VERSION).artifacts) {
      expect(artifact.sha256).toBeNull();
    }
  });

  it('holds every applicable step within the known step vocabulary', () => {
    for (const artifact of declareArtifactSet(VERSION).artifacts) {
      for (const step of artifact.applicableSteps) {
        expect(VERIFICATION_STEPS).toContain(step);
      }
    }
  });

  it('holds every format to the same end state — the six steps that mean "it works and leaves nothing behind" (FR-015)', () => {
    const endState = [
      'launch',
      'version-match',
      'self-contained',
      'core-journey',
      'checksum-match',
      'residue-scan',
    ];
    for (const artifact of declareArtifactSet(VERSION).artifacts) {
      for (const step of endState) {
        expect(artifact.applicableSteps).toContain(step);
      }
    }
  });
});

describe('resolveArtifact (042 FR-012)', () => {
  it('returns exactly one artifact for a known role', () => {
    const set = declareArtifactSet(VERSION);
    const found = resolveArtifact(set, 'setup');
    expect(found.role).toBe('setup');
    expect(found.filename).toContain(VERSION);
  });

  it('throws for an unknown role, naming it and listing the valid ones', () => {
    const set = declareArtifactSet(VERSION);
    expect(() => resolveArtifact(set, 'nonesuch' as never)).toThrowError(/nonesuch/);
    expect(() => resolveArtifact(set, 'nonesuch' as never)).toThrowError(/setup/);
  });

  it('never returns "the first match" — every declared role resolves to its own artifact', () => {
    const set = declareArtifactSet(VERSION);
    const resolved = set.artifacts.map((a) => resolveArtifact(set, a.role).filename);
    expect(new Set(resolved).size).toBe(set.artifacts.length);
  });
});

describe('reconcileArtifactSet (042 FR-013)', () => {
  const declared = declareArtifactSet(VERSION);
  const allFilenames = declared.artifacts.map((a) => a.filename);

  it('matches when the produced set is exactly the declared set', () => {
    const result = reconcileArtifactSet(declared, allFilenames);
    expect(result).toEqual({ matched: true, missing: [], unexpected: [], reason: null });
  });

  it('is order-independent — a directory listing is not a declaration', () => {
    const result = reconcileArtifactSet(declared, [...allFilenames].reverse());
    expect(result.matched).toBe(true);
  });

  it('reports a declared artifact the build did not produce', () => {
    const result = reconcileArtifactSet(declared, allFilenames.slice(1));
    expect(result.matched).toBe(false);
    expect(result.missing).toEqual([allFilenames[0]]);
    expect(result.reason).toMatch(/missing/i);
  });

  it('FAILS on an artifact the build produced but nobody declared', () => {
    const result = reconcileArtifactSet(declared, [...allFilenames, 'throng-mystery-1.2.3.exe']);
    expect(result.matched).toBe(false);
    expect(result.unexpected).toEqual(['throng-mystery-1.2.3.exe']);
    expect(result.reason).toMatch(/unexpected|not declared/i);
  });

  it('reports both directions at once, in one sentence', () => {
    const result = reconcileArtifactSet(declared, ['throng-mystery-1.2.3.exe']);
    expect(result.matched).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.unexpected).toEqual(['throng-mystery-1.2.3.exe']);
    expect(result.reason).not.toBeNull();
    expect(result.reason?.split('\n')).toHaveLength(1);
  });

  it('ignores files that are not artifacts at all, rather than calling them unexpected', () => {
    const result = reconcileArtifactSet(declared, [...allFilenames, 'builder-debug.yml', 'latest.yml']);
    expect(result.matched).toBe(true);
  });
});
