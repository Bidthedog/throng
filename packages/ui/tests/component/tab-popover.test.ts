/**
 * What the tab hover popover SAYS (031 US6 / FR-051, FR-050b; contracts/tab-strip.md §6 P2).
 *
 * PLACE AT: `packages/ui/tests/component/tab-popover.test.ts`
 * COMPANION TO `packages/ui/tests/e2e/tab-presentation.e2e.ts:143` — T096 (034 FR-045).
 *
 * ══ THIS FILE DELETES NOTHING, AND THAT IS THE VERDICT, NOT AN OVERSIGHT ══
 *
 * T096 stays whole. Three of its assertions are the WIRING — that the popover's name is the chip's
 * own label, that its panel list is the real panel titles read out of the running layout, and that
 * the chip carries no leftover `title` alongside the surface — and one is real geometry (FR-049:
 * the panels are drawn INDENTED under the tab, measured as `x`). A component test cannot make any
 * of those claims, and 034 FR-047 says a partial replacement is not a replacement. So this file is
 * ADDITIVE: it states what `TabPopover` renders for a given set of props, which is the half T096
 * only ever reached through the app.
 *
 * ══ WHAT IT ADDS THAT NOTHING ASSERTED ANYWHERE ══
 *
 * T096 hovers a tab holding exactly TWO panels, so it reads `2 panels` and never exercises the
 * conditional that produces it. Nothing in the suite asserts:
 *
 *   - the SINGULAR — `1 panel`, the branch a `${n} panels` template silently gets wrong;
 *   - the EMPTY case — no panel list element at all, rather than an empty `<ul>` with a bullet;
 *   - that duplicate panel names both survive — two panels may legitimately wear the same name,
 *     and the popover must list both rather than collapsing them. NOTE this does NOT establish
 *     anything about the `key={`${index}:${panel}`}` the component uses: measured, mutating that
 *     to a bare `key={panel}` reddens nothing here, because React renders both siblings and warns
 *     rather than dropping one, and a key never reaches the DOM for an assertion to read. The
 *     mutation is inert at this layer, not the test weak — a distinction worth keeping straight,
 *     since the comfortable reading of a green mutation is always that the mutation was bad;
 *   - that the name is shown IN FULL (FR-050b) — the ellipsised form in the strip is what the user
 *     is hovering to see past, so a popover that repeated the truncation would be pointless.
 *
 * ══ WHY IT MOUNTS CLEANLY WHERE THE REST OF THE STRIP DOES NOT ══
 *
 * `TabPopover` is exported and takes four plain props (`tabId`, `name`, `panelNames`, `anchor`).
 * It reaches no context, no store and no IPC — unlike `TabGroup`, which needs seven providers and a
 * measured layout before it renders a single chip. That is the whole reason this half comes down and
 * the rest of `tab-presentation.e2e.ts` does not.
 *
 * The `useLayoutEffect` that positions the surface still runs here. jsdom reports every rect as
 * zeroes, so `clampToViewport` resolves to `{ left: 0, top: 0 }` and the surface becomes visible —
 * which is what makes the content readable. WHERE it lands is not asserted anywhere in this file:
 * that is layout, it is proved against a real viewport in `floating-surfaces.test.ts` and the
 * running app, and a jsdom assertion about it would be a coordinate agreeing with itself.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * In `mount()` below, pass `anchor: null` instead of the element (one line: replace
 * `anchor: host` with `anchor: null`). `TabPopover` returns `null` for a null anchor, so nothing is
 * portaled and the document stays empty. **ALL EIGHT tests fail.** Every test here asserts an
 * element or a text PRESENT before it asserts anything absent — there is no test in this file that
 * an unrendered popover can satisfy.
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { TabPopover } from '../../src/renderer/workspace/tab-popover.js';

/** Anchors created for a test, removed afterwards — the popover portals to `document.body`. */
const anchors: HTMLElement[] = [];

afterEach(() => {
  for (const el of anchors.splice(0)) el.remove();
});

/**
 * Render the popover against a real anchor element in the document.
 *
 * The anchor has to be a live `HTMLElement`: the positioning effect calls
 * `anchor.getBoundingClientRect()`, and a detached node or a bare object would throw inside the
 * layout effect rather than fail an assertion.
 */
function mount(tabId: string, name: string, panelNames: string[]): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  anchors.push(host);
  render(createElement(TabPopover, { tabId, name, panelNames, anchor: host }));
}

/** The panel rows, in the order the surface is showing them. */
function panelRows(): string[] {
  return Array.from(document.querySelectorAll('.tabstrip-popover__panel')).map((el) =>
    (el.textContent ?? '').trim(),
  );
}

