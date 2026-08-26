import { describe, it, expect } from 'vitest';
import { countCharacters, countWords } from '@throng/core';

/**
 * 040 FR-008c / SC-005 — counting a 5 MB document completes within 2 seconds.
 *
 * ══ WHAT IS MEASURED, AND WHY THESE TWO FUNCTIONS ══
 *
 * The document readouts are produced by exactly one pair of calls — `countCharacters` and
 * `countWords` over the whole text — inside `scheduleDocumentMetrics`
 * (`packages/ui/src/renderer/editor/document-metrics-store.ts`). That pair IS the debounced work
 * FR-008b defers off the keystroke path, so measuring the pair measures the thing the requirement
 * budgets. Nothing else in the bar is O(document): the caret readouts are FR-008a's synchronous
 * arithmetic over an offset, and the selection is walked in chunks.
 *
 * ══ TWO SECONDS IS A REGRESSION ALARM, NOT A TARGET ══
 *
 * The real figure should be ORDERS OF MAGNITUDE under this bound — both functions are a single
 * linear pass, so 5 MB is tens of milliseconds on any machine that can run the app at all. The
 * number exists to catch an accidental O(n²) scan, a per-character allocation, or a "fix" that
 * routes the count through `[...text]` or `text.match(/\S+/g)` and materialises a million strings.
 * It is NOT here to certify performance, and it must never be tightened towards whatever this
 * machine happens to measure today.
 *
 * The bound is deliberately ABSOLUTE and wide, and there is no counts-on-versus-counts-off
 * comparison anywhere in this file. The repository's only latency precedent,
 * `packages/ui/tests/integration/config-broadcast-latency.test.ts`, says in as many words that
 * *"a latency assertion tuned to the median is a flake generator"*, and it is right: this is
 * wall-clock on a machine that may be running an E2E suite on every other core. A relative
 * assertion would measure the contention rather than the code.
 *
 * ══ THE SUBJECTIVE HALF IS NOT HERE, BY DESIGN ══
 *
 * "Typing feels no heavier with the counts on than off" is a manual quickstart step (FR-008c). The
 * mechanical half of that claim — that the count never runs on the keystroke path — is asserted by
 * the debounce and listener tests at the tiers that can see a listener; this file only answers
 * "how long does the count itself take".
 *
 * ══ WHY THE UNIT TIER ══
 *
 * The counting rules are pure, so the cheapest layer that can time them is this one. The
 * `integration` project is `environment: 'node'` with no DOM, and an app-level comparison would be
 * timing the harness rather than the counting.
 */

/** FR-008c's ceiling. A regression alarm — see the note above before touching it. */
const FR008C_BUDGET_MS = 2000;

/** The document this feature budgets for. */
const FIVE_MB = 5 * 1024 * 1024;

/**
 * One line of ordinary source, spelled out so the expected counts below can be checked by reading
 * rather than trusted.
 *
 * 27 characters of text plus one LF = 28. Six runs of non-whitespace: `const`, `alpha`, `=`,
 * `beta`, `+`, `gamma;` — punctuation is not whitespace (FR-003b), so `gamma;` is one word.
 */
const LINE = 'const alpha = beta + gamma;\n';
const LINE_CHARS = 28;
const LINE_WORDS = 6;

/** Enough lines to pass 5 MB — 187,246 × 28 = 5,242,888 characters. */
const LINES = Math.ceil(FIVE_MB / LINE_CHARS);

describe('FR-008c / SC-005 — a 5 MB document counts inside the budget', () => {
  it('counts characters and words in well under two seconds, and counts them correctly', () => {
    const text = LINE.repeat(LINES);
    // The fixture itself is part of the claim: a document that turned out to be 500 KB would meet
    // the budget while proving nothing about the one the requirement names.
    expect(text.length).toBeGreaterThanOrEqual(FIVE_MB);

    const started = performance.now();
    const characters = countCharacters(text);
    const words = countWords(text);
    const elapsed = performance.now() - started;

    /*
     * ANTI-VACUITY. A timing assertion on its own is satisfied perfectly by a counter that returns
     * a constant, and "fast" is exactly what a broken count looks like. These two expectations are
     * what make the elapsed figure mean something: the work was actually done, and the answers are
     * the ones arithmetic predicts for this fixture.
     *
     * The LF is one character and it COUNTS (FR-003a), so the character total is simply the string
     * length — there are no CRLF pairs in this fixture to discount.
     */
    expect(characters).toBe(LINES * LINE_CHARS);
    expect(words).toBe(LINES * LINE_WORDS);

    expect(
      elapsed,
      `counting ${text.length} characters took ${elapsed.toFixed(1)} ms, against FR-008c's ` +
        `${FR008C_BUDGET_MS} ms alarm. This bound is generous by two orders of magnitude — if it ` +
        `has been crossed, look for a quadratic scan or a per-character allocation, not for a ` +
        `slower machine.`,
    ).toBeLessThan(FR008C_BUDGET_MS);
  });
});
