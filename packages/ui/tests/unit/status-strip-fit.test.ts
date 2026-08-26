/**
 * How the status bar gives way as its panel narrows (040 US2 — FR-021, FR-022, FR-022a, FR-023,
 * FR-024, FR-025).
 *
 * ══ WHY THIS IS A UNIT TEST OF A PURE FUNCTION ══
 *
 * "What does the bar show at width W" is arithmetic over measured widths, and it is the half of
 * US2 that can be wrong in a way nobody sees: a bar that drops the LINE number before the word
 * count still looks like a working bar. Separating the decision from the measurement is what makes
 * that decision assertable at all — jsdom has no layout, so a component test could only ever feed
 * this function zeros, and an E2E could only tell you the answer at whatever width the window
 * happened to be.
 *
 * So the split is: this function decides, `status-strip.tsx` measures and renders, and
 * `editor-status-bar.e2e.ts` proves the rendered result is one line high and does not overlap.
 *
 * ══ THE TWO RULES THAT ARE EASY TO GET BACKWARDS ══
 *
 * **Labels shorten; figures do not** (FR-021, FR-022). A `1,204` clipped to `1,23` is a smaller
 * plausible number, so a figure is hidden WHOLE or not at all — and FR-022a adds the corollary that
 * a figure is never rendered without its label either, because a bare `1,204` on the bar cannot be
 * told from a line number.
 *
 * **`Ln` and `Col` never shorten** (FR-022a). Two characters carry the whole meaning, and `L` / `C`
 * would trade real ambiguity for two pixels. There are exactly two forms and no third.
 */
import { describe, expect, it } from 'vitest';
import {
  HIDE_ORDER,
  READOUT_LABELS,
  READOUT_ORDER,
  fitReadouts,
  type ReadoutId,
  type SegmentWidth,
} from '../../src/renderer/editor/status-strip-fit.js';

/* ────────────────────────────────────────────────────────────────────────── *
 * A measured bar, in round numbers
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Every readout 10px wide with its full label, 5px with its short one — except `Ln` and `Col`,
 * which have no short form and so measure the same either way.
 *
 * Round numbers on purpose: every threshold below is arithmetic a reader can check in their head,
 * so a failing assertion says which RULE broke rather than sending anyone to a calculator.
 */
const WIDE: Record<ReadoutId, SegmentWidth> = {
  line: { full: 10, short: 10 },
  column: { full: 10, short: 10 },
  selected: { full: 10, short: 5 },
  chars: { full: 10, short: 5 },
  words: { full: 10, short: 5 },
};

const GAP = 2;

/** The fit at a given width, with every readout present. */
function at(available: number, widths: Partial<Record<ReadoutId, SegmentWidth>> = WIDE) {
  return fitReadouts({ available, widths, gap: GAP });
}

const ids = (available: number, widths?: Partial<Record<ReadoutId, SegmentWidth>>): ReadoutId[] =>
  at(available, widths).segments.map((s) => s.id);

const formOf = (available: number, id: ReadoutId): string | undefined =>
  at(available).segments.find((s) => s.id === id)?.label;

/*
 * The ladder these tests walk, computed once here so each assertion can cite a step rather than
 * restate the arithmetic. Five segments, four gaps of 2:
 *
 *   58  all five, every label full          (50 + 8)
 *   53  words short                         (45 + 8)
 *   48  words + chars short                 (40 + 8)
 *   43  words + chars + selected short      (35 + 8)
 *   36  words dropped                       (30 + 6)
 *   29  chars dropped                       (25 + 4)
 *   22  selected dropped                    (20 + 2)
 *   10  column dropped                      (10 + 0)
 *    0  line dropped — nothing left
 */

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-021 — shorten first, hide second
 * ────────────────────────────────────────────────────────────────────────── */

