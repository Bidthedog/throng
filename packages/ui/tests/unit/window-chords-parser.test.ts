/**
 * The parser behind the window-chord manifest guard reads `app.tsx` as TEXT, so the text's line
 * endings are an input to it.
 *
 * The workstation checks this repo out with LF and the hosted Windows runner with CRLF
 * (`core.autocrlf=true`). The guard passed locally and threw on the runner — "HANDLED entry `// 046
 * US2 …` is neither a literal nor a resolvable constant" — because it stripped a line comment with
 * `/\/\/.*$/`, and `.` does not match `\r`: on a CRLF line the pattern cannot reach the end of the
 * string, the comment survives, and it is then read as an entry. So the same source is fed here with
 * each line ending, rather than trusting whichever one the current checkout happens to have.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_TSX, parseHandledActions, toPlaywrightPresses, toPlaywrightTwoStroke } from '../shared/window-chords.js';

const lf = (s: string): string => s.replace(/\r\n/g, '\n');
const crlf = (s: string): string => lf(s).replace(/\n/g, '\r\n');

describe('parseHandledActions is independent of line endings and comments', () => {
  const real = readFileSync(APP_TSX, 'utf8');

  it('reads the real allowlist identically with LF and CRLF line endings', () => {
    const fromLf = parseHandledActions(lf(real));
    expect(fromLf.length).toBeGreaterThan(10);
    expect(parseHandledActions(crlf(real))).toEqual(fromLf);
  });

  const sample = [
    "const QUICK_OPEN: string = 'navigate.quickOpen';",
    'export const WINDOW_HANDLED_ACTIONS: ReadonlySet<string> = new Set([',
    "  'zoom.in', // trailing comment",
    '  // a whole-line comment naming a, b and c',
    '  /* a block comment */ "zoom.out",',
    '  /*',
    "   * a block comment spanning lines, with 'quotes' and // slashes",
    '   */',
    "  'focus.left', 'focus.right',",
    '  QUICK_OPEN,',
    ']);',
  ].join('\n');
  const expected = ['zoom.in', 'zoom.out', 'focus.left', 'focus.right', 'navigate.quickOpen'];

  it.each([
    ['LF', lf(sample)],
    ['CRLF', crlf(sample)],
  ])('ignores line and block comments anywhere in the set (%s)', (_name, src) => {
    expect(parseHandledActions(src)).toEqual(expected);
  });

  it('still throws on an entry it cannot resolve — the guard is not made lenient', () => {
    const src = "const WINDOW_HANDLED_ACTIONS: ReadonlySet<string> = new Set([\r\n  'a.b',\r\n  NOPE,\r\n]);";
    expect(() => parseHandledActions(src)).toThrow(/NOPE/);
  });
});

/**
 * 046 iterate round 1 (T106) — `toPlaywrightPresses`, the shared E2E helper that turns a binding
 * TOKEN into the literal string(s) `page.keyboard.press` takes.
 *
 * Two things a token cannot spell directly: a tier-1 chord must be pressed on its PHYSICAL key
 * (plan.md, iterate round 1: "Playwright presses the physical key for a tier-1 chord
 * (`Control+Shift+Alt+Equal`, not `+`)") — Playwright's own key names are `code`-shaped
 * (`Equal`, `Digit0`, `NumpadAdd`, `ArrowLeft`…), and it has no `+` key of its own to press. And a
 * two-stroke binding is not one string — under 046 FR-124 (superseding round 1's "released, then
 * W") `Ctrl+E,W` is Ctrl held from E through W, which `toPlaywrightTwoStroke` spells as the keys to
 * hold and the two to press.
 *
 * This function does not exist yet (it lands with T111, mirroring `chord-key.ts`'s own token→code
 * mapping into this Playwright-facing form), so every case here is RED until then.
 */
describe('toPlaywrightPresses turns a binding token into what page.keyboard.press takes', () => {
  it('a tier-1 chord on the + key presses the PHYSICAL key, not the produced character', () => {
    expect(toPlaywrightPresses('Ctrl+Shift+Alt++')).toEqual(['Control+Shift+Alt+Equal']);
  });

  it('a two-stroke chord is ONE continuous press: the first stroke’s modifiers held through the second', () => {
    // 046 FR-124 (S29) — re-pinned from "`Ctrl+E W` is Ctrl+E, released, then W". The strokes as
    // written are still two entries, the second naming only what it adds…
    expect(toPlaywrightPresses('Ctrl+E,W')).toEqual(['Control+e', 'w']);
    // …and the chord is pressed by holding Ctrl from E through W.
    expect(toPlaywrightTwoStroke('Ctrl+E,W')).toEqual({ hold: ['Control'], first: 'e', second: 'w' });
    expect(toPlaywrightTwoStroke('Ctrl+E,Shift+W')).toEqual({ hold: ['Control'], first: 'e', second: 'Shift+W' });
    expect(toPlaywrightTwoStroke('Ctrl+E W'), 'a legacy token is the same chord').toEqual({
      hold: ['Control'],
      first: 'e',
      second: 'w',
    });
    expect(() => toPlaywrightTwoStroke('Ctrl+,')).toThrow(); // Ctrl+comma is ONE stroke
  });

  /*
   * 046 T142 — an UNSHIFTED letter is pressed lowercase, because that is the `key` a real keyboard
   * reports for it. Playwright's `press('W')` sends `key: 'W'` with no Shift held — an event no
   * keyboard produces — and CodeMirror, which matches a bare second stroke on `e.key`, reads that as
   * a stroke other than `w`: measured, `editor-word-wrap.e2e.ts` saw the chord's pending indication
   * and then "not bound" instead of the toggle. A letter with Shift keeps its capital.
   */
  it('an unshifted letter is pressed lowercase, a shifted one keeps its capital', () => {
    expect(toPlaywrightPresses('Ctrl+Alt+W')).toEqual(['Control+Alt+w']);
    expect(toPlaywrightPresses('Ctrl+Shift+Alt+B')).toEqual(['Control+Shift+Alt+B']);
  });

  it('an ordinary single-stroke chord is one press, Playwright-cased', () => {
    expect(toPlaywrightPresses('Ctrl+Shift+T')).toEqual(['Control+Shift+T']);
  });

  it('every tier-1 default resolves to exactly one physical-key press', () => {
    for (const chord of ['Ctrl+Shift+Alt+M', 'Ctrl+Shift+Alt+0', 'Ctrl+Shift+Alt+ArrowLeft']) {
      expect(toPlaywrightPresses(chord), chord).toHaveLength(1);
    }
    expect(toPlaywrightPresses('Ctrl+Shift+Alt+0')).toEqual(['Control+Shift+Alt+Digit0']);
    expect(toPlaywrightPresses('Ctrl+Shift+Alt+ArrowLeft')).toEqual(['Control+Shift+Alt+ArrowLeft']);
  });
});
