/**
 * Bounded indentation inference (016, FR-018c).
 *
 * What the document ALREADY does beats what the settings say it should — a file indented with
 * tabs keeps taking tabs, whatever the language profile prefers, because the alternative is an
 * editor that quietly mixes styles into someone else's file.
 *
 * The bound is part of the requirement, not an optimisation. Cost is O(1) in document size: at most
 * the first 100 lines, and only the first 20 characters of each. A 200 MB minified bundle is sampled
 * exactly as cheaply as a config file.
 *
 * ## The bound caps WORK, not coverage
 *
 * An earlier version of this sampled `min(ceil(10% of lines), 100)` lines, and that was a real bug:
 * a five-line file sampled ONE line — its unindented opening — and inferred nothing. Most source
 * files shorter than about fifty lines would have come back inconclusive, fallen through to the
 * settings, and had the wrong style quietly poured into them on the very next Tab. Which is the
 * exact failure this function exists to prevent.
 *
 * Reading the first hundred lines is already O(1) in document size. Reading a *fraction* of the file
 * buys nothing on top of that and loses every short file.
 *
 * Pure; no OS, no DOM.
 */

/** The style deduced from the document's opening lines, or null when inconclusive. */
export type InferredIndent = { style: 'tabs' } | { style: 'spaces'; width: number } | null;

const MAX_SAMPLE_LINES = 100;
/** Only this many characters of a line are inspected — the O(1) half of the bound. */
const INSPECT_CHARS = 20;

/**
 * Infer the document's indentation style from its opening lines.
 *
 * - Any considered line whose leading whitespace starts with a TAB ⇒ `tabs`. A tab anywhere in
 *   the inspected prefix is decisive: a part-migrated file must not have spaces poured into it.
 * - Otherwise ⇒ `spaces`, width = the most frequent leading-space count; ties go to the SMALLER.
 * - A line whose leading whitespace runs PAST the inspected window has an indeterminate width and
 *   is EXCLUDED from the tally — counting it as 20 would let deep nesting invent an indent width
 *   the file never uses.
 * - No considered lines ⇒ `null`, and the effective language's profile applies instead.
 */
export function inferIndent(text: string): InferredIndent {
  const lines = text.split('\n');
  const sampleSize = Math.min(MAX_SAMPLE_LINES, lines.length);

  const widths = new Map<number, number>();
  for (let i = 0; i < sampleSize; i += 1) {
    const line = lines[i];
    if (line.length === 0) continue;

    const prefix = line.slice(0, INSPECT_CHARS);
    if (prefix[0] !== ' ' && prefix[0] !== '\t') continue; // not an indented line

    let spaces = 0;
    let sawTab = false;
    for (const ch of prefix) {
      if (ch === '\t') {
        sawTab = true;
        break;
      }
      if (ch !== ' ') break;
      spaces += 1;
    }
    if (sawTab) return { style: 'tabs' };

    // A whitespace-only line indents nothing. `spaces === prefix.length` means the run reached the
    // end of the inspected window — its true width is unknown, so it is excluded rather than
    // counted as 20 (see the doc comment).
    if (spaces === line.length || spaces >= INSPECT_CHARS) continue;
    if (spaces > 0) widths.set(spaces, (widths.get(spaces) ?? 0) + 1);
  }

  if (widths.size === 0) return null;

  let best = 0;
  let bestCount = 0;
  for (const [width, count] of widths) {
    if (count > bestCount || (count === bestCount && width < best)) {
      best = width;
      bestCount = count;
    }
  }
  return { style: 'spaces', width: best };
}
