/**
 * Counting and cutting names the way a user counts them (031 US4, FR-033a–c, FR-037a–e).
 *
 * The name limit is stated in "characters", and the only definition of that word the application
 * shares with the person typing is the **grapheme cluster** — the thing they would point at. A flag
 * is one character made of two code points and four UTF-16 units; a family emoji is one character
 * made of eight. Counting in `.length` would let a ten-character limit refuse the fourth emoji, and
 * cutting in `.length` would leave a name ending in half a surrogate pair or an accent parted from
 * its letter. Both are visible to the user and neither is explicable.
 *
 * Pure: no DOM, no OS, no configuration. The limit itself lives in settings; this module only
 * applies one it is handed.
 */

/**
 * ONE segmenter for the process (R4). `Intl.Segmenter` construction is comparatively expensive and
 * the rename cap runs on every keystroke, so it must never be built inside a function.
 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Printable ASCII has no combining marks, no surrogate pairs and no CR-LF pair, so every character
 * is its own cluster and the segmenter has nothing to decide. Skipping it here is what keeps the
 * common rename — someone typing a plain name — off the slow path entirely.
 */
const PLAIN_ASCII = /^[\x20-\x7E]*$/;

/** Number of grapheme clusters — what a user would point at and call characters (N1). */
export function countGraphemes(text: string): number {
  if (PLAIN_ASCII.test(text)) return text.length;
  // Counted through the iterator rather than spread into an array: the segments themselves are of
  // no interest, and a rename counter must not allocate one object per character per keystroke.
  const segments = GRAPHEMES.segment(text)[Symbol.iterator]();
  let count = 0;
  while (!segments.next().done) count += 1;
  return count;
}

/**
 * The index at which `text` exceeds `max` clusters, or `null` when it never does.
 *
 * Returning the index rather than a boolean lets `truncateGraphemes` cut without segmenting twice,
 * and lets `wasTruncated` answer without building a string it will throw away.
 */
function overflowIndex(text: string, max: number): number | null {
  if (PLAIN_ASCII.test(text)) return text.length > max ? max : null;
  let seen = 0;
  for (const { index } of GRAPHEMES.segment(text)) {
    if (seen === max) return index;
    seen += 1;
  }
  return null;
}

/** A limit that bounds nothing: absent, non-finite, or otherwise not a real ceiling. */
function unbounded(limit: number): boolean {
  return !Number.isFinite(limit);
}

/**
 * The first `limit` grapheme clusters of `text`.
 *
 * The cut falls only on a cluster boundary (N2), so the result never contains a split surrogate
 * pair, a halved emoji or a dangling zero-width joiner. Nothing is added — no ellipsis, no marker
 * of any kind (N4) — which is what makes it idempotent at a fixed limit (N5): the marker that would
 * accumulate over successive reductions does not exist.
 *
 * Trailing whitespace the cut leaves behind is trimmed (N9, FR-037e): a cut landing after a space
 * would otherwise end a name in an invisible character the user can neither tell from its neighbour
 * nor retype. The result may therefore be shorter than the limit — correct, not a rounding error.
 * Leading whitespace is untouched, because the user typed that, and a cut consisting only of
 * whitespace is left as it is for the same reason: all of it is leading.
 *
 * A limit of zero or below yields `''`; a non-finite limit means unbounded (N7).
 */
export function truncateGraphemes(text: string, limit: number): string {
  if (unbounded(limit)) return text;
  const max = Math.floor(limit);
  if (max <= 0) return '';

  const at = overflowIndex(text, max);
  if (at === null) return text;

  const cut = text.slice(0, at);
  const trimmed = cut.trimEnd();
  return trimmed.length > 0 ? trimmed : cut;
}

/**
 * True when `text` is longer than `limit` — false for a name that lands exactly on it (N6).
 *
 * This drives the ellipsis drawn at render time (FR-037c) and nothing else: the marker is
 * presentation, so it must never reach the value, the limit's arithmetic, or anything persisted.
 */
export function wasTruncated(text: string, limit: number): boolean {
  if (unbounded(limit)) return false;
  const max = Math.floor(limit);
  if (max <= 0) return text.length > 0;
  return overflowIndex(text, max) !== null;
}
