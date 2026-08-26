/**
 * The bar APPLIES the fit decision (040 US2 — FR-013, FR-022b, FR-023, FR-024, FR-026).
 *
 * ══ WHAT THIS FILE ASSERTS, AND WHAT IT REFUSES TO ══
 *
 * `status-strip-fit.ts` decides what fits and `unit/status-strip-fit.test.ts` walks that decision at
 * every width. This file asserts the OTHER half — that the component measures, asks, and renders the
 * answer — and nothing else. **jsdom has no layout.** Every rect is 0×0 and `ResizeObserver` is not
 * implemented at all, so a "narrow bar" here is a set of numbers the test hands over, never a
 * measurement. Anything that is genuinely a measurement — the bar being one line high, the two
 * groups not overlapping, the text area's height not moving — is `editor-status-bar.e2e.ts` under
 * `@reserve:layout`, and stays there.
 *
 * That is also why FR-013 is asserted as GROUP MEMBERSHIP rather than as position. "Left-aligned"
 * is a fact about pixels; "the readouts are children of the leading group" is a fact about the tree,
 * and it is the fact the CSS then acts on.
 *
 * ══ THE MEASUREMENT CONTRACT THE COMPONENT EXPOSES ══
 *
 * Two seams, both ordinary DOM:
 *
 *   - a `ResizeObserver` on the strip, which reports how wide the whole bar is;
 *   - `getBoundingClientRect()` on elements carrying `data-measure`, which are the controls group
 *     and the bar's hidden RULER — one copy of every present readout in each of its two label
 *     forms, so both widths are known on the first pass and the fit never has to converge over
 *     several frames.
 *
 * The stubs below drive exactly those two and nothing else. No component API exists for a test to
 * inject a fit result directly, which is deliberate: a seam like that would be the only caller, and
 * the thing it bypassed would be the thing under test.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BAR_GAP, StatusStrip } from '../../src/renderer/editor/status-strip.js';
import { fitReadouts } from '../../src/renderer/editor/status-strip-fit.js';
import { setPanelCaret, __resetCaretStore } from '../../src/renderer/editor/caret-store.js';
import {
  scheduleDocumentMetrics,
  __resetDocumentMetricsStore,
} from '../../src/renderer/editor/document-metrics-store.js';
import {
  removePanelLanguage,
  setPanelLanguage,
} from '../../src/renderer/editor/editor-language.js';

const PANEL = 'p1';
const DOC_KEY = `panel:${PANEL}`;

/* ────────────────────────────────────────────────────────────────────────── *
 * The stubbed ruler
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * What each measurable element "measures", by its `data-measure` key.
 *
 * Chosen so every threshold on the ladder below is arithmetic a reader can check. The short forms
 * are narrower than the full ones, and `Ln` / `Col` measure the same in both because they have no
 * short form (FR-022a).
 *
 * **The trailing controls group is deliberately NOT in this table**, and that is the point of
 * {@link intrinsicControls} below. It was `controls: 100` — a constant — which made FR-014
 * unfalsifiable here: the requirement is about what happens when the measured value is a function of
 * the measurement, and a constant cannot express that.
 */
const MEASURED: Record<string, number> = {
  'line:full': 30,
  'line:short': 30,
  'column:full': 34,
  'column:short': 34,
  'selected:full': 60,
  'selected:short': 40,
  'chars:full': 62,
  'chars:short': 44,
  'words:full': 58,
  'words:short': 38,
};

/**
 * The bar's flex gap, in px — **imported, not re-typed**.
 *
 * This was a third literal `6` until T044a: one in `status-strip.tsx` (which the arithmetic uses),
 * one in `editor.css` (which the cascade uses), and one here. `status-strip-declared-css.test.ts`
 * now guards the first two against each other; a third copy sitting in the very test that exercises
 * the arithmetic would have been the one that agreed with nothing and failed to notice.
 */
const GAP = BAR_GAP;

/* ────────────────────────────────────────────────────────────────────────── *
 * The trailing group, modelled the way flexbox actually treats it
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The width the two controls WANT, by the language name they are drawing.
 *
 * A function of their CONTENT and of nothing else — which is what "intrinsic" means, and what the
 * bar has to subtract if FR-014 is to hold. `Plain Text` is 100 so every threshold on the ladder
 * below is the arithmetic it always was; `JSON with Comments` is the same two controls with a longer
 * language name in them, and is the whole of the FR-014 declaration further down.
 */
