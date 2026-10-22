import { describe, expect, it } from 'vitest';

import {
  combinationsOf,
  declareArtifactSet,
  END_STATE_STEPS,
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

  it('treats .msi as an artifact extension (058 FR-027): an undeclared MSI fails, a missing one is named', () => {
    const extra = reconcileArtifactSet(declared, [...allFilenames, 'throng-9.9.9.msi']);
    expect(extra.matched).toBe(false);
    expect(extra.unexpected).toEqual(['throng-9.9.9.msi']);

    const missing = reconcileArtifactSet(
      declared,
      allFilenames.filter((f) => !f.endsWith('.msi')),
    );
    expect(missing.matched).toBe(false);
    expect(missing.missing).toEqual([`throng-${VERSION}.msi`]);
  });
});

/**
 * 058 FR-003a/FR-026/FR-033 — the MSI is a role in the declared set; setup and MSI offer both install
 * scopes; every artifact says who it is for.
 */
describe('the MSI role and install scopes (058 FR-003a, FR-026, FR-033)', () => {
  const set = declareArtifactSet(VERSION);

  it('declares four artifacts, the MSI among them, resolved by role', () => {
    expect(set.artifacts.map((a) => a.role).sort()).toEqual(['archive', 'msi', 'portable', 'setup']);
    const msi = resolveArtifact(set, 'msi');
    expect(msi.filename).toBe(`throng-${VERSION}.msi`);
    expect(msi.label).toBe('Installer (MSI, for managed deployment)');
  });

  it('labels the setup without naming a scope, since it offers both (FR-003)', () => {
    const label = resolveArtifact(set, 'setup').label;
    expect(label).toBe('Installer (setup)');
    expect(label).not.toMatch(/per-user|machine|all users/i);
  });

  it('gives setup and msi both scopes, and portable and archive none (FR-003)', () => {
    expect(resolveArtifact(set, 'setup').scopes).toEqual(['per-user', 'machine']);
    expect(resolveArtifact(set, 'msi').scopes).toEqual(['per-user', 'machine']);
    expect(resolveArtifact(set, 'portable').scopes).toEqual([]);
    expect(resolveArtifact(set, 'archive').scopes).toEqual([]);
  });

  it('gives every artifact a one-line audience for the release body (FR-033)', () => {
    for (const artifact of set.artifacts) {
      expect(artifact.audience.trim()).not.toBe('');
      expect(artifact.audience).not.toContain('\n');
    }
  });

  it('checks the install labels on every installer, whatever its scope (FR-017b)', () => {
    expect(resolveArtifact(set, 'setup').applicableSteps).toContain('install-labels');
    expect(resolveArtifact(set, 'msi').applicableSteps).toContain('install-labels');
  });
});

describe('combinationsOf (058 FR-028, FR-030)', () => {
  const combos = combinationsOf(declareArtifactSet(VERSION));
  const byId = (id: string) => {
    const found = combos.find((c) => c.id === id);
    if (!found) throw new Error(`no combination ${id}`);
    return found;
  };

  it('yields exactly one combination per artifact-and-scope, in a fixed order', () => {
    expect(combos.map((c) => c.id)).toEqual([
      'setup-user',
      'setup-machine',
      'msi-user',
      'msi-machine',
      'portable',
      'archive',
    ]);
  });

  it('names each verdict file for its combination', () => {
    for (const c of combos) expect(c.verdictFile).toBe(`verification-verdict-${c.id}.json`);
  });

  it('carries the role and the scope, null for an artifact without scopes', () => {
    expect(byId('msi-machine')).toMatchObject({ role: 'msi', scope: 'machine' });
    expect(byId('setup-user')).toMatchObject({ role: 'setup', scope: 'per-user' });
    expect(byId('portable').scope).toBeNull();
    expect(byId('archive').scope).toBeNull();
  });

  it('adds the standard-account install to every per-user combination (FR-006)', () => {
    expect(byId('setup-user').applicableSteps).toContain('standard-account-install');
    expect(byId('msi-user').applicableSteps).toContain('standard-account-install');
    expect(byId('setup-machine').applicableSteps).not.toContain('standard-account-install');
  });

  it('adds the second-account, in-use and not-elevated steps to every machine-wide combination', () => {
    for (const id of ['setup-machine', 'msi-machine']) {
      for (const step of ['second-account', 'in-use-upgrade', 'not-elevated-launch']) {
        expect(byId(id).applicableSteps).toContain(step);
      }
    }
    expect(byId('setup-user').applicableSteps).not.toContain('second-account');
  });

  it('adds silent-elevation-refused to the setup’s machine-wide combination only (FR-010)', () => {
    expect(byId('setup-machine').applicableSteps).toContain('silent-elevation-refused');
    expect(byId('msi-machine').applicableSteps).not.toContain('silent-elevation-refused');
    expect(byId('setup-user').applicableSteps).not.toContain('silent-elevation-refused');
  });

  it('puts install-labels and no-write on every setup and msi combination', () => {
    for (const id of ['setup-user', 'setup-machine', 'msi-user', 'msi-machine']) {
      expect(byId(id).applicableSteps).toContain('install-labels');
      expect(byId(id).applicableSteps).toContain('no-write');
    }
  });

  it('leaves portable and archive with their own steps only', () => {
    const artifact = resolveArtifact(declareArtifactSet(VERSION), 'portable');
    expect(byId('portable').applicableSteps).toEqual(artifact.applicableSteps);
  });

  it('holds every combination to the same end state (042 FR-015)', () => {
    for (const c of combos) for (const step of END_STATE_STEPS) expect(c.applicableSteps).toContain(step);
  });

  it('stays within the step vocabulary', () => {
    for (const c of combos) for (const step of c.applicableSteps) expect(VERIFICATION_STEPS).toContain(step);
  });
});
