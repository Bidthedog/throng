import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerPanelFocus,
  unregisterPanelFocus,
  requestPanelFocus,
  focusPanel,
} from '../../src/renderer/workspace/panel-focus.js';

/**
 * The panel-focus registry — DOM focus follows the active-panel indicator (012 US3, issue #144).
 *
 * PLACE AT: `packages/ui/tests/unit/panel-focus.test.ts`
 * NEW COVERAGE (035). Eight dependents, no test. It is module-level rather than React state
 * precisely so the global keydown handler can reach it without threading refs through the tree —
 * which also makes it testable with no DOM at all, and nothing had.
 *
 * ══ WHAT IT IS FOR ══
 *
 * Move-focus must move the CARET, not just the highlight. A panel that looks active while the
 * keyboard still types into the last one is worse than no indicator at all, because the user has
 * been told where their next keystroke goes and told wrong.
 *
 * ══ THE PARKED REQUEST (#144) IS THE HARD PART ══
 *
 * A project switch swaps the whole layout, and the new active tab's editor mounts only after an
 * async `client.load()` round-trip — so a focus requested the instant the switch settles finds no
 * callback yet. Rather than race that mount, the request is parked and honoured when the panel
 * registers. Every assertion about parking below is about a bug that has actually happened.
 *
 * ══ WHY THE MODULE STATE IS DRAINED BETWEEN TESTS ══
 *
 * `pendingFocusPanelId` is a module-level slot with no reset export, so a test that parks a request
 * and does not consume it would leak into the next one — and the leak would look like a passing
 * test, because a stray parked id only shows up when some LATER panel happens to register under
 * that name. The drain below consumes the slot through the module's own API rather than reaching
 * into its internals.
 */
const noop = (): void => {};

afterEach(() => {
  // Park a request for a name nothing else uses, then satisfy it — the only way to empty the slot
  // through the public surface.
  requestPanelFocus('__drain__');
  registerPanelFocus('__drain__', noop);
  unregisterPanelFocus('__drain__');
});

describe('focusing a panel that is mounted', () => {
  it('calls the registered callback and reports that it did', () => {
    const focus = vi.fn();
    registerPanelFocus('p1', focus);

    expect(focusPanel('p1')).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);

    unregisterPanelFocus('p1');
  });

  it('reports FALSE for a panel with no input surface', () => {
    /*
     * The return value is load-bearing, not diagnostic: "a plain placeholder panel has none — the
     * caller can then fall back to focusing its container". A caller that could not tell the
     * difference would either leave the caret where it was or focus nothing at all.
     */
    expect(focusPanel('never-registered')).toBe(false);
  });

  it('survives a callback that throws, and still reports success', () => {
    /*
     * "The view may be tearing down — a missed focus is non-fatal." The alternative is an exception
     * escaping into a global keydown handler, which would take out the keystroke that caused it and
     * every one after it in the same dispatch.
     */
    registerPanelFocus('p1', () => {
      throw new Error('view is unmounting');
    });

    expect(() => focusPanel('p1')).not.toThrow();
    expect(focusPanel('p1'), 'a callback existed, even though it failed').toBe(true);

    unregisterPanelFocus('p1');
  });

  it('replaces a callback rather than accumulating them', () => {
    // A panel view that remounts registers again under the same id. Two live callbacks would mean
    // one focus request reaching a detached surface as well as the live one.
    const first = vi.fn();
    const second = vi.fn();
    registerPanelFocus('p1', first);
    registerPanelFocus('p1', second);

    focusPanel('p1');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    unregisterPanelFocus('p1');
  });

  it('forgets a panel on unregister, idempotently', () => {
    registerPanelFocus('p1', noop);
    unregisterPanelFocus('p1');

    expect(focusPanel('p1')).toBe(false);
    expect(() => unregisterPanelFocus('p1')).not.toThrow();
    expect(() => unregisterPanelFocus('never-registered')).not.toThrow();
  });
});