const CONTROLS_WIDTH: Record<string, number> = {
  'Plain Text': 100,
  'JSON with Comments': 160,
};
const CONTROLS_DEFAULT = 100;

/** The trailing group's INTRINSIC width — what its content costs, before any flex line squeezes it. */
function intrinsicControls(group: Element): number {
  const name = group.firstElementChild?.textContent ?? '';
  return CONTROLS_WIDTH[name] ?? CONTROLS_DEFAULT;
}

/**
 * Whether the cascade lets this group give way — read from the APPLICATION'S OWN stylesheet.
 *
 * This is the one thing in this file that is not a number the test made up, and it is deliberate.
 * Whether the trailing group shrinks is a CSS fact, and it is the whole of FR-014: a group that
 * shrinks reports the width it was GRANTED, which is a function of the readouts, which are a
 * function of the measurement. Hard-coding either answer here would make the requirement
 * unfalsifiable at this tier for the second time — the previous version pinned `controls: 100` as a
 * constant and could not fail.
 *
 * jsdom resolves a plain keyword on a plain class selector faithfully; that is the same narrow thing
 * `status-strip-declared-css.test.ts` relies on, and its limits are documented there.
 */
function shrinks(el: Element): boolean {
  return (getComputedStyle(el).flexShrink || '1') !== '0';
}

/** What the readouts group is occupying RIGHT NOW, at the label forms it settled on. */
function readoutsWidth(strip: Element | null): number {
  const group = strip?.querySelector('.editor-status-strip__group--readouts');
  const kids = group ? [...group.children] : [];
  if (kids.length === 0) return 0;
  const sum = kids.reduce(
    (acc, el) =>
      acc +
      (MEASURED[`${el.getAttribute('data-readout')}:${el.getAttribute('data-label')}`] ?? 0),
    0,
  );
  return sum + GAP * (kids.length - 1);
}

/**
 * What flexbox actually GIVES the trailing group, under the stylesheet as it is written.
 *
 * Two outcomes, and the difference between them is FR-014:
 *
 *   - **`flex-shrink: 0`** — the group keeps its intrinsic width, clamped by `max-width: 100%` to
 *     the strip. Both terms are functions of the CONTENT and of the PANEL, never of the readouts, so
 *     `available = bar - controls - gap` is arithmetic rather than a fixed-point equation.
 *   - **the default `flex: 0 1 auto`** (with the group's `min-width: 0`) — the group shrinks to
 *     whatever the readouts left over. Measure THAT and the readouts are sized from a number that
 *     was sized from the readouts: the bar settles at a stable wrong answer, the language
 *     ellipsised beneath readouts painting over it, and the next measurement confirms it.
 */
function grantedControls(group: Element): number {
  const intrinsic = intrinsicControls(group);
  if (!shrinks(group)) return Math.min(intrinsic, stripWidth);
  const readouts = readoutsWidth(group.parentElement);
  const spare = stripWidth - readouts - (readouts > 0 ? GAP : 0);
  return Math.max(0, Math.min(intrinsic, spare));
}

/**
 * How far past the strip's edge the bar's content reaches, in px. Never positive if FR-014 holds.
 *
 * The readouts the bar chose to draw, plus the gap between the groups, plus what the controls
 * actually COST — not what they were squeezed to. A positive number is the language indicator being
 * overrun by readouts that claimed space it needed (FR-014, FR-024).
 */
function overflowPx(): number {
  const strip = screen.getByTestId(`editor-status-strip-${PANEL}`);
  const controls = strip.querySelector('.editor-status-strip__group--controls');
  const readouts = readoutsWidth(strip);
  return (
    readouts +
    (readouts > 0 ? GAP : 0) +
    (controls ? intrinsicControls(controls) : 0) -
    stripWidth
  );
}

