import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { declareArtifactSet, lookupReleaseNotes } from '@throng/core';

// @ts-expect-error — plain-JS build/CI script, imported for its pure command decision.
import { runReleaseNotes } from '../../../../scripts/release-notes.mjs';

/**
 * 042 FR-002/FR-005 — the CLI that renders the release body, and the standing check that this
 * repository's own `CHANGELOG.md` still satisfies the parser.
 *
 * Exit codes are the contract (contracts/release-notes.md): 0 rendered, 2 no section for the
 * version, 3 the section is empty, 4 a version mismatch.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const ARTIFACTS = [
  {
    role: 'setup',
    filename: 'throng-setup-1.2.3.exe',
    label: 'Installer (setup)',
    audience: 'Most people: installs for you, or for everyone on the machine',
    scopes: ['per-user', 'machine'],
    applicableSteps: [],
    sha256: 'a'.repeat(64),
  },
];

const CHANGELOG = `# Changelog

## 1.2.3

### Fixed
- A real fix.

## 1.2.2

### Fixed
`;

const BASE = { changelog: CHANGELOG, artifacts: ARTIFACTS, commitSha: 'c'.repeat(40) };

describe('release-notes render (042 FR-002)', () => {
  it('exits 0 and writes a body carrying the notes and the footer', () => {
    const r = runReleaseNotes({ argv: ['render', '--version', '1.2.3'], ...BASE });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('A real fix.');
    expect(r.stdout).toContain('SHA-256');
    expect(r.stdout).toContain('throng-setup-1.2.3.exe');
  });

  it('exits 2 when there is no section for the version, naming the version it looked for', () => {
    const r = runReleaseNotes({ argv: ['render', '--version', '9.9.9'], ...BASE });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('9.9.9');
  });

  it('exits 3 when the section exists but declares nothing', () => {
    const r = runReleaseNotes({ argv: ['render', '--version', '1.2.2'], ...BASE });
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('1.2.2');
  });

  it('exits 2 when no version is given — it must never guess which release it is rendering', () => {
    const r = runReleaseNotes({ argv: ['render'], ...BASE });
    expect(r.code).toBe(2);
  });

  it('exits non-zero with a reason for an unknown subcommand', () => {
    const r = runReleaseNotes({ argv: ['invent'], ...BASE });
    expect(r.code).not.toBe(0);
    expect(r.stderr.trim()).not.toBe('');
  });

  it('never writes a body on a refusal — a partial body is how boilerplate creeps back in', () => {
    for (const version of ['9.9.9', '1.2.2']) {
      const r = runReleaseNotes({ argv: ['render', '--version', version], ...BASE });
      expect(r.stdout).toBe('');
    }
  });
});

describe('release-notes render — the MSI and the verification gaps (058 FR-032/FR-033)', () => {
  const FOUR = declareArtifactSet('1.2.3').artifacts.map((a, i) => ({ ...a, sha256: String(i + 1).repeat(64) }));
  const FOUR_BASE = { ...BASE, artifacts: FOUR };

  it('renders each artifact’s audience line and one SHA-256 row for each of the four artifacts', () => {
    const r = runReleaseNotes({ argv: ['render', '--version', '1.2.3'], ...FOUR_BASE });
    expect(r.code).toBe(0);
    for (const artifact of FOUR) {
      expect(r.stdout).toContain(artifact.filename);
      expect(r.stdout).toContain(artifact.audience);
      expect(r.stdout).toContain(artifact.sha256);
    }
    expect(r.stdout).toContain('throng-1.2.3.msi');
  });

  it('lists every unproven step when given them, and nothing when given none', () => {
    const gaps = [{ combination: 'msi-machine', step: 'second-account', reason: 'no second desktop' }];
    const withGaps = runReleaseNotes({ argv: ['render', '--version', '1.2.3'], ...FOUR_BASE, gaps });
    expect(withGaps.stdout).toMatch(/verification gaps/i);
    expect(withGaps.stdout).toContain('msi-machine');
    expect(withGaps.stdout).toContain('no second desktop');

    const without = runReleaseNotes({ argv: ['render', '--version', '1.2.3'], ...FOUR_BASE });
    expect(without.stdout).not.toMatch(/verification gap/i);
  });
});

describe("this repository's CHANGELOG.md (042 FR-003/FR-005)", () => {
  const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
  const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;

  it('carries a section for the version in package.json, so a release of it would not be refused', () => {
    const r = lookupReleaseNotes(changelog, version);
    expect(r.cause).toBeNull();
    expect(r.found?.sections.length).toBeGreaterThan(0);
  });

  it('carries an Unreleased section for work to accumulate in', () => {
    expect(changelog).toMatch(/^## Unreleased/m);
  });

  it('keeps its own guidance in an HTML comment, so it can never reach a release body', () => {
    const r = lookupReleaseNotes(changelog, version);
    expect(JSON.stringify(r.found)).not.toMatch(/RECONSTRUCTED|HOW THIS FILE IS USED/);
  });
});
