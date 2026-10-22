/**
 * Installer verification verdict (020 FR-023–FR-027, FR-024a; 042 FR-014–FR-016; 058 FR-028–FR-031).
 *
 * Verification exercises a package's full lifecycle on a clean machine (install → launch → version
 * → core journey → checksum match → uninstall → residue scan) and records a verdict BOUND to the
 * exact package (`version` + `installerSha256`). An ABSENT verdict is a failure, never a pass
 * (FR-027). This module is the pure shape + helpers; `scripts/verify-installer.mjs` performs the
 * real steps and emits a verdict.
 *
 * Since 058 a verdict belongs to a COMBINATION — an artifact in one install scope — and the release
 * needs one for every combination plus one for the coexistence run.
 */

/** The ordered steps a full verification runs; a failure names the first that failed (FR-025). */
export type VerificationStep =
  | 'interrupted-install'
  | 'install'
  | 'install-labels'
  | 'launch'
  | 'version-match'
  | 'self-contained'
  | 'shortcut'
  | 'no-service'
  | 'core-journey'
  | 'reattach'
  | 'standard-account-install'
  | 'second-account'
  | 'in-use-upgrade'
  | 'not-elevated-launch'
  | 'silent-elevation-refused'
  | 'checksum-match'
  | 'no-write'
  | 'uninstall'
  | 'residue-scan';

export const VERIFICATION_STEPS: readonly VerificationStep[] = [
  'interrupted-install', // an aborted install leaves no launchable partial product (FR-022)
  'install', // the silent install succeeded (FR-023)
  'install-labels', // the registered entry and shortcut carry the copy's scope and installer (058 FR-017b)
  'launch', // the installed app booted a real window (no startup crash)
  'version-match', // installer filename == package == reported version (SC-002)
  'self-contained', // the daemon runs under the BUNDLED runtime, no PATH node, no network (FR-009/041)
  'shortcut', // the Start-menu launch shortcut exists (FR-014)
  'no-service', // no Windows service was registered by the install (FR-011)
  'core-journey', // the packaged app + its bundled-runtime daemon boot together
  'reattach', // the detached daemon survives app close and is reattached on reopen (SC-009, FR-019)
  'standard-account-install', // a per-user install as a real standard account succeeds (058 FR-006)
  'second-account', // a standard account uses the shared install: own daemon, own data (058 FR-012/013/029)
  'in-use-upgrade', // an unattended reinstall with another account running exits 3010 (058 FR-016a)
  'not-elevated-launch', // the app the elevated installer starts runs unelevated (058 FR-007)
  'silent-elevation-refused', // `/S /allusers` without elevation exits 740 and installs nothing (058 FR-010)
  'checksum-match', // the installer bytes match the expected checksum (FR-024a)
  'no-write', // nothing was written under the install root at runtime (FR-008)
  'uninstall', // silent uninstall removed the app
  'residue-scan', // no throng process or component left behind (FR-020)
];

/**
 * The steps the hosted runner may not be able to exercise, and so may record `unproven` instead of
 * `passed` or `failed` (058 spec Assumptions: if the runner cannot run a genuine second account,
 * "that gap is reported on every run … rather than assumed covered").
 *
 * The GUI half of `second-account` (research D11), and `not-elevated-launch`: a hosted runner is an
 * administrator with UAC disabled, so its desktop (explorer.exe) is itself high integrity and there
 * is no medium desktop to start the app from. Adding to this list widens what a release may publish
 * with unproven — so it is a reviewed change, not a convenience.
 */
export const RUNNER_LIMITED_STEPS: readonly VerificationStep[] = ['second-account', 'not-elevated-launch'];

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
// That is why a step has more than two outcomes. Running the fixed step list against an archive
// would fail a release that is perfectly good; marking those steps `passed` would make the verdict
// assert an uninstall that never ran, which is worse than no verdict at all. FR-027 already takes
// the position that absence is not success for a missing verdict; `not-applicable` says the same
// thing about a step, explicitly, where a human reading the verdict can see it.
// ---------------------------------------------------------------------------------------------

