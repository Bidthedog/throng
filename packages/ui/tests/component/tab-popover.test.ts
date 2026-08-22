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
import { TabPopover, popoverTabName } from '../../src/renderer/workspace/tab-popover.js';
import type { PanelListEntry } from '../../src/renderer/workspace/use-panel-display-names.js';

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
/**
 * Panel rows are `{ name, icon, typeLabel }` since #304. The helper still takes bare strings so the
 * assertions above stay about what the surface SAYS; `typed()` is for the tests that are about the
 * type icon itself.
 */
function untyped(name: string): PanelListEntry {
  return { name, icon: null, typeLabel: null };
}

function typed(name: string, icon: string, typeLabel: string): PanelListEntry {
  return { name, icon, typeLabel };
}

function mount(tabId: string, name: string | null, panelNames: (string | PanelListEntry)[]): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  anchors.push(host);
  const rows = panelNames.map((p) => (typeof p === 'string' ? untyped(p) : p));
  render(createElement(TabPopover, { tabId, name, panelNames: rows, anchor: host }));
}

/**
 * The panel NAMES, in the order the surface is showing them.
 *
 * Reads the name span rather than the whole row since #304: the row also holds the type icon, and
 * with a glyph icon pack that glyph is a character in `textContent` — so a row-level read would
 * assert on `▣ISSUE MANAGEMENT` and turn every one of these into a test of the icon pack.
 */
function panelRows(): string[] {
  return Array.from(document.querySelectorAll('.tabstrip-popover__panel-name')).map((el) =>
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

/**
 * #304 — the panel's TYPE, as an icon standing where the bullet used to.
 *
 * The information is the type, and an icon carries it only for someone who can both see it and
 * resolve the glyph. So the assertions below are as much about the `title` as about the icon: a
 * marker nothing can name is decoration, and this row replaced a `list-style: disc` bullet that at
 * least cost nobody anything.
 */
describe('the panel type in each row (#304)', () => {
  it('marks a row with its type icon', () => {
    mount('t-1', null, [typed('ISSUE MANAGEMENT', 'terminal', 'Terminal')]);

    // `Icon` resolves to inline SVG or to a glyph depending on the active pack, and both arrive as
    // a `.icon` span — so this asserts the icon was RENDERED without pinning which form it took.
    const marker = screen.getByTestId('tabstrip-popover-panel-kind-0');
    expect(marker.querySelector('.icon'), 'the icon itself is rendered').not.toBeNull();
  });

  it('NAMES the type on the icon, so the glyph is not the only way to read it', () => {
    mount('t-1', null, [typed('composition-root', 'editorPanel', 'Editor Panel')]);

    expect(screen.getByTestId('tabstrip-popover-panel-kind-0')).toHaveAttribute(
      'title',
      'Editor Panel',
    );
  });

  it('keeps the name as the row text, with no type spelled out beside it', () => {
    // The icon replaced a `(Terminal)` suffix. Both at once would say it twice.
    mount('t-1', null, [typed('ISSUE MANAGEMENT', 'terminal', 'Terminal')]);

    expect(panelRows()).toEqual(['ISSUE MANAGEMENT']);
  });

  it('gives an untyped panel a plain BULLET, and no type to read', () => {
    // It has no type yet, so there is nothing to name — and the bullet is what the whole list wore
    // before the icons arrived, which is the honest marker for "a panel, kind not yet chosen".
    mount('t-1', null, [untyped('Panel 4')]);

    expect(screen.queryByTestId('tabstrip-popover-panel-kind-0'), 'no type marker').toBeNull();
    expect(document.querySelector('.tabstrip-popover__panel-icon')?.textContent).toBe('•');
    expect(panelRows()).toEqual(['Panel 4']);
  });

  it('keeps every row on the same marker slot, typed or not', () => {
    // A row that omitted the span would start one glyph left of its neighbours.
    mount('t-1', null, [untyped('Panel 4'), typed('build', 'terminal', 'Terminal')]);

    const icons = document.querySelectorAll('.tabstrip-popover__panel-icon');
    expect(icons, 'one slot per row, bullet or icon').toHaveLength(2);
    expect(icons[0]?.textContent, 'the untyped row wears the bullet').toBe('•');
  });

  it('marks each row with its OWN type', () => {
    mount('t-1', null, [
      typed('ISSUE MANAGEMENT', 'terminal', 'Terminal'),
      typed('composition-root', 'editorPanel', 'Editor Panel'),
    ]);

    expect(screen.getByTestId('tabstrip-popover-panel-kind-0')).toHaveAttribute('title', 'Terminal');
    expect(screen.getByTestId('tabstrip-popover-panel-kind-1')).toHaveAttribute(
      'title',
      'Editor Panel',
    );
  });
});

/**
 * #296 — the name line, and when it earns its place.
 *
 * Split in two on purpose. The DECISION is `popoverTabName`, which is pure and asserted exhaustively
 * here; the rendering is the component. What is deliberately NOT here is the measurement that feeds
 * `ellipsised`: whether `tabs.maxWidth` actually ellipsised the chip depends on the rendered font,
 * so it needs a real layout engine and stays at the E2E layer (constitution v5.1.0's real-layout
 * reserve). Splitting it this way means only the measurement costs an application launch, rather
 * than all three acceptance criteria.
 */
describe('whether the popover repeats the tab name (#296)', () => {
  it('omits it when the chip is already showing the name in full', () => {
    mount('t-1', popoverTabName('Build', false, false), ['Panel 1', 'Panel 2']);

    expect(screen.queryByTestId('tabstrip-popover-name')).toBeNull();
  });

  it('makes the panel list the first thing in the surface when the name is omitted', () => {
    // The point of the tweak: the list the popover exists to reveal starts a line higher.
    mount('t-1', popoverTabName('Build', false, false), ['Panel 1']);

    const popover = screen.getByTestId('tabstrip-popover');
    expect(popover.firstElementChild).toBe(screen.getByTestId('tabstrip-popover-count'));
  });

  it('keeps the FULL name when tabs.maxNameLength shortened it (FR-037)', () => {
    const long = 'A very long tab name indeed';
    mount('t-1', popoverTabName(long, true, false), ['Panel 1']);

    expect(screen.getByTestId('tabstrip-popover-name')).toHaveTextContent(long);
  });

  it('keeps the FULL name when tabs.maxWidth ellipsised the chip — FR-050b holds', () => {
    const long = 'A very long tab name indeed';
    mount('t-1', popoverTabName(long, false, true), ['Panel 1']);

    expect(screen.getByTestId('tabstrip-popover-name')).toHaveTextContent(long);
  });

  it('is decided by EITHER mechanism, not both at once', () => {
    // Stated because the two are independent: a name can be shortened without the chip ellipsising
    // and vice versa, and requiring both would drop the name in exactly the cases it is needed.
    expect(popoverTabName('Build', true, false)).toBe('Build');
    expect(popoverTabName('Build', false, true)).toBe('Build');
    expect(popoverTabName('Build', true, true)).toBe('Build');
    expect(popoverTabName('Build', false, false)).toBeNull();
  });
});
