import type { IUserContext } from '../abstractions/user-context.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`IUserContext contract violation: ${message}`);
  }
}

/**
 * Reusable contract suite for any `IUserContext` implementation (research D8,
 * extends the 001 [Gap A] pattern). Throws on the first violation; returns
 * normally when the subject satisfies every obligation. Imports nothing OS- or
 * runner-specific, so `@throng/core` stays free of OS/Node/test dependencies and
 * any test layer (or future platform package) can run it.
 */
export function runUserContextContract(makeSubject: () => IUserContext): void {
  const subject = makeSubject();

  // Obligation 1: currentUser() returns non-empty userId and userName.
  const user = subject.currentUser();
  assert(
    typeof user.userId === 'string' && user.userId.trim().length > 0,
    `currentUser().userId must be a non-empty string; got ${JSON.stringify(user.userId)}`,
  );
  assert(
    typeof user.userName === 'string' && user.userName.trim().length > 0,
    `currentUser().userName must be a non-empty string; got ${JSON.stringify(user.userName)}`,
  );

  // Obligation 2: currentUser() is stable within a process run.
  const again = subject.currentUser();
  assert(
    again.userId === user.userId && again.userName === user.userName,
    `currentUser() must be stable across calls; got ${JSON.stringify(user)} then ${JSON.stringify(again)}`,
  );

  // Obligation 3: userId is safe as a storage key — no path separators, not blank.
  assert(
    !/[\\/]/.test(user.userId),
    `currentUser().userId must contain no path separators; got ${JSON.stringify(user.userId)}`,
  );
}
