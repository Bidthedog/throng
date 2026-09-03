/**
 * Installer verification verdict (020 FR-023–FR-027, FR-024a).
 *
 * Verification exercises a package's full lifecycle on a clean machine (install → launch → version
 * → core journey → checksum match → uninstall → residue scan) and records a verdict BOUND to the
 * exact package (`version` + `installerSha256`). An ABSENT verdict is a failure, never a pass
 * (FR-027). This module is the pure shape + helpers; `scripts/verify-installer.mjs` performs the
 * real steps and emits a verdict.
 */

/** The ordered steps a full verification runs; a failure names the first that failed (FR-025). */
export type VerificationStep =
  | 'interrupted-install'
  | 'install'
  | 'launch'
  | 'version-match'
  | 'self-contained'
  | 'shortcut'
  | 'no-service'
  | 'core-journey'
  | 'reattach'
  | 'checksum-match'
  | 'no-write'
  | 'uninstall'
  | 'residue-scan';

export const VERIFICATION_STEPS: readonly VerificationStep[] = [
  'interrupted-install', // an aborted install leaves no launchable partial product (FR-022)
  'install', // NSIS silent install succeeded (FR-023)
  'launch', // the installed app booted a real window (no startup crash)
  'version-match', // installer filename == package == reported version (SC-002)
  'self-contained', // the daemon runs under the BUNDLED runtime, no PATH node, no network (FR-009/041)
  'shortcut', // the Start-menu launch shortcut exists (FR-014)
  'no-service', // no Windows service was registered by the install (FR-011)
  'core-journey', // the packaged app + its bundled-runtime daemon boot together
  'reattach', // the detached daemon survives app close and is reattached on reopen (SC-009, FR-019)
  'checksum-match', // the installer bytes match the expected checksum (FR-024a)
  'no-write', // nothing was written under the install root at runtime (FR-008)
  'uninstall', // silent uninstall removed the app
  'residue-scan', // no throng process or component left behind (FR-020)
];

export interface VerificationVerdict {
  /** Product version of the package tested. */
  version: string;
  /** SHA-256 of the exact installer bytes — binds the verdict to one package. */
  installerSha256: string;
  /** True only when every step passed. */
  passed: boolean;
  /** The first step that failed, or `null` when passed (FR-025). */
  failedStep: VerificationStep | null;
}

// ---------------------------------------------------------------------------------------------
// A verdict over the whole declared artifact set (042 FR-014/FR-015/FR-016).
//
// A release publishes several artifacts, and every one of them must be verified to the same end
// state before any of them is published. What varies per format is only how the artifact gets on
// and off disk — an archive has no install step and no uninstaller.
//
// That is why a step has THREE outcomes rather than two. Running the fixed step list against an
// archive would fail a release that is perfectly good; marking those steps `passed` would make the
// verdict assert an uninstall that never ran, which is worse than no verdict at all. FR-027 already
// takes the position that absence is not success for a missing verdict; `not-applicable` says the
// same thing about a step, explicitly, where a human reading the verdict can see it.
// ---------------------------------------------------------------------------------------------

/** What a single verification step did for a single artifact. */
export type StepOutcome = 'passed' | 'failed' | 'not-applicable';

/** The verdict for one artifact of the set. */
export interface ArtifactVerdict {
  /** Which artifact this covers, by role — never by filename or extension (042 FR-012). */
  role: string;
  /** SHA-256 of the exact bytes verified; binds this verdict to those bytes (020 FR-024a). */
  sha256: string;
  /** Every step's outcome. A step absent from the artifact's applicable list is `not-applicable`. */
  steps: Partial<Record<VerificationStep, StepOutcome>>;
  /** True when every APPLICABLE step passed. */
  passed: boolean;
  /** The first applicable step that did not pass, in run order; `null` when passed. */
  failedStep: VerificationStep | null;
}

/** The artifact shape this module needs; the full one lives in `release-artifacts.ts`. */
interface VerifiableArtifact {
  role: string;
  applicableSteps: readonly VerificationStep[];
}

/**
 * Build one artifact's verdict from its per-step results.
 *
 * An applicable step with **no** result is a failure, not a skip. A harness that quietly omitted a
 * step would otherwise produce a passing verdict for a check that never ran, which is the same
 * conflation `not-applicable` exists to prevent — from the other direction.
 */
export function buildArtifactVerdict(
  artifact: VerifiableArtifact,
  sha256: string,
  results: Partial<Record<VerificationStep, boolean>>,
): ArtifactVerdict {
  const applicable = new Set(artifact.applicableSteps);
  const steps: Partial<Record<VerificationStep, StepOutcome>> = {};

  for (const step of VERIFICATION_STEPS) {
    if (!applicable.has(step)) {
      steps[step] = 'not-applicable';
      continue;
    }
    steps[step] = results[step] === true ? 'passed' : 'failed';
  }

  const failedStep = VERIFICATION_STEPS.find((s) => steps[s] === 'failed') ?? null;
  return { role: artifact.role, sha256, steps, passed: failedStep === null, failedStep };
}

/** Combine the per-artifact verdicts into the verdict the publish gate reads. */
export function buildSetVerdict(
  version: string,
  artifacts: readonly ArtifactVerdict[],
): VerificationVerdict & { artifacts: readonly ArtifactVerdict[] } {
  const firstFailure = artifacts.find((a) => !a.passed) ?? null;
  const setup = artifacts.find((a) => a.role === 'setup');
  return {
    version,
    // Retained so the existing four-way version match (020 SC-002) keeps its input.
    installerSha256: setup?.sha256 ?? '',
    passed: artifacts.length > 0 && firstFailure === null,
    failedStep: firstFailure?.failedStep ?? null,
    artifacts,
  };
}

/** The artifact-set shape this check needs. */
interface VerifiableSet {
  artifacts: readonly VerifiableArtifact[];
}

/**
 * Whether a verdict certifies the exact set about to be published (042 FR-016).
 *
 * True only when: the verdict is present and recorded for this version; **every** declared role has
 * an artifact verdict; each binds to the sha256 of that artifact's actual bytes; each passed; and
 * none of them marks an APPLICABLE step `not-applicable`.
 *
 * That last clause is what stops the third state being abused. A verdict claiming `uninstall:
 * not-applicable` for the setup installer is a skipped check wearing an exemption's clothes, so it
 * is rejected rather than evaluated — the set that is published must be the set that was verified,
 * and "verified" must mean what it says.
 */
export function isVerdictPassingForSet(
  verdict: (VerificationVerdict & { artifacts?: readonly ArtifactVerdict[] }) | null | undefined,
  version: string,
  set: VerifiableSet,
  actualSha256ByRole: Readonly<Record<string, string>>,
): boolean {
  if (!verdict) return false; // absence of evidence is not consent (FR-027)
  if (verdict.version !== version) return false;

  const byRole = new Map((verdict.artifacts ?? []).map((a) => [a.role, a]));

  for (const declared of set.artifacts) {
    const found = byRole.get(declared.role);
    if (!found) return false; // a partial verdict is a refusal, not a partial pass
    if (!found.passed) return false;
    if (found.sha256 !== actualSha256ByRole[declared.role]) return false;
    for (const step of declared.applicableSteps) {
      if (found.steps[step] === 'not-applicable') return false;
    }
  }

  return true;
}