/**
 * What a single verification step did for a single combination.
 *
 * `unproven` means the step applies but the environment could not exercise it, with a reason. Only a
 * step in {@link RUNNER_LIMITED_STEPS} may record it; anywhere else it is treated as `failed`.
 */
export type StepOutcome = 'passed' | 'failed' | 'not-applicable' | 'unproven';

/** What a harness reports for a step it ran: it passed, it failed, or the runner could not tell. */
export type StepResult = boolean | 'unproven';

/** The verdict for one combination of the set. */
export interface ArtifactVerdict {
  /** Which artifact this covers, by role — never by filename or extension (042 FR-012). */
  role: string;
  /**
   * Which combination this is — `msi-machine`, `portable` (058 FR-030). For an artifact without
   * scopes it is the role, so a pre-058 verdict file keeps its identity.
   */
  combination: string;
  /** SHA-256 of the exact bytes verified; binds this verdict to those bytes (020 FR-024a). */
  sha256: string;
  /** Every step's outcome. A step absent from the combination's applicable list is `not-applicable`. */
  steps: Partial<Record<VerificationStep, StepOutcome>>;
  /** Why each `unproven` step could not be proven, for the release body and the job summary. */
  unprovenReasons?: Partial<Record<VerificationStep, string>>;
  /** True when every APPLICABLE step passed (or is `unproven` where that is allowed). */
  passed: boolean;
  /** The first applicable step that did not pass, in run order; `null` when passed. */
  failedStep: VerificationStep | null;
}

/** The shape this module needs from an artifact or a combination; the full ones live elsewhere. */
interface VerifiableArtifact {
  role: string;
  /** Present on a combination; absent on an artifact, whose identity is then its role. */
  id?: string;
  applicableSteps: readonly VerificationStep[];
}

function isRunnerLimited(step: VerificationStep): boolean {
  return RUNNER_LIMITED_STEPS.includes(step);
}

/**
 * Build one combination's verdict from its per-step results.
 *
 * An applicable step with **no** result is a failure, not a skip. A harness that quietly omitted a
 * step would otherwise produce a passing verdict for a check that never ran, which is the same
 * conflation `not-applicable` exists to prevent — from the other direction. A result of `'unproven'`
 * is honoured only for a runner-limited step.
 */
export function buildArtifactVerdict(
  artifact: VerifiableArtifact,
  sha256: string,
  results: Partial<Record<VerificationStep, StepResult>>,
  unprovenReasons?: Partial<Record<VerificationStep, string>>,
): ArtifactVerdict {
  const applicable = new Set(artifact.applicableSteps);
  const steps: Partial<Record<VerificationStep, StepOutcome>> = {};

  for (const step of VERIFICATION_STEPS) {
    if (!applicable.has(step)) {
      steps[step] = 'not-applicable';
      continue;
    }
    const result = results[step];
    if (result === true) steps[step] = 'passed';
    else if (result === 'unproven' && isRunnerLimited(step)) steps[step] = 'unproven';
    else steps[step] = 'failed';
  }

  const failedStep = VERIFICATION_STEPS.find((s) => steps[s] === 'failed') ?? null;
  const verdict: ArtifactVerdict = {
    role: artifact.role,
    combination: artifact.id ?? artifact.role,
    sha256,
    steps,
    passed: failedStep === null,
    failedStep,
  };

  const reasons: Partial<Record<VerificationStep, string>> = {};
  for (const step of VERIFICATION_STEPS) {
    if (steps[step] === 'unproven') reasons[step] = unprovenReasons?.[step] ?? 'no reason recorded';
  }
  if (Object.keys(reasons).length > 0) verdict.unprovenReasons = reasons;
  return verdict;
}

/** Combine the per-combination verdicts into the verdict the publish gate reads. */
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

