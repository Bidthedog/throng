import { describe, expect, it } from 'vitest';
import { MAX_LINK_CANDIDATES_PER_LINE } from '../../src/links/limits.js';
import * as limits from '../../src/links/limits.js';
import { detectPathCandidates } from '../../src/links/detect.js';
import * as core from '@throng/core';

/**
 * 045 T074 (FR-071) — the numbers that keep link detection honest, asserted at the edges where they
 * actually bite.
 *
 * ══ WHY THESE ARE CONSTANTS AND NOT SETTINGS ══
 *
 * None answers a question a user has. Nobody wants a different number of paths per line — they want
 * links that appear and a terminal that stays responsive. A setting nobody should change is a setting
 * somebody eventually will, and then the support question is "why is my terminal slow" with a value in
 * a JSON file as the answer. 030's scrollback guard and 044's preview size limit are the precedents.
 *
 * ══ WHAT THE PER-LINE CAP IS ACTUALLY PROTECTING ══
 *
 * The POINTER and the render path. Detection is cheap and total, but a single line of output can carry
 * thousands of path-shaped tokens — a `find` dump, a `tree`, a minified stack trace — and every one of
 * them would otherwise become a mark and a decoration, on callbacks xterm and CodeMirror run
 * synchronously.
 *
 * *Round four (T265, R32):* the cache-lifetime block — a cached answer must not outlive its location
 * (FR-070) — was deleted with the renderer cache. Nothing is resolved to draw a link
 * (FR-155), so there is no answer to outlive; FR-122's back-off lives in main as `LINK_ROOT_BACKOFF_MS`
 * (`file-link-resolver-network.test.ts`).
 */

describe('MAX_LINK_CANDIDATES_PER_LINE — one line cannot make a hover expensive (FR-071)', () => {
  it('is a whole number, and at least enough for an ordinary line of output', () => {
    expect(Number.isSafeInteger(MAX_LINK_CANDIDATES_PER_LINE)).toBe(true);
    // A `git status` line, a compiler diagnostic naming two files, a stack frame: single figures.
    expect(MAX_LINK_CANDIDATES_PER_LINE).toBeGreaterThanOrEqual(16);
  });

  it('is small enough to bound the work, whatever the line holds', () => {
    expect(MAX_LINK_CANDIDATES_PER_LINE).toBeLessThanOrEqual(256);
  });

  it('actually bites: a pathological line produces far more candidates than the cap allows', () => {
    // 100,000 characters of path-shaped tokens — the `find` dump case, at the size a terminal will
    // happily print. Detection is total and returns every one of them; the cap is what stops each
    // becoming a resolution request and a decoration on a synchronous hover callback.
    const line = Array.from({ length: 12_500 }, (_, i) => `d${i}/f${i}.ts`).join(' ');
    expect(line.length).toBeGreaterThan(100_000);

    const candidates = detectPathCandidates(line, []);
    expect(candidates.length).toBeGreaterThan(MAX_LINK_CANDIDATES_PER_LINE * 10);
  });

  it('leaves a line of pure separators alone — it is not a path candidate at all', () => {
    const slashes = '/'.repeat(100_000);
    // One token, and one reading of it: the cap is not what saves this case, the grammar is.
    expect(detectPathCandidates(slashes, []).length).toBeLessThanOrEqual(1);
  });
});

/*
 * 045 T178's idle-interval block lived here. Round four (T264, R32) deleted the idle scan and its
 * interval; the view pass that replaced it is bounded by `LINK_MARK_THROTTLE_MS` instead, and its
 * still-true assertions (no output data, the per-line cap) moved to `terminal-link-view-marks.test.ts`.
 */

/**
 * 045 T199, amended by T242 — MAX_PATH_SPACE_WORDS, how many words one span may hold (FR-179f; plan
 * Complexity Tracking, third round). The third guard beside the per-line cap: without it a path
 * followed by a long sentence ending in `readme.md` would drag the whole sentence into the link.
 *
 * Read through the module namespace so the file's existing cases keep running while the export is
 * absent.
 */
