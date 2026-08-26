import { describe, it, expect } from 'vitest';
import {
  caretPosition,
  countCharacters,
  countGraphemes,
  countWords,
  selectedCharacters,
} from '@throng/core';

/**
 * 040 US1 — the pure counting rules behind the editor status bar
 * (data-model.md §4; spec FR-002, FR-002a, FR-003a, FR-003b, FR-003c, FR-004, FR-004a, FR-005).
 *
 * These are the rules stated in the requirements, asserted without an editor. Every figure the
 * status bar shows is one of these four functions applied to text the renderer already holds, so a
 * disagreement between a compiler's column and throng's, or between a character count before and
 * after a line-ending conversion, is a failure that belongs here rather than in an E2E.
 */

/** A few lines of ordinary source, in LF form. Used for the LF ↔ CRLF property. */
const SAMPLE_LF = ['const foo_bar = "hello-world";', '', 'export default foo_bar;'].join('\n');

/*
 * The astral fixtures, built from CODE POINTS rather than pasted in as literals. Two reasons, and
 * the second is the one that bites: an emoji literal is easy to mangle in transit, and a ZERO WIDTH
 * JOINER is INVISIBLE in an editor — a reviewer cannot see whether the family below has two of them
 * or three, so the arithmetic in the expectations could not be checked by reading. Spelled as code
 * points, every unit in the sums is countable on the page.
 */
const GRINNING = String.fromCodePoint(0x1f600); // U+1F600 — 1 code point, 1 grapheme, 2 UTF-16 units
const MAN = String.fromCodePoint(0x1f468); // U+1F468 — 2 units
const WOMAN = String.fromCodePoint(0x1f469); // U+1F469 — 2 units
const GIRL = String.fromCodePoint(0x1f467); // U+1F467 — 2 units
const ZWJ = String.fromCodePoint(0x200d); // U+200D ZERO WIDTH JOINER — 1 unit, invisible
/** One grapheme cluster a user would point at and call a single character. Eight UTF-16 units. */
const FAMILY = [MAN, ZWJ, WOMAN, ZWJ, GIRL].join('');
/** U+00A0 NO-BREAK SPACE — whitespace to JavaScript's `\s`, NOT whitespace to `wc -w`. */
const NBSP = String.fromCodePoint(0x00a0);

describe('countCharacters (040 FR-003a — a line break is ONE character)', () => {
  it('counts the characters on the lines AND one per break', () => {
    // data-model.md §4's worked example: six letters and two CRLF pairs, each pair one character.
    expect(countCharacters('ab\r\ncd\r\nef')).toBe(8);
    // The same text in LF form is the same document and the same figure.
    expect(countCharacters('ab\ncd\nef')).toBe(8);
  });

  it('reports 9 for a document of ten empty lines', () => {
    /*
     * Ten lines means nine breaks and nothing else, and FR-003a states the answer verbatim: 9.
     * The reversed answer said 0, which is the case that decided it — a document the user filled
     * with nine keystrokes is not an empty document.
     */
    expect(countCharacters('\n'.repeat(9))).toBe(9);
    expect(countCharacters('\r\n'.repeat(9))).toBe(9);
  });

  it('is UNCHANGED by an LF ↔ CRLF conversion', () => {
    /*
     * The property worth asserting directly (data-model.md §4), and it SURVIVES the reversal:
     * #71 converts a document's line endings, which changes how each break is spelled and not how
     * many breaks there are. A `text.length` count fails this — CRLF would report one more per
     * line — and nothing else in the suite would notice.
     */
    const crlf = SAMPLE_LF.replace(/\n/gu, '\r\n');
    expect(crlf).not.toBe(SAMPLE_LF);
    expect(countCharacters(crlf)).toBe(countCharacters(SAMPLE_LF));
    expect(countCharacters(SAMPLE_LF)).toBe(30 + 0 + 23 + 2); // three lines, two breaks
  });

  it('counts a lone CR as one break, like any other', () => {
    // An old-Mac document is still a document, and its break is still one character.
    expect(countCharacters('ab\rcd')).toBe(5);
  });

  it('counts a CR followed by a CRLF pair as TWO breaks, not three characters', () => {
    // `\r` then `\r\n`: a lone break and a paired one. The pair must not be split into two, and
    // the lone CR before it must not be swallowed into one.
    expect(countCharacters('a\r\r\nb')).toBe(4);
  });

  it('reports 0 for an empty document', () => {
    expect(countCharacters('')).toBe(0);
  });

  it('counts a trailing newline, because the user typed it', () => {
    // The clearest single statement of the reversal: `abc\n` is one character longer than `abc`.
    expect(countCharacters('abc\n')).toBe(countCharacters('abc') + 1);
    expect(countCharacters('abc\r\n')).toBe(countCharacters('abc') + 1);
  });
});

