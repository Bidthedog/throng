import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 030 FR-057 / SC-013 — A NOTICE THAT STATES NO SUBJECT MUST NOT COMPILE.
 *
 * ══ WHY THIS SPAWNS A COMPILER, WHICH NO OTHER GUARD HERE DOES ══
 *
 * The obvious way to write this is a `@ts-expect-error` over a bad call. In THIS repository that
 * suppression is inert, and measurably so: `packages/ui/tsconfig.json` includes only `src/main` and
 * `src/preload`, `packages/ui/tsconfig.renderer.json` only `src/renderer`, and the root config
 * `files: []` + references. No configuration anywhere includes `tests/`, so `tsc -b` and
 * `typecheck:renderer` never see a test file — and a `@ts-expect-error` that had STOPPED suppressing
 * anything (which is the whole failure this guard exists to catch) would be reported by nobody.
 * The comment would sit there looking like a guard for as long as anyone cared to read it.
 *
 * So the mechanism has to be a compiler that actually runs over a file that actually claims the
 * type. It costs a `tsc` invocation per run; FR-057 asks for enforcement rather than for a
 * convention, and enforcement that cannot fail is not enforcement.
 *
 * ══ THE CONTROL IS NOT OPTIONAL ══
 *
 * "tsc exited non-zero" is satisfied by a broken fixture, an unresolved import, a missing
 * `dist/index.d.ts` — by anything at all. The second test compiles the SAME fixture with a subject
 * added and requires a clean exit, so a red first test means "the type does not require a subject"
 * and can mean nothing else.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** Inside `packages/ui/tests/` so `react`, `@throng/core` and `@types/*` resolve the way they do for
 *  the real renderer sources — module resolution walks up from the file, and nowhere else. */
const GUARD = join(HERE, '..', '.tsc-notice-guard');
const TSC = fileURLToPath(new URL('../../../../node_modules/typescript/bin/tsc', import.meta.url));

afterAll(() => rmSync(GUARD, { recursive: true, force: true }));

/** The workspace root, four levels up from `packages/ui/tests/unit/`. */
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Bring `@throng/core`'s BUILD up to date before compiling anything.
 *
 * ══ WHY A UNIT TEST BUILDS A PACKAGE ══
 *
 * The fixtures below import the renderer's `notification.js`, and tsc follows that graph into
 * `config-store.tsx` and `write-config.ts`, both of which import from `@throng/core` — which the
 * renderer's tsconfig resolves through **`packages/core/dist`**, not through its source.
 *
 * So this guard's result depended on a build artifact it neither produced nor checked, and the
 * failure mode was the worst kind: the CONTROL case goes red, the message blames a "fresh tree", and
 * the real cause is anything at all that left `dist` behind `src` — a rebase, a branch switch, an
 * interrupted build, another session's `tsc -b`. Reported symptom: *"returns different errors every
 * time I run it"*, which is exactly right, because the errors are whatever that stale barrel happens
 * to be missing.
 *
 * Reproduced deliberately before this was written: deleting `applyConfigPatch` and `ConfigChange`
 * from the built barrel fails the control with two `TS2305`s and nothing else changed; restoring it
 * passes. That is the whole mechanism.
 *
 * ══ WHY BUILD RATHER THAN DETECT ══
 *
 * A staleness CHECK still ends in "…so this test cannot run", which is a red bar for something the
 * test could simply have fixed. A test that establishes its own precondition is worth a few seconds;
 * one that fails on somebody else's build state is worth less than nothing, because it teaches
 * people to disbelieve it.
 *
 * ══ WHY INCREMENTAL FIRST AND FORCED ONLY ON FAILURE ══
 *
 * Measured here, on this tree: `tsc -b` when `dist` is already current costs **1079 ms**, and
 * `--force` costs **3284 ms**. The incremental build is what fixes the real staleness mode — `src`
 * newer than `dist`, after a rebase or a branch switch — because `tsbuildinfo` sees the inputs move.
 *
 * It does NOT fix a `dist` that is wrong while `src` is untouched, and that was learnt the hard way:
 * the first version of this fix was verified by hand-editing the built barrel, `tsc -b` decided the
 * project was up to date, nothing was rebuilt, and the "fix" failed its own verification while
 * leaving the tree broken. So the control below force-rebuilds and retries ONCE before it is allowed
 * to fail. The common path stays at ~1 s and the pathological path repairs itself, which means the
 * message that reaches a developer is only ever about a real type error.
 */
