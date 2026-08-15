import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimTransientOverlay,
  __resetTransientOverlayForTests,
} from '../../src/renderer/common/transient-overlay.js';

/**
 * 033 Phase 11 / D1 (FR-071, FR-071a) — the window's one transient-overlay slot.
 *
 * Six cases, and every one of them is a trap the plan names by hand. They are unit tests rather
 * than E2E ones because each describes an ORDERING inside the registry — which callback ran, in
 * what order, and what the slot held afterwards — and an ordering is exactly the thing an E2E can
 * only observe the consequences of. The E2E (`transient-overlays.e2e.ts`) proves the user-visible
 * half: at most one overlay on screen.
 *
 * The registry is module state, deliberately (D1: "one realm, one slot"), so these tests reset it
 * between cases through the test-only hatch rather than by re-importing the module.
 */
describe('claimTransientOverlay — the one-slot claim registry (FR-071)', () => {
  beforeEach(() => {
    __resetTransientOverlayForTests();
  });

  it('claiming an empty slot dismisses nothing', () => {
    const calls: string[] = [];
    claimTransientOverlay(() => calls.push('a'));
    expect(calls).toEqual([]);
  });

  it("claiming while another holds the slot calls the incumbent's dismiss exactly once", () => {
    const calls: string[] = [];
    claimTransientOverlay(() => calls.push('a'));
    claimTransientOverlay(() => calls.push('b'));
    expect(calls).toEqual(['a']);

    // …and the new claimant is now the incumbent, so a third claim dismisses B and not A again.
    claimTransientOverlay(() => calls.push('c'));
    expect(calls).toEqual(['a', 'b']);
  });

  /**
   * The claim-before-dismiss ordering, which is the whole reason the assignment happens first.
   *
   * An incumbent's `dismiss` is almost always a `setState(false)`, and the effect cleanup that
   * follows runs the `release` it was handed — synchronously, in React's own teardown. If the claim
   * were written AFTER the dismiss, that release would clear the slot the new overlay is about to
   * take, and the NEXT overlay would find nothing to dismiss. The bug appears only on the second
   * link of a chain, which is exactly what "the chord did nothing" looks like from the outside.
   */
  it('an incumbent whose dismiss synchronously releases itself leaves the NEW claim in the slot', () => {
    const calls: string[] = [];
    let releaseA: (() => void) | null = null;
    releaseA = claimTransientOverlay(() => {
      calls.push('a');
      releaseA?.(); // the effect cleanup, arriving synchronously
    });

    claimTransientOverlay(() => calls.push('b'));
    expect(calls).toEqual(['a']);

    // If A's self-release had cleared the slot, this would dismiss nothing.
    claimTransientOverlay(() => calls.push('c'));
    expect(calls).toEqual(['a', 'b']);
  });

  /**
   * The late-unmount case. React mounts the new tree before cleaning up the old one, so a
   * superseded overlay's cleanup can arrive after a newer overlay has already claimed the slot. A
   * plain `current = null` there would silently disarm the live overlay.
   */
  it('a release from a superseded claim is a no-op and does not clear the current holder', () => {
    const calls: string[] = [];
    const releaseA = claimTransientOverlay(() => calls.push('a'));
    claimTransientOverlay(() => calls.push('b'));
    calls.length = 0;

    releaseA(); // arrives late, long after B took the slot

    claimTransientOverlay(() => calls.push('c'));
    expect(calls).toEqual(['b']);
  });

  it('release is idempotent — calling it twice clears the slot once and never a later claim', () => {
    const calls: string[] = [];
    const releaseA = claimTransientOverlay(() => calls.push('a'));
    releaseA();
    releaseA();

    claimTransientOverlay(() => calls.push('b'));
    expect(calls).toEqual([]); // the slot was empty; nothing to dismiss

    releaseA(); // a third, even later release must not evict B
    claimTransientOverlay(() => calls.push('c'));
    expect(calls).toEqual(['b']);
  });

  /**
   * An overlay tearing itself down must not be able to keep the next one from opening. A throwing
   * `dismiss` is a defect in that overlay; refusing to record the new claim would turn it into a
   * defect in every overlay after it.
   */
  it('an incumbent whose dismiss throws does not prevent the new claim from being recorded', () => {
    const calls: string[] = [];
    claimTransientOverlay(() => {
      throw new Error('this overlay explodes on the way out');
    });

    expect(() => claimTransientOverlay(() => calls.push('b'))).not.toThrow();

    claimTransientOverlay(() => calls.push('c'));
    expect(calls).toEqual(['b']);
  });
});
