/**
 * The declared release artifact set (042 FR-011/FR-012/FR-013).
 *
 * A release consists of a KNOWN list of artifacts, declared in one place, and every consumer —
 * packaging, verification, the publish gates, the release body — resolves against that declaration
 * by ROLE. Nothing globs, nothing switches on a file extension, and nothing depends on the order a
 * directory happens to list its contents.
 *
 * That rule exists because of a specific defect. `release.yml` resolved the installer three
 * independent times as `ls dist/installer/*.exe | head -n1` — once to verify it, once for the
 * publish gates, once for the checksum that goes into the release body. With one artifact that is
 * merely fragile. With two `.exe`-producing targets it is wrong, SILENTLY: the three resolutions can
 * each pick a different file, so the gates would verify one artifact while the release published
 * another's checksum, and nothing in the pipeline would report it.
 *
 * This module is the pure declaration and the pure comparisons over it. Reading a directory,
 * hashing bytes and driving an installer belong to `scripts/*.mjs`, which is build tooling — the
 * same split `publish-gate.ts` and `scripts/publish-gates.mjs` already use, and the reason any of
 * this is testable without cutting a release.
 */

import type { VerificationStep } from './verification-verdict.js';

/**
 * How every consumer names an artifact. Not an extension, not a filename, not a position in a
 * listing — those are the three identifiers that collide.
 *
 * The set is closed for 042 and deliberately open to growth: #361 adds a machine-wide installer, so
 * no consumer may assume the count.
 */
export type ReleaseArtifactRole = 'setup' | 'msi' | 'portable' | 'archive';

/**
 * Where an installer puts itself (058 FR-003, spec entity *Install scope*): for the signed-in user
 * alone, needing no elevation, or for every account on the machine, needing it.
 */
export type InstallScope = 'per-user' | 'machine';

/**
 * The steps that constitute "it works, and it leaves nothing behind" — the end state 042 FR-015
 * holds EVERY format to, whatever route it took onto disk. A format may add steps beyond these
 * (an installer also uninstalls); none may omit one.
 */
export const END_STATE_STEPS: readonly VerificationStep[] = [
  'launch', // it started
  'version-match', // it is the version it claims to be
  'self-contained', // its daemon runs under the BUNDLED runtime, not a PATH node (020 FR-009)
  'core-journey', // the app and its daemon boot together
  'checksum-match', // its bytes are the bytes that were published (020 FR-024a)
  'residue-scan', // nothing is left behind afterwards (042 FR-021)
];

/** One member of the declared set. */
export interface ReleaseArtifact {
  /** The stable identity every consumer asks for. Unique within a set. */
  role: ReleaseArtifactRole;
  /** The exact expected filename, version already interpolated. Never a pattern at this point. */
  filename: string;
  /** What the release body calls it, for a reader choosing between artifacts (042 FR-023). */
  label: string;
  /** One line saying who should download this one (058 FR-033, research D12). */
  audience: string;
  /**
   * The install scopes this format offers (058 FR-003): both for the installers, none for the
   * formats that install nothing. Each scope is verified on its own (FR-028) — see
   * {@link combinationsOf}.
   */
  scopes: readonly InstallScope[];
  /**
   * Which verification steps mean something for this format. A step OUTSIDE this list is recorded
   * `not-applicable` in the verdict — never `passed`. An archive has no uninstaller, and a verdict
   * asserting an uninstall that never ran is worse than one that fails honestly (020 FR-027 takes
   * the same position: absence is not success).
   */
  applicableSteps: readonly VerificationStep[];
  /** The digest of the published bytes; `null` in a declaration, filled once the bytes exist. */
  sha256: string | null;
}

/** Every artifact one release consists of, in the order the release body should list them. */
export interface ReleaseArtifactSet {
  /** The product version this set belongs to (020 FR-001 — the root `package.json`). */
  version: string;
  artifacts: readonly ReleaseArtifact[];
}

/** The outcome of comparing a declaration against what a build actually produced. */
export interface ReconcileResult {
  /** True only when the produced set is exactly the declared set. */
  matched: boolean;
  /** Declared but not produced. */
  missing: readonly string[];
  /** Produced but not declared — a failure, not a curiosity (see `reconcileArtifactSet`). */
  unexpected: readonly string[];
  /** One sentence naming the discrepancy, for the refusal message (020 FR-031); `null` when matched. */
  reason: string | null;
}

