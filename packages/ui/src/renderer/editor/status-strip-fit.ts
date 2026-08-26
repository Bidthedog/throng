/**
 * What the editor status bar shows at a given width (040 US2 — FR-021, FR-022, FR-022a, FR-023,
 * FR-024, FR-025, FR-026).
 *
 * Pure: no DOM, no React, no measurement. It is handed the space available and the measured width
 * of each readout in each of its label forms, and it answers which readouts render and which form
 * each one uses. `status-strip.tsx` does the measuring and the rendering; this module owns only the
 * decision.
 *
 * ══ WHY THE DECISION IS SEPARATED FROM THE MEASUREMENT ══
 *
 * Because it is the half that can be wrong invisibly. A bar that drops the LINE number before the
 * word count still looks like a working bar, and the user only discovers it at the moment they most
 * need the line number. jsdom has no layout, so a component test can only ever feed this zeros, and
 * an E2E can only report the answer at whatever width the window happened to be — neither can walk
 * the ladder. As a pure function it is checked at every width, in milliseconds.
 *
 * ══ THE TWO RULES, IN PRECEDENCE ORDER ══
 *
 * **Shorten first (FR-021).** Every label that has a short form takes it before ANY segment is
 * hidden. Losing a figure costs the user information; `words` → `w` costs them nothing.
 *
 * **Then hide, in a fixed order (FR-023).** `words → chars → selected → column → line`. The line
 * survives longest because it is the figure an error message names, which is the reason #256 asks
 * for these readouts at all.
 *
 * ══ WHAT THIS MODULE DELIBERATELY CANNOT EXPRESS ══
 *
 * The language indicator and the wrap toggle. FR-024 says they are never hidden by width, and 016
 * FR-010c requires the indicator to be persistent — so rather than encoding them and trusting the
 * loop to stop in time, they are simply not in this module's vocabulary. There is no code path that
 * could reach them. The same reasoning covers figures: there is no "figure without its label" form
 * to reach, so `1,204` can never be clipped to `1,23` (FR-022) and can never appear as a bare
 * number that could equally be a line, a column or a count (FR-022a).
 */

/** The five figures the bar reports. */
export type ReadoutId = 'line' | 'column' | 'selected' | 'chars' | 'words';

/** There are exactly two label forms and no third (FR-022a). */
export type LabelForm = 'full' | 'short';

/** One readout's measured width in each label form. Equal for labels that do not shorten. */
export interface SegmentWidth {
  full: number;
  short: number;
}

/** A readout that renders, and the label form it renders with. */
export interface FitSegment {
  id: ReadoutId;
  label: LabelForm;
}

export interface FitResult {
  /** The readouts that render, in DISPLAY order (left to right). */
  segments: readonly FitSegment[];
}

/** Left-to-right on screen. Not the hide order — conflating the two renders the bar backwards. */
export const READOUT_ORDER = ['line', 'column', 'selected', 'chars', 'words'] as const;

/**
 * The order segments are given up in (FR-023). `line` is last on purpose.
 *
 * It is also the order labels SHORTEN in, which is a derivation rather than a second rule: the
 * segment closest to being dropped is the one that should give ground first. Inventing a separate
 * shortening order would be a rule with nothing in the spec behind it, free to drift.
 */
export const HIDE_ORDER = ['words', 'chars', 'selected', 'column', 'line'] as const;

/**
 * The declared forms, transcribed from FR-022a's table.
 *
 * `Ln` and `Col` are their own short form. Two characters carry the whole meaning, and `L` / `C`
 * would trade real ambiguity for two pixels — so the requirement forbids a third form, and the
 * equality here is what makes that structural rather than a convention.
 */
export const READOUT_LABELS: Record<ReadoutId, { full: string; short: string }> = {
  line: { full: 'Ln', short: 'Ln' },
  column: { full: 'Col', short: 'Col' },
  selected: { full: 'selected', short: 'sel' },
  chars: { full: 'chars', short: 'ch' },
  words: { full: 'words', short: 'w' },
};

/**
 * True when this readout's label actually has a shorter form to take.
 *
 * Exported because the RULER needs the same answer: a label whose two forms are identical must be
 * drawn once and measured once (`Ln 412` in both forms is one string, and drawing it twice put two
 * identical copies of every visible readout into the document for no width the bar did not already
 * know). One predicate, so the decision to shorten and the decision to measure cannot disagree.
 */
export function labelShortens(id: ReadoutId): boolean {
  return READOUT_LABELS[id].short !== READOUT_LABELS[id].full;
}

/**
 * Decide what fits.
 *
 * A readout absent from `widths` is not PRESENT — no selection means no `selected` segment
 * (FR-005), and counts that have not settled yet mean no count segments (FR-008b). That is a
 * different thing from a readout that was hidden, and the order below skips it by NAME rather than
 * by position: an implementation that dropped "the third segment" would take the column instead.
 *
 * Deterministic (FR-025): a pure function of its arguments, holding nothing between calls, so two
 * panels of the same width necessarily agree. Monotonic in width (FR-026): widening never shows
 * fewer segments and never lengthens a label back, so the bar only ever gets terser as it narrows.
 */
export function fitReadouts(input: {
  /** Space the readouts may occupy, in px. */
  available: number;
  /** Measured width per PRESENT readout, in each label form. */
  widths: Partial<Record<ReadoutId, SegmentWidth>>;
  /** Space between adjacent readouts, in px. */
  gap?: number;
}): FitResult {
  const gap = input.gap ?? 0;
  const forms = new Map<ReadoutId, LabelForm>();
  let present: ReadoutId[] = READOUT_ORDER.filter((id) => input.widths[id] !== undefined);
  for (const id of present) forms.set(id, 'full');

  const total = (): number => {
    if (present.length === 0) return 0;
    const sum = present.reduce(
      (acc, id) => acc + (input.widths[id]?.[forms.get(id) ?? 'full'] ?? 0),
      0,
    );
    return sum + gap * (present.length - 1);
  };

  const fits = (): boolean => total() <= input.available;

  // FR-021 — exhaust shortening before hiding anything.
  for (const id of HIDE_ORDER) {
    if (fits()) return result(present, forms);
    if (present.includes(id) && labelShortens(id)) forms.set(id, 'short');
  }

  // FR-023 — then give up whole segments, in the declared order. FR-024: the order ends at `line`,
  // and there is nothing after it this loop could reach.
  for (const victim of HIDE_ORDER) {
    if (fits()) break;
    present = present.filter((id) => id !== victim);
  }

  return result(present, forms);
}

function result(present: readonly ReadoutId[], forms: ReadonlyMap<ReadoutId, LabelForm>): FitResult {
  return { segments: present.map((id) => ({ id, label: forms.get(id) ?? 'full' })) };
}
