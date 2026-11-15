import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS gate script, imported for its pure decision.
import { SKIP_REASONS_REPORTER, stageArgs } from '../../../../scripts/gate-lib.mjs';

/**
 * 070 T072, FR-038, SC-002, FR-039 — the macOS gate lists every skipped test by its platform guard's reason and fails a
 * skip that gives none, through the skip-reasons reporter on its vitest stages. Windows and Linux run exactly the
 * commands they ran before.
 *
 * Layer: unit — the arguments gate.mjs hands to npm, decided without running a stage.
 */

const STAGES = ['lint', 'typecheck', 'build', 'unit', 'component', 'integration', 'contract', 'e2e'].map((name) => ({
  name,
  script: ['lint', 'typecheck', 'build'].includes(name) ? name : `test:${name}`,
}));
const REPORTERS = ['--', '--reporter=default', `--reporter=${SKIP_REASONS_REPORTER}`];

describe('the npm arguments for each gate stage', () => {
  it.each(['win32', 'linux'])('leaves every %s stage as it was', (platform) => {
    for (const stage of STAGES) expect(stageArgs(stage, { platform })).toEqual(['run', stage.script]);
    expect(stageArgs(STAGES[7], { platform, e2eGrep: '@core|@linux' })).toEqual(['run', 'test:e2e', '--', '--grep', '"@core|@linux"']);
  });

  it('adds the skip-reasons reporter beside the default one to the four vitest stages on macOS, and to nothing else', () => {
    for (const stage of STAGES) {
      const vitest = ['unit', 'component', 'integration', 'contract'].includes(stage.name);
      expect(stageArgs(stage, { platform: 'darwin' })).toEqual(vitest ? ['run', stage.script, ...REPORTERS] : ['run', stage.script]);
    }
  });

  it('names the reporter the macOS CI jobs name', () => {
    expect(SKIP_REASONS_REPORTER).toBe('./packages/platform/tests/support/skip-reasons.reporter.ts');
  });
});
