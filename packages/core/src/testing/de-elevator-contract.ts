import type { DeElevateSpec, IDeElevator } from '../abstractions/de-elevator.js';

/**
 * Reusable contract suite for {@link IDeElevator} (005 Phase G, FR-025c). Runnable
 * against any implementation — a fake in unit tests, or a real platform de-elevator
 * in a platform contract test. Framework-agnostic: throws on a violation so callers
 * assert with `expect(() => run()).not.toThrow()`.
 *
 * Structural obligations asserted here (OS-independent):
 *  - `isAvailable()` returns a boolean.
 *  - When available, `wrap(spec)` returns a structurally valid spec — a non-empty
 *    `file` and a `string[]` `args`. HOW the original program is carried into the
 *    wrapped launch (plaintext args vs an encoded shim payload) is impl-specific and
 *    intentionally NOT constrained here.
 *
 * The BEHAVIOURAL obligation — that the wrapped spec actually runs the intended
 * program de-elevated — can only be asserted on the real OS while elevated; the
 * platform contract test gates that with a logged skip (never here, never a silent
 * pass).
 */
export function runDeElevatorContract(factory: () => IDeElevator): void {
  const impl = factory();

  const available = impl.isAvailable();
  if (typeof available !== 'boolean') {
    throw new Error(`IDeElevator.isAvailable() must return a boolean, got ${typeof available}`);
  }
  if (!available) return; // an unavailable de-elevator need not wrap anything

  const spec: DeElevateSpec = { file: 'C:\\Windows\\System32\\cmd.exe', args: ['/K', 'echo hi'] };
  const wrapped = impl.wrap(spec);
  if (!wrapped || typeof wrapped.file !== 'string' || wrapped.file.length === 0) {
    throw new Error('IDeElevator.wrap() must return a non-empty { file }');
  }
  if (!Array.isArray(wrapped.args) || wrapped.args.some((a) => typeof a !== 'string')) {
    throw new Error('IDeElevator.wrap() must return { args: string[] }');
  }
}
