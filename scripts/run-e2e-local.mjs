/**
 * The local E2E run: two passes, arranged for the shortest wall-clock on ONE machine.
 *
 *   1. the PARALLEL tier, at several workers
 *   2. the SERIAL tier, at one worker
 *
 * This is deliberately NOT how CI is arranged. Focus contention is per-DESKTOP: throng closes menus
 * and popups when its window loses focus (context-menu.tsx), and the preferences window is a child
 * window that takes focus. So workers are the lever within a machine — and since spec 034 removed
 * the split across machines (FR-057), it is the only lever there is. CI runs one job at one worker;
 * a developer has one machine and wants the two tiers back to back.
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
import { isMain } from './is-main.mjs';

/** Leave a couple of cores for the OS and the daemons each app spawns. */
const WORKERS = process.env.THRONG_E2E_WORKERS ?? String(Math.max(2, Math.min(6, cpus().length - 2)));

function play(args, extraEnv = {}) {
  const r = spawnSync('npx', ['playwright', 'test', ...args], {
    stdio: 'inherit',
    // Windows needs a shell to run npx.cmd. Elsewhere a shell would re-read the arguments, and the `|` in the gate's
    // `--grep @core|@linux` would become a pipe to a command that does not exist (062 FR-046).
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  return r.status ?? 1;
}

/**
 * The Playwright arguments one tier gets (072 FR-015, FR-019).
 *
 * `shard` (`i/N`, from THRONG_E2E_SHARD) splits EACH tier's files across N runners, so a runner takes its share of the
 * parallel tier and then its share of the serial tier. A runner is its own machine, so the serial tier stays one worker
 * inside it; sharding never merges the tiers. `failFast` stops the tier at its first failing test.
 */
export function e2eTierArgs({ workers, shard, failFast = false }) {
  const args = [`--workers=${workers}`];
  if (shard !== undefined) {
    const m = /^(\d+)\/(\d+)$/.exec(shard);
    const [i, n] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
    if (!m || n < 1 || i < 1 || i > n) throw new Error(`THRONG_E2E_SHARD must be i/N with 1 <= i <= N, got "${shard}"`);
    args.push(`--shard=${i}/${n}`);
  }
  if (failFast) args.push('--max-failures=1');
  return args;
}

/**
 * Where one tier writes its Playwright JSON report. Each tier is its own Playwright process, so a shared
 * THRONG_E2E_JSON_OUT would keep only the serial tier's report: `e2e-report.json` becomes `e2e-report.parallel.json` and
 * `e2e-report.serial.json`. Keep the path outside Playwright's `test-results/`, which every run empties first.
 */
export function tierJsonOut(requested, tier) {
  if (!requested) return undefined;
  return requested.endsWith('.json') ? `${requested.slice(0, -5)}.${tier}.json` : `${requested}.${tier}.json`;
}

/*
 * FAIL-FAST, opt-in via THRONG_E2E_FAIL_FAST (set by `npm run gate` and by every agent-started pipeline run).
 *
 * The default is unchanged — a bare `npm run test:e2e` runs both tiers to completion, because a developer asking for
 * the whole suite wants the whole failure set, not the first item of it. The nightly pipeline wants the same.
 *
 * An agent-started run wants the opposite: a run that already has one confirmed failure cannot come back green, and
 * every test after it is wall-clock spent to learn nothing. So it stops the tier at its first failing test and does not
 * start the next tier at all.
 */
function main() {
  const forwarded = process.argv.slice(2);
  if (forwarded.length > 0) process.exit(play(forwarded));

  const failFast = process.env.THRONG_E2E_FAIL_FAST === '1';
  const shard = process.env.THRONG_E2E_SHARD || undefined;
  const started = Date.now();
  const passes = [
    ['parallel', WORKERS],
    ['serial', '1'],
  ];
  const results = [];
  for (const [tier, workers] of passes) {
    console.log(`\n[e2e] ${tier} tier — ${workers} worker(s)${shard ? ` — shard ${shard}` : ''}${failFast ? ' — fail-fast' : ''}\n`);
    const args = e2eTierArgs({ workers, shard, failFast });
    // The first tier warmed Electron off disk on CI (playwright-global-setup.mjs); one warm-up is enough.
    const jsonOut = tierJsonOut(process.env.THRONG_E2E_JSON_OUT, tier);
    const code = play(args, {
      THRONG_E2E_TIER: tier,
      ...(jsonOut ? { THRONG_E2E_JSON_OUT: jsonOut } : {}),
      ...(results.length > 0 ? { THRONG_E2E_WARM: '1' } : {}),
    });
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
}

// Run only when executed, never on import: a unit test imports this module for e2eTierArgs, and an import that started
// both E2E tiers would run the whole suite on the workstation.
if (isMain(import.meta.url)) main();