describe('a character is a UTF-16 CODE UNIT, not a grapheme (040 FR-003c)', () => {
  /*
   * FR-003c is the most contested rule in the feature and was, until this block existed, the only
   * one with NO test: every other assertion in this file uses BMP text, where code units, code
   * points and grapheme clusters all agree, so `countCharacters`'s body could have been swapped for
   * `[...text].length - terminators` or an `Intl.Segmenter` count with the whole suite still green.
   * These assertions are the ones that go red for each of those, which is the only reason to have
   * them: they make a rule that was argued in prose into a rule the build enforces.
   */

  it('counts an astral character as the TWO units its surrogate pair occupies', () => {
    // A code-POINT rule says 1 here, and a grapheme rule says 1 too. Only the code-unit rule says 2.
    expect(countCharacters(GRINNING)).toBe(2);
    // The SELECTION path is the same rule and must give the same figure. Asserted here rather than
    // left to the block below because this is where the code-unit claim is made, and because the
    // chunked form is the one the editor actually delivers: `iterRange` hands over an astral
    // character as ONE two-unit chunk, so a `[...chunk].length` drift shows up as 1.
    expect(selectedCharacters([[GRINNING]])).toBe(2);
  });

  it('counts a ZWJ sequence as every unit it is built from', () => {
    // `a` + the family cluster + `b`. The family is ONE thing on screen and eight units underneath:
    // three astral code points at 2 units each, joined by two ZERO WIDTH JOINERs at 1 unit each.
    const familyUnits = 2 + 1 + 2 + 1 + 2; // MAN, ZWJ, WOMAN, ZWJ, GIRL — 8
    // A FIXTURE guard, not a claim about the module: the two ZWJs are invisible on the page, so
    // this is the assertion that says the sum above describes the constant it is applied to. It is
    // kept because without it a mangled fixture fails the module assertions instead, sending the
    // reader to `document-metrics.ts` for a defect that is in this file.
    expect(FAMILY).toHaveLength(familyUnits);
    expect(countCharacters(`a${FAMILY}b`)).toBe(1 + familyUnits + 1); // 10
    // …and on the selection path, delivered the way a rope delivers it: one chunk per code point.
    expect(selectedCharacters([[MAN, ZWJ, WOMAN, ZWJ, GIRL]])).toBe(familyUnits);
  });

  it('keeps FR-004a for a document that is nothing but one emoji (FR-003c, FR-004a)', () => {
    /*
     * The gap this closes, and it is the reason FR-004a is asserted as an EQUALITY rather than a
     * number: every other selection fixture in this file is BMP ASCII, where code units and code
     * points agree — including FR-004a's own equality test, whose document is `SAMPLE_LF`. So
     * `selectedCharacters` could drift to `[...chunk].length` — a plausible drift, and exactly what
     * `countCharacters`' JSDoc warns a later "fix" would reach for — with the whole suite green,
     * while a one-emoji document reported `1 selected` against a total of 2.
     *
     * Select-all in these documents therefore has to agree with the total, whatever the document is
     * made of.
     */
    for (const document of [GRINNING, FAMILY, `a${FAMILY}b`, `${GRINNING}\r\n${GRINNING}`]) {
      expect(selectedCharacters([document]), document).toBe(countCharacters(document));
    }
    // Spelled out once as a figure too, so the equality cannot be satisfied by both sides drifting.
    expect(selectedCharacters([GRINNING])).toBe(2);
  });

  it('keeps both rules at once: a break is 1 and an emoji is still 2 (FR-003a, FR-003c)', () => {
    /*
     * The two rules meeting, because the reversal moved one of them and could easily have been
     * implemented as `text.length` — which is right for the break and WRONG for nothing here, so
     * this pins the other half: the emoji's surrogate pair still counts 2, while the CRLF pair
     * beside it counts 1. A rule that treated both pairs alike would pass with either 4 or 6.
     */
    expect(countCharacters(`${GRINNING}\r\n${GRINNING}`)).toBe(2 + 1 + 2);
    expect(countCharacters(`${GRINNING}\n${GRINNING}`)).toBe(2 + 1 + 2);
  });

  it('is the OPPOSITE semantics from countGraphemes, deliberately (031 FR-033a)', () => {
    /*
     * Both definitions ship, and the point of asserting them side by side is that the divergence is
     * VISIBLE in one place rather than inferred from two modules that never mention each other.
     * `countGraphemes` counts what the user would point at — right for a filename they are typing.
     * `countCharacters` counts code units — right for a document measurement and a caret column
     * that must agree with a compiler's. An emoji is 1 there and 2 here, and that is the accepted
     * inconsistency FR-003c records rather than a bug in either.
     */
    expect(countGraphemes(GRINNING)).toBe(1);
    expect(countCharacters(GRINNING)).toBe(2);
    expect(countGraphemes(FAMILY)).toBe(1);
    expect(countCharacters(FAMILY)).toBe(8);
  });

  it('advances the caret column by one per UNIT across an astral character (FR-002a)', () => {
    // Offset 2 is PAST the whole surrogate pair — CodeMirror's offsets are code units too — so the
    // caret is at column 3. A code-point rule would report column 2, and would then disagree with
    // the column a compiler reports for the same position, which is what FR-002a forbids.
    expect(caretPosition(`${GRINNING}x`, 2)).toEqual({ line: 1, column: 3 });
    expect(caretPosition(`${GRINNING}x`, 3)).toEqual({ line: 1, column: 4 });
  });
});