describe('a focus requested before the panel exists (#144)', () => {
  it('is honoured the moment the panel registers', () => {
    /*
     * The project-switch case. The request beats the deferred editor mount, and a one-shot
     * `view.focus()` fired inside that async mount is lost in the churn — the click that triggered
     * the switch left DOM focus on the sidebar's project button, which is itself focusable.
     */
    const focus = vi.fn();

    requestPanelFocus('p-late');
    expect(focus, 'nothing to call yet').not.toHaveBeenCalled();

    registerPanelFocus('p-late', focus);

    expect(focus).toHaveBeenCalledTimes(1);
    unregisterPanelFocus('p-late');
  });

  it('fires exactly once, not on every later registration', () => {
    // A remount must not resurrect a focus the user asked for minutes ago and has since moved on
    // from. The slot is cleared as it is consumed.
    const focus = vi.fn();
    requestPanelFocus('p-late');
    registerPanelFocus('p-late', focus);
    unregisterPanelFocus('p-late');

    registerPanelFocus('p-late', focus);

    expect(focus).toHaveBeenCalledTimes(1);
    unregisterPanelFocus('p-late');
  });

  it('is only ever satisfied by the panel it named', () => {
    // "Panel ids are unique, so a parked request can only ever be satisfied by the exact panel it
    // named." An unrelated panel mounting in the meantime must not steal the caret.
    const wrong = vi.fn();
    requestPanelFocus('p-late');

    registerPanelFocus('p-other', wrong);

    expect(wrong).not.toHaveBeenCalled();
    unregisterPanelFocus('p-other');
  });

  it('fires immediately when the panel is ALREADY mounted, and parks nothing', () => {
    const focus = vi.fn();
    const later = vi.fn();
    registerPanelFocus('p1', focus);

    requestPanelFocus('p1');
    expect(focus).toHaveBeenCalledTimes(1);

    // Nothing is parked, so a subsequent registration of the same id must not fire again.
    unregisterPanelFocus('p1');
    registerPanelFocus('p1', later);
    expect(later).not.toHaveBeenCalled();

    unregisterPanelFocus('p1');
  });

  it('keeps only the LAST request — focus is singular (a decision, not a limitation)', () => {
    /*
     * The module argues this explicitly and it is worth pinning: two parked requests could only
     * ever mean two panels fighting for one caret, and the later request is the more recent
     * statement of what the user is doing. The discarded one is not lost work — the panel it named
     * simply mounts without taking focus, which is what an unfocused panel does anyway.
     */
    const first = vi.fn();
    const second = vi.fn();

    requestPanelFocus('p-first');
    requestPanelFocus('p-second');

    registerPanelFocus('p-first', first);
    expect(first, 'the superseded request was discarded').not.toHaveBeenCalled();

    registerPanelFocus('p-second', second);
    expect(second).toHaveBeenCalledTimes(1);

    unregisterPanelFocus('p-first');
    unregisterPanelFocus('p-second');
  });

  it('consumes the parked slot even when the callback throws', () => {
    /*
     * The module is explicit that this is NOT an excuse for registering early: "registerPanelFocus
     * consumes the slot whether or not the callback can deliver, so a view must register only once
     * its input surface is live."
     *
     * Asserted so the cost of getting that wrong is visible in the suite: a view that registers
     * before it can focus burns the request, and the parked focus is gone — it does not wait for a
     * later, working registration.
     */
    const broken = vi.fn(() => {
      throw new Error('surface not ready');
    });
    const working = vi.fn();

    requestPanelFocus('p-late');
    registerPanelFocus('p-late', broken);
    expect(broken).toHaveBeenCalledTimes(1);

    unregisterPanelFocus('p-late');
    registerPanelFocus('p-late', working);

    expect(working, 'the request was spent on the registration that could not deliver').not.toHaveBeenCalled();
    unregisterPanelFocus('p-late');
  });
});
