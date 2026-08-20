import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * Every test file in this package PARSES (034 FR-045's harness half).
 *
 * ══ THE HOLE THIS CLOSES, WHICH WAS FOUND THE EXPENSIVE WAY ══
 *
 * Nothing in this repository typechecks a test file. `packages/ui/tsconfig.json` compiles only
 * `src/main` and `src/preload`; the renderer goes through Vite; and both Vitest and Playwright
 * transpile with esbuild, which STRIPS types without checking them. So a test file's only gate was
 * the runner that executes it.
 *
 * That let four E2E specs be committed carrying a duplicated `const` declaration — a hard syntax
 * error, not a subtle type one — while `npm run lint` AND `npm run typecheck` both reported green.
 * The failure surfaced inside a Playwright run, which is the single worst place in this repo to
 * learn that a file does not parse: the E2E stage is the most expensive thing here, it is the LAST
 * stage of the gate, and a spec that cannot be loaded fails in a way that reads as a harness fault
 * rather than a typo.
 *
 * ══ WHY PARSING AND NOT TYPECHECKING ══
 *
 * Typechecking the test tree today reports ~133 real type errors plus a pile of project-reference
 * plumbing — a worthwhile job, and far too large to hide inside this spec. Parsing is the part that
 * costs nothing and catches the whole class of failure that actually escaped: a file that cannot be
 * loaded at all. It runs in the `unit` project, which is stage four of eight, so a broken spec now
 * fails in seconds rather than a suite later.
 *
 * A type error still slips through. That is a known, stated gap rather than an assumed one, and the
 * follow-up is a `tsconfig.tests.json` wired into `npm run typecheck` once those errors are cleared.
 *
 * ══ ANTI-VACUITY ══
 *
 * `files` is asserted non-empty before anything is parsed. Without that, a wrong directory or a
 * changed extension would walk zero files and report a confident, meaningless green — which is the
 * exact shape of the four vacuous tests this branch has already had to repair.
 */

const here = dirname(fileURLToPath(import.meta.url));
const testsRoot = join(here, '..');

/** Every `.ts`/`.tsx` under `packages/ui/tests`, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...walk(p));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

describe('every test file parses', () => {
  const files = walk(testsRoot);

  it('finds test files to check at all', () => {
    // The control. A zero-length list would make every assertion below vacuously true.
    expect(files.length, `no .ts/.tsx files found under ${testsRoot}`).toBeGreaterThan(200);
  });

  /**
   * Read a file, retrying briefly on a transient I/O error.
   *
   * ══ WHY THIS IS NOT BELT-AND-BRACES ══
   *
   * This guard walks a directory that the working tree is actively editing, and on Windows a file
   * that has just been written can still be held for a moment — `readFileSync` then throws `EBUSY`
   * or `EPERM`. The first version caught THAT in the same `catch` as a syntax error and reported it
   * as *"these test files do not parse"*, which sends the next reader hunting for a typo in a file
   * that is fine.
   *
   * Observed once, in a full 350-file run, immediately after a spec had been rewritten; not
   * reproduced in six subsequent full runs nor in isolation. The mechanism is a hypothesis and is
   * labelled one — but the MISREPORT is not: a read error announced as a parse error is wrong
   * whatever caused it, and that is what this separates.
   */
  const readWithRetry = (file: string): string => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return readFileSync(file, 'utf8');
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        // ENOENT is NOT retried: a file that is not there is not a file that is busy, and retrying
        // it would turn a deleted-mid-walk race into three seconds of waiting for nothing.
        if (attempt >= 5 || (code !== 'EBUSY' && code !== 'EPERM')) throw e;
        // Synchronous, because this test is synchronous and a sleep here is cheaper than making the
        // whole walk async for a path that almost never runs.
        const until = Date.now() + 20;
        while (Date.now() < until) {
          /* spin */
        }
      }
    }
  };

  it('parses each one, so a broken spec fails here and not inside an E2E run', () => {
    const broken: string[] = [];
    const unreadable: string[] = [];

    for (const file of files) {
      let source: string;
      try {
        source = readWithRetry(file);
      } catch (e) {
        /*
         * ══ A FILE THAT IS GONE IS NOT A FAILURE ══
         *
         * `walk()` lists the tree when this describe is COLLECTED; the reads happen afterwards. A
         * file created and removed inside that window — a scratch fixture, a scripted edit, an
         * editor's temp file — is listed and then missing, and `ENOENT` is deliberately not retried
         * above because a file that is gone is not a file that is busy.
         *
         * Reporting it at all was the mistake. It is not a spec that fails to parse, and it is not
         * an I/O problem the suite should go red over: there is nothing left to check. Skipped, and
         * the check is `existsSync` rather than the errno so a rename mid-walk lands here too.
         */
        if (!existsSync(file)) continue;
        // Reported SEPARATELY. "I could not read this" and "this does not parse" are different
        // facts, and only the second is a broken spec.
        unreadable.push(`${relative(testsRoot, file)}: ${(e as Error).message.split('\n')[0]}`);
        continue;
      }
      const parse = (text: string): string | null => {
        try {
          transformSync(text, {
            // `loader` from the extension: a `.tsx` parsed as `ts` reports every JSX tag as an error.
            loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
            // Parse only. esbuild still reports duplicate declarations, unbalanced braces, and
            // anything else that stops the file being loaded — which is the whole subject here.
            format: 'esm',
            target: 'es2022',
          });
          return null;
        } catch (e) {
          return (e as Error).message.split('\n')[0];
        }
      };

      /*
       * ══ A FAILURE IS RE-READ BEFORE IT IS BELIEVED ══
       *
       * This guard walks a directory the working tree is actively editing, and a file caught
       * MID-WRITE is returned as a truncated prefix — `readFileSync` does not throw, it succeeds and
       * hands back less than the file. esbuild then correctly reports that the truncated text does
       * not parse, and the guard accuses a file that is perfectly fine.
       *
       * Observed three times in one session, and every one of them in the run immediately after a
       * command had rewritten spec files. Never reproduced afterwards, in seven clean full runs or
       * in isolation — which is exactly the shape a torn read has.
       *
       * So a first failure is treated as a QUESTION rather than an answer: read the file again and
       * parse again. A real syntax error fails both times and is reported; a torn read parses on the
       * second pass and is not. The cost falls entirely on the failure path.
       *
       * The earlier EBUSY/EPERM retry above covers the other half — where the read THROWS instead of
       * lying — and neither replaces the other.
       */
      const firstError = parse(source);
      if (firstError !== null) {
        /*
         * ══ THE FAILURE REPORTS ITS OWN DIAGNOSIS ══
         *
         * This guard failed four times across one session's full `unit`+`component` runs and passed
         * every time it was run alone or captured — so the filename was never once observed. Chasing
         * it further costs more than making the next red answer the question.
         *
         * The two lengths are the whole diagnosis. If the second read is LONGER, the first was torn
         * (the file was mid-write) and the accusation is spurious — which the re-read below then
         * withdraws. If they are equal, the file really does not parse and the message says so
         * without ambiguity.
         */
        const second = readWithRetry(file);
        const secondError = parse(second);
        if (secondError !== null) {
          const sizes =
            second.length === source.length
              ? `${second.length} bytes, identical on re-read`
              : `${source.length} bytes first, ${second.length} on re-read — A TORN READ, and this ` +
                'accusation is spurious';
          broken.push(`${relative(testsRoot, file)}: ${secondError} [${sizes}]`);
        }
      }
    }

    expect(broken, `these test files do not parse:\n  ${broken.join('\n  ')}`).toEqual([]);
    expect(
      unreadable,
      `these test files could not be READ — an I/O problem, not a syntax one:\n  ${unreadable.join('\n  ')}`,
    ).toEqual([]);
    /*
     * ══ WHY THIS TEST DECLARES A TIMEOUT, AND WHERE THE NUMBER COMES FROM ══
     *
     * It reads and parses EVERY test file in the repository, so its cost grows with the suite it
     * guards — and it ran on vitest's 5 s default until that stopped being enough. Measured on
     * 2026-08-19, at 356 test files:
     *
     *   isolated          790 ms, 834 ms
     *   under full load   4103 ms, 4331 ms, 4103 ms   (unit + component, all workers)
     *
     * So the default left roughly 15% headroom over the loaded worst case, and adding six test
     * files in one session was enough to tip it — the failure was a TIMEOUT at 5885 ms, reported as
     * a red on the file it guards rather than as a budget problem, which is exactly the misreport
     * the read/parse separation above exists to prevent, one level up.
     *
     * 20 s is ~4.6x the measured worst case: room for a slower machine and for the suite to keep
     * growing, without being so loose that a genuine hang looks like a slow run.
     *
     * This number is expected to need raising again. When it does, re-measure rather than doubling
     * it — a budget nobody has measured is the thing this file has already been bitten by twice.
     */
  }, 20_000);
});
