import { describe, expect, it } from 'vitest';
import { stayedAbsent } from '../e2e/harness.js';

/**
 * The expected-absent fence FR-016/FR-017 require (034 T035b).
 *
 * ══ WHY THIS TEST EXISTS AT ALL ══
 *
 * `stayedAbsent` is the mechanism for asserting something did NOT happen. Its whole value is that it
 * fails in two specific ways, and a fence whose failure modes are untested is precisely the thing it
 * was written to prevent — a guard that looks like evidence and is not. So both are driven here, and
 * `research.md` §9's precedent applies: a unit test over the E2E tree, not a new lint mechanism.
 *
 * ══ WHAT IT REPLACES ══
 *
 * `await expect(thing).toHaveCount(0)` immediately after an action is green whether the behaviour is
 * right or the app is merely slow: it asserts "not yet" and reports "never". The 034 baseline
 * measured 222 hard-coded sleeps across 83 files, most of them that same idea with a longer fuse.
 *
 * ══ THE ANTI-VACUITY CONTROL ══
 *
 * Replace the `throw` in `stayedAbsent`'s `catch` with a `return`, so an unmet fence falls through to
 * the absence check instead of failing. The second test below then PASSES — an unmet fence and a
 * count of zero look identical from the outside — which is exactly the degradation FR-017 forbids and
 * exactly why that test is here. Run, and it fails 1 of 5 with the throw restored.
 */

const never = (): Promise<never> => Promise.reject(new Error('the fence never occurred'));
const at_once = (): Promise<void> => Promise.resolve();

describe('stayedAbsent — the expected-absent fence', () => {
  it('passes when the fence occurs and the thing is absent', async () => {
    await expect(stayedAbsent(at_once, async () => 0, 'a notice')).resolves.toBeUndefined();
  });

  it('FAILS when the fence never occurs, rather than falling through to the absence check', async () => {
    // The FR-017 half. A count of zero would satisfy the assertion below on its own, so if this ever
    // starts passing the fence has degraded into the sleep it replaced.
    await expect(stayedAbsent(never, async () => 0, 'a notice')).rejects.toThrow(
      /the fence never occurred, so "a notice did not happen" cannot be asserted/,
    );
  });

  it('names what was being asserted when the fence fails', async () => {
    await expect(stayedAbsent(never, async () => 0, 'a second toast')).rejects.toThrow(
      /a second toast/,
    );
  });

  it('fails when the thing IS present after the fence, reporting how many', async () => {
    await expect(stayedAbsent(at_once, async () => 3, 'a notice')).rejects.toThrow(
      /expected none after the fence, found 3/,
    );
  });

  it('keeps the fence’s own error as the cause, so a red says why the fence failed', async () => {
    // Without this the caller sees "the fence never occurred" and has to guess which wait timed out.
    const err = await stayedAbsent(never, async () => 0, 'a notice').catch((e: unknown) => e);
    expect((err as Error).cause).toBeInstanceOf(Error);
    expect(((err as Error).cause as Error).message).toContain('the fence never occurred');
  });
});
