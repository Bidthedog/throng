import { describe, expect, it } from 'vitest';

import { declareArtifactSet } from '@throng/core';

// @ts-expect-error — plain-JS build/CI script, imported for its pure command decision.
import { runArtifactSet } from '../../../../scripts/artifact-set.mjs';

/**
 * 042 FR-011/FR-012/FR-013 — the CLI `release.yml` calls instead of
 * `ls dist/installer/*.exe | head -n1`. `runArtifactSet` is the pure decision: it takes the argv,
 * the product version and the filenames actually present, and returns an exit code with what to
 * print. Reading the directory belongs to the thin `main()` around it.
 *
 * Exit codes are the contract (contracts/artifact-set.md): 0 success, 2 unknown role, 3 declared
 * artifact missing from the directory, 4 reconciliation failed.
 */

const VERSION = '1.2.3';
const SETUP = `throng-setup-${VERSION}.exe`;

// Derived from the declaration rather than written out, so adding a role does not silently make
// these tests assert a set that no longer exists.
const ALL = declareArtifactSet(VERSION).artifacts.map((a) => a.filename);

describe('artifact-set list (042 FR-011)', () => {
  it('exits 0 and lists every declared artifact', () => {
    const r = runArtifactSet({ argv: ['list'], version: VERSION, filenames: [SETUP] });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(SETUP);
    expect(r.stdout).toContain('setup');
  });

  it('emits the whole set as JSON for the workflow to consume', () => {
    const r = runArtifactSet({ argv: ['list', '--json'], version: VERSION, filenames: [SETUP] });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.version).toBe(VERSION);
    expect(parsed.artifacts.map((a: { role: string }) => a.role)).toContain('setup');
  });

  it('lists even when nothing has been built — a declaration is data, not a measurement', () => {
    const r = runArtifactSet({ argv: ['list'], version: VERSION, filenames: [] });
    expect(r.code).toBe(0);
  });

  it('emits one path per line with --paths, so an upload step names every artifact instead of globbing', () => {
    const r = runArtifactSet({ argv: ['list', '--paths'], version: VERSION, filenames: ALL, dir: 'dist/installer' });
    expect(r.code).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines).toHaveLength(ALL.length);
    for (const filename of ALL) expect(lines.some((l) => l.endsWith(filename))).toBe(true);
    for (const line of lines) expect(line).toContain('dist');
  });

  it('--paths carries nothing but the paths, so the output can be fed straight to a multi-line input', () => {
    const r = runArtifactSet({ argv: ['list', '--paths'], version: VERSION, filenames: [SETUP] });
    expect(r.stdout).not.toContain('\t');
    expect(r.stdout).not.toMatch(/Installer|setup\s/);
  });
});

describe('artifact-set resolve (042 FR-012)', () => {
  it('prints the bare filename and nothing else, so $(…) interpolation is safe', () => {
    const r = runArtifactSet({ argv: ['resolve', 'setup'], version: VERSION, filenames: [SETUP] });
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.stdout.trim().endsWith(SETUP)).toBe(true);
  });

  it('exits 2 for an unknown role, naming it and the valid ones', () => {
    const r = runArtifactSet({ argv: ['resolve', 'nonesuch'], version: VERSION, filenames: [SETUP] });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/nonesuch/);
    expect(r.stderr).toMatch(/setup/);
  });

  it('exits 3 when the declared artifact is not on disk, naming the expected filename', () => {
    const r = runArtifactSet({ argv: ['resolve', 'setup'], version: VERSION, filenames: [] });
    expect(r.code).toBe(3);
    expect(r.stderr).toContain(SETUP);
  });

  it('exits 2 when no role is given at all', () => {
    const r = runArtifactSet({ argv: ['resolve'], version: VERSION, filenames: [SETUP] });
    expect(r.code).toBe(2);
  });
});

describe('artifact-set reconcile (042 FR-013)', () => {
  it('exits 0 when the built set is exactly the declared set', () => {
    const r = runArtifactSet({ argv: ['reconcile'], version: VERSION, filenames: ALL });
    expect(r.code).toBe(0);
  });

  it('exits 4 naming a declared artifact the build did not produce', () => {
    const r = runArtifactSet({ argv: ['reconcile'], version: VERSION, filenames: [] });
    expect(r.code).toBe(4);
    expect(r.stderr).toContain(SETUP);
  });

  it('exits 4 when only SOME of the set was built — a partial build is not a build', () => {
    const r = runArtifactSet({ argv: ['reconcile'], version: VERSION, filenames: [SETUP] });
    expect(r.code).toBe(4);
  });

  it('exits 4 on an artifact the build produced but nobody declared', () => {
    const r = runArtifactSet({
      argv: ['reconcile'],
      version: VERSION,
      filenames: [...ALL, `throng-mystery-${VERSION}.exe`],
    });
    expect(r.code).toBe(4);
    expect(r.stderr).toMatch(/mystery/);
  });

  it('tolerates electron-builder side-car files, which are not artifacts', () => {
    const r = runArtifactSet({
      argv: ['reconcile'],
      version: VERSION,
      filenames: [...ALL, ...ALL.map((f) => `${f}.blockmap`), 'latest.yml', 'builder-debug.yml'],
    });
    expect(r.code).toBe(0);
  });
});

describe('artifact-set, unknown input', () => {
  it('exits 2 for an unknown subcommand, listing the ones it has', () => {
    const r = runArtifactSet({ argv: ['destroy'], version: VERSION, filenames: [SETUP] });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/list/);
    expect(r.stderr).toMatch(/resolve/);
    expect(r.stderr).toMatch(/reconcile/);
  });

  it('never exits 0 with an empty stderr on failure — a silent failure is the defect this replaces', () => {
    for (const argv of [['resolve', 'nonesuch'], ['resolve'], ['destroy']]) {
      const r = runArtifactSet({ argv, version: VERSION, filenames: [SETUP] });
      expect(r.code).not.toBe(0);
      expect(r.stderr.trim()).not.toBe('');
    }
  });
});
