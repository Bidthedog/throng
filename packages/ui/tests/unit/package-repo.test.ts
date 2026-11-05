import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS build/CI script, imported for its pure decisions.
import { aptRelease, aptStanza, buildIndexes, channelsFor, compareSemver, releaseAssetPath, selectBundles } from '../../../../scripts/package-repo.mjs';

/** 064: which index goes where. Getting this wrong puts an alpha in front of a stable user. */

describe('compareSemver (064 FR-007)', () => {
  it.each([
    ['1.0.0', '1.0.0-alpha12', 1],
    ['1.0.0-alpha12', '1.0.0-alpha2', 1],
    ['1.0.0-rc.1', '1.0.0-alpha12', 1],
    ['1.0.0-rc.10', '1.0.0-rc.2', 1],
    ['1.1.0-alpha1', '1.0.0', 1],
    ['1.0.1', '1.0.0', 1],
    ['1.10.0', '1.9.0', 1],
    ['1.0.0', '1.0.0', 0],
  ])('%s against %s', (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected);
    expect(compareSemver(b, a)).toBe(expected === 0 ? 0 : -expected);
  });
});

describe('channelsFor (064 FR-007)', () => {
  it('a stable release updates both channels', () => {
    expect(channelsFor('1.0.0')).toEqual(['stable', 'prerelease']);
  });
  it('a prerelease updates only the prerelease channel', () => {
    expect(channelsFor('1.0.0-alpha12')).toEqual(['prerelease']);
  });
  it('building a stable index from a prerelease is refused, before anything is read', () => {
    expect(() => buildIndexes({ version: '1.0.0-alpha12', out: 'unused', deb: 'unused', channels: ['stable'] })).toThrow(/stable channel/);
  });
});

describe('selectBundles (064 FR-007, SC-005)', () => {
  const release = (version: string, withBundle = true, overrides = {}): object => ({
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes('-'),
    assets: withBundle ? [{ name: `throng-repo-index-${version}.tar.gz` }, { name: `throng-${version}-amd64.deb` }] : [{ name: 'other.zip' }],
    ...overrides,
  });

  it('is empty before any release carries a bundle', () => {
    expect(selectBundles([release('1.0.0-alpha12', false)])).toEqual({ stable: null, prerelease: null });
  });

  it('never takes a prerelease for the stable channel', () => {
    const picked = selectBundles([release('1.0.0-alpha13'), release('1.0.0-alpha12')]);
    expect(picked.stable).toBeNull();
    expect(picked.prerelease?.version).toBe('1.0.0-alpha13');
  });

  it('needs the version and the release flag to agree before a release is stable', () => {
    const picked = selectBundles([release('1.0.0-alpha13', true, { prerelease: false }), release('1.1.0', true, { prerelease: true })]);
    expect(picked.stable).toBeNull();
  });

  it('gives a prerelease user the stable release when it is the highest', () => {
    const picked = selectBundles([release('1.0.0'), release('1.0.0-rc.1')]);
    expect(picked.stable?.version).toBe('1.0.0');
    expect(picked.prerelease?.version).toBe('1.0.0');
  });

  it('gives a prerelease user the newer prerelease above stable', () => {
    const picked = selectBundles([release('1.1.0-alpha1'), release('1.0.0')]);
    expect(picked.stable?.version).toBe('1.0.0');
    expect(picked.prerelease?.version).toBe('1.1.0-alpha1');
  });

  it('takes the highest version, not the most recently published', () => {
    const picked = selectBundles([release('1.0.1'), release('1.1.0')]);
    expect(picked.stable?.version).toBe('1.1.0');
  });

  it('ignores a draft', () => {
    const picked = selectBundles([release('2.0.0', true, { draft: true }), release('1.0.0')]);
    expect(picked.stable?.version).toBe('1.0.0');
  });

  it('skips a release with no bundle, and uses the one before it', () => {
    const picked = selectBundles([release('1.1.0', false), release('1.0.0')]);
    expect(picked.stable?.version).toBe('1.0.0');
  });
});

describe('the apt index (064 FR-005)', () => {
  it('points at the release asset, relative to the mirror', () => {
    expect(releaseAssetPath('1.0.0-alpha12', 'throng-1.0.0-alpha12-amd64.deb')).toBe(
      'Bidthedog/throng/releases/download/v1.0.0-alpha12/throng-1.0.0-alpha12-amd64.deb',
    );
  });

  it('adds the location and hashes to the control fields', () => {
    const stanza = aptStanza('Package: throng\nVersion: 1.0.0~alpha12\n', { filename: 'a/b.deb', size: 42, sha256: 'abc' });
    expect(stanza).toBe('Package: throng\nVersion: 1.0.0~alpha12\nFilename: a/b.deb\nSize: 42\nSHA256: abc\n');
  });

  it('names its own channel in Release, and hashes every index', () => {
    const text = aptRelease('prerelease', new Date('2026-11-04T12:00:00Z'), [{ path: 'main/binary-amd64/Packages', size: 5, sha256: 'ff' }]);
    expect(text).toContain('Suite: prerelease\n');
    expect(text).toContain('Codename: prerelease\n');
    expect(text).toContain('Date: Wed, 04 Nov 2026 12:00:00 UTC\n');
    expect(text).toContain('SHA256:\n ff 5 main/binary-amd64/Packages\n');
  });
});
