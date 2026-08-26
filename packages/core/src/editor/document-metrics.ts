/**
 * The editor status bar's counting rules (040 US1 — FR-002, FR-002a, FR-003a, FR-003b, FR-003c,
 * FR-004, FR-004a, FR-005; data-model.md §4).
 *
 * Pure: no DOM, no CodeMirror, no OS. The caller owns the text and the offsets; this module owns
 * what the numbers MEAN. Keeping them here rather than in the renderer is what makes each rule
 * checkable without an editor, and what stops four readouts each inventing their own arithmetic.
 *
 * **Two definitions are shared by everything below, and both are decisions rather than defaults.**
 *
 * A **line break** — CR, LF, or the CRLF pair — is **one character**, whichever of the three spells
 * it. That is FR-003a, and it says two things at once. A break COUNTS, because it is a character
 * the user typed and can delete, so a document of ten empty lines reports 9 rather than 0. And a
 * CRLF pair counts ONE, which is what makes the figure survive #71's LF ↔ CRLF conversion: the text
 * did not change, so the figure must not move. A count based on `text.length` gets the first half
 * right and fails the second silently, reporting a different size for the same document depending
 * on a setting the reader cannot see.
 *
 * **This rule was reversed after implementation** (spec.md's Clarifications, 2026-08-25). The
 * original answer excluded breaks entirely — `"ab\r\ncd\r\nef"` was 6 and is now 8 — and the
 * reasoning for both answers is recorded there, deliberately, so a later reader can tell a decision
 * from a drift. Do not restore the exclusion from this file alone.
 *
 * A **character** is a UTF-16 code unit, NOT a grapheme cluster (FR-003c) — deliberately unlike
 * `countGraphemes` in `../text/grapheme.js`, which counts the way a user counts a filename they are
 * typing. Two reasons, and they point the same way. The column has to agree with the column a
 * compiler or a linter reports (FR-002a), and those count code units or code points, not clusters.
 * And these figures are computed over a whole document rather than a short name, where segmenting
 * every character would cost far more than FR-008c's budget allows. So an emoji is 2 here and 1
 * there; that inconsistency is knowingly accepted, and FR-003c is where it is argued.
 *
 * @see countGraphemes in `packages/core/src/text/grapheme.ts` — the OTHER character semantics, and
 * the one to reach for when the number is shown next to a name the user typed.
 * @see columnAt in `./rect-select.js` — NOT a substitute for {@link caretPosition}. It returns a
 * DISPLAY column that expands tabs to `tabWidth`, which is exactly what FR-002a forbids a status
 * bar from showing; it exists for block selection, where the visual grid is the point.
 */

const CR = 0x0d;
const LF = 0x0a;

/** Where a caret is, in the register a text editor uses (FR-002). */
export interface CaretPosition {
  /** 1-based: the first line is line 1. */
  line: number;
  /**
   * 1-based CHARACTER offset within the line (FR-002a). A tab advances this by exactly 1.
   * NOT a display column — it must never depend on the document's indent width (016 FR-018).
   */
  column: number;
}

/**
 * CRLF pairs in `chunk` — the only place the count differs from `chunk.length`.
 *
 * Every character is one, including a lone CR and a lone LF, so the whole of FR-003a's arithmetic
 * is "length, minus one for each CRLF pair, because the pair is a single break".
 *
 * `precededByCr` is what makes this usable over a STREAM: a pair can be split across a chunk
 * boundary, and the caller answers "did the previous chunk end in CR?" so the LF opening this one
 * is recognised as the second half of a break already charged for. That single bit of carried state
 * is the subtlest thing in this module; `document-metrics.test.ts` pins it at several boundaries.
 *
 * Counted by scanning rather than by `chunk.match(/\r\n/g)?.length`, which would allocate one
 * string per line break — several hundred thousand of them in a large document, on a path FR-008c
 * gives a budget.
 *
 * The loop needs no skip after a match: the second half of a pair is an LF, and an LF can never
 * begin one, so no CR is ever consumed twice.
 */
function crlfPairs(chunk: string, precededByCr: boolean): number {
  let pairs = precededByCr && chunk.charCodeAt(0) === LF ? 1 : 0;
  for (let i = 0; i < chunk.length - 1; i += 1) {
    if (chunk.charCodeAt(i) === CR && chunk.charCodeAt(i + 1) === LF) pairs += 1;
  }
  return pairs;
}

