import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * A script a TEST imports must not carry a shebang.
 *
 * ══ WHAT THIS COST ══
 *
 * `scripts/e2e-durations.mjs` began `#!/usr/bin/env node`. It is imported by
 * `packages/ui/tests/unit/e2e-durations.test.ts`, which passed locally on every run and **failed on
 * CI** with `SyntaxError: Invalid or unexpected token` — 287 suites green, that one unable to load,
 * and the whole unit job red.
 *
 * The mechanism is Vite's, and it is environment-dependent, which is exactly why a human will not
 * catch it by reading: an imported `.mjs` is either handed to Node — where a shebang is legal and
 * stripped — or **inlined**, with its source wrapped in a function body. `#!` is only valid at the
 * very start of a program, so inside that wrapper it is a hard syntax error. Vite externalised the
 * module on a developer machine and inlined it on the runner. The same file, the same commit, two
 * answers.
 *
 * Demonstrated rather than assumed:
 *
 *   wrapped WITH shebang     -> SyntaxError: Invalid or unexpected token   (CI's exact string)
 *   wrapped WITHOUT shebang  -> parses
 *
 * ══ WHY A GUARD RATHER THAN A NOTE ══
 *
 * Three other scripts carry shebangs quite legitimately — `gate.mjs`, `run-e2e-local.mjs`,
 * `build-app-icons.mjs`. None is imported by a test, so none can hit this. The rule is therefore not
 * "no shebangs in scripts/" but the narrower and checkable one below, and a note in a file nobody
 * re-reads would not have survived the next script.
 *
 * The check runs from the TEST side on purpose: it discovers what the tests actually import rather
 * than trusting a hand-kept list, so a new test importing an existing shebang script is caught too
 * — the direction this defect would have arrived from next.
 */

const TESTS_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** `import ... from '<path>'` / `await import('<path>')`, capturing the specifier. */
const IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]+\.(?:mjs|cjs|js))['"]/g;

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(full));
    else if (/\.(test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith('.e2e.ts')) out.push(full);
  }
  return out;
}

/** Every script under `scripts/` that some test imports, resolved to an absolute path. */
function importedScripts(): { script: string; importedBy: string }[] {
  const found = new Map<string, string>();
  for (const file of testFiles(TESTS_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const resolved = join(file, '..', spec);
      if (!relative(REPO_ROOT, resolved).replace(/\\/g, '/').startsWith('scripts/')) continue;
      if (!found.has(resolved)) found.set(resolved, file);
    }
  }
  return [...found].map(([script, importedBy]) => ({ script, importedBy }));
}

describe('scripts imported by tests', () => {
  const imported = importedScripts();

  it('finds the imports at all, so an empty pass cannot be mistaken for a clean one', () => {
    // Without this the whole guard passes vacuously the moment the regex or the walk breaks — the
    // same failure it exists to prevent, rebuilt inside the thing preventing it.
    expect(
      imported.map((i) => relative(REPO_ROOT, i.script)),
      'no test imports anything under scripts/ — the scanner is broken, or the import moved',
    ).not.toEqual([]);
  });

  it('none of them starts with a shebang', () => {
    const offenders = imported
      .filter(({ script }) => readFileSync(script, 'utf8').startsWith('#!'))
      .map(
        ({ script, importedBy }) =>
          `${relative(REPO_ROOT, script).replace(/\\/g, '/')} (imported by ` +
          `${relative(REPO_ROOT, importedBy).replace(/\\/g, '/')})`,
      );

    expect(
      offenders,
      `A script imported by a test must not begin with "#!". Vite may INLINE it rather than hand ` +
        `it to Node, wrapping the source in a function body where a shebang is a SyntaxError — and ` +
        `it makes that choice per environment, so this passes locally and fails on CI. Delete the ` +
        `line; the scripts here are invoked as "node scripts/<name>.mjs" and Windows ignores ` +
        `shebangs anyway:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