/*
 * The ladder, in STRIP widths. `available = strip - controls - gap`, and the readouts cost
 * 30+34+60+62+58 = 244 plus four 6px gaps = 268 at full width.
 *
 *   500  available 394  every label full
 *   360  available 254  words short          (248)
 *   300  available 194  words dropped        (166)
 *   200  available  94  selected dropped     ( 70 — line + column only)
 *   120  available  14  nothing fits         (  0 — the two controls survive alone, FR-024)
 */

/** The width the ResizeObserver will report for the strip. Reassigned per test. */
let stripWidth = 500;

/** Every live observer, so a test can REPORT A RESIZE rather than only an initial size. */
const observers = new Set<{ cb: ResizeObserverCallback; targets: Set<Element>; self: ResizeObserver }>();

function report(entry: { cb: ResizeObserverCallback; targets: Set<Element>; self: ResizeObserver }): void {
  const contentRect = {
    width: stripWidth,
    height: 20,
    top: 0,
    left: 0,
    right: stripWidth,
    bottom: 20,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } satisfies DOMRectReadOnly;
  for (const target of entry.targets) {
    entry.cb([{ target, contentRect } as ResizeObserverEntry], entry.self);
  }
}

/**
 * A `ResizeObserver` that reports the current {@link stripWidth} on `observe()`, and again whenever
 * {@link resizeTo} asks it to.
 *
 * The re-firing half is not a convenience: FR-026 is about a bar that was narrowed and then WIDENED
 * again, and an observer that only ever reported an initial size cannot express the second half of
 * that sentence. A first version of this file stubbed only `observe()`, and the widening test
 * failed against a correct component — the stub, not the code, was what could not resize.
 */
class StubResizeObserver implements ResizeObserver {
  private readonly entry: { cb: ResizeObserverCallback; targets: Set<Element>; self: ResizeObserver };
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, targets: new Set(), self: this };
    observers.add(this.entry);
  }
  observe(target: Element): void {
    this.entry.targets.add(target);
    report(this.entry);
  }
  unobserve(target: Element): void {
    this.entry.targets.delete(target);
  }
  disconnect(): void {
    observers.delete(this.entry);
  }
}

let originalRect: typeof Element.prototype.getBoundingClientRect;
let sheet: HTMLStyleElement;

/*
 * The application's own stylesheet, so {@link shrinks} reads the real cascade rather than a
 * hard-coded belief about it. Resolved from the runner's root for the same reason
 * `status-strip-declared-css.test.ts` does — under jsdom `import.meta.url` is an `http://localhost/`
 * URL that `fileURLToPath` rejects — and guarded by `existsSync`, so a moved file fails by name
 * instead of quietly loading nothing and taking the measurement model with it.
 */
const EDITOR_CSS = resolve(process.cwd(), 'packages/ui/src/renderer/editor/editor.css');

