import type { IElevationState } from '../abstractions/elevation.js';

/**
 * Reusable contract suite for {@link IElevationState} (005 Phase G, FR-025a/c).
 * Runnable against any implementation — a fake in unit tests, or the real
 * `WindowsElevation` in a platform contract test. Framework-agnostic: it throws on
 * a violation so the caller's `expect(() => run()).not.toThrow()` reports it.
 *
 * Obligations asserted:
 *  - `isElevated()` returns a **boolean**.
 *  - `isElevated()` is **stable** for the process lifetime (same value across calls).
 *
 * The OS-level truth (that the boolean matches the real token integrity, and that
 * an elevated context reports `true`) can only be asserted on an actually-elevated
 * runner; the platform contract test gates those with a logged skip — never here.
 */
export function runElevationContract(factory: () => IElevationState): void {
  const impl = factory();

  const first = impl.isElevated();
  if (typeof first !== 'boolean') {
    throw new Error(`IElevationState.isElevated() must return a boolean, got ${typeof first}`);
  }
  // Stability: repeated calls must agree (elevation cannot change mid-process).
  for (let i = 0; i < 5; i += 1) {
    const again = impl.isElevated();
    if (again !== first) {
      throw new Error('IElevationState.isElevated() must be stable across calls within a process');
    }
  }
}
