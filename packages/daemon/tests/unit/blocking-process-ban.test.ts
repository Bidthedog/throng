import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * 051 FR-020 / SC-006 — a synchronous process call or a thread-blocking wait in the daemon or the
 * platform layer fails the build. Every one of them stops every terminal at once; #468 was four.
 *
 * Proven through ESLint's own API against the repository's config, so what is asserted is the rule
 * the build actually runs — not a copy of it.
 */
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const eslint = new ESLint({ cwd: root });

async function errorsFor(text: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(text, { filePath });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? m.message);
}

const BLOCKING = {
  'a named synchronous import': "import { execFileSync } from 'node:child_process';\nexecFileSync('x');\n",
  'a member call on the module': "import * as cp from 'node:child_process';\ncp.spawnSync('x');\n",
  'a busy-wait': 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);\n',
};

describe('051 FR-020 — blocking process calls fail the build where the daemon runs', () => {
  for (const dir of ['packages/daemon/src', 'packages/platform-windows/src']) {
    for (const [what, text] of Object.entries(BLOCKING)) {
      it(`${dir}: ${what} is an error`, async () => {
        const errors = await errorsFor(text, `${root}${dir}/probe.ts`);
        expect(errors.some((r) => r === 'no-restricted-imports' || r === 'no-restricted-syntax')).toBe(true);
      });
    }
  }

  it('the UI is not covered: its main process may block briefly, and a renderer cannot spawn at all', async () => {
    const errors = await errorsFor(BLOCKING['a named synchronous import'], `${root}packages/ui/src/main/probe.ts`);
    expect(errors).not.toContain('no-restricted-imports');
  });
}, 60_000);