beforeAll(() => {
  expect(existsSync(EDITOR_CSS), `editor.css was not found at ${EDITOR_CSS}`).toBe(true);
  sheet = document.createElement('style');
  sheet.textContent = readFileSync(EDITOR_CSS, 'utf8');
  document.head.appendChild(sheet);

  globalThis.ResizeObserver = StubResizeObserver;
  originalRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function measured(this: Element): DOMRect {
    /*
     * The trailing group answers by WHERE IT IS, which is the whole subject of FR-014: an
     * out-of-flow copy reports what the controls cost, and the one on the flex line reports what it
     * was granted. A component that measures the second one is measuring its own output.
     */
    if (this.classList.contains('editor-status-strip__group--controls')) {
      const groupWidth = grantedControls(this);
      return {
        width: groupWidth,
        height: 14,
        top: 0,
        left: 0,
        right: groupWidth,
        bottom: 14,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
    const key = this.getAttribute('data-measure');
    const width = key !== null ? (MEASURED[key] ?? 0) : 0;
    return {
      width,
      height: width > 0 ? 14 : 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 14,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

afterAll(() => {
  // Owned by this file and removed with it: a global that outlives the file that needed it is how
  // a neighbouring test starts passing for a reason nobody wrote down.
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
  Element.prototype.getBoundingClientRect = originalRect;
  sheet.remove();
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Anti-vacuity: the cascade the measurement model consults really is loaded
 * ────────────────────────────────────────────────────────────────────────── */

describe('the stylesheet the measurement model reads actually parsed', () => {
  it('applies a rule from editor.css to a probe element', () => {
    /*
     * Without this, a sheet that failed to load would make `shrinks()` answer "yes" for everything —
     * the model would silently revert to the squeezing one, the FR-014 declaration below would fail
     * for a reason that has nothing to do with the component, and its message would send the reader
     * to `status-strip.tsx`. `display: flex` is declared on `.editor-status-strip` and is no
     * element's default.
     */
    const probe = document.createElement('div');
    probe.className = 'editor-status-strip';
    document.body.appendChild(probe);
    expect(getComputedStyle(probe).display, 'editor.css did not reach the probe element').toBe(
      'flex',
    );
    probe.remove();
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  __resetCaretStore();
  __resetDocumentMetricsStore();
  stripWidth = 500;
});

afterEach(() => {
  vi.useRealTimers();
  removePanelLanguage(PANEL);
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Rendering
 * ────────────────────────────────────────────────────────────────────────── */

/** Every readout present: a caret, a selection, and settled counts. */
function strip(width: number) {
  stripWidth = width;
  setPanelCaret(PANEL, { line: 412, column: 7 }, 63);
  scheduleDocumentMetrics(DOC_KEY, 'one two three four');
  act(() => {
    vi.advanceTimersByTime(200);
  });
  const view = render(
    createElement(StatusStrip, { panelId: PANEL, projectId: 'proj-1', relPath: null }),
  );
  return view;
}

/** Report a new width to the live observers, exactly as dragging a splitter would. */
function resizeTo(width: number): void {
  stripWidth = width;
  act(() => {
    for (const entry of observers) report(entry);
  });
}

const visible = (): string[] =>
  [...screen.getByTestId(`editor-status-readouts-${PANEL}`).children].map(
    (el) => el.getAttribute('data-readout') ?? '',
  );

const labelForm = (id: string): string | null =>
  screen.queryByTestId(`editor-status-${id}-${PANEL}`)?.getAttribute('data-label') ?? null;

/** What the pure decider says for this strip width, given the same measurements. */
function expected(width: number) {
  return fitReadouts({
    available: width - CONTROLS_DEFAULT - GAP,
    widths: {
      line: { full: MEASURED['line:full'], short: MEASURED['line:short'] },
      column: { full: MEASURED['column:full'], short: MEASURED['column:short'] },
      selected: { full: MEASURED['selected:full'], short: MEASURED['selected:short'] },
      chars: { full: MEASURED['chars:full'], short: MEASURED['chars:short'] },
      words: { full: MEASURED['words:full'], short: MEASURED['words:short'] },
    },
    gap: GAP,
  }).segments;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * The bar renders what the decider decided
 * ────────────────────────────────────────────────────────────────────────── */

describe('the bar applies the fit result', () => {
  it('shows every readout, full-labelled, when there is room', () => {
    strip(500);
    expect(visible()).toEqual(['line', 'column', 'selected', 'chars', 'words']);
    for (const id of ['line', 'column', 'selected', 'chars', 'words']) {
      expect(labelForm(id), `${id} should be at its full label`).toBe('full');
    }
  });

  it('shortens the words label first, without hiding anything (FR-021)', () => {
    // 360px: shortening `words` alone brings the bar back inside the space. Nothing may disappear.
    strip(360);
    expect(visible()).toHaveLength(5);
    expect(labelForm('words')).toBe('short');
    expect(labelForm('chars')).toBe('full');
  });

  it('drops the word count once shortening is exhausted (FR-023)', () => {
    strip(300);
    expect(visible()).toEqual(['line', 'column', 'selected', 'chars']);
    expect(screen.queryByTestId(`editor-status-words-${PANEL}`)).toBeNull();
  });

  it('keeps the LINE last of the readouts (FR-023)', () => {
    strip(200);
    expect(visible()).toEqual(['line', 'column']);
  });

  it('keeps the two controls even when no readout fits at all (FR-024)', () => {
    // The hide order has no vocabulary for the language indicator or the wrap toggle, so there is
    // no width at which either can go — 016 FR-010c calls the indicator persistent, and Finding 1
    // exists to protect exactly that.
    strip(120);
    expect(visible()).toEqual([]);
    expect(screen.getByTestId(`editor-language-${PANEL}`)).toBeVisible();
    expect(screen.getByTestId(`editor-word-wrap-${PANEL}`)).toBeVisible();
  });

  it('renders exactly what the pure decider answers, at every width on the ladder', () => {
    /*
     * The wiring claim itself, stated once against the function rather than restated as five more
     * literal expectations: whatever `fitReadouts` decides for these measurements, that is what is
     * on screen. The literal cases above are what keep this from being a tautology — they say what
     * the answer IS, this says the component does not have a second opinion.
     */
    for (const width of [500, 380, 360, 340, 320, 300, 250, 200, 160, 120]) {
      const { unmount } = strip(width);
      expect(
        visible(),
        `at ${width}px the rendered set must match the decider`,
      ).toEqual(expected(width).map((s) => s.id));
      for (const segment of expected(width)) {
        expect(labelForm(segment.id), `${segment.id} at ${width}px`).toBe(segment.label);
      }
      expect(
        overflowPx(),
        `at ${width}px the readouts claimed space the controls need (FR-014)`,
      ).toBeLessThanOrEqual(0);
      unmount();
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-014 — the READOUTS give way, and the measurement does not feed back
 * ────────────────────────────────────────────────────────────────────────── */

describe('the controls are subtracted at what they COST (FR-014, FR-024)', () => {
  it('gives way in the readouts when the language name grows', () => {
    /*
     * ══ THE DEFECT, AS A SEQUENCE ══
     *
     * 374px is the width at which the five full-labelled readouts (268) plus the bar gap plus a
     * 100px trailing group fit exactly. Nothing is hidden and nothing is short.
     *
     * Then the language changes from `Plain Text` to `JSON with Comments`. That is the ONLY thing
     * that moves: the same panel, the same width, the same caret, the same counts.
     *
     * An implementation that measures the IN-FLOW trailing group cannot see it. That group shrinks
     * (`min-width: 0`, default `flex: 0 1 auto`), so its rect reports the width the readouts left
     * over — still 100 — while the controls now need 160. `available` stays overstated, no readout
     * gives way, the bar overflows by 60px, and the next measurement reads the SHRUNK group and
     * confirms the same wrong number. A stable wrong fixed point, with the language ellipsised
     * beneath readouts painting over it, which is FR-014 exactly inverted: the requirement says the
     * READOUTS are what give way.
     *
     * The observable is `overflowPx`, and it is written against what the controls COST rather than
     * against their rendered box — precisely the reading `editor-status-bar.e2e.ts` cannot take,
     * because a squeezed box measures as fitting whatever it is overflowing with.
     */
    strip(374);
    expect(visible(), 'five readouts must fit to begin with').toHaveLength(5);
    expect(overflowPx(), 'and the bar must not be overflowing yet').toBeLessThanOrEqual(0);

    act(() => {
      setPanelLanguage(PANEL, { languageId: 'jsonc', source: 'override' });
    });

    expect(screen.getByTestId(`editor-language-${PANEL}`)).toHaveTextContent('JSON with Comments');
    expect(
      overflowPx(),
      'the readouts kept space the longer language name needs — the trailing group was measured ' +
        'after being squeezed by the very readouts the measurement then sized',
    ).toBeLessThanOrEqual(0);
    expect(
      visible().length,
      'and something must actually have given way, or the bar simply got narrower content',
    ).toBeLessThan(5);
  });

  it('restores them when the language name shrinks again (FR-026)', () => {
    // The other direction, and the half a one-way clamp would pass: nothing may be held back once
    // the space the controls were taking is handed to the readouts again.
    strip(374);
    act(() => {
      setPanelLanguage(PANEL, { languageId: 'jsonc', source: 'override' });
    });
    expect(visible().length).toBeLessThan(5);

    act(() => {
      setPanelLanguage(PANEL, { languageId: 'plaintext', source: 'plaintext' });
    });

    expect(visible(), 'every readout comes back').toHaveLength(5);
    expect(overflowPx()).toBeLessThanOrEqual(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-026 — widening restores everything, and disturbs nothing
 * ────────────────────────────────────────────────────────────────────────── */

describe('widening restores every hidden segment (FR-026)', () => {
  it('brings them all back, at their full labels', () => {
    strip(120);
    expect(visible()).toEqual([]);

    resizeTo(500);

    expect(visible()).toEqual(['line', 'column', 'selected', 'chars', 'words']);
    expect(labelForm('words')).toBe('full');
  });

  it('does not change the caret position or the selection', () => {
    /*
     * The half of FR-026 that is easy to lose: a fit pass that re-published the caret, or that
     * re-derived the selection from what is on screen, would move the user's cursor because they
     * dragged a splitter. The figures must come back reading exactly what they read before.
     */
    strip(500);
    expect(screen.getByTestId(`editor-status-line-${PANEL}`)).toHaveTextContent('Ln 412');
    expect(screen.getByTestId(`editor-status-selected-${PANEL}`)).toHaveTextContent('63 selected');

    resizeTo(120);
    resizeTo(500);

    expect(screen.getByTestId(`editor-status-line-${PANEL}`)).toHaveTextContent('Ln 412');
    expect(screen.getByTestId(`editor-status-column-${PANEL}`)).toHaveTextContent('Col 7');
    expect(screen.getByTestId(`editor-status-selected-${PANEL}`)).toHaveTextContent('63 selected');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-013 — group membership, never position
 * ────────────────────────────────────────────────────────────────────────── */

describe('the two alignment groups (FR-013)', () => {
  it('puts the readouts in the leading group and the controls in the trailing one', () => {
    strip(500);
    const leading = screen.getByTestId(`editor-status-readouts-${PANEL}`);
    const trailing = screen.getByTestId(`editor-status-controls-${PANEL}`);

    expect(leading).toContainElement(screen.getByTestId(`editor-status-line-${PANEL}`));
    expect(trailing).toContainElement(screen.getByTestId(`editor-language-${PANEL}`));
    expect(trailing).toContainElement(screen.getByTestId(`editor-word-wrap-${PANEL}`));
  });

  it('renders the leading group EVEN WHEN IT IS EMPTY', () => {
    /*
     * ══ THE HAZARD THIS EXISTS FOR ══
     *
     * The bar is `justify-content: space-between`. With TWO children the controls sit hard right,
     * which is what 016 FR-010c requires of the language indicator. With ONE child, `space-between`
     * puts that child on the LEFT — so a leading group that unmounted when it had nothing to show
     * would silently move the language label to the wrong edge of the bar.
     *
     * It has two ways to become empty: every readout dropped at the narrowest width (US2 AS4), and
     * both readout preferences switched off (US3 AS5). Neither is exotic. An empty flex child costs
     * nothing and is what keeps the right group right.
     */
    strip(120);
    const leading = screen.getByTestId(`editor-status-readouts-${PANEL}`);
    expect(leading, 'the group must be in the DOM even with no readouts in it').toBeInTheDocument();
    expect(leading.children).toHaveLength(0);

    /*
     * Both GROUPS, by name — not `children.length >= 2`, which was the assertion here and could not
     * fail. The strip renders three children unconditionally (the two groups and the ruler), so
     * deleting the readouts group outright still left two and still read green, while the very thing
     * the comment above describes had happened.
     */
    const bar = screen.getByTestId(`editor-status-strip-${PANEL}`);
    const groups = [...bar.children].filter((el) =>
      el.classList.contains('editor-status-strip__group'),
    );
    expect(
      groups,
      'space-between needs TWO groups on the flex line to push apart; a single child goes left',
    ).toEqual([leading, screen.getByTestId(`editor-status-controls-${PANEL}`)]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-022b — the language label truncates, and never leaves
 * ────────────────────────────────────────────────────────────────────────── */

describe('the language label at the narrowest width (FR-022b, FR-024)', () => {
  it('is still present, and still carries its truncating class', () => {
    /*
     * The language name is not an abbreviation this spec gets to choose, so it has no short form —
     * it ellipsises instead, and at the narrowest panel it is the last thing standing beside the
     * wrap toggle. The CLASS is asserted rather than a computed `text-overflow`, because jsdom does
     * not resolve the cascade; that the ellipsis actually renders is 016's own E2E.
     */
    strip(120);
    const language = screen.getByTestId(`editor-language-${PANEL}`);

    expect(language).toBeVisible();
    expect(language).toHaveClass('editor-status-strip__language');
  });
});