/**
 * The single authoritative declaration. Every filename carries the version, following the pattern
 * `electron-builder.yml` already uses for the setup installer (`throng-setup-${version}.${ext}`), so
 * an artifact separated from its release is still identifiable (020 FR-004's principle).
 */
export function declareArtifactSet(version: string): ReleaseArtifactSet {
  return {
    version,
    artifacts: [
      {
        role: 'setup',
        filename: `throng-setup-${version}.exe`,
        label: 'Installer (setup)',
        audience: 'Most people: installs for you, or for everyone on the machine',
        scopes: ['per-user', 'machine'],
        // The installer is the only format that installs, and therefore the only one that can
        // uninstall, register a shortcut, or be interrupted mid-install. `no-write` asserts nothing
        // is written under the INSTALL ROOT at runtime (020 FR-008) — a property of an installed
        // program in a shared location, which a folder the user owns does not have.
        applicableSteps: [
          'interrupted-install',
          'install',
          'install-labels',
          'launch',
          'version-match',
          'self-contained',
          'shortcut',
          'no-service',
          'core-journey',
          'reattach',
          'checksum-match',
          'no-write',
          'uninstall',
          'residue-scan',
        ],
        sha256: null,
      },
      {
        role: 'msi',
        filename: `throng-${version}.msi`,
        label: 'Installer (MSI, for managed deployment)',
        audience: 'Administrators deploying with Intune, SCCM or Group Policy',
        scopes: ['per-user', 'machine'],
        // A Windows Installer package registers a shortcut and an uninstall entry and is interrupted
        // and uninstalled exactly as the setup is, so it takes the setup's whole list.
        applicableSteps: [
          'interrupted-install',
          'install',
          'install-labels',
          'launch',
          'version-match',
          'self-contained',
          'shortcut',
          'no-service',
          'core-journey',
          'reattach',
          'checksum-match',
          'no-write',
          'uninstall',
          'residue-scan',
        ],
        sha256: null,
      },
      {
        role: 'portable',
        filename: `throng-portable-${version}.exe`,
        label: 'Portable (no installation)',
        audience: 'Run without installing',
        scopes: [],
        // A self-extracting executable installs nothing, so it has no install, uninstall or
        // shortcut step, and `no-write` — which asserts nothing is written under the INSTALL ROOT
        // at runtime — has no install root to be about.
        //
        // `residue-scan` DOES apply, and is the hardest step this format has. A portable build
        // unpacks itself somewhere that is not the folder the user deleted, so a scan pointed only
        // at the download location will pass while a full copy of throng remains on disk. That is
        // the likeliest way this feature ships a false green; see specs/042 research D4.
        applicableSteps: [
          'launch',
          'version-match',
          'self-contained',
          'no-service',
          'core-journey',
          'reattach',
          'checksum-match',
          'residue-scan',
        ],
        sha256: null,
      },
      {
        role: 'archive',
        filename: `throng-${version}.zip`,
        label: 'Archive (extract and run)',
        audience: 'Extract and run anywhere',
        scopes: [],
        // Extract-and-run: the folder IS the installation, so deleting it is the whole uninstall.
        applicableSteps: [
          'launch',
          'version-match',
          'self-contained',
          'no-service',
          'core-journey',
          'reattach',
          'checksum-match',
          'residue-scan',
        ],
        sha256: null,
      },
    ],
  };
}

/**
 * One thing to verify on one clean machine (058 FR-028, spec entity *Verification combination*):
 * an artifact in one of its scopes, or an artifact that has none.
 *
 * DERIVED from the declaration, never declared by hand, so the matrix in `release.yml` and the
 * publish gate both read the same list and cannot drift from the artifact set (FR-030).
 */
export interface VerificationCombination {
  /** `<role>-<user|machine>`, or `<role>` for an artifact without scopes. Unique. */
  id: string;
  role: ReleaseArtifactRole;
  /** `null` for an artifact without scopes. */
  scope: InstallScope | null;
  /** The artifact's own steps plus the ones its scope adds. */
  applicableSteps: readonly VerificationStep[];
  /** Where this combination's verdict is written and read. */
  verdictFile: string;
}

