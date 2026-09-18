import { describe, expect, it } from 'vitest';
import { LINK_CACHE_TTL_MS, MAX_LINK_CANDIDATES_PER_LINE } from '../../src/links/limits.js';
import * as limits from '../../src/links/limits.js';
import { detectPathCandidates } from '../../src/links/detect.js';

/**
 * 045 T074 (FR-070, FR-071) — the two numbers that keep link detection honest, asserted at the
 * edges where they actually bite.
 *
 * ══ WHY THESE ARE CONSTANTS AND NOT SETTINGS ══
 *
 * Neither answers a question a user has. Nobody wants a different cache lifetime, and nobody wants a
 * different number of paths per line — they want links that appear and a terminal that stays
 * responsive, which is what these two deliver between them. A setting nobody should change is a
 * setting somebody eventually will, and then the support question is "why is my terminal slow" with
 * a value in a JSON file as the answer. 030's scrollback guard and 044's preview size limit are the
 * two precedents; the Complexity Tracking table in `plan.md` records this as the third.
 *
 * ══ WHAT EACH ONE IS ACTUALLY PROTECTING ══
 *
 * The TTL protects a user who CREATES a file after its name was printed. The watcher covers the
 * cases it sees; the TTL is the backstop for everything it does not — a file written by a program
 * outside any watched root, a network share, a path the watcher never registered. Too long and
 * "that file exists now" stays false until the terminal is closed; too short and resting the pointer
 * on one path re-asks main several times a second.
 *
 * The per-line cap protects the POINTER. Detection is cheap and total, but a single line of output
 * can carry thousands of path-shaped tokens — a `find` dump, a `tree`, a minified stack trace — and
 * every one of them would otherwise become a resolution request and a decoration, on a callback
 * xterm runs synchronously while the mouse moves.
 */

describe('LINK_CACHE_TTL_MS — a cached answer must not outlive its location (FR-070)', () => {
  it('is a whole number of milliseconds', () => {
    expect(Number.isSafeInteger(LINK_CACHE_TTL_MS)).toBe(true);
    expect(LINK_CACHE_TTL_MS).toBeGreaterThan(0);
  });

  it('is long enough that resting the pointer on one path does not re-ask main', () => {
    // A pointer at rest still produces a hover per repaint, and the self-heal repaint runs on a 2s
    // interval — so anything under a few seconds means a request every couple of seconds for as
    // long as the pointer sits still.
    expect(LINK_CACHE_TTL_MS).toBeGreaterThanOrEqual(5_000);
  });

  it('is short enough that a file created after its name was printed becomes a link on its own', () => {
    // The ceiling is a user's patience, not a machine's: create the file, look back at the terminal,
    // hover the path. A minute is already longer than that takes.
    expect(LINK_CACHE_TTL_MS).toBeLessThanOrEqual(60_000);
  });
});

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

/**
 * 045 T178 — LINK_IDLE_SCAN_MS, the quiet interval before the terminal's idle scan resolves the rows in
 * view (FR-137; contract §7 P13). A named constant beside its two siblings, for their reason.
 *
 * It protects two things pulling in opposite directions. Too SHORT and a program that streams in
 * bursts — a build printing a line every few tens of milliseconds, a `tail -f` — goes "quiet" between
 * every burst, so the scan runs on what is effectively the output path, which FR-072 forbids. Too
 * LONG and a user who stops output and looks for a link waits for the at-rest mark (FR-136) long
 * enough to reach for the pointer anyway.
 *
 * Read through the module namespace so the file's existing cases keep running while the export is
 * absent.
 */
describe('LINK_IDLE_SCAN_MS — the idle scan waits for quiet, and not for long (FR-137)', () => {
  const idle = (limits as Record<string, unknown>).LINK_IDLE_SCAN_MS as number | undefined;

  it('is exported from core/src/links/limits.ts as a whole number of milliseconds', () => {
    expect(typeof idle, 'limits.ts exports LINK_IDLE_SCAN_MS').toBe('number');
    expect(Number.isSafeInteger(idle)).toBe(true);
  });

  it('is longer than the gaps inside a burst of streamed output, so streaming never counts as quiet', () => {
    expect(idle).toBeGreaterThanOrEqual(150);
  });

  it('is short enough that the at-rest mark arrives before the user reaches for the pointer', () => {
    expect(idle).toBeLessThanOrEqual(1_000);
  });

  it('is well inside the cache TTL, so a scan’s answers are still fresh when a hover reads them', () => {
    expect(idle).toBeLessThan(LINK_CACHE_TTL_MS);
  });
});

/**
 * 045 T199 — MAX_PATH_SPACE_WORDS, how many words an anchored token may be extended by (FR-150;
 * link-resolution.md §8.1 D16; plan Complexity Tracking, third round). The third guard beside the
 * per-line cap: every extended reading is a candidate, so without a cap one path followed by a long
 * sentence multiplies into as many existence checks as the sentence has words.
 *
 * Read through the module namespace, like LINK_IDLE_SCAN_MS above, so the file's existing cases keep
 * running while the export is absent.
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

  it('at the edge: a token followed by cap + 1 words yields cap extended readings plus the token', () => {
    expect(typeof cap, 'limits.ts exports MAX_PATH_SPACE_WORDS').toBe('number');
    const n = cap ?? 0;
    const words = Array.from({ length: n + 1 }, (_, i) => `w${i + 1}`);
    const line = `D:\\a ${words.join(' ')}`;
    const fromToken = detectPathCandidates(line, []).filter((c) => c.start === 0).map((c) => c.text);
    expect(fromToken).toHaveLength(n + 1);
    expect(fromToken[0]).toBe(`D:\\a ${words.slice(0, n).join(' ')}`);
    expect(fromToken[fromToken.length - 1]).toBe('D:\\a');
  });

  it('exactly cap words: the longest reading takes every one of them', () => {
    expect(typeof cap, 'limits.ts exports MAX_PATH_SPACE_WORDS').toBe('number');
    const n = cap ?? 0;
    const words = Array.from({ length: n }, (_, i) => `w${i + 1}`);
    const line = `D:\\a ${words.join(' ')}`;
    const longest = detectPathCandidates(line, []).find((c) => c.start === 0)?.text;
    expect(longest).toBe(line);
  });
});