/** The combination shape this check needs. */
interface VerifiableCombination {
  id: string;
  role: string;
  applicableSteps: readonly VerificationStep[];
}

/**
 * What is wrong with one combination's verdict, in one phrase naming the step, or `null` when the
 * verdict certifies it. The steps are re-read rather than trusting the verdict's own `passed` flag,
 * so a hand-edited or forged file cannot pass.
 */
function problemWith(
  combination: VerifiableCombination,
  verdict: ArtifactVerdict | undefined,
  actualSha256: string | undefined,
): string | null {
  if (!verdict) return `${combination.id}: no verification verdict`;
  if (verdict.sha256 !== actualSha256) {
    return `${combination.id}: the verdict was recorded for different bytes than the ones being published`;
  }
  for (const step of VERIFICATION_STEPS) {
    const outcome = verdict.steps[step];
    const applicable = combination.applicableSteps.includes(step);
    if (!applicable) continue;
    if (outcome === 'passed') continue;
    if (outcome === 'unproven') {
      if (isRunnerLimited(step)) continue;
      return `${combination.id}: ${step} is unproven, and only a runner-limited step may be`;
    }
    if (outcome === 'not-applicable') return `${combination.id}: ${step} is marked not-applicable but applies`;
    return `${combination.id}: ${step} ${outcome === 'failed' ? 'failed' : 'has no result'}`;
  }
  return null;
}

/** One step that could not be exercised, reported on every run (058 spec Assumptions). */
export interface UnprovenGap {
  combination: string;
  step: VerificationStep;
  reason: string;
}

/** The unproven steps across a set of verdicts, in verdict then run order. */
export function unprovenGaps(verdicts: readonly ArtifactVerdict[]): UnprovenGap[] {
  const gaps: UnprovenGap[] = [];
  for (const verdict of verdicts) {
    for (const step of VERIFICATION_STEPS) {
      if (verdict.steps[step] === 'unproven') {
        gaps.push({
          combination: verdict.combination,
          step,
          reason: verdict.unprovenReasons?.[step] ?? 'no reason recorded',
        });
      }
    }
  }
  return gaps;
}

/**
 * Whether a verdict certifies every combination about to be published (058 FR-030).
 *
 * True only when: the verdict is present and recorded for this version; **every** combination has a
 * verdict of its own; each binds to the sha256 of that artifact's actual bytes; and every applicable
 * step passed — or is `unproven` where the spec allows it. A step marked `not-applicable` that does
 * apply is a skipped check wearing an exemption's clothes, and is rejected.
 */
export function isVerdictPassingForCombinations(
  verdict: (VerificationVerdict & { artifacts?: readonly ArtifactVerdict[] }) | null | undefined,
  version: string,
  combinations: readonly VerifiableCombination[],
  actualSha256ByRole: Readonly<Record<string, string>>,
): boolean {
  if (!verdict) return false; // absence of evidence is not consent (FR-027)
  if (verdict.version !== version) return false;

  const byCombination = new Map((verdict.artifacts ?? []).map((a) => [a.combination ?? a.role, a]));
  return combinations.every(
    (c) => problemWith(c, byCombination.get(c.id), actualSha256ByRole[c.role]) === null,
  );
}

// ---------------------------------------------------------------------------------------------
// The coexistence verdict (058 FR-031): one machine carrying every installer in every scope and the
// archive, proving they live side by side.
// ---------------------------------------------------------------------------------------------

export type CoexistenceStep =
  | 'all-installed'
  | 'each-launches-own-version'
  | 'second-launch-refused'
  | 'same-data-folder'
  | 'reattach-across-copies'
  | 'reinstall-one-leaves-others'
  | 'uninstall-one-leaves-others';

