/**
 * Publish-gate evaluation (020 FR-028/031/034).
 *
 * Publishing a release is refused unless ALL hold: a real (non-placeholder) version, the four
 * version representations agree, the built set reconciles with the declared one, every
 * combination passed verification, and the notes bind to the version — and a version that is
 * already published is refused rather than overwritten. Each refusal names the single unmet
 * condition (FR-031). This is the PURE decision; the workflow (`scripts/publish-gates.mjs`,
 * `release.yml`) supplies the inputs.
 *
 * Every condition is evaluated by the machine. There is no human sign-off: 065 FR-001 supersedes
 * 020 FR-028(c) and FR-029, so a release that passes runs from tag to publish unattended.
 */

import type { UnprovenGap } from './verification-verdict.js';

export interface PublishGateInput {
  /** The version is real (not `0.0.0`/blank) — see `isPlaceholderVersion`. */
  isRealVersion: boolean;
  /**
   * The four version representations agree (installer filename == package == reported == release
   * tag; `matchReleaseVersions`, SC-002). This is what binds the release to the exact package
   * (FR-033) — a tag or filename for a different build fails here.
   */
  versionsAligned: boolean;
  /** This exact package passed installer verification (a recorded, passing verdict). */
  isVerified: boolean;
  /** This version has already been published (re-publish must be refused, FR-034). */
  isAlreadyPublished: boolean;
  /**
   * `CHANGELOG.md` holds a non-empty section for exactly this version (042 FR-005). False covers
   * all three failures — no section, an empty one, and one headed with a different version — which
   * the refusal message from `scripts/release-notes.mjs` distinguishes for the reader.
   */
  notesBindToVersion: boolean;
  /**
   * The artifacts actually built are exactly the declared set (042 FR-013). False covers both
   * directions: a declared artifact the build did not produce, and one it produced that nobody
   * declared — publishing an artifact that was never verified is what FR-016 forbids.
   */
  artifactSetReconciles: boolean;
  /**
   * Why verification was refused, from `evaluateVerification` (058 FR-030): names the combination —
   * and the step — that did not pass. Carried into the gate's reason so a maintainer sees which of
   * the verdicts to look at. Ignored when `isVerified`.
   */
  verificationRefusal?: string | null;
  /**
   * Steps that could not be exercised but are allowed not to be (058 spec Assumptions). They do not
   * refuse publication; they are handed back so the release body and job summary can report them.
   */
  reportedGaps?: readonly UnprovenGap[];
}

export interface PublishGateResult {
  /** True only when every gate is satisfied. */
  allowed: boolean;
  /** The single unmet condition when refused; `null` when allowed. */
  reason: string | null;
  /** The unproven steps to report, passed through from the input; empty when there are none. */
  reportedGaps: readonly UnprovenGap[];
}

/**
 * Evaluate the publish gates plus the no-re-publish rule. There is NO override path: the
 * result is a pure function of the inputs.
 */
export function evaluatePublishGate(input: PublishGateInput): PublishGateResult {
  const reportedGaps = input.reportedGaps ?? [];
  const refuse = (reason: string): PublishGateResult => ({ allowed: false, reason, reportedGaps });

  if (!input.isRealVersion) {
    return refuse('the package is not versioned (placeholder version)');
  }
  if (!input.versionsAligned) {
    return refuse('the installer, package, reported and release-tag versions do not all match');
  }
  if (input.isAlreadyPublished) {
    return refuse('this version has already been published');
  }
  if (!input.artifactSetReconciles) {
    return refuse('the built artifacts do not match the declared artifact set');
  }
  if (!input.isVerified) {
    // 058 FR-030 — name the combination that did not pass, not just that something did not.
    return refuse(
      input.verificationRefusal
        ? `the release is not verified — ${input.verificationRefusal}`
        : 'the installer is not verified',
    );
  }
  // 042 FR-005 — notes absent, empty or bound to another version.
  if (!input.notesBindToVersion) {
    return refuse('the release notes are missing, empty, or written for a different version');
  }
  return { allowed: true, reason: null, reportedGaps };
}
