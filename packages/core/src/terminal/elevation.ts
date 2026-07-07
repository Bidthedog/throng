/**
 * Pure elevation gating (005 Phase G — FR-025a). A Terminal Panel's "run as admin"
 * control is allowed only when the terminal-hosting daemon is itself running
 * elevated (you can't spawn a high-integrity child from a medium-integrity daemon).
 * The rule is deliberately trivial and identity-shaped so it stays a single source
 * of truth for the form gate, the capability query, and any future callers.
 */
export function canRunAsAdmin(daemonElevated: boolean): boolean {
  return daemonElevated;
}

/**
 * Whether UI main should retire and re-spawn the daemon elevated (FR-025b). When
 * throng itself is launched as administrator but the running daemon is a
 * lower-integrity process, admin terminals can't launch — so the app must replace
 * the daemon with an elevated one (an extension of the build-id/instance
 * handshake) rather than silently attach to a medium-integrity daemon. The reverse
 * (app not elevated) never forces a respawn.
 */
export function shouldRespawnDaemonElevated(appElevated: boolean, daemonElevated: boolean): boolean {
  return appElevated && !daemonElevated;
}

/**
 * Whether a terminal must be **de-elevated** before it spawns (FR-025c mixed mode).
 * Cross-platform decision (the *mechanism* is OS-specific, behind {@link IDeElevator}):
 * de-elevate exactly when the user did NOT ask for admin but the host process is
 * itself elevated — so an unchecked terminal runs at the normal user's privilege
 * even from an elevated daemon. When the host is not elevated there is nothing to
 * drop; when admin was requested the terminal stays elevated.
 */
export function shouldDeElevate(runAsAdmin: boolean, hostElevated: boolean): boolean {
  return !runAsAdmin && hostElevated;
}