describe('a label shortens before any segment is hidden (FR-021)', () => {
  it('keeps every segment when the full-label bar fits exactly', () => {
    expect(ids(58)).toEqual(['line', 'column', 'selected', 'chars', 'words']);
    for (const id of READOUT_ORDER) expect(formOf(58, id)).toBe('full');
  });

  it('shortens rather than hides at every width shortening can absorb', () => {
    /*
     * The whole of FR-021, stated as the range it governs: from the first pixel that does not fit
     * (57) down to the last width the fully-shortened bar still fits (43), NOTHING may disappear.
     * An implementation that reached for the hide order first would pass a spot check at one width
     * and fail somewhere in this range.
     */
    for (let w = 43; w <= 57; w += 1) {
      expect(ids(w), `at ${w}px every segment must still be present`).toHaveLength(5);
    }
  });

  it('never hides a segment while a shortenable label is still full', () => {
    /*
     * The sharp form of the precedence rule, and the one that catches a partial implementation:
     * whenever anything has been dropped, every label that CAN be short already is. Checked across
     * the whole ladder rather than at a chosen width.
     */
    for (let w = 0; w <= 60; w += 1) {
      const { segments } = at(w);
      if (segments.length === 5) continue; // nothing dropped yet — not what this asserts
      const stillFull = segments.filter(
        (s) => s.label === 'full' && READOUT_LABELS[s.id].short !== READOUT_LABELS[s.id].full,
      );
      expect(
        stillFull.map((s) => s.id),
        `at ${w}px a segment was dropped while these labels were still full`,
      ).toEqual([]);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-022a — the declared forms, and only those
 * ────────────────────────────────────────────────────────────────────────── */

describe('labels shorten through the declared forms (FR-022a)', () => {
  it('declares exactly the forms the requirement tabulates', () => {
    // The table in FR-022a, transcribed. If a sixth form is ever invented, this is what says so.
    expect(READOUT_LABELS).toEqual({
      line: { full: 'Ln', short: 'Ln' },
      column: { full: 'Col', short: 'Col' },
      selected: { full: 'selected', short: 'sel' },
      chars: { full: 'chars', short: 'ch' },
      words: { full: 'words', short: 'w' },
    });
  });

  it('leaves Ln and Col alone — they are already at their shortest', () => {
    // Not "they happen to be short": `L` and `C` would save two pixels and buy real ambiguity, so
    // the requirement forbids a third form. The equality above is what makes it structural.
    expect(READOUT_LABELS.line.short).toBe(READOUT_LABELS.line.full);
    expect(READOUT_LABELS.column.short).toBe(READOUT_LABELS.column.full);
  });

  it('shortens in the order the hide order already fixes, so no new order is invented', () => {
    /*
     * FR-023 fixes which segment is first to go; the segment closest to being dropped is the one
     * that should give ground first, so shortening runs words → chars → selected. That is DERIVED
     * from the hide order rather than a second ordering nobody wrote down — which matters, because
     * an invented order would be untestable against the spec and free to drift.
     */
    expect(formOf(53, 'words')).toBe('short');
    expect(formOf(53, 'chars')).toBe('full');
    expect(formOf(53, 'selected')).toBe('full');

    expect(formOf(48, 'chars')).toBe('short');
    expect(formOf(48, 'selected')).toBe('full');

    expect(formOf(43, 'selected')).toBe('short');
  });

  it('never lengthens a label as the bar narrows', () => {
    /*
     * Monotonicity. Once a segment has dropped, the survivors might fit at full width again — and
     * reverting would make a label GROW as the user narrows the panel, which reads as a defect
     * whatever the arithmetic says. The bar only ever gets terser.
     */
    for (let w = 0; w < 60; w += 1) {
      const wider = new Map(at(w + 1).segments.map((s) => [s.id, s.label]));
      for (const s of at(w).segments) {
        // A segment short at the WIDER width, and still present here, must still be short.
        if (wider.get(s.id) === 'short') {
          expect(s.label, `${s.id} grew back to its full label at ${w}px`).toBe('short');
        }
      }
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-022 — a figure is hidden whole, never truncated
 * ────────────────────────────────────────────────────────────────────────── */

describe('a figure is hidden whole, never truncated (FR-022)', () => {
  it('offers no form in which a segment renders without its label', () => {
    /*
     * Structural, and deliberately so: the result type has no "figure only" state to reach, so a
     * clipped `1,23` — or a bare `1,204` that could be a line, a count or a column — is not
     * something this function can produce. Asserted over the whole ladder so the claim covers
     * every width rather than a sample.
     */
    for (let w = 0; w <= 60; w += 1) {
      for (const s of at(w).segments) {
        expect(['full', 'short'], `${s.id} at ${w}px`).toContain(s.label);
      }
    }
  });

  it('drops a segment rather than squeezing it in at a width it does not fit', () => {
    // 36px is exactly the four-segment bar. At 35 the fourth has to go, not shrink further.
    expect(ids(36)).toHaveLength(4);
    expect(ids(35)).toHaveLength(3);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-023 / FR-024 — the fixed order, and where it stops
 * ────────────────────────────────────────────────────────────────────────── */

describe('segments hide in the fixed order and the order terminates (FR-023, FR-024)', () => {
  it('declares the order the requirement names', () => {
    expect(HIDE_ORDER).toEqual(['words', 'chars', 'selected', 'column', 'line']);
  });

  it('loses them in exactly that order as the bar narrows', () => {
    /*
     * Walked rather than spot-checked: the sequence of LOSSES is recorded from the widest width to
     * zero and compared with the requirement in one assertion. A single wrong step anywhere on the
     * ladder shows up as a different sequence, and the diff names it.
     */
    const lost: ReadoutId[] = [];
    let previous = new Set(ids(60));
    for (let w = 59; w >= 0; w -= 1) {
      const now = new Set(ids(w));
      for (const id of previous) if (!now.has(id)) lost.push(id);
      previous = now;
    }
    expect(lost).toEqual(['words', 'chars', 'selected', 'column', 'line']);
  });

  it('keeps the LINE last, because it is the figure an error message names', () => {
    // The reason #256 asks for the readouts at all. At 22px only line and column remain; at 10px
    // only line. That ordering is the requirement's whole point, not a tie-break.
    expect(ids(22)).toEqual(['line', 'column']);
    expect(ids(10)).toEqual(['line']);
  });

  it('stops after line, and models no control it could go on to hide (FR-024)', () => {
    /*
     * FR-024 says the language indicator and the wrap toggle are never hidden by width — 016
     * FR-010c requires the indicator to be persistent, and Finding 1 exists to protect it. The
     * strongest way to honour that is for this function to have no vocabulary for them: it decides
     * about READOUTS and nothing else, so there is no code path that could reach a control.
     */
    expect(ids(0)).toEqual([]);
    expect(ids(-100)).toEqual([]);
    for (const id of HIDE_ORDER) expect(READOUT_ORDER).toContain(id);
    expect(HIDE_ORDER).toHaveLength(READOUT_ORDER.length);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-025 — deterministic for a given width
 * ────────────────────────────────────────────────────────────────────────── */

describe('the result is deterministic (FR-025)', () => {
  it('answers identically for identical input', () => {
    for (let w = 0; w <= 60; w += 7) {
      expect(at(w)).toEqual(at(w));
    }
  });

  it('gives two panels of the same width the same set of segments', () => {
    // Stated as the requirement states it: two panels, one width, one answer. Nothing about the
    // result may depend on which panel asked, on call order, or on anything held between calls.
    const panelA = fitReadouts({ available: 45, widths: WIDE, gap: GAP });
    const panelB = fitReadouts({ available: 45, widths: WIDE, gap: GAP });
    expect(panelA).toEqual(panelB);
  });

  it('is monotonic in width — a wider bar never shows fewer segments (FR-026)', () => {
    /*
     * The property behind "widening restores every hidden segment". Asserted here as arithmetic;
     * that the RENDER follows it, with the caret and selection untouched, is
     * `status-strip-fit-wiring.test.ts`.
     */
    for (let w = 0; w < 60; w += 1) {
      expect(ids(w + 1).length, `${w + 1}px showed fewer segments than ${w}px`).toBeGreaterThanOrEqual(
        ids(w).length,
      );
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Segments that are not there to begin with
 * ────────────────────────────────────────────────────────────────────────── */

describe('a readout that is not present is not a readout that was hidden', () => {
  it('skips an absent segment in the order without disturbing the rest', () => {
    /*
     * With no selection there is no `selected` segment at all (FR-005), and before the counts
     * settle there are no count segments (FR-008b). The order must simply not mention them — an
     * implementation that dropped "the third segment" by position rather than by name would take
     * the column away instead.
     */
    const noSelection: Partial<Record<ReadoutId, SegmentWidth>> = {
      line: WIDE.line,
      column: WIDE.column,
      chars: WIDE.chars,
      words: WIDE.words,
    };
    // Four segments, three gaps: 40 + 6 = 46 at full width.
    expect(ids(46, noSelection)).toEqual(['line', 'column', 'chars', 'words']);
    // Narrowed past everything: words then chars go, and `selected` never appears.
    expect(ids(22, noSelection)).toEqual(['line', 'column']);
  });

  it('renders nothing at all when nothing is present', () => {
    expect(fitReadouts({ available: 1000, widths: {}, gap: GAP }).segments).toEqual([]);
  });

  it('keeps the display order, which is not the hide order', () => {
    // Rendered left to right as line, column, selected, chars, words — the reverse-ish of the order
    // they are dropped in. Conflating the two would render the bar backwards.
    expect(READOUT_ORDER).toEqual(['line', 'column', 'selected', 'chars', 'words']);
    expect(ids(58)).toEqual([...READOUT_ORDER]);
  });
});