describe('MAX_PATH_SPACE_WORDS — an extension is bounded, and bites exactly at its edge (FR-150)', () => {
  const cap = (limits as Record<string, unknown>).MAX_PATH_SPACE_WORDS as number | undefined;

  it('is exported from core/src/links/limits.ts as a whole number', () => {
    expect(typeof cap, 'limits.ts exports MAX_PATH_SPACE_WORDS').toBe('number');
    expect(Number.isSafeInteger(cap)).toBe(true);
  });

  it('is at least 2 — the corpus needs C:\\Program Files\\Common Files\\…', () => {
    expect(cap).toBeGreaterThanOrEqual(2);
  });

  it('is small enough that one line cannot turn a sentence into dozens of readings', () => {
    expect(cap).toBeLessThanOrEqual(16);
  });

  // FR-179f (round four): the cap counts the WHOLE span, the starting token included, and a span is
  // one reading — round three's longest-first extended readings are gone. So the edge is: a span of
  // exactly `cap` words ending in a known extension is one link; one word more and the scan gives up,
  // leaving the token alone.
  const spanOf = (n: number): string =>
    ['D:\\a', ...Array.from({ length: n - 2 }, (_, i) => `w${i + 1}`), 'last.md'].join(' ');

  it('exactly cap words: the span takes every one of them, as one reading', () => {
    expect(typeof cap, 'limits.ts exports MAX_PATH_SPACE_WORDS').toBe('number');
    const line = spanOf(cap ?? 0);
    const fromToken = detectPathCandidates(line, []).filter((c) => c.start === 0).map((c) => c.text);
    expect(fromToken).toEqual([line]);
  });

  it('at the edge: cap + 1 words is past the cap, so the token stands alone', () => {
    expect(typeof cap, 'limits.ts exports MAX_PATH_SPACE_WORDS').toBe('number');
    const line = spanOf((cap ?? 0) + 1);
    const fromToken = detectPathCandidates(line, []).filter((c) => c.start === 0).map((c) => c.text);
    expect(fromToken).toEqual(['D:\\a']);
  });
});

/**
 * 045 T146 — MAX_TIMED_OUT_LINK_CHECKS, how many volume roots may be stuck past the existence-check
 * timeout at once (FR-121, P9). The behaviour at the edge — a third stuck root is never stat-ed — is
 * proven over a fake clock in `packages/ui/tests/unit/file-link-resolver-network.test.ts`; this pins
 * the number against the pool it protects.
 */
/**
 * 045 T235 — the two round-four intervals (plan Complexity Tracking, round four). Read from the
 * package's public surface, since the renderer takes them from there.
 *
 * `LINK_MARK_THROTTLE_MS` bounds how often the view pass may run while a program repaints without
 * pause (FR-172, SC-021: "marked within one throttle interval"). `LINK_HINT_MS` is how long the plain-
 * click hint stays up (FR-165d) — reading time, which does not depend on the machine.
 */
describe('LINK_MARK_THROTTLE_MS — marks keep up with a repainting program, at a bounded cost (FR-172)', () => {
  const throttle = (core as Record<string, unknown>).LINK_MARK_THROTTLE_MS as number | undefined;

  it('is exported from @throng/core as 100 ms', () => {
    expect(typeof throttle, '@throng/core exports LINK_MARK_THROTTLE_MS').toBe('number');
    expect(Number.isSafeInteger(throttle)).toBe(true);
    expect(throttle).toBe(100);
  });

  it('is longer than a frame, so a continuous repaint is not a scan per frame (FR-072)', () => {
    expect(throttle).toBeGreaterThan(16);
  });

  it('is short enough that a mark arrives before the eye settles on the row', () => {
    expect(throttle).toBeLessThanOrEqual(250);
  });
});

describe('LINK_HINT_MS — the plain-click hint is readable, then gets out of the way (FR-165d)', () => {
  const hint = (core as Record<string, unknown>).LINK_HINT_MS as number | undefined;

  it('is exported from @throng/core as 2,500 ms', () => {
    expect(typeof hint, '@throng/core exports LINK_HINT_MS').toBe('number');
    expect(Number.isSafeInteger(hint)).toBe(true);
    expect(hint).toBe(2_500);
  });

  it('is long enough to read a one-line hint', () => {
    expect(hint).toBeGreaterThanOrEqual(1_500);
  });

  it('is short enough not to linger over the text it covers', () => {
    expect(hint).toBeLessThanOrEqual(5_000);
  });
});

describe('MAX_TIMED_OUT_LINK_CHECKS — stuck checks never take the thread pool (FR-121)', () => {
  const cap = (limits as Record<string, unknown>).MAX_TIMED_OUT_LINK_CHECKS as number | undefined;

  it('is exported as a whole number, at least 1 so one offline share is still reported', () => {
    expect(Number.isSafeInteger(cap)).toBe(true);
    expect(cap).toBeGreaterThanOrEqual(1);
  });

  it('is below libuv’s four-thread pool, so the rest of the app always keeps a thread', () => {
    expect(cap).toBeLessThan(4);
  });
});
