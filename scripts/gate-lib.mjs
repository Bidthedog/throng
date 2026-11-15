// The `npm run` arguments for one gate stage, kept apart from gate.mjs so they can be tested without running a gate.

/** The vitest stages, whose skips the macOS gate reports by reason (070 T072, FR-038, SC-002). */
const VITEST_STAGES = ['unit', 'component', 'integration', 'contract'];

/** Beside the default reporter: lists every skip by its platform guard's reason and fails on a skip that gives none. */
export const SKIP_REASONS_REPORTER = './packages/platform/tests/support/skip-reasons.reporter.ts';

/**
 * The arguments to `npm` for one stage.
 *
 * Only on macOS do the vitest stages gain the skip-reasons reporter; on Windows and Linux every stage's command is
 * exactly what it was before 070 (FR-039). The E2E stage takes the lane's grep when one is set (062 FR-046).
 *
 * @param {{name: string, script: string}} stage
 * @param {{platform: string, e2eGrep?: string}} on
 * @returns {string[]}
 */
export function stageArgs(stage, { platform, e2eGrep }) {
  if (stage.name === 'e2e' && e2eGrep) return ['run', stage.script, '--', '--grep', `"${e2eGrep}"`];
  if (platform === 'darwin' && VITEST_STAGES.includes(stage.name)) {
    return ['run', stage.script, '--', '--reporter=default', `--reporter=${SKIP_REASONS_REPORTER}`];
  }
  return ['run', stage.script];
}
