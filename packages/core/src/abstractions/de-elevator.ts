/**
 * IDeElevator (Principle II, 005 Phase G — FR-025c). OS seam that **wraps a PTY
 * launch so the child runs de-elevated** (at the normal user's privilege) when the
 * host daemon is elevated but the terminal was NOT requested "as admin". The
 * decision to de-elevate is pure and cross-platform ({@link shouldDeElevate}); this
 * seam is only the OS-specific *mechanism*:
 *
 *  - **Windows** — re-launch through a `CreateProcessWithTokenW` shim carrying the
 *    shell (medium-integrity) token, so the ConPTY child runs at medium integrity
 *    while the daemon stays elevated.
 *  - **Linux/macOS** — re-launch through `setpriv`/`su` to drop to `$SUDO_USER`,
 *    keeping the same controlling pty.
 *
 * `node-pty` spawns the *wrapped* spec exactly like any other, so the pty plumbing
 * is unchanged — only *who* the child runs as differs. No OS calls here (the
 * contract only); concrete impls live in the platform packages.
 */

/** The launchable parts the de-elevator rewrites (a subset of the daemon LaunchSpec). */
export interface DeElevateSpec {
  file: string;
  args: string[];
}

export interface IDeElevator {
  /**
   * True when de-elevation is actually supported on this host+process (e.g. the
   * daemon is elevated AND the shell token / SUDO_USER is obtainable). When false
   * the caller MUST fall back to a normal spawn rather than silently running an
   * unchecked terminal elevated.
   */
  isAvailable(): boolean;
  /**
   * Rewrite `spec` so spawning it runs the same program de-elevated. MUST preserve
   * the original program + args (as the payload the shim ultimately executes).
   */
  wrap(spec: DeElevateSpec): DeElevateSpec;
}

/**
 * A no-op {@link IDeElevator} for hosts that cannot (or need not) de-elevate — it
 * reports unavailable and returns the spec unchanged. Used when the daemon is not
 * elevated, and as the safe default before a platform impl is wired.
 */
export const passthroughDeElevator: IDeElevator = {
  isAvailable: () => false,
  wrap: (spec) => spec,
};
