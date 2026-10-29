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
 * survives longest of the readouts because it is the figure an error message names, which is the
 * reason #256 asks for these readouts at all. 059 FR-032 continues the order with the two format
 * indicators — `lineEnding → encoding` — and it terminates there.
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

/**
 * 059 FR-030 — the document's encoding and line-ending indicators. They live in the TRAILING group,
 * beside the language label and the wrap toggle, but unlike those two they may be hidden by width —
 * after every readout (FR-032) — so they are segments this module decides about.
 */
export type IndicatorId = 'encoding' | 'lineEnding';

/** Anything the fit decides about: a readout or a format indicator. Never a control (FR-024). */
export type SegmentId = ReadoutId | IndicatorId;

/** There are exactly two label forms and no third (FR-022a). */
export type LabelForm = 'full' | 'short';

/** One readout's measured width in each label form. Equal for labels that do not shorten. */
export interface SegmentWidth {
  full: number;
  short: number;
}

/** A segment that renders, and the label form it renders with. */
export interface FitSegment {
  id: SegmentId;
  label: LabelForm;
}

export interface FitResult {
  /** The readouts that render, in DISPLAY order (left to right). */
  segments: readonly FitSegment[];
}

/** Left-to-right on screen. Not the hide order — conflating the two renders the bar backwards. */
export const READOUT_ORDER = ['line', 'column', 'selected', 'chars', 'words'] as const;

/** The indicators left to right in the trailing group, before the language label (059 FR-030). */
export const INDICATOR_ORDER = ['encoding', 'lineEnding'] as const;

/** Every segment, in display order: the readouts lead, the indicators trail. */
export const SEGMENT_ORDER = [...READOUT_ORDER, ...INDICATOR_ORDER] as const;

/**
 * The order segments are given up in (FR-023, continued by 059 FR-032). Among the readouts `line` is
 * last on purpose; the two format indicators outlast every readout — line ending first, then
 * encoding — and the order TERMINATES there: the language label and the wrap toggle are not in it.
 *
 * It is also the order labels SHORTEN in, which is a derivation rather than a second rule: the
 * segment closest to being dropped is the one that should give ground first. Inventing a separate
 * shortening order would be a rule with nothing in the spec behind it, free to drift. (The indicators
 * have no short form, so they take no part in shortening.)
 */
export const HIDE_ORDER = ['words', 'chars', 'selected', 'column', 'line', 'lineEnding', 'encoding'] as const;

const isIndicator = (id: SegmentId): id is IndicatorId => id === 'encoding' || id === 'lineEnding';

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
export function labelShortens(id: SegmentId): boolean {
  // An indicator's label is data — `UTF-16 LE`, `CRLF` — and has no abbreviation to take.
  if (isIndicator(id)) return false;
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
  /**
   * Space the segments may occupy, in px: the bar less the never-hidden controls and the one gap
   * between the two groups.
   */
  available: number;
  /** Measured width per PRESENT segment, in each label form. */
  widths: Partial<Record<SegmentId, SegmentWidth>>;
  /** Space between adjacent segments, in px. */
  gap?: number;
}): FitResult {
  const gap = input.gap ?? 0;
  const forms = new Map<SegmentId, LabelForm>();
  let present: SegmentId[] = SEGMENT_ORDER.filter((id) => input.widths[id] !== undefined);
  for (const id of present) forms.set(id, 'full');

  /*
   * The gaps follow where each kind of segment SITS. Readouts are separated from one another, and the
   * last one from the trailing group by the gap `available` already excludes. An indicator sits in the
   * trailing group and is always followed by something — the next indicator, or the controls — so each
   * present indicator costs one gap of its own, whether or not any readout survives.
   */
  const total = (): number => {
    const sum = present.reduce(
      (acc, id) => acc + (input.widths[id]?.[forms.get(id) ?? 'full'] ?? 0),
      0,
    );
    const readouts = present.filter((id) => !isIndicator(id)).length;
    const indicators = present.length - readouts;
    return sum + gap * Math.max(0, readouts - 1) + gap * indicators;
  };

  const fits = (): boolean => total() <= input.available;

  // FR-021 — exhaust shortening before hiding anything.
  for (const id of HIDE_ORDER) {
    if (fits()) return result(present, forms);
    if (present.includes(id) && labelShortens(id)) forms.set(id, 'short');
  }

  // FR-023 — then give up whole segments, in the declared order. FR-024 / 059 FR-032: the order ends
  // at the encoding indicator, and there is nothing after it this loop could reach.
  for (const victim of HIDE_ORDER) {
    if (fits()) break;
    present = present.filter((id) => id !== victim);
  }

  return result(present, forms);
}

function result(present: readonly SegmentId[], forms: ReadonlyMap<SegmentId, LabelForm>): FitResult {
  return { segments: present.map((id) => ({ id, label: forms.get(id) ?? 'full' })) };
}
