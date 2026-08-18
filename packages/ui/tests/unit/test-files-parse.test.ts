import { readdirSync, readFileSync, statSync } from 'node:fs';
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

  it('parses each one, so a broken spec fails here and not inside an E2E run', () => {
    const broken: string[] = [];

    for (const file of files) {
      try {
        transformSync(readFileSync(file, 'utf8'), {
          // `loader` from the extension: a `.tsx` parsed as `ts` reports every JSX tag as an error.
          loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
          // Parse only. esbuild still reports duplicate declarations, unbalanced braces, and
          // anything else that stops the file being loaded — which is the whole subject here.
          format: 'esm',
          target: 'es2022',
        });
      } catch (e) {
        broken.push(`${relative(testsRoot, file)}: ${(e as Error).message.split('\n')[0]}`);
      }
    }

    expect(broken, `these test files do not parse:\n  ${broken.join('\n  ')}`).toEqual([]);
  });
});