describe('countWords (040 FR-003b — maximal runs of non-whitespace)', () => {
  it('counts the runs in the worked example', () => {
    // `const` `foo_bar` `=` `"hello-world";` — four, exactly what `wc -w` says.
    expect(countWords('const foo_bar = "hello-world";')).toBe(4);
  });

  it('does not split on punctuation, hyphens, dots or underscores', () => {
    expect(countWords('foo_bar()')).toBe(1);
    expect(countWords('https://x.com/y')).toBe(1);
    expect(countWords('well-known')).toBe(1);
  });

  it('treats tabs and newlines as whitespace, and collapses runs of it', () => {
    expect(countWords('a\nb\tc')).toBe(3);
    expect(countWords('  a     b  ')).toBe(2);
    expect(countWords('a\r\n\r\nb')).toBe(2);
  });

  it('reports 0 for empty and whitespace-only documents', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \t\r\n  ')).toBe(0);
  });

  it('SPLITS on a no-break space, where `wc -w` would not', () => {
    /*
     * The one place the rule and its familiar analogue part company, pinned so the divergence is
     * deliberate rather than discovered. JavaScript's `\s` includes U+00A0; glibc's `iswspace`,
     * which is what `wc -w` uses, does not — so this is two words to throng and one to `wc`.
     *
     * Splitting is the answer a text editor wants: the user sees two words on screen, and a count
     * that disagreed with their eyes in order to agree with a POSIX utility would be the wrong
     * trade. FR-003b names `wc -w` as the FAMILIAR rule, not as the authority, and this test is why
     * that wording matters.
     */
    expect(countWords(`a${NBSP}b`)).toBe(2);
    expect(countWords(NBSP)).toBe(0);
  });
});

