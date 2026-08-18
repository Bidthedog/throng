import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The E2E keyboard fixtures must differ in what they DO, not only in what they say (#214, 034
 * FR-045/FR-046a).
 *
 * `fixtures/alt-echo.mjs` opened with eight lines explaining that it is "a full-screen program that
 * does NOT negotiate anything", called that "the case that matters, and the one the kitty variant
 * hides" — and then, on line 19, wrote `\x1b[>1u`, the kitty push. Stripped of comments it was
 * byte-for-byte `fixtures/kitty-alt-echo.mjs`. The spec that used it
 * (`terminal-kitty-editing-keys.e2e.ts`, "Ctrl+End survives a tab switch even when the program
 * negotiated nothing") was therefore a duplicate of the test immediately above it, and the case it
 * was named for had never been exercised at all. It passed for months, and passing is exactly the
 * problem: a test that measures the wrong program tells you nothing while reading like coverage.
 *
 * A reviewer cannot catch this, because the two files LOOK different — the difference is entirely in
 * prose. So the check is mechanical, and it runs at the unit layer because it is a fact about source
 * text, not about a terminal.
 *
 * TWO CLAIMS, deliberately separate:
 *
 *   1. No two fixtures are the same program. Comments are removed BEFORE comparing, because the
 *      whole defect was that the comments were the only difference. (This repo has been bitten twice
 *      in one session by a source-scan that matched a commented-out call site.)
 *   2. A fixture that is not named `kitty-*` does not negotiate the kitty keyboard protocol. That is
 *      the naming convention the four fixtures already follow, and encoding it means the next
 *      "negotiates nothing" fixture cannot quietly negotiate.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Point FIXTURE_DIR at a directory holding no `.mjs` files (e.g. change `'../e2e/fixtures'` to
 * `'../e2e'`, which holds only `.ts`). Both tests in this file MUST fail — 2 of 2 — because each one
 * asserts on the SIZE of what it loaded before it asserts on the contents. A "no duplicates found"
 * over an empty set is the exact shape of a test that cannot fail, and this file would be worthless
 * without that floor.
 */

const FIXTURE_DIR = fileURLToPath(new URL('../e2e/fixtures', import.meta.url));

/** The fixtures that exist today. Named so that deleting one is a deliberate edit, not a silent drop. */
const KNOWN = ['kitty-alt-echo.mjs', 'kitty-alt-toggle.mjs', 'kitty-echo.mjs'];

/**
 * A fixture's EXECUTABLE text: comments removed, blank lines dropped, indentation normalised.
 *
 * Block comments first, then line comments. `\r?\n` throughout — these files are CRLF, and a
 * pattern anchored on a bare `\n` silently matches nothing at the end of a line.
 *
 * It does not attempt to understand string literals, and it does not need to: a `//` inside a string
 * would only ever make two files look MORE different, which fails safe for the claim being made.
 */
function executableText(file: string): string {
  return readFileSync(join(FIXTURE_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/** `CSI > <flags> u` and `CSI = <flags> ; <mode> u` — the two ways a program turns kitty on. */
function negotiatesKitty(file: string): boolean {
  const code = executableText(file);
  // Matched against the SOURCE ESCAPE `\x1b`, six characters, not a control byte: these fixtures
  // write the sequence as an escape in a string literal, and a literal control byte here would be
  // invisible in review and would make git treat this file as binary.
  return /\\x1b\[[>=][0-9;]*u/.test(code);
}

const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.mjs'));

describe('E2E keyboard fixtures are distinct programs (#214)', () => {
  it('no two fixtures are the same program once their comments are removed', () => {
    /*
     * The floor first. Without it this test passes on an empty directory, which is precisely the
     * vacuity the control above exists to demonstrate.
     */
    expect(
      fixtures.length,
      `no .mjs fixtures were found under ${FIXTURE_DIR} — this test would pass vacuously`,
    ).toBeGreaterThanOrEqual(3);
    for (const name of KNOWN) {
      expect(fixtures, `${name} has gone missing from the fixture set`).toContain(name);
    }

    const byCode = new Map<string, string[]>();
    for (const f of fixtures) {
      const code = executableText(f);
      byCode.set(code, [...(byCode.get(code) ?? []), f]);
    }
    const duplicates = [...byCode.values()].filter((names) => names.length > 1);

    expect(
      duplicates,
      `These E2E fixtures are the SAME PROGRAM and differ only in their comments, so every spec ` +
        `that distinguishes them is asserting on a difference that does not exist (#214):\n` +
        duplicates.map((names) => `  ${names.join(' === ')}`).join('\n'),
    ).toEqual([]);
  });

  it('only a kitty-* fixture negotiates the kitty keyboard protocol', () => {
    expect(
      fixtures.length,
      `no .mjs fixtures were found under ${FIXTURE_DIR} — this test would pass vacuously`,
    ).toBeGreaterThanOrEqual(3);
    /*
     * The convention has to be shown to BITE in both directions, or "no non-kitty fixture
     * negotiates" is satisfied by a fixture set in which nothing negotiates at all.
     */
    const negotiating = fixtures.filter(negotiatesKitty);
    expect(
      negotiating,
      'not one fixture negotiates the kitty protocol, so the check below cannot fail',
    ).not.toEqual([]);

    const misnamed = negotiating.filter((f) => !f.startsWith('kitty-'));
    expect(
      misnamed,
      `These fixtures push the kitty keyboard protocol but are not named kitty-*. A fixture whose ` +
        `name (and header) says it negotiates nothing, while its code negotiates, makes the spec ` +
        `using it a duplicate of the kitty spec next to it — which is what #214 was:\n` +
        misnamed.map((f) => `  ${f}`).join('\n'),
    ).toEqual([]);
  });
});
