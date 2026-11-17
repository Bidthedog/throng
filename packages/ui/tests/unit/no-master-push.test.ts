import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * 072 FR-010: a merge to master starts nothing. The pull request's run on its head commit already tested that tree, and
 * the nightly covers master after it; a workflow that runs on every push to a branch costs a runner for no new answer.
 *
 * Layer: unit. Reads every file in `.github/workflows`.
 */

const WORKFLOWS = join(process.cwd(), '.github', 'workflows');
const files = readdirSync(WORKFLOWS)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, workflow: parse(readFileSync(join(WORKFLOWS, name), 'utf8')) as { on: Record<string, unknown> } }));

describe('no workflow starts on a push to a branch (FR-010)', () => {
  it.each(files.map((f) => [f.name, f] as const))('%s has no push trigger with branches', (_name, { workflow }) => {
    const push = workflow.on.push as { branches?: unknown; 'branches-ignore'?: unknown; paths?: unknown } | null | undefined;
    expect(push?.branches).toBeUndefined();
    expect(push?.['branches-ignore']).toBeUndefined();
    expect(push?.paths).toBeUndefined();
  });

  it('the site deployment is dispatched only', () => {
    const pages = files.find((f) => f.name === 'pages.yml');
    expect(Object.keys(pages?.workflow.on ?? {})).toEqual(['workflow_dispatch']);
  });

  it('the only push trigger left is the release tag', () => {
    const pushers = files.filter((f) => 'push' in f.workflow.on).map((f) => f.name);
    expect(pushers).toEqual(['release.yml']);
  });
});
