/**
 * Tab-strip E2E helpers (031).
 *
 * Two jobs, both about not re-deriving the same thing in five specs:
 *
 *  - {@link seedTabs} makes the strip overflow. Every US1/US3/US5 spec needs that and none of them
 *    care how it is done, so the "+ then type then Enter" dance lives here once.
 *  - {@link stripGeometry} reads what the strip actually looks like. US1's whole claim is about
 *    GEOMETRY — a tab's height and position — rather than about a class being present, so the
 *    measurement has to come from `getBoundingClientRect()` in the real renderer. Reading it in one
 *    place also stops each spec inventing its own selectors, which is what makes a restructure like
 *    031's cost twenty spec edits instead of one.
 */
import { expect, type Page } from '@playwright/test';

/** A tab's on-screen box, as the renderer actually laid it out. */
export interface TabBox {
  testId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What the strip looks like right now. */
export interface StripGeometry {
  tabs: TabBox[];
  /** The scrolling track's metrics. `scrollWidth > clientWidth` is the definition of overflow. */
  track: { scrollLeft: number; scrollWidth: number; clientWidth: number };
  /**
   * True when a NATIVE horizontal scrollbar occupies space in the strip — the 031 defect.
   *
   * Measured as `offsetHeight - clientHeight` on the scrolling element, which is exactly the space a
   * horizontal scrollbar takes out of the content box. Checking `overflow-x` in CSS would not do:
   * the property can say `auto` while no scrollbar is present, and it is the STOLEN SPACE that
   * clipped the tabs, not the declaration.
   */
  hasNativeScrollbar: boolean;
  /** Whether each fade overlay is showing. */
  fades: { left: boolean; right: boolean };
}

/**
 * Create tabs named `names`, in order, and return their test ids.
 *
 * Clicking "+" creates a tab AND opens its rename field (tab-group.tsx: `setRenamingTabId(ws.addTab())`),
 * so each name is typed into the field that is already focused rather than by re-entering rename.
 */
export async function seedTabs(win: Page, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    await win.getByTestId('tab-add').click();
    const input = win.locator('[data-testid^="tab-rename-input-"]');
    await input.waitFor({ state: 'visible' });
    const testId = (await input.getAttribute('data-testid')) ?? '';
    await input.fill(name);
    await input.press('Enter');
    // The id is the suffix of the rename input's testid; the chip's testid uses the same id.
    ids.push(`tab-${testId.replace('tab-rename-input-', '')}`);
  }
  return ids;
}

/** Measure the strip as it is currently laid out. */
export async function stripGeometry(win: Page): Promise<StripGeometry> {
  return win.evaluate(() => {
    const strip = document.querySelector('[data-testid="tab-strip"]');
    if (!strip) throw new Error('no tab strip in the DOM');

    // The scrolling element is the track once 031 lands, and was the strip itself before it. Reading
    // whichever exists keeps this helper usable on both sides of the restructure, which is what lets
    // the same spec fail before it and pass after.
    const track = strip.querySelector('[data-testid="tabstrip-track"]') ?? strip;
    const el = track as HTMLElement;

    /*
     * The CHIPS, and only the chips.
     *
     * `[data-testid^="tab-"]` alone is not enough, and stopped being enough the moment 031 US5 gave
     * the parts of a chip their own test ids: `tab-title-<id>`, `tab-count-<id>` and
     * `tab-unsaved-<id>` all start with `tab-` and all pass a `^tab-[^-]` shape check (`tab-t`,
     * `tab-c`, `tab-u`). The helper then reported THREE "tabs" per tab, each with a different box,
     * and every count and geometry built on it was quietly wrong.
     *
     * The class is the honest discriminator: a chip is a `.tab-chip`, and its children are not.
     */
    const boxes = [...strip.querySelectorAll('[data-testid^="tab-"]')]
      .filter((n) => n.classList.contains('tab-chip'))
      .filter((n) => /^tab-[^-]/.test(n.getAttribute('data-testid') ?? ''))
      .filter((n) => !(n.getAttribute('data-testid') ?? '').startsWith('tab-add'))
      .map((n) => {
        const r = n.getBoundingClientRect();
        return {
          testId: n.getAttribute('data-testid') ?? '',
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        };
      });

    return {
      tabs: boxes,
      track: { scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth },
      hasNativeScrollbar: el.offsetHeight - el.clientHeight > 0,
      fades: {
        left: strip.getAttribute('data-fade-left') === 'true',
        right: strip.getAttribute('data-fade-right') === 'true',
      },
    };
  });
}