export const COEXISTENCE_STEPS: readonly CoexistenceStep[] = [
  'all-installed',
  'each-launches-own-version',
  'second-launch-refused',
  'same-data-folder',
  'reattach-across-copies', // a terminal from one copy is reattached from another copy of the build (FR-021)
  'reinstall-one-leaves-others',
  'uninstall-one-leaves-others',
];

export interface CoexistenceCopy {
  id: string;
  installRoot: string;
  version: string;
  /**
   * Who installed it, when that matters. The per-user MSI is installed by a standard second account,
   * because one MSI product code cannot be held per-user and machine-wide by a single account.
   */
  installedBy?: string;
}

export interface CoexistenceVerdict {
  version: string;
  copies: readonly CoexistenceCopy[];
  steps: Partial<Record<CoexistenceStep, StepOutcome>>;
  passed: boolean;
  failedStep: CoexistenceStep | null;
}

/** Build the coexistence verdict; a step with no result is a failure, like any applicable step. */
export function buildCoexistenceVerdict(
  version: string,
  copies: readonly CoexistenceCopy[],
  results: Partial<Record<CoexistenceStep, boolean>>,
): CoexistenceVerdict {
  const steps: Partial<Record<CoexistenceStep, StepOutcome>> = {};
  for (const step of COEXISTENCE_STEPS) steps[step] = results[step] === true ? 'passed' : 'failed';
  const failedStep = COEXISTENCE_STEPS.find((s) => steps[s] === 'failed') ?? null;
  return { version, copies, steps, passed: failedStep === null, failedStep };
}

/** The first coexistence step that is not `passed`, or `null` — read from the steps, not the flag. */
export function firstCoexistenceProblem(
  verdict: CoexistenceVerdict | null | undefined,
  version: string,
): string | null {
  if (!verdict) return 'coexistence: no verification verdict';
  if (verdict.version !== version) return 'coexistence: the verdict was recorded for another version';
  for (const step of COEXISTENCE_STEPS) {
    if (verdict.steps[step] !== 'passed') return `coexistence: ${step} ${verdict.steps[step] ?? 'has no result'}`;
  }
  return null;
}

export function isCoexistenceVerdictPassing(
  verdict: CoexistenceVerdict | null | undefined,
  version: string,
): boolean {
  return firstCoexistenceProblem(verdict, version) === null;
}

// ---------------------------------------------------------------------------------------------
// The whole picture, for the publish gate.
// ---------------------------------------------------------------------------------------------

export interface VerificationEvidence {
  version: string;
  combinations: readonly VerifiableCombination[];
  /** Every combination verdict that could be read; a missing one is simply absent. */
  verdicts: readonly ArtifactVerdict[];
  coexistence: CoexistenceVerdict | null | undefined;
  actualSha256ByRole: Readonly<Record<string, string>>;
}

export interface VerificationEvaluation {
  passed: boolean;
  /** Names the first combination (and step) that did not pass; `null` when passed. */
  refusal: string | null;
  /** Every `unproven` step on a passing evaluation, to be reported (never silently accepted). */
  reportedGaps: readonly UnprovenGap[];
}

/**
 * Evaluate all the verification evidence at once (058 FR-030). The refusal names the combination —
 * and the step — that did not pass, so a maintainer sees which of the seven verdicts to look at.
 */
export function evaluateVerification(evidence: VerificationEvidence): VerificationEvaluation {
  const byCombination = new Map(evidence.verdicts.map((v) => [v.combination ?? v.role, v]));
  for (const combination of evidence.combinations) {
    const problem = problemWith(
      combination,
      byCombination.get(combination.id),
      evidence.actualSha256ByRole[combination.role],
    );
    if (problem) return { passed: false, refusal: problem, reportedGaps: [] };
  }
  const coexistenceProblem = firstCoexistenceProblem(evidence.coexistence, evidence.version);
  if (coexistenceProblem) return { passed: false, refusal: coexistenceProblem, reportedGaps: [] };

  return { passed: true, refusal: null, reportedGaps: unprovenGaps(evidence.verdicts) };
}
