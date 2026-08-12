import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

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
      const { code, output } = compile('explicit-none', WITH_EXPLICIT_NONE);
      expect(
        code,
        'the control fixture does not compile, so the test above proves nothing. ' +
          'If this is a fresh tree, run `npm run build` first — the renderer resolves ' +
          '@throng/core through packages/core/dist.\n' +
          output,
      ).toBe(0);
    },
    180_000,
  );
});