function buildCore(force: boolean): void {
  const args = [TSC, '-b', join(REPO, 'packages', 'core')];
  if (force) args.push('--force');
  try {
    execFileSync(process.execPath, args, { encoding: 'utf8', stdio: 'pipe', cwd: REPO });
  } catch {
    // A core that will not build is its own failure and `typecheck` reports it far more clearly than
    // this guard could. Let the fixtures below run and say what tsc actually found.
  }
}

beforeAll(() => buildCore(false), 180_000);

/**
 * Compile one fixture on its own, and report what tsc said.
 *
 * `include` is overridden to the fixture alone: tsc follows its imports and typechecks
 * `notification.tsx` and everything under it anyway, so compiling the whole renderer as well would
 * only add seconds and let an unrelated renderer error redden this guard.
 */
function compile(name: string, source: string): { code: number; output: string } {
  const dir = join(GUARD, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fixture.ts'), source, 'utf8');
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      extends: '../../../tsconfig.renderer.json',
      compilerOptions: { noEmit: true, composite: false, incremental: false },
      // The fixture, plus the renderer's ambient globals: `window.throng` is declared in
      // `global.d.ts`, and without it every bridge call in the graph tsc walks reports TS2339 —
      // seven failures that have nothing to do with what is being measured.
      include: ['fixture.ts', '../../../src/renderer/global.d.ts'],
    }),
    'utf8',
  );
  try {
    execFileSync(process.execPath, [TSC, '-p', dir], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, output: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** A raise with everything a notice needs EXCEPT the one thing #195 is about. */
const WITHOUT_SUBJECT = `
import type { NoticeInput } from '../../../src/renderer/common/notification.js';

export const raise: NoticeInput = {
  severity: 'error',
  message: 'Something went wrong.',
};
`;

/** The same raise, stating that no subject is available — FR-019's deliberate, visible escape. */
const WITH_EXPLICIT_NONE = `
import type { NoticeInput } from '../../../src/renderer/common/notification.js';

export const raise: NoticeInput = {
  severity: 'error',
  message: 'Something went wrong.',
  subject: { kind: 'none' },
};
`;

describe('FR-057 — the type system rejects a notice that names nothing', () => {
  it(
    'a raise with no subject at all fails to compile, naming the property',
    () => {
      const { code, output } = compile('missing', WITHOUT_SUBJECT);
      expect(code, `tsc accepted a notice with no subject:\n${output}`).not.toBe(0);
      // The EXACT diagnostic, not merely the word: an unresolved import or a broken fixture also
      // mentions "subject" (the fixture's own path does), and a guard satisfied by any failure at
      // all is a guard that would stay green after the requirement was deleted.
      expect(
        output,
        'tsc failed, but not because of the missing subject — this guard is measuring something else',
      ).toMatch(/Property 'subject' is missing/);
    },
    180_000,
  );

  it(
    'the SAME raise compiles cleanly once it says { kind: "none" }',
    () => {
      let { code, output } = compile('explicit-none', WITH_EXPLICIT_NONE);

      /*
       * One forced rebuild before believing a red. See the header: a `dist` that is wrong while
       * `src` is untouched is invisible to `tsc -b`, and that state produces `TS2305`s about members
       * the source plainly exports — which reads as a broken requirement and is nothing of the kind.
       */
      if (code !== 0) {
        buildCore(true);
        ({ code, output } = compile('explicit-none-after-rebuild', WITH_EXPLICIT_NONE));
      }

      expect(
        code,
        'the control fixture does not compile, so the test above proves nothing. ' +
          'This is NOT a stale `packages/core/dist`: it was rebuilt, forcibly, and the fixture ' +
          'was compiled again. These diagnostics are real:\n' +
          output,
      ).toBe(0);
    },
    180_000,
  );
});
