/**
 * 072 FR-015, FR-019: the full pipeline splits the Windows E2E suite across runners, and an agent-started run stops at
 * the first failing test.
 *
 * Layer: unit. `e2eTierArgs` is the pure part of `scripts/run-e2e-local.mjs`: which Playwright arguments each tier
 * gets. A shard is a separate machine, so the serial tier stays one worker inside it; sharding splits each tier's
 * files, it never merges the tiers (research R4).
 */
import { describe, expect, it } from 'vitest';
import { e2eTierArgs, tierJsonOut } from '../../../../scripts/run-e2e-local.mjs';

describe('tierJsonOut', () => {
  // Each tier is its own Playwright process; one shared THRONG_E2E_JSON_OUT would leave only the serial tier's report,
  // and the nightly report would never see a parallel-tier failure (072 FR-021).
  it('gives each tier its own JSON report beside the requested one', () => {
    expect(tierJsonOut('e2e-results/e2e-report-linux-1.json', 'parallel')).toBe(
      'e2e-results/e2e-report-linux-1.parallel.json',
    );
    expect(tierJsonOut('e2e-results/e2e-report-linux-1.json', 'serial')).toBe(
      'e2e-results/e2e-report-linux-1.serial.json',
    );
    expect(tierJsonOut('report', 'serial')).toBe('report.serial.json');
  });

  it('asks for no report when none was requested', () => {
    expect(tierJsonOut(undefined, 'parallel')).toBeUndefined();
    expect(tierJsonOut('', 'parallel')).toBeUndefined();
  });
});

describe('e2eTierArgs', () => {
  it('runs the parallel tier at the requested workers and the serial tier at one, unsharded by default', () => {
    expect(e2eTierArgs({ tier: 'parallel', workers: '6' })).toEqual(['--workers=6']);
    expect(e2eTierArgs({ tier: 'serial', workers: '1' })).toEqual(['--workers=1']);
  });

  it('gives BOTH tiers the same shard, so each runner takes its share of each', () => {
    expect(e2eTierArgs({ tier: 'parallel', workers: '2', shard: '3/4' })).toEqual(['--workers=2', '--shard=3/4']);
    expect(e2eTierArgs({ tier: 'serial', workers: '1', shard: '3/4' })).toEqual(['--workers=1', '--shard=3/4']);
  });

  it('stops each tier at its first failing test when fail-fast', () => {
    expect(e2eTierArgs({ tier: 'serial', workers: '1', shard: '1/2', failFast: true })).toEqual([
      '--workers=1',
      '--shard=1/2',
      '--max-failures=1',
    ]);
  });

  it('rejects a shard that is not i/N with 1 <= i <= N', () => {
    for (const bad of ['0/4', '5/4', '2', 'a/b', '1/0']) {
      expect(() => e2eTierArgs({ tier: 'parallel', workers: '2', shard: bad }), bad).toThrow(/shard/i);
    }
  });
});
