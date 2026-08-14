#!/usr/bin/env node
/**
 * The local E2E run: two passes, arranged for the shortest wall-clock on ONE machine.
 *
 *   1. the PARALLEL tier, at several workers
 *   2. the SERIAL tier, at one worker
 *
 * This is deliberately NOT how CI is arranged. Focus contention is per-DESKTOP: throng closes menus
 * and popups when its window loses focus (context-menu.tsx), and the preferences window is a child
 * window that takes focus. So workers are the lever within a machine, and shards are the lever across
 * machines. CI has three machines and wants three balanced shards (`shard-plan.json`); a developer
 * has one machine and wants the two tiers back to back.
 *
 * MEASURED, not assumed. The whole suite was run at six workers three times with retries off. The
 * serial tier in `parallel-plan.json` is every spec that opens the preferences window — the
 * contention mechanism — plus every spec observed failing. Drawing the line only from observed
 * failures would encode luck, because contention produces a different failure set every run
 * (0, 5, 1, 3, 4 and 6 flaky across six runs when this was first measured).
 *
 * Numbers, for anyone deciding whether this is worth its complexity: 208 spec files, 651 tests, 37
 * files serial and 171 parallel. One worker across three groups took ~35 minutes; six workers takes
 * ~8-11. The serial tail is what stops it being better still, and the only change that removes the
 * constraint rather than working around it is a hidden window (issue #117) — a window that cannot
 * take focus cannot steal it.
 *
 * TWO PROCESSES, not one. A single long-lived Playwright process was measured at 633 passed / 2
 * failed over 33 minutes, where those two failures passed 5/5 alone and 56/56 inside a short run —
 * something accumulates across hundreds of app launches, and a fresh process resets it. Each tier
 * gets its own.
 *
 * Anything passed on the command line is forwarded and turns the split OFF, because the caller has
 * already chosen what to run:
 *   npm run test:e2e -- packages/ui/tests/e2e/explorer.e2e.ts
 *   npm run test:e2e -- --grep "chords"
 */
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';

/** Leave a couple of cores for the OS and the daemons each app spawns. */
const WORKERS = process.env.THRONG_E2E_WORKERS ?? String(Math.max(2, Math.min(6, cpus().length - 2)));

function play(args, extraEnv = {}) {
  const r = spawnSync('npx', ['playwright', 'test', ...args], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  return r.status ?? 1;
}

const forwarded = process.argv.slice(2);
if (forwarded.length > 0) {
  process.exit(play(forwarded));
}

/*
 * FAIL-FAST, opt-in via THRONG_E2E_FAIL_FAST (set by `npm run gate`).
 *
 * The default is unchanged — a bare `npm run test:e2e` runs both tiers to completion,
 * because a developer asking for the whole suite wants the whole failure set, not the
 * first item of it.
 *
 * The gate wants the opposite, and for a reason worth naming: this stage is ~21 minutes,
 * and a run that already has one confirmed failure cannot come back green. Every test
 * after that failure is wall-clock spent to learn nothing. So the gate stops the tier at
 * its first failing test (`--max-failures=1`) and does not start the next tier at all.
 */
const failFast = process.env.THRONG_E2E_FAIL_FAST === '1';

const started = Date.now();
const passes = [
  ['parallel', WORKERS],
  ['serial', '1'],
];
const results = [];
for (const [tier, workers] of passes) {
  console.log(`\n[e2e] ${tier} tier — ${workers} worker(s)${failFast ? ' — fail-fast' : ''}\n`);
  const args = [`--workers=${workers}`];
  if (failFast) args.push('--max-failures=1');
  const code = play(args, { THRONG_E2E_TIER: tier });
  results.push([tier, code]);
  if (failFast && code !== 0) {
    console.error(`\n[e2e] ${tier} tier failed — skipping the remaining tier(s) (fail-fast)\n`);
    break;
  }
}

const mins = ((Date.now() - started) / 60000).toFixed(1);
const failed = results.filter(([, code]) => code !== 0);
if (failed.length > 0) {
  console.error(`\n[e2e] FAILED after ${mins} min — tier(s): ${failed.map(([t]) => t).join(', ')}\n`);
  process.exit(failed[0][1]);
}
console.log(`\n[e2e] both tiers green in ${mins} min\n`);
