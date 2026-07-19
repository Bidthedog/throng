/**
 * Product version helpers (020 FR-002 / FR-016a / FR-028).
 *
 * The single authoritative product version is the root `package.json` `version` (read at the
 * boundaries — Electron's `app.getVersion()` in the UI main process, a build-generated constant
 * in the daemon). These pure helpers give the version its ORDER (upgrade/downgrade comparison,
 * FR-016a) and its placeholder test (publish refusal, FR-028 (a)) without reading any file, so
 * they are usable in every boundary including the renderer.
 *
 * The product version is deliberately DISTINCT from the content-hash `BUILD_ID`
 * (`scripts/stamp-build.mjs`, FR-006): the version identifies a release, the build id detects a
 * stale daemon. Two builds of one version differ in build id but not in version.
 */

/** Parse the numeric `MAJOR.MINOR.PATCH` core of a version, ignoring a leading `v`, prerelease and build metadata. */
function semverCore(version: string): [number, number, number] {
  const core = version.trim().replace(/^v/i, '').split('-')[0].split('+')[0];
  const parts = core.split('.').map((n) => Number.parseInt(n, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Ordered comparison of two versions by their `MAJOR.MINOR.PATCH` core: negative when `a` is
 * older than `b`, zero when equal, positive when `a` is newer. Prerelease/build suffixes do not
 * affect the core ordering (sufficient for the upgrade/downgrade decision, FR-016a).
 */
export function compareVersions(a: string, b: string): number {
  const ca = semverCore(a);
  const cb = semverCore(b);
  for (let i = 0; i < 3; i++) {
    if (ca[i] !== cb[i]) return ca[i] - cb[i];
  }
  return 0;
}

/**
 * True when `version` is a placeholder that MUST NOT be published (FR-028 (a)): the initial
 * `0.0.0` every package still carries, or an empty/blank value.
 */
export function isPlaceholderVersion(version: string): boolean {
  const trimmed = version.trim();
  return trimmed === '' || semverCore(trimmed).every((n) => n === 0);
}

/** The four version representations that MUST agree for a release (020 SC-002). */
export interface ReleaseVersionSources {
  /** The installer artifact filename, e.g. `throng-setup-1.2.3.exe`. */
  installerFilename: string;
  /** The internal (root `package.json`) product version. */
  packageVersion: string;
  /** The version the installed app reports (installed manifest / `app.getVersion()`). */
  reportedVersion: string;
  /** The release tag, e.g. `v1.2.3` (a leading `v` is tolerated). */
  releaseTag: string;
}

export interface VersionMatchResult {
  /** True only when all four representations carry the same MAJOR.MINOR.PATCH core. */
  matched: boolean;
  /** The first disagreement, naming the offending representation; `null` when matched. */
  reason: string | null;
}

/** Extract the `MAJOR.MINOR.PATCH(-pre)(+build)` version embedded in an installer filename. */
function versionFromInstallerFilename(name: string): string | null {
  // Drop the file extension first, or a greedy prerelease match swallows it (…-rc.1.exe → -rc.1.exe).
  const base = name.replace(/\.[A-Za-z][A-Za-z0-9]*$/, '');
  const m = base.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return m ? m[1] : null;
}

/**
 * Assert the **four-way version match** (020 SC-002): the installer filename, the internal package
 * version, the reported app version and the release tag all carry the same version core. This is
 * what binds a release (and the human sign-off that gates it, FR-030/033) to the exact package — a
 * tag or filename for a different build fails here rather than publishing a mislabelled artifact.
 * Compared by numeric core (a leading `v` and prerelease/build suffixes do not matter).
 */
export function matchReleaseVersions(sources: ReleaseVersionSources): VersionMatchResult {
  const filenameVersion = versionFromInstallerFilename(sources.installerFilename);
  if (!filenameVersion) {
    return { matched: false, reason: `the installer filename "${sources.installerFilename}" carries no version` };
  }
  const ref = sources.packageVersion;
  // Full identity (leading `v` and `+build` metadata do not matter, but the PRERELEASE does — a
  // stable build must not align with a same-core prerelease tag/filename, and vice-versa).
  const identity = (v: string): string => v.trim().replace(/^v/i, '').split('+')[0];
  const refId = identity(ref);
  const checks: Array<[string, string]> = [
    ['installer filename version', filenameVersion],
    ['reported app version', sources.reportedVersion],
    ['release tag', sources.releaseTag],
  ];
  for (const [label, value] of checks) {
    if (compareVersions(value, ref) !== 0 || identity(value) !== refId) {
      return { matched: false, reason: `${label} (${value}) does not match the package version (${ref})` };
    }
  }
  return { matched: true, reason: null };
}
