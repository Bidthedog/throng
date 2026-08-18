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
import { afterEach } from 'vitest';

// React Testing Library's auto-cleanup only registers itself when it can detect a
// global `afterEach`, and it is cheaper to be explicit than to depend on that
// detection: a leaked tree shows up as a *neighbouring* test failing on a duplicate
// element, which is a genuinely confusing failure to read.
afterEach(() => {
  cleanup();
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
