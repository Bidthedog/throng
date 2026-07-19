import { describe, expect, it } from 'vitest';

import { compareVersions, isPlaceholderVersion, matchReleaseVersions } from '../../src/index.js';

/**
 * 020 FR-002 / FR-016a / FR-028 — the product version is an ordered, comparable identifier.
 *
 * `compareVersions` drives upgrade/downgrade detection (FR-016a: an installer refuses an older
 * version over a newer one) and `isPlaceholderVersion` drives the publish gate (FR-028 (a): a
 * placeholder version cannot be published).
 */
describe('product version ordering (020 FR-002/016a)', () => {
  it('orders MAJOR.MINOR.PATCH', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.0.1', '1.1.0')).toBeLessThan(0);
    expect(compareVersions('1.1.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('treats equal versions as equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('tolerates a leading v and build/prerelease suffixes for core ordering', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.3+build.5', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3-rc.1', '1.2.4')).toBeLessThan(0);
  });

  it('detects a downgrade (older over newer)', () => {
    // installing 1.0.0 over an installed 1.1.0 is a downgrade → older < newer
    expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
  });
});

describe('placeholder version (020 FR-028 (a))', () => {
  it('flags 0.0.0 and empty as placeholders', () => {
    expect(isPlaceholderVersion('0.0.0')).toBe(true);
    expect(isPlaceholderVersion('')).toBe(true);
    expect(isPlaceholderVersion('   ')).toBe(true);
  });

  it('accepts a real version', () => {
    expect(isPlaceholderVersion('1.0.0')).toBe(false);
    expect(isPlaceholderVersion('0.1.0')).toBe(false);
  });
});

describe('four-way release version match (020 SC-002)', () => {
  const good = {
    installerFilename: 'throng-setup-1.2.3.exe',
    packageVersion: '1.2.3',
    reportedVersion: '1.2.3',
    releaseTag: 'v1.2.3',
  };

  it('matches when filename, package, reported and tag all agree (tag may carry a leading v)', () => {
    expect(matchReleaseVersions(good)).toEqual({ matched: true, reason: null });
  });

  it('rejects and names a filename version that disagrees', () => {
    const r = matchReleaseVersions({ ...good, installerFilename: 'throng-setup-1.2.4.exe' });
    expect(r.matched).toBe(false);
    expect(r.reason).toMatch(/filename/i);
  });

  it('rejects and names a reported app version that disagrees', () => {
    const r = matchReleaseVersions({ ...good, reportedVersion: '1.2.4' });
    expect(r.matched).toBe(false);
    expect(r.reason).toMatch(/reported/i);
  });

  it('rejects and names a release tag that disagrees', () => {
    const r = matchReleaseVersions({ ...good, releaseTag: 'v2.0.0' });
    expect(r.matched).toBe(false);
    expect(r.reason).toMatch(/tag/i);
  });

  it('rejects an installer filename that carries no version', () => {
    const r = matchReleaseVersions({ ...good, installerFilename: 'throng-setup.exe' });
    expect(r.matched).toBe(false);
    expect(r.reason).toMatch(/filename/i);
  });

  it('rejects a prerelease that shares the core but not the full version (no stable/prerelease slip)', () => {
    // A stable package 1.2.3 must NOT align with a prerelease tag/filename of the same core.
    expect(matchReleaseVersions({ ...good, releaseTag: 'v1.2.3-rc.1' }).matched).toBe(false);
    expect(
      matchReleaseVersions({ ...good, installerFilename: 'throng-setup-1.2.3-rc.1.exe' }).matched,
    ).toBe(false);
    // …and a prerelease release lines up only when every representation carries the same prerelease.
    expect(
      matchReleaseVersions({
        installerFilename: 'throng-setup-1.2.3-rc.1.exe',
        packageVersion: '1.2.3-rc.1',
        reportedVersion: '1.2.3-rc.1',
        releaseTag: 'v1.2.3-rc.1',
      }).matched,
    ).toBe(true);
  });
});
