/**
 * When release.yml may take a gate's E2E verdict instead of running the suite again (065 FR-014): only
 * a full gate, green at its first attempt, on exactly the tree being released.
 */
import { describe, expect, it } from 'vitest';
import { findReusableGate } from '../../../../scripts/release-e2e-reuse.mjs';

const run = (head_sha: string, over: Record<string, unknown> = {}) => ({
  head_sha,
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  event: 'workflow_dispatch',
  display_title: 'gate (full gate)',
  html_url: `https://example.test/${head_sha}`,
  ...over,
});

const trees: Record<string, string> = { a: 'T1', b: 'T2', c: 'T1' };
const treeOf = async (sha: string) => trees[sha] as string;

describe('reusing a gate verdict', () => {
  it('takes a full green gate on the same tree, whatever the commit', async () => {
    await expect(findReusableGate([run('b'), run('c')], treeOf, 'T1')).resolves.toMatchObject({ head_sha: 'c' });
  });

  it('finds nothing for a different tree', async () => {
    await expect(findReusableGate([run('b')], treeOf, 'T1')).resolves.toBeUndefined();
  });

  it.each([
    ['a partial gate', { display_title: 'gate (test:unit)' }],
    ['a stress run', { display_title: 'gate (stress)' }],
    ['a red gate', { conclusion: 'failure' }],
    ['an unfinished gate', { status: 'in_progress', conclusion: null }],
    ['a re-run into green', { run_attempt: 2 }],
    ['a run from any other event', { event: 'pull_request' }],
  ])('refuses %s', async (_name, over) => {
    await expect(findReusableGate([run('a', over)], treeOf, 'T1')).resolves.toBeUndefined();
  });

  it('asks for each commit tree only once', async () => {
    let asked = 0;
    const counted = async (sha: string) => {
      asked += 1;
      return trees[sha] as string;
    };
    await findReusableGate([run('b'), run('b'), run('b')], counted, 'T1');
    expect(asked).toBe(1);
  });
});