/** True when the tabs no longer fit the track. */
export function isOverflowing(g: StripGeometry): boolean {
  return g.track.scrollWidth > g.track.clientWidth;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 031 US3 — scrolling, the tab-actions group and the picker.
 *
 * Everything below works in the TRACK'S OWN CONTENT SPACE (`offsetLeft` / `offsetWidth`), which is
 * the space core's `stripCounts` / `stepTarget` / `revealTarget` are defined in and the space the
 * renderer measures in (`tab-group.tsx: readMetrics`). Measuring in viewport coordinates instead
 * would need every read corrected for the current scroll, and a test that forgets the correction
 * fails only once the strip has been scrolled — i.e. in exactly the tests this feature is about.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** Sub-pixel slack. Layout produces fractional widths; a third of a pixel is not visibility. */
export const EPS = 0.5;

/** One tab's edges in the track's content space. */
export interface Chip {
  /** `tab-<id>` — the chip's own test id. */
  testId: string;
  /** The bare tab id, which is what the picker's and close control's test ids are built from. */
  tabId: string;
  left: number;
  right: number;
  active: boolean;
}

/** The strip as the renderer's geometry sees it, right now. */
export interface StripState {
  chips: Chip[];
  scrollLeft: number;
  viewportWidth: number;
  contentWidth: number;
  /** The largest legal `scrollLeft`. Past this there is nothing left to reveal. */
  maxScroll: number;
  fades: { left: boolean; right: boolean };
}

/** Measure the strip in content space. */
export async function stripState(win: Page): Promise<StripState> {
  return win.evaluate(() => {
    const strip = document.querySelector('[data-testid="tab-strip"]');
    if (!strip) throw new Error('no tab strip in the DOM');
    const track = strip.querySelector('[data-testid="tabstrip-track"]') as HTMLElement | null;
    if (!track) throw new Error('no tabstrip-track in the DOM');
    const chips = Array.from(track.querySelectorAll<HTMLElement>('.tab-chip')).map((chip) => {
      const testId = chip.getAttribute('data-testid') ?? '';
      return {
        testId,
        tabId: testId.replace(/^tab-/, ''),
        left: chip.offsetLeft,
        right: chip.offsetLeft + chip.offsetWidth,
        active: chip.getAttribute('data-active') === 'true',
      };
    });
    const contentWidth = chips.reduce((widest, chip) => Math.max(widest, chip.right), 0);
    return {
      chips,
      scrollLeft: track.scrollLeft,
      viewportWidth: track.clientWidth,
      contentWidth,
      maxScroll: Math.max(0, contentWidth - track.clientWidth),
      fades: {
        left: strip.getAttribute('data-fade-left') === 'true',
        right: strip.getAttribute('data-fade-right') === 'true',
      },
    };
  });
}

export interface Counts {
  hiddenLeft: number;
  hiddenRight: number;
  total: number;
  overflowing: boolean;
}

/**
 * What the counts OUGHT to be, straight from the definition in the contract (S1): a tab is hidden
 * on a side only when it is **entirely** past that edge, so a tab straddling an edge is counted on
 * neither side.
 *
 * Deliberately re-stated here rather than imported from `@throng/core`. Importing the implementation
 * would make every count assertion in these specs a tautology — it would agree with itself whatever
 * it did. This is the definition; the badges are the claim.
 */
export function expectedCounts(s: StripState): Counts {
  const viewLeft = s.scrollLeft;
  const viewRight = s.scrollLeft + s.viewportWidth;
  let hiddenLeft = 0;
  let hiddenRight = 0;
  for (const chip of s.chips) {
    if (chip.right <= viewLeft + EPS) hiddenLeft += 1;
    else if (chip.left >= viewRight - EPS) hiddenRight += 1;
  }
  return {
    hiddenLeft,
    hiddenRight,
    total: s.chips.length,
    overflowing: s.contentWidth > s.viewportWidth + EPS,
  };
}

/** The index of the left-most tab not entirely hidden to the left — the tab the strip sits on. */
export function anchorIndex(s: StripState): number {
  for (let i = 0; i < s.chips.length; i += 1) {
    if (s.chips[i]!.right > s.scrollLeft + EPS) return i;
  }
  return s.chips.length - 1;
}

/** Is this chip entirely inside the viewport? */
export function isFullyVisible(s: StripState, chip: Chip): boolean {
  return chip.left >= s.scrollLeft - EPS && chip.right <= s.scrollLeft + s.viewportWidth + EPS;
}

/** Every chip entirely inside the viewport, in strip order. */
export function fullyVisibleChips(s: StripState): Chip[] {
  return s.chips.filter((chip) => isFullyVisible(s, chip));
}

/** The chips cut off by an edge — visible enough to click, not visible enough to read. */
export function partlyVisibleChips(s: StripState): Chip[] {
  const viewLeft = s.scrollLeft;
  const viewRight = s.scrollLeft + s.viewportWidth;
  return s.chips.filter(
    (chip) =>
      chip.right > viewLeft + EPS && chip.left < viewRight - EPS && !isFullyVisible(s, chip),
  );
}

/** The counts the three tab-action controls are DISPLAYING, read off their badges. */
export async function actionBadges(
  win: Page,
): Promise<{ hiddenLeft: number; hiddenRight: number; total: number }> {
  const badge = async (testId: string): Promise<number> => {
    const text = await win.getByTestId(testId).locator('.icon-button__badge').textContent();
    return Number((text ?? '').trim());
  };
  return {
    hiddenLeft: await badge('tabstrip-step-left'),
    hiddenRight: await badge('tabstrip-step-right'),
    total: await badge('tabstrip-show-all'),
  };
}

/**
 * Wait until the displayed counts agree with what is actually on screen (S2).
 *
 * This is the barrier after ANY mutation — a scroll, an add, a destroy, a reorder, a resize. The
 * renderer recomputes on a scroll event or a render, both of which land after the gesture returns,
 * so a bare read one line later is a race. Polling on the agreement waits for the CONDITION rather
 * than for a duration, and doubles as the S2 assertion itself.
 */
export async function expectCountsInSync(win: Page): Promise<Counts> {
  let last: Counts = { hiddenLeft: 0, hiddenRight: 0, total: 0, overflowing: false };
  await expect
    .poll(
      async () => {
        const state = await stripState(win);
        const want = expectedCounts(state);
        last = want;
        // Not overflowing → there is no group to read, and T1 says there must not be one.
        if (!want.overflowing) {
          return (await win.getByTestId('tabstrip-actions').count()) === 0 ? 'agree' : 'disagree';
        }
        if ((await win.getByTestId('tabstrip-actions').count()) === 0) return 'disagree';
        const shown = await actionBadges(win);
        return shown.hiddenLeft === want.hiddenLeft &&
          shown.hiddenRight === want.hiddenRight &&
          shown.total === want.total
          ? 'agree'
          : `shown ${shown.hiddenLeft}/${shown.hiddenRight}/${shown.total}, on screen ${want.hiddenLeft}/${want.hiddenRight}/${want.total}`;
      },
      { message: 'the tab-action counts never caught up with what is on screen' },
    )
    .toBe('agree');
  return last;
}

/**
 * Put the track at `value` (the browser clamps it) and wait for the strip to react.
 *
 * The wait for stillness FIRST is load-bearing. Seeding tabs leaves a reveal scroll in flight, and
 * that animation writes `scrollLeft` on every frame — so a position written into the middle of one is
 * simply overwritten a frame later, and the test that thought it had positioned the strip is
 * measuring somewhere else entirely. Establishing a precondition means waiting for the strip to stop
 * moving before moving it.
 */
export async function setScrollLeft(win: Page, value: number): Promise<void> {
  await beginScrollTrace(win);
  await waitForScrollStill(win);
  await endScrollTrace(win);
  const wanted = await win.evaluate((v) => {
    const track = document.querySelector('[data-testid="tabstrip-track"]') as HTMLElement | null;
    if (!track) throw new Error('no tabstrip-track in the DOM');
    track.scrollLeft = v;
    return track.scrollLeft; // already clamped by the browser
  }, value);
  await expect
    .poll(async () => Math.round((await stripState(win)).scrollLeft), {
      message: 'the track never settled at the requested scroll position',
    })
    .toBe(Math.round(wanted));
  await expectCountsInSync(win);
}

/* ── The scroll trace ──────────────────────────────────────────────────────────────────────────
 *
 * Several of §3's guarantees are about the SHAPE of a motion rather than its destination — it must
 * not jump back (A8), it must settle exactly once (A7), it must not move at all (A2), it must not
 * be animated (A10, A11). None of those can be read from a final position, so the track's
 * `scrollLeft` is sampled once per animation frame and the resulting series is what gets asserted.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/** Start sampling `scrollLeft` once per frame. Replaces any trace already running. */
export async function beginScrollTrace(win: Page): Promise<void> {
  await win.evaluate(() => {
    const w = window as unknown as {
      __throngTabTrace?: number[];
      __throngTabTraceStop?: (() => void) | null;
    };
    w.__throngTabTraceStop?.();
    const track = document.querySelector('[data-testid="tabstrip-track"]') as HTMLElement | null;
    if (!track) throw new Error('no tabstrip-track to trace');
    const samples: number[] = [track.scrollLeft];
    w.__throngTabTrace = samples;
    let frame = requestAnimationFrame(function tick() {
      samples.push(track.scrollLeft);
      frame = requestAnimationFrame(tick);
    });
    w.__throngTabTraceStop = () => {
      cancelAnimationFrame(frame);
      w.__throngTabTraceStop = null;
    };
  });
}

/** Stop sampling and hand back everything seen. */
export async function endScrollTrace(win: Page): Promise<number[]> {
  return win.evaluate(() => {
    const w = window as unknown as {
      __throngTabTrace?: number[];
      __throngTabTraceStop?: (() => void) | null;
    };
    w.__throngTabTraceStop?.();
    return w.__throngTabTrace ?? [];
  });
}

/**
 * Wait until the trace has been still for `stillFrames` consecutive frames.
 *
 * "Still" is a condition, not a duration — which is the whole point. A `waitForTimeout` here would
 * assert that some number of milliseconds is always enough, and would quietly stop testing anything
 * the day a scroll took one frame longer.
 */
export async function waitForScrollStill(
  win: Page,
  { stillFrames = 12, timeout = 12_000 }: { stillFrames?: number; timeout?: number } = {},
): Promise<void> {
  await expect
    .poll(
      async () =>
        win.evaluate((need) => {
          const samples =
            (window as unknown as { __throngTabTrace?: number[] }).__throngTabTrace ?? [];
          if (samples.length < need + 1) return false;
          const tail = samples.slice(-need);
          return tail.every((v) => Math.abs(v - tail[0]!) <= 0.5);
        }, stillFrames),
      { timeout, message: 'the tab strip never stopped moving' },
    )
    .toBe(true);
}

/**
 * Trace one gesture from a standing start to a full stop, and hand back the series.
 *
 * ALWAYS prefer this to hand-rolling begin → act → wait. A trace left running from a PREVIOUS
 * gesture is already still, so `waitForScrollStill` returns on its first poll — before the new
 * scroll has taken its first frame — and every assertion after it then measures a strip in mid
 * flight while reading like it measured a settled one. That is not a hypothetical: it is how the
 * step-and-step-back assertion first failed, reporting a wrong anchor for an entirely right renderer.
 */
export async function traceScroll(win: Page, action: () => Promise<void>): Promise<number[]> {
  await beginScrollTrace(win);
  await action();
  await waitForScrollStill(win);
  return endScrollTrace(win);
}

/** Wait until at least `frames` samples have been taken — a frame-count window, not a clock one. */
export async function waitForTraceFrames(win: Page, frames: number): Promise<void> {
  await expect
    .poll(
      async () =>
        win.evaluate(
          () => ((window as unknown as { __throngTabTrace?: number[] }).__throngTabTrace ?? []).length,
        ),
      { message: `the strip never produced ${frames} animation frames` },
    )
    .toBeGreaterThanOrEqual(frames);
}

/** Samples that lie strictly between `from` and `to` — the frames an ANIMATION would produce. */
export function intermediateSamples(trace: number[], from: number, to: number): number[] {
  const low = Math.min(from, to) + EPS;
  const high = Math.max(from, to) - EPS;
  return trace.filter((v) => v > low && v < high);
}

/** True when the series only ever moves one way (A8 — no jump back, no drift to an old target). */
export function isMonotonic(trace: number[]): boolean {
  const first = trace[0]!;
  const last = trace[trace.length - 1]!;
  const rising = last >= first;
  for (let i = 1; i < trace.length; i += 1) {
    const delta = trace[i]! - trace[i - 1]!;
    if (rising ? delta < -EPS : delta > EPS) return false;
  }
  return true;
}

/**
 * Seed tabs until the strip overflows, and hand back every seeded chip's test id.
 *
 * Seeding to a CONDITION rather than to a fixed count is what makes these specs survive a theme
 * change, a different default window size, or a name limit that shortens the chips: "enough tabs to
 * overflow" is the precondition every US3 test actually needs, and a hard-coded six is only that
 * precondition on the machine it was written on.
 */
export async function seedOverflowingTabs(
  win: Page,
  label: string,
  {
    initial = 6,
    /**
     * How each tab is named. Long names overflow in a handful of tabs, which is what most of these
     * specs want; SHORT names are what a test needs when it has to work with several tabs FULLY
     * VISIBLE AT ONCE, since a 340px chip in a 546px track means at most one of them ever is.
     */
    nameFor = (n: number): string => `${label}-a-deliberately-long-tab-name-${n}`,
  }: { initial?: number; nameFor?: (n: number) => string } = {},
): Promise<string[]> {
  const name = nameFor;
  const ids = await seedTabs(win, Array.from({ length: initial }, (_, i) => name(i + 1)));
  let n = initial;
  while (n < initial + 10) {
    const state = await stripState(win);
    if (state.contentWidth > state.viewportWidth + EPS) return ids;
    n += 1;
    ids.push(...(await seedTabs(win, [name(n)])));
  }
  const state = await stripState(win);
  expect(
    state.contentWidth > state.viewportWidth + EPS,
    'seeded enough tabs to overflow the strip',
  ).toBe(true);
  return ids;
}
