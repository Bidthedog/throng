/**
 * The tab strip's smooth scroll (031 US3, contracts/tab-strip.md §3, FR-029–FR-031d).
 *
 * ONE `requestAnimationFrame` loop per strip, owning a **replaceable target**. That single sentence
 * is the design, and every guarantee in §3 falls out of it structurally rather than being defended
 * by a rule someone has to remember:
 *
 *  - **A6 (supersede)** — a new scroll overwrites the in-flight run's `from`/`to`/`startedAt`. It
 *    therefore starts from wherever the strip actually is, and takes the full duration to get to the
 *    new target, instead of finishing the old journey first.
 *  - **A7 (never queue)** — there is nowhere to queue *to*. Two quick steps write the target twice
 *    and the strip settles once, at the second one.
 *  - **A8 (no residue)** — there is no second animation to leave behind, and no `setTimeout`
 *    callback closing over a stale target that could fire after the fact. Nothing can jump back.
 *  - **A9 (rests at the most recent target)** — the caller recomputes its target against the current
 *    contents, and the browser clamps `scrollLeft` to the live content box, so a tab destroyed
 *    mid-flight cannot be scrolled to.
 *
 * The curve itself lives in `@throng/core` (`ease`), so A4/A5 — accelerate from rest, decelerate to
 * a stop, the same curve at every duration — are asserted without a DOM.
 *
 * **Reduce motion is an override, never a setting** (A11–A13). The OS preference forces the instant
 * path whatever `tabs.smoothScrollMs` says, is honoured LIVE (turning it on settles a scroll already
 * in flight, rather than waiting for the next one), and — because it is read from `matchMedia` and
 * never written anywhere — it cannot rewrite the stored setting (A12).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ease } from '@throng/core';

const REDUCE_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * Sub-pixel slack, matching core's geometry epsilon. A third of a pixel is not a journey, and
 * layout produces fractional positions constantly.
 */
const SETTLED_EPSILON = 0.5;

/**
 * The live media query, or `null` where there is no `matchMedia` (a non-DOM test environment).
 * Absence means "no preference expressed", which is the same answer as a query that does not match.
 */
function reduceMotionQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(REDUCE_MOTION);
}

/**
 * Whether the OS is currently asking for reduced motion, re-rendering when that changes (A13).
 *
 * Subscribed rather than sampled once: the preference is a system setting the user can flip while
 * the application is open, and a value read at mount would go stale silently — which is the failure
 * mode "honoured live" exists to forbid.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => reduceMotionQuery()?.matches ?? false);
  useEffect(() => {
    const query = reduceMotionQuery();
    if (!query) return;
    setReduced(query.matches); // re-sample: the preference may have changed before we subscribed
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** One scroll in flight. Replaced wholesale by a superseding scroll; never queued behind one. */
interface Run {
  from: number;
  to: number;
  startedAt: number;
  duration: number;
}

export interface TabScroller {
  /**
   * Scroll the track to `target`. `null` — which is what `revealTarget`/`stepTarget` return when
   * there is nothing to do — is a deliberate no-op, so an already-visible tab causes no movement
   * (A2) without every call site having to test for it.
   */
  scrollTo: (target: number | null) => void;
  /**
   * Where the strip is HEADING — the in-flight scroll's target — or `null` when nothing is in
   * flight and "where it is heading" is simply where it is (A7, A9).
   *
   * Callers decide against this rather than against the live `scrollLeft`, because the live value
   * 50ms into a 400ms glide is still essentially the position the glide started from. A step
   * measured there chooses the SAME destination the previous press did (so presses fail to
   * accumulate), and a reveal measured there judges visibility against a viewport the strip is in
   * the act of leaving (so a scroll towards a tab that has since been destroyed is never
   * recomputed). Both are the same mistake: asking where the strip is, when the question is where
   * it will be.
   */
  pendingTarget: () => number | null;
  /** True while the instant path is in force — duration 0, or the OS asking for reduced motion. */
  instant: boolean;
}

