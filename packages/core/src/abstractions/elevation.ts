/**
 * IElevationState (Principle II, 005 Phase G — FR-025a/c). OS seam reporting
 * whether the current process runs **elevated** (high integrity / "as
 * administrator"). The Windows impl `WindowsElevation` lives in
 * `@throng/platform-windows`; it is consumed by the **daemon** (authoritative — it
 * spawns the PTYs, and reports `terminal.capabilities.elevated`) and by **UI main**
 * (to compare against the daemon and trigger an elevated respawn, FR-025b). No OS
 * calls here — the contract only.
 */
export interface IElevationState {
  /** True iff THIS process runs at high integrity (admin). Stable per process. */
  isElevated(): boolean;
}
