import type { IPlatformInfo, OsName } from '../abstractions/platform-info.js';

const VALID_OS_NAMES: readonly OsName[] = ['windows', 'macos', 'linux'];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`IPlatformInfo contract violation: ${message}`);
  }
}

/**
 * Reusable contract suite for any `IPlatformInfo` implementation ([Gap A]).
 * Throws on the first violation; returns normally when the subject satisfies
 * every obligation. Framework-agnostic by design — it imports nothing, so
 * `@throng/core` stays free of OS, Node, and test-runner dependencies and any
 * test layer (or future macOS/Linux package) can run it.
 */
export function runPlatformInfoContract(makeSubject: () => IPlatformInfo): void {
  const subject = makeSubject();

  // Obligation 1: osName() returns exactly one allowed value, stable across calls.
  const osName = subject.osName();
  assert(
    (VALID_OS_NAMES as readonly string[]).includes(osName),
    `osName() must return one of ${VALID_OS_NAMES.join(', ')}; got ${JSON.stringify(osName)}`,
  );
  assert(
    subject.osName() === osName,
    `osName() must be stable across calls; got ${JSON.stringify(osName)} then ${JSON.stringify(subject.osName())}`,
  );

  // Obligation 2: pathSeparator() is a single-character string consistent with osName().
  const separator = subject.pathSeparator();
  assert(
    typeof separator === 'string' && separator.length === 1,
    `pathSeparator() must be a single-character string; got ${JSON.stringify(separator)}`,
  );
  const expectedSeparator = osName === 'windows' ? '\\' : '/';
  assert(
    separator === expectedSeparator,
    `pathSeparator() must be ${JSON.stringify(expectedSeparator)} when osName() === ${JSON.stringify(osName)}; got ${JSON.stringify(separator)}`,
  );

  // Obligation 3: methods are side-effect-free and safe to call repeatedly.
  assert(
    subject.pathSeparator() === separator,
    'pathSeparator() must be stable across repeated calls',
  );
}