/**
 * Drive one strip's horizontal scroll.
 *
 * `durationMs` is `tabs.smoothScrollMs`; `0` means instant (A10). It is read through a ref so a
 * settings change never re-creates `scrollTo` — a new identity would re-fire every effect that
 * depends on it, which for the reveal-the-active-tab effect means scrolling again for no reason.
 */
export function useTabScroll(
  trackRef: RefObject<HTMLElement | null>,
  durationMs: number,
): TabScroller {
  const reduceMotion = usePrefersReducedMotion();
  const instant = reduceMotion || !(durationMs > 0);

  const run = useRef<Run | null>(null);
  const frame = useRef<number | null>(null);
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;
  const instantRef = useRef(instant);
  instantRef.current = instant;

  const cancelFrame = useCallback((): void => {
    if (frame.current === null) return;
    cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  /**
   * Finish any scroll in flight AT ITS TARGET, immediately.
   *
   * Stopping where the animation happens to be would leave the active tab half-revealed — an
   * instant scroll must still achieve the OUTCOME (A14), not merely stop moving.
   */
  const settle = useCallback((): void => {
    const inFlight = run.current;
    run.current = null;
    cancelFrame();
    const track = trackRef.current;
    if (inFlight && track) track.scrollLeft = inFlight.to;
  }, [cancelFrame, trackRef]);

  const start = useCallback((): void => {
    const tick = (now: number): void => {
      frame.current = null;
      const track = trackRef.current;
      const inFlight = run.current;
      if (!track || !inFlight) {
        run.current = null;
        return;
      }
      const elapsed = now - inFlight.startedAt;
      const t = inFlight.duration > 0 ? elapsed / inFlight.duration : 1;
      if (t >= 1) {
        track.scrollLeft = inFlight.to;
        run.current = null;
        return;
      }
      track.scrollLeft = inFlight.from + (inFlight.to - inFlight.from) * ease(t);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [trackRef]);

  const scrollTo = useCallback(
    (target: number | null): void => {
      const track = trackRef.current;
      if (track === null || target === null) return;
      /*
       * "Be here" — the strip is already at the target, to the sub-pixel.
       *
       * There is nothing to animate, and a zero-distance run is not harmless: it writes `scrollLeft`
       * on EVERY frame for the whole duration, so for those 300ms the strip is pinned against
       * anything else that tries to move it. That is not hypothetical — the browser scrolls a
       * newly-mounted, focused tab chip into view natively, which lands the strip on the very
       * position the reveal is about to ask for, and the resulting no-op glide then undid a scroll
       * made a frame later.
       *
       * It SUPERSEDES like any other scroll (A6): the journey in flight is abandoned where it is,
       * rather than resuming and pulling the strip off the target it has just been given.
       */
      if (Math.abs(track.scrollLeft - target) <= SETTLED_EPSILON) {
        run.current = null;
        cancelFrame();
        return;
      }
      if (instantRef.current) {
        run.current = null;
        cancelFrame();
        track.scrollLeft = target;
        return;
      }
      // The supersede (A6): `from` is where the strip IS, not where the previous run began.
      run.current = {
        from: track.scrollLeft,
        to: target,
        startedAt: performance.now(),
        duration: durationRef.current,
      };
      if (frame.current === null) start();
    },
    [cancelFrame, start, trackRef],
  );

  // Stable identity: the reveal effect depends on this, and a new function each render would
  // re-fire (and re-scroll) for no reason at all.
  const pendingTarget = useCallback((): number | null => run.current?.to ?? null, []);

  // A13 — the preference turning on settles whatever is in flight, rather than only affecting the
  // next scroll. A user who asks for less motion mid-glide has asked about THIS glide.
  useEffect(() => {
    if (instant) settle();
  }, [instant, settle]);

  useEffect(() => cancelFrame, [cancelFrame]);

  return { scrollTo, pendingTarget, instant };
}