/** The steps a scope adds to the artifact's own (research D11). */
function scopeSteps(role: ReleaseArtifactRole, scope: InstallScope): readonly VerificationStep[] {
  if (scope === 'per-user') return ['standard-account-install'];
  const machine: VerificationStep[] = ['second-account', 'in-use-upgrade', 'not-elevated-launch'];
  // Only the setup has a silent switch that can ask for machine-wide without elevation (FR-010); the
  // MSI's equivalent is Windows Installer's own refusal.
  if (role === 'setup') machine.push('silent-elevation-refused');
  return machine;
}

/** Every combination of the set, in declaration order, per-user before machine-wide. */
export function combinationsOf(set: ReleaseArtifactSet): readonly VerificationCombination[] {
  const combinations: VerificationCombination[] = [];
  for (const artifact of set.artifacts) {
    if (artifact.scopes.length === 0) {
      combinations.push({
        id: artifact.role,
        role: artifact.role,
        scope: null,
        applicableSteps: artifact.applicableSteps,
        verdictFile: `verification-verdict-${artifact.role}.json`,
      });
      continue;
    }
    for (const scope of artifact.scopes) {
      const id = `${artifact.role}-${scope === 'per-user' ? 'user' : 'machine'}`;
      combinations.push({
        id,
        role: artifact.role,
        scope,
        applicableSteps: [...artifact.applicableSteps, ...scopeSteps(artifact.role, scope)],
        verdictFile: `verification-verdict-${id}.json`,
      });
    }
  }
  return combinations;
}

/**
 * The one artifact for a role, or a throw naming the role and the valid ones.
 *
 * It throws rather than returning `undefined` on purpose: every caller of this is a pipeline step
 * about to verify, hash or publish a file, and a step that quietly proceeds with nothing is how the
 * original defect stayed invisible.
 */
export function resolveArtifact(set: ReleaseArtifactSet, role: ReleaseArtifactRole): ReleaseArtifact {
  const found = set.artifacts.find((a) => a.role === role);
  if (!found) {
    const valid = set.artifacts.map((a) => a.role).join(', ');
    throw new Error(`unknown artifact role '${role}' — the declared set holds: ${valid}`);
  }
  return found;
}

/** The lowercased extension of a filename, including the dot; `''` when it has none. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

/**
 * Compare a declaration against the filenames a build actually produced.
 *
 * **An unexpected artifact fails just as a missing one does.** A build that produced a file nobody
 * declared is a build whose output is not understood, and publishing an artifact that was never
 * verified is exactly what 042 FR-016 forbids.
 *
 * Only files that LOOK like artifacts are candidates — a file is a candidate when its extension is
 * one the declaration uses. electron-builder writes `latest.yml` and `<artifact>.blockmap` beside
 * the artifacts it was asked for, and calling those unexpected would fail every build. Deriving the
 * candidate extensions from the declaration rather than hardcoding a skip-list means a new format
 * brings its own extension with it.
 */
export function reconcileArtifactSet(
  declared: ReleaseArtifactSet,
  foundFilenames: readonly string[],
): ReconcileResult {
  const declaredNames = declared.artifacts.map((a) => a.filename);
  const artifactExtensions = new Set(declaredNames.map(extensionOf));

  const candidates = foundFilenames.filter((f) => artifactExtensions.has(extensionOf(f)));

  const foundSet = new Set(candidates);
  const missing = declaredNames.filter((n) => !foundSet.has(n));

  const declaredSet = new Set(declaredNames);
  const unexpected = candidates.filter((f) => !declaredSet.has(f));

  if (missing.length === 0 && unexpected.length === 0) {
    return { matched: true, missing: [], unexpected: [], reason: null };
  }

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`${missing.length} declared artifact(s) missing (${missing.join(', ')})`);
  if (unexpected.length > 0) {
    parts.push(`${unexpected.length} unexpected artifact(s) not declared (${unexpected.join(', ')})`);
  }

  return {
    matched: false,
    missing,
    unexpected,
    reason: `the built artifacts do not match the declared set for ${declared.version}: ${parts.join('; ')}`,
  };
}