describe('caretPosition (040 FR-002, FR-002a — 1-based line, 1-based CHARACTER column)', () => {
  it('puts the very first position at line 1, column 1', () => {
    // FR-002, named rather than left implicit: the first line is line 1 and the first column is 1.
    expect(caretPosition('', 0)).toEqual({ line: 1, column: 1 });
    expect(caretPosition('abc', 0)).toEqual({ line: 1, column: 1 });
  });

  it('advances the column by exactly 1 per tab, never to a tab stop', () => {
    /*
     * data-model.md §4's worked example. A DISPLAY column with four-wide tab stops would say 9
     * here, and would move again the moment `editor.indent.tabWidth` changed — which is precisely
     * what FR-002a forbids, because a compiler's column would then stop matching throng's.
     */
    expect(caretPosition('\t\tfoo', 2)).toEqual({ line: 1, column: 3 });
    expect(caretPosition('\t\tfoo', 5)).toEqual({ line: 1, column: 6 });
  });

  it('counts an LF break, reporting the next line from column 1', () => {
    expect(caretPosition('ab\ncd', 2)).toEqual({ line: 1, column: 3 });
    expect(caretPosition('ab\ncd', 3)).toEqual({ line: 2, column: 1 });
    expect(caretPosition('ab\ncd', 5)).toEqual({ line: 2, column: 3 });
  });

  it('counts a CRLF pair as ONE break, not two', () => {
    expect(caretPosition('ab\r\ncd', 4)).toEqual({ line: 2, column: 1 });
    expect(caretPosition('ab\r\ncd', 6)).toEqual({ line: 2, column: 3 });
  });

  it('counts a lone CR as a break', () => {
    expect(caretPosition('ab\rcd', 3)).toEqual({ line: 2, column: 1 });
  });

  it('is total: an offset outside the document clamps rather than throwing', () => {
    // No editor produces these. The function still has to answer, because a readout that throws
    // takes the whole status bar down with it.
    expect(caretPosition('abc', -5)).toEqual({ line: 1, column: 1 });
    expect(caretPosition('abc', 99)).toEqual({ line: 1, column: 4 });
  });

  it('answers a place for NaN and for the infinities, rather than reporting `Col NaN`', () => {
    /*
     * The gap the "total by construction" claim had. `Math.floor(NaN)` is NaN, and NaN survives
     * both `Math.max` and `Math.min` — so the clamp let it through, the loop never ran, and the
     * function returned `{ line: 1, column: NaN }`, which a status bar renders as `Col NaN`. Not a
     * crash and not a place: exactly the failure mode a totality claim is supposed to rule out.
     *
     * Unreachable from CodeMirror, whose offsets are always integers. It is asserted anyway because
     * the docstring makes a promise about EVERY offset, and a promise the code does not keep is
     * worse than no promise.
     */
    expect(caretPosition('abc', Number.NaN)).toEqual({ line: 1, column: 1 });
    // The infinities were never broken — they clamp through `max`/`min` — and are asserted here so
    // that a future guard written as `Number.isFinite` cannot quietly send the end of the document
    // back to its start.
    expect(caretPosition('abc', Number.POSITIVE_INFINITY)).toEqual({ line: 1, column: 4 });
    expect(caretPosition('abc', Number.NEGATIVE_INFINITY)).toEqual({ line: 1, column: 1 });
  });

  it('does not report a position INSIDE a CRLF pair', () => {
    // Unreachable from a real editor — CodeMirror treats the pair as one position — but the
    // answer must be a real place, so it clamps to the end of the line the pair closes.
    expect(caretPosition('ab\r\ncd', 3)).toEqual({ line: 1, column: 3 });
  });
});

