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

/**
 * Build a verdict from a per-step pass/fail map. `passed` is true only when every step passed;
 * `failedStep` is the FIRST failing step in run order.
 */
export function verdictFromSteps(
  version: string,
  installerSha256: string,
  results: Partial<Record<VerificationStep, boolean>>,
): VerificationVerdict {
  const failedStep = VERIFICATION_STEPS.find((s) => results[s] !== true) ?? null;
  return { version, installerSha256, passed: failedStep === null, failedStep };
}

/**
 * Interpret a verdict for the publish gate. An ABSENT verdict (`null`/`undefined`) is treated as a
 * FAILURE (FR-027), never as a pass. A verdict also fails if it does not bind to the exact package
 * being published (version + installer sha).
 */
export function isVerdictPassingFor(
  verdict: VerificationVerdict | null | undefined,
  version: string,
  installerSha256: string,
): boolean {
  if (!verdict) return false; // absence of evidence is not consent (FR-027)
  return verdict.passed && verdict.version === version && verdict.installerSha256 === installerSha256;
}