/**
 * Characters in `text`, **including every line break** (FR-003a), each counted as one UTF-16 code
 * unit (FR-003c).
 *
 * A break is one character however it is spelled, so a document of ten empty lines reports 9, and
 * the same text in LF and in CRLF form reports the same figure. An astral character — an emoji,
 * most of them — is a surrogate PAIR and therefore counts 2; that is the deliberate half of
 * FR-003c rather than an oversight, and the tests pin it so a later "fix" to `[...text].length`
 * cannot pass quietly. Note that the two pairs are treated OPPOSITELY on purpose: a CRLF pair is
 * one character and a surrogate pair is two, because the first is one thing the user typed and the
 * second is one thing the encoding needed two units to say.
 *
 * The CR handling is defence in depth: the live buffer is always LF-normalised, for the reason
 * spelled out in {@link caretPosition}'s CRLF note.
 */
export function countCharacters(text: string): number {
  return text.length - crlfPairs(text, false);
}

/**
 * Words in `text` — maximal runs of non-whitespace **as JavaScript's `\s` defines whitespace**
 * (FR-003b).
 *
 * Punctuation, hyphens, dots and underscores are not whitespace, so `foo_bar()` and
 * `https://x.com/y` are one word each. A tab and a newline separate words without either being
 * enumerated here.
 *
 * **Close to `wc -w`, but not identical to it, and the difference is deliberate.** JavaScript's `\s`
 * includes U+00A0 NO-BREAK SPACE and a handful of other Unicode separators that glibc's `iswspace`
 * excludes, so the three characters a, U+00A0, b are TWO words here and ONE word to `wc -w`.
 * Splitting on it is the better answer for a text editor — the user sees two words on screen, and a count that disagreed
 * with their eyes to agree with a POSIX utility would be the wrong trade — so `wc -w` is named
 * throughout as the FAMILIAR rule, never as the authority. The divergence is pinned by a test.
 *
 * The regex is stepped with `exec` rather than `text.match(RUNS).length` so the words themselves
 * are never collected: only their number is wanted, and a large document has a great many.
 */
export function countWords(text: string): number {
  const runs = /\S+/gu;
  let words = 0;
  while (runs.exec(text) !== null) words += 1;
  return words;
}

/**
 * The 1-based line and 1-based character column of `offset` within `text`
 * (FR-002, FR-002a).
 *
 * Total by construction: an offset outside the document clamps to its nearest end rather than
 * throwing, because a readout that throws takes the whole status bar down with it. That claim is
 * only honoured if NaN is handled too — clamping leaves it NaN, and the result would render as
 * `Col NaN` rather than failing loudly — so it is answered explicitly below.
 *
 * O(offset). That is the right shape for the pure rule — it depends on nothing but the text — and
 * a caller that already holds a line index is free to use it instead; this is the definition the
 * index has to agree with.
 */
export function caretPosition(text: string, offset: number): CaretPosition {
  /*
   * NaN, not every non-finite value: ±Infinity clamps correctly through `max`/`min` (to 0 and to
   * `text.length`), but NaN compares false against everything, so it would survive the clamp, skip
   * the loop, and come back as `{ line: 1, column: NaN }`. There is no nearest end to a value that
   * is not on the number line, so it answers with the document's start.
   */
  const requested = Math.floor(offset);
  let at = Number.isNaN(requested) ? 0 : Math.min(Math.max(0, requested), text.length);

  /*
   * A caret can never sit BETWEEN the CR and the LF of one break — the pair is a single position,
   * and CodeMirror treats it as one. Nothing in the app produces such an offset, but the answer
   * still has to be a real place, so it clamps back to the end of the line the pair closes.
   *
   * This arm and the two CR arms below are defence in depth against text THIS APP CANNOT PRODUCE.
   * The fidelity model normalises every break to LF on decode (`text-fidelity.ts` `decode`, via
   * `normaliseToLf`) and re-applies the file's original ending only on encode, and `clipboard-mode`
   * does the same to a paste — so the live buffer is always LF and no CR ever reaches here from the
   * editor. They are kept because this is a PURE rule over any string a caller hands it, and a
   * counting module that mis-answers on CRLF would be a trap for the first caller who reads a file
   * without going through `decode`. Do not delete them as dead, and do not build on them as live.
   */
  if (at > 0 && text.charCodeAt(at - 1) === CR && text.charCodeAt(at) === LF) at -= 1;

  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at; i += 1) {
    const code = text.charCodeAt(i);
    // The break is counted at the LF of a CRLF pair, so the pair opens ONE line rather than two.
    // A lone CR is still a break — an old-Mac document is a document.
    if (code === LF || (code === CR && text.charCodeAt(i + 1) !== LF)) {
      line += 1;
      lineStart = i + 1;
    }
  }

  return { line, column: at - lineStart + 1 };
}