describe('the tab hover popover (FR-051)', () => {
  it('names the tab, counts its panels, and lists them in layout order', () => {
    mount('t-1', 'Build', ['Panel 1', 'Panel 2', 'Panel 3']);

    const popover = screen.getByTestId('tabstrip-popover');
    expect(popover).toBeVisible();
    expect(screen.getByTestId('tabstrip-popover-name')).toHaveTextContent('Build');
    expect(screen.getByTestId('tabstrip-popover-count')).toHaveTextContent('3 panels');
    // ORDER, not membership. `toEqual` on the array is what tells a list that happens to contain
    // the right names from one that lists them the way the layout holds them.
    expect(panelRows()).toEqual(['Panel 1', 'Panel 2', 'Panel 3']);
  });

  it('says “1 panel”, singular, for a tab holding one', () => {
    /*
     * The branch T096 never reaches: it hovers a two-panel tab, so `${n} panels` would pass there
     * forever. A tab with one panel is the ordinary case in the running application — every project
     * starts as exactly that — which is what makes this the most-seen string in the file.
     */
    mount('t-1', 'Solo', ['Panel 1']);

    // EXACT, not substring: `toHaveTextContent('1 panel')` is satisfied by '1 panels', so the
    // plural-only mutation could not redden it — measured. The regex anchors both ends.
    expect(screen.getByTestId('tabstrip-popover-count')).toHaveTextContent(/^1 panel$/);
    expect(panelRows()).toEqual(['Panel 1']);
  });

  it('draws no panel list at all for a tab with none, rather than an empty one', () => {
    /*
     * PRESENT first, absent second. The name and the count are asserted before the list is asserted
     * missing, so this cannot be satisfied by a popover that failed to render — which is the exact
     * shape of vacuous pass this layer produces.
     */
    mount('t-1', 'Empty', []);

    expect(screen.getByTestId('tabstrip-popover-name')).toHaveTextContent('Empty');
    expect(screen.getByTestId('tabstrip-popover-count')).toHaveTextContent('0 panels');
    expect(screen.queryByTestId('tabstrip-popover-panels')).toBeNull();
    expect(panelRows()).toEqual([]);
  });

  it('keeps BOTH of two panels that share a name', () => {
    /*
     * Panel names are not unique across a tab, and the component keys its rows on `index:name` for
     * that reason. A `key={panel}` would render one row and log a duplicate-key warning — a defect
     * that shows up as a missing line in a tooltip and nowhere else.
     */
    mount('t-1', 'Twins', ['Logs', 'Logs', 'Build']);

    expect(panelRows()).toEqual(['Logs', 'Logs', 'Build']);
    expect(screen.getByTestId('tabstrip-popover-count')).toHaveTextContent('3 panels');
  });

  it('shows the tab name IN FULL, however long it is (FR-050b)', () => {
    /*
     * The strip ellipsises a name that will not fit its chip; the popover is what the user hovers to
     * see past that. A surface that repeated the truncation would answer the question with the
     * question.
     *
     * Asserted as an exact `textContent` rather than `toContainText`: a popover that appended an
     * ellipsis to the full name — the plausible half-fix — still contains the full name.
     */
    const long = 'a deployment pipeline for the release candidate branch';
    mount('t-1', long, ['Panel 1']);

    expect(screen.getByTestId('tabstrip-popover-name').textContent).toBe(long);
  });

  it('identifies whose tab it is describing', () => {
    // `data-tab-id` is how T096 tells "a popover opened" from "the popover for the tab under the
    // pointer opened" — the distinction that matters when the strip has moved under the cursor.
    mount('tab-42', 'Build', ['Panel 1']);

    expect(screen.getByTestId('tabstrip-popover')).toHaveAttribute('data-tab-id', 'tab-42');
  });

  it('is a tooltip to assistive technology', () => {
    mount('t-1', 'Build', ['Panel 1']);

    expect(screen.getByTestId('tabstrip-popover')).toHaveAttribute('role', 'tooltip');
  });

  it('renders outside the strip, as a child of the document body', () => {
    /*
     * `.tab-strip` is `overflow: hidden`, so a surface rendered inside it is CLIPPED by it. The
     * portal is what stops the popover being a sliver at the edge of the strip — and it is a
     * structural claim about where the node lands, which needs no layout to state.
     */
    mount('t-1', 'Build', ['Panel 1']);

    const popover = screen.getByTestId('tabstrip-popover');
    expect(popover.parentElement).toBe(document.body);
  });
});