describe('selectedCharacters (040 FR-004, FR-004a, FR-005)', () => {
  it('sums every range under a multi-range selection', () => {
    // data-model.md §4's worked example: 30 + 33.
    expect(selectedCharacters(['x'.repeat(30), 'y'.repeat(33)])).toBe(63);
  });

  it('counts a line break as one character, exactly as the total does', () => {
    /*
     * Note WHAT this call delivers, because it is the split-pair case in disguise: a string is an
     * `Iterable<string>`, so `'ab\r\ncd'` arrives as SIX one-character chunks — the CR and the LF
     * among them. Answering 5 here therefore already requires the rule to carry state across a
     * chunk boundary; a per-chunk pair rule would say 6.
     */
    expect(selectedCharacters(['ab\r\ncd'])).toBe(5);
    expect(selectedCharacters(['ab\ncd'])).toBe(5);
  });

  it('reports the SAME figure as the total for a whole-document selection (FR-004a)', () => {
    /*
     * The requirement is stated as an equality rather than a number, so it is asserted as one:
     * select everything and the two readouts must agree, whatever the document happens to be.
     */
    const crlf = SAMPLE_LF.replace(/\n/gu, '\r\n');
    expect(selectedCharacters([SAMPLE_LF])).toBe(countCharacters(SAMPLE_LF));
    expect(selectedCharacters([crlf])).toBe(countCharacters(crlf));
  });

  it('has ONE exception to that equality, and it is the EMPTY document (FR-004a, FR-005)', () => {
    /*
     * Select-all in an empty document produces one range covering nothing, which is
     * indistinguishable from a bare caret — the same offsets, the same empty text. So
     * `selectedCharacters` answers `null` (no selection) where `countCharacters` answers `0`, and
     * FR-004a's equality does not hold.
     *
     * That is the RIGHT behaviour, not a defect to fix: FR-005 wants nothing at all rendered when
     * there is no selection, and `0 selected` sitting permanently in the status bar of an empty
     * file is precisely what it forbids. Making the equality hold here would mean rendering a
     * readout for a caret, which is the worse of the two. The exception is asserted so that a
     * future reader who notices the mismatch finds a decision rather than a bug — and so that
     * anyone tempted to "restore" the equality has to delete this test to do it.
     */
    expect(countCharacters('')).toBe(0);
    expect(selectedCharacters([''])).toBeNull();
  });

  it('returns NULL, not 0, when every range is a bare caret (FR-005)', () => {
    // FR-005: no selection renders as nothing at all. `0` is a different claim — it says a
    // selection exists and is empty — and would put a readout on screen that never leaves.
    const carets = selectedCharacters(['', '', '']);
    expect(carets).toBeNull();
    expect(carets).not.toBe(0);
  });

  it('returns null when there are no ranges at all', () => {
    expect(selectedCharacters([])).toBeNull();
  });

  it('reports 1 for a selection that covers only a line ending', () => {
    /*
     * The awkward case the wave-1 review flagged, and what the reversal did to it: a selection of
     * exactly one line ending used to report `0 selected` — a readout on screen saying nothing was
     * selected while something plainly was. It now reports 1, because the break IS the character
     * the user selected, and the case is gone rather than explained.
     */
    expect(selectedCharacters(['\r\n'])).toBe(1);
    expect(selectedCharacters(['\n'])).toBe(1);
    expect(selectedCharacters(['\r'])).toBe(1);
  });

  it('ignores empty ranges alongside real ones', () => {
    expect(selectedCharacters(['', 'abcd', ''])).toBe(4);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * A range arrives as CHUNKS, never as one string (040 T012a — FR-008a)
 * ────────────────────────────────────────────────────────────────────────── */

describe('selectedCharacters takes an iterable of chunks (040 T012a)', () => {
  /**
   * ══ THE DEFECT THIS CHANGE REMOVES ══
   *
   * Taking each range's whole TEXT means the caller has to build that text. In the editor the
   * caller is `publishCaret`, which runs SYNCHRONOUSLY inside the update listener — FR-008a pins it
   * there deliberately, because a lagging caret reads as a broken editor. So Ctrl+A followed by
   * `Shift+Down` in a 5 MB document sliced, allocated and immediately discarded a ~5 MB string, and
   * did it again for every mouse-move of a shift-drag.
   *
   * CodeMirror's `Text` can be walked in chunks (`doc.iterRange(from, to)`) with no concatenation
   * at all, so the allocation was never necessary. The original JSDoc defended the string form as
   * "what lets the line-ending rule be the very same code" — a false dichotomy: the rule is
   * per-character, so it applies to a stream of chunks unchanged. One rule, no allocation.
   *
   * ══ WHY A STRING IS STILL A VALID ARGUMENT, AND WHY THAT IS NOT AN ACCIDENT ══
   *
   * A string IS an `Iterable<string>` — iterating one yields its characters — so every call above
   * remains correct and remains meaningful: those are ranges delivered in one-character chunks.
   * That is why this change needed no edit to a single existing assertion.
   */

  it('counts a range delivered in chunks exactly as it counts it whole', () => {
    // The equivalence the whole change rests on. If these two ever disagree, the chunked path has
    // grown a rule of its own, which is the one thing this refactor must not do.
    expect(selectedCharacters([['hello', ' ', 'world']])).toBe(11);
    expect(selectedCharacters([['hello world']])).toBe(11);
  });

  it('is unaffected by WHERE the chunk boundaries fall, INCLUDING inside a CRLF pair', () => {
    /*
     * The correctness hazard chunking introduces, and the reason this test is not redundant with
     * the one above. A boundary can land anywhere, and the one place it hurts is BETWEEN the CR
     * and the LF of one break.
     *
     * Under FR-003a's reversed rule this is the single subtlest thing in the module. The pair is
     * one character, so the rule is now pair-AWARE — and a pair-aware rule that looks at one chunk
     * at a time sees a lone CR ending one chunk and a lone LF opening the next, counts two breaks,
     * and over-counts by one character per line on any CRLF text. Getting it right means carrying
     * exactly one character of state — "did the last chunk end in CR?" — across the boundary.
     *
     * Every form below is the same six-character text and must give the same answer: four
     * characters plus one break.
     */
    expect(selectedCharacters([['ab\r', '\ncd']])).toBe(5);
    expect(selectedCharacters([['ab\r\ncd']])).toBe(5);
    expect(selectedCharacters([['a', 'b', '\r', '\n', 'c', 'd']])).toBe(5);
  });

  it('carries the split-pair state across EVERY boundary, not just the first', () => {
    /*
     * The discriminating case, and the reason the one above is not sufficient on its own: a rule
     * that reset its carry after using it once — or that only checked the previous chunk when the
     * current one begins a range — passes with a single split pair and fails with two.
     *
     * `x` `\r\n` `y` `\r\n` `z` is three characters and two breaks, split at BOTH pairs. Counting
     * each chunk independently gives 2 + 3 + 2 = 7, which is the wrong answer this pins.
     */
    expect(selectedCharacters([['x\r', '\ny\r', '\nz']])).toBe(5);
    expect(selectedCharacters([['x\r\ny\r\nz']])).toBe(5);
  });

  it('does not lose the CR when the next chunk is NOT an LF', () => {
    // The other half of carrying state: a chunk ending in CR that is followed by ordinary text is
    // a lone break, and must still count 1. An implementation that deferred the CR and then forgot
    // to charge for it would report 2 here.
    expect(selectedCharacters([['a\r', 'b']])).toBe(3);
    expect(selectedCharacters([['a\r', '\r\nb']])).toBe(4); // lone CR, then a split-free pair
    expect(selectedCharacters([['a\r']])).toBe(2); // …including when the range simply ends there
  });

  it('CLEARS the carry on a chunk that does not end in CR, so it cannot go sticky', () => {
    /*
     * The carry's NEGATIVE half, and until this case existed it was pinned nowhere that the
     * clearing changed the answer. Mutating the assignment to
     * `precededByCr = precededByCr || chunk.endsWith(CR)` — a carry that latches on and never
     * clears — left ALL 22 other `selectedCharacters` assertions green, because each of the three
     * that look like they should catch it is insensitive to it:
     *
     *   - `['a\r', 'b']` is 3 either way: `'b'` does not begin with an LF, so a stale carry is
     *     never consulted;
     *   - `['a\r', '\r\nb']` is 4 either way: that chunk BEGINS with a CR, so the stale carry and
     *     the real one agree;
     *   - `['a\r']` has no successor chunk for the carry to reach.
     *
     * The shape that discriminates needs THREE chunks, where the middle one neither begins with LF
     * nor ends with CR: it must clear the carry that the first chunk set, so the LF opening the
     * third is a break of its own rather than the second half of a pair already charged for.
     * `a` `\r` `b` `\n` `c` is five characters and two lone breaks; a sticky carry reports 4.
     */
    expect(selectedCharacters([['a\r', 'b', '\nc']])).toBe(5);
    // The same five characters delivered as one chunk stream, where no boundary falls after the
    // CR at all — so the carry is never set, and the two spellings must still agree.
    expect(selectedCharacters([['a\rb\nc']])).toBe(5);
  });

  it('keeps the carry across an EMPTY chunk between the CR and the LF', () => {
    // An empty chunk is not text and cannot separate a pair. A rule that reset its carry on any
    // chunk — rather than only on one with content — would count two breaks here.
    expect(selectedCharacters([['a\r', '', '\nb']])).toBe(3);
  });

  it('does NOT carry the split-pair state from one RANGE into the next', () => {
    /*
     * Two ranges are two separate pieces of the document, not adjacent text — a multi-cursor
     * selection can end one range on a CR and begin another on an LF that is nowhere near it. Each
     * range is `a` + a break (2) and a break + `b` (2), so the answer is 4. State leaking between
     * ranges would fuse them into one pair and report 3.
     */
    expect(selectedCharacters([['a\r'], ['\nb']])).toBe(4);
  });

  it('accepts a SINGLE-USE iterable, so nothing may iterate a range twice', () => {
    /*
     * `doc.iterRange()` returns a cursor, not a collection: it can be walked once. An
     * implementation that measured a range and then counted it — or that buffered it into an array
     * "just to be safe" — would either answer 0 on the second pass or reintroduce the allocation
     * this change exists to remove. A generator is the cheapest way to state that requirement.
     */
    function* range(): Generator<string> {
      yield 'one ';
      yield 'two ';
      yield 'three';
    }
    expect(selectedCharacters([range()])).toBe(13);
  });

  it('takes the RANGES lazily too, not only the chunks', () => {
    // The outer sequence is an iterable as well, so a caller may stream ranges straight from
    // `state.selection.ranges` without collecting them into an array first.
    function* ranges(): Generator<Iterable<string>> {
      yield ['ab', 'cd'];
      yield ['ef'];
    }
    expect(selectedCharacters(ranges())).toBe(6);
  });

  it('still answers NULL for bare carets delivered as empty chunk streams (FR-005)', () => {
    /*
     * `iterRange(from, from)` is what a bare caret produces, and it yields nothing. The
     * "is there a selection at all" question therefore has to be answered from the CHUNKS — a range
     * counts as real once it produces a non-empty one — rather than from a string's length, which
     * no longer exists at this boundary.
     */
    function* nothing(): Generator<string> {
      // yields nothing at all
    }
    expect(selectedCharacters([nothing(), nothing()])).toBeNull();
    expect(selectedCharacters([[], []])).toBeNull();
    expect(selectedCharacters([['', '']])).toBeNull();
  });

  it('reports 1 for a selection covering only a line ending, delivered as a SPLIT pair', () => {
    // The distinction FR-005 turns on, restated at the new boundary: this range produced content,
    // so it IS a selection, and that content is one character — the break — so it counts 1. The
    // split is the trap: without the carry, the same selection reports 2.
    expect(selectedCharacters([['\r', '\n']])).toBe(1);
    expect(selectedCharacters([['\r\n']])).toBe(1);
  });

  it('sums chunked ranges across a multi-range selection (FR-004)', () => {
    // data-model.md §4's worked example again, this time arriving the way the editor delivers it.
    expect(selectedCharacters([['x'.repeat(20), 'x'.repeat(10)], ['y'.repeat(33)]])).toBe(63);
  });
});