/**
 * The selected character count for a multi-range selection, or `null` when nothing is selected
 * (FR-004, FR-004a, FR-005).
 *
 * Each range arrives as an **iterable of chunks** — a stream of the pieces it is made of, in order —
 * rather than as one string. The line-break rule is {@link countCharacters}'s and there is still
 * only one of it — both count through {@link crlfPairs} — so FR-004a holds by construction: a
 * selection spanning the whole document reports the same figure as the total.
 *
 * ══ WHY CHUNKS, AND WHY THE STRING FORM WAS A DEFECT ══
 *
 * This is called SYNCHRONOUSLY from the editor's update listener — FR-008a pins it there on
 * purpose, because a lagging caret position reads as a broken editor. Asking for a range's whole
 * text meant the caller had to BUILD that text first, so Ctrl+A followed by `Shift+Down` in a 5 MB
 * document sliced, allocated and immediately discarded a ~5 MB string, and did it again on every
 * mouse-move of a shift-drag.
 *
 * None of that was necessary. CodeMirror's `Text` walks in chunks (`doc.iterRange(from, to)`) with
 * no concatenation at all, and the counting rule is very nearly per character, so it applies to a
 * stream of pieces with one bit of carried state and no buffering — see the boundary note below.
 * The earlier signature defended itself as "what lets the line-ending rule be the very same code" —
 * which was a false dichotomy: it is the very same code either way.
 *
 * ══ WHY A PLAIN STRING IS STILL A LEGAL RANGE ══
 *
 * A string is an `Iterable<string>` — iterating one yields its characters — so `['abcd']` is simply
 * a range delivered in one-character chunks, and answers 4. That keeps small call sites and tests
 * readable. It is O(length) in iterator steps, so it is the right form for a short literal and the
 * wrong form for a document; a caller holding a rope should hand over the rope's own iterator.
 *
 * (Iterating a string yields CODE POINTS, so an astral character arrives as one two-code-unit
 * chunk and still counts 2 — FR-003c's UTF-16 code units, undisturbed.)
 *
 * ══ CHUNK BOUNDARIES ARE THE HAZARD, AND ONE BIT OF STATE ANSWERS IT ══
 *
 * A boundary can fall anywhere, including between the CR and the LF of one break. Under FR-003a's
 * reversed rule that is no longer free: the pair is ONE character, so the rule is pair-aware, and a
 * pair-aware rule applied chunk by chunk sees a lone CR closing one chunk and a lone LF opening the
 * next, counts two breaks, and **over-counts by one character per line** on any CRLF text.
 *
 * So `precededByCr` is carried from one chunk to the next — see {@link crlfPairs}. It is reset at
 * every RANGE, because two ranges of a multi-cursor selection are separate pieces of the document
 * and not adjacent text: a CR ending one says nothing about an LF beginning another. Both halves
 * are asserted in `document-metrics.test.ts`, at several boundaries and across a range edge, so
 * neither can be dropped quietly.
 *
 * An **empty chunk cannot separate a pair**, so the carry survives one: it is skipped without
 * clearing the flag.
 *
 * ══ NULL VERSUS ZERO ══
 *
 * `null` means NO SELECTION, and it is a different answer from `0` (FR-005): `0` claims a selection
 * exists and is empty, and would leave a readout on screen that never goes away. With chunks, "is
 * there a selection at all" is answered by whether any range produced a **non-empty chunk** — a
 * bare caret's `iterRange(from, from)` yields nothing. The emptiness that yields `null` is the
 * range's, not the count's.
 *
 * Since the reversal, a non-empty range can no longer report `0`: every character it covers counts,
 * a line ending included. The awkward case the wave-1 review found — a selection of exactly one
 * line ending rendering `0 selected` — is gone, and reports `1`.
 */
export function selectedCharacters(ranges: Iterable<Iterable<string>>): number | null {
  let selected = 0;
  let anyRange = false;

  for (const chunks of ranges) {
    // Reset per RANGE, never per selection: see the boundary note above.
    let precededByCr = false;

    for (const chunk of chunks) {
      // Each range is walked exactly ONCE and nothing is retained: `iterRange` hands back a cursor,
      // not a collection, so buffering it here would both break a single-use iterator and put back
      // the allocation this signature exists to avoid.
      if (chunk.length === 0) continue;
      anyRange = true;
      selected += chunk.length - crlfPairs(chunk, precededByCr);
      precededByCr = chunk.charCodeAt(chunk.length - 1) === CR;
    }
  }

  return anyRange ? selected : null;
}
