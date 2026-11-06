/**
 * Component-layer setup. Runs once per test file, before any test.
 *
 * Two jobs, and deliberately no more: register the jest-dom matchers, and unmount
 * every rendered tree between tests. A setup file that starts seeding application
 * state is a setup file that has begun rebuilding the harness this layer exists to
 * avoid — if a component needs a provider, the test wraps it explicitly so the
 * reader can see what it depends on.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/** Generous against dnd-kit's own 50 ms, and still a bound: a suppressor that never lifts fails loudly. */
const CLICK_SUPPRESSION_BOUND_MS = 1_000;

/**
 * True when a click can reach the document again. dnd-kit's pointer sensor, once a drag activates,
 * adds a capture-phase `click` listener on the DOCUMENT that stops propagation, so the click that ends
 * a drag does not also activate what it was dropped on; it removes that listener only 50 ms after the
 * drag ends (`setTimeout(documentListeners.removeAll, 50)` in `@dnd-kit/core`). The jsdom document
 * outlives each test in a file, so a test that clicks within 50 ms of the previous test's drop has its
 * click swallowed before React sees it — the Linux CI failure of `projects-panel-category-reorder`'s
 * chevron click, whose two predecessors ran in 33 ms there.
 */
function clicksReachTheDocument(): boolean {
  const probe = document.createElement('div');
  let reached = false;
  probe.addEventListener('click', () => {
    reached = true;
  });
  document.body.appendChild(probe);
  probe.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  probe.remove();
  return reached;
}

// React Testing Library's auto-cleanup only registers itself when it can detect a
// global `afterEach`, and it is cheaper to be explicit than to depend on that
// detection: a leaked tree shows up as a *neighbouring* test failing on a duplicate
// element, which is a genuinely confusing failure to read.
//
// The same goes for a drag's click suppressor (above): it is waited out here, so it can never reach the
// next test. One synthetic click when nothing is pending; a real wait only after a drag. Under fake timers
// dnd-kit's own timer is fake too and nothing real can lift it, so the wait is skipped.
afterEach(async () => {
  cleanup();
  if (typeof document === 'undefined' || vi.isFakeTimers()) return;
  const deadline = Date.now() + CLICK_SUPPRESSION_BOUND_MS;
  while (!clicksReachTheDocument()) {
    if (Date.now() > deadline) {
      throw new Error(`clicks were still being stopped at the document ${CLICK_SUPPRESSION_BOUND_MS} ms after the test — a drag's click suppressor never lifted`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
});

/**
 * `Element.prototype.scrollIntoView` — jsdom does not implement it, and calling it throws.
 *
 * Any component that keeps a highlighted row visible calls it, so without this the failure is not a
 * missing assertion but a crash inside the render: "row?.scrollIntoView is not a function", thrown
 * from a keyboard handler and surfacing as every test in the file failing at once.
 *
 * A no-op is the honest shim. jsdom has no layout, so there is no scrolling to simulate and nothing
 * a faithful implementation could do — which is also why "the right row is scrolled into view" is a
 * claim that stays at the E2E layer (constitution v5.1.0's real-layout reserve). What a component
 * test can still say is that the component asked.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* no layout in jsdom — see above */
  };
}
