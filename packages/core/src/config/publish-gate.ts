/**
 * Publish-gate evaluation (020 FR-028/031/034).
 *
 * Publishing a release is refused unless ALL hold: a real (non-placeholder) version, a passed
 * installer verification, and a recorded human QA sign-off — and a version that is already
 * published is refused rather than overwritten. Each refusal names the single unmet condition
 * (FR-031). This is the PURE decision; the workflow (`scripts/publish-gates.mjs`, `release.yml`)
 * supplies the inputs (the human sign-off comes from a GitHub Environment reviewer approval, which
 * cannot be satisfied by automation — FR-029).
 */

export interface PublishGateInput {
  /** The version is real (not `0.0.0`/blank) — see `isPlaceholderVersion`. */
  isRealVersion: boolean;
  /**
   * The four version representations agree (installer filename == package == reported == release
   * tag; `matchReleaseVersions`, SC-002). This is what binds the release and the human sign-off to
   * the exact package (FR-030/033) — a tag or filename for a different build fails here.
   */
  versionsAligned: boolean;
  /** This exact package passed installer verification (a recorded, passing verdict). */
  isVerified: boolean;
  /** A human recorded a QA sign-off for this exact package. */
  isSignedOff: boolean;
  /** This version has already been published (re-publish must be refused, FR-034). */
  isAlreadyPublished: boolean;
}

export interface PublishGateResult {
  /** True only when every gate is satisfied. */
  allowed: boolean;
  /** The single unmet condition when refused; `null` when allowed. */
  reason: string | null;
}

/**
 * Evaluate the three publish gates plus the no-re-publish rule. There is NO override path: the
 * result is a pure function of the inputs.
 */
export function evaluatePublishGate(input: PublishGateInput): PublishGateResult {
  if (!input.isRealVersion) {
    return { allowed: false, reason: 'the package is not versioned (placeholder version)' };
  }
  if (!input.versionsAligned) {
    return {
      allowed: false,
      reason: 'the installer, package, reported and release-tag versions do not all match',
    };
  }
  if (input.isAlreadyPublished) {
    return { allowed: false, reason: 'this version has already been published' };
  }
  if (!input.isVerified) {
    return { allowed: false, reason: 'the installer is not verified' };
  }
  if (!input.isSignedOff) {
    return { allowed: false, reason: 'QA sign-off is missing' };
  }
  return { allowed: true, reason: null };
}
