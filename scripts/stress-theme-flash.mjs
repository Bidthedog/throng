#!/usr/bin/env node
/**
 * Stress one spec and COUNT, for issue #286 (theme-flash sub-workspace window race).
 *
 * ══ WHY A SCRIPT AND NOT A HAND-RUN LOOP ══
 *
 * #286's acceptance criteria ask for two things a single run cannot give:
 *
 *   1. the mechanism reproduced ON DEMAND, rather than inferred from timings;
 *   2. the test surviving the number of consecutive runs it took to OBSERVE the failure.
 *
 * Both are counts, and a count is the one thing "run it again and see" reliably gets wrong. A flake
 * that fails one run in four passes three times in a row for free, so a fix declared on a green run
 * has learned nothing. This runs N times, with RETRIES OFF, and prints pass/fail — the before and
 * after numbers that make a fix distinguishable from a coincidence.
 *
 * Retries are off deliberately: they exist to capture diagnostics and they mask exactly the
 * transition being measured. A flake that "passed on attempt 2" is a failure for this purpose.
 *
 * ══ USAGE ══
 *
 *   node scripts/stress-theme-flash.mjs                 # 5 runs of the spec in isolation
 *   node scripts/stress-theme-flash.mjs --runs 10
 *   node scripts/stress-theme-flash.mjs --serial        # the whole serial tier, N times
 *
 * ══ THE CAVEAT THAT MATTERS, AND IT IS NOT A FOOTNOTE ══
 *
 * #286 has NEVER failed in isolation — 12/12 clean at both 1 and 6 workers. So the default mode
 * here CANNOT reproduce it, and a green 10/10 from it proves nothing about the race. It is useful
 * only as the "after" half of a before/after pair for a change that might have made things worse,
 * and as a fast check that the spec still passes at all.
 *
 * `--serial` is the mode that can actually observe it, because the failure needs a long run's worth
 * of accumulated teardown to widen the gap it lands in. That costs ~16 minutes per iteration and
 * saturates every core, so it needs the machine to itself.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf('--runs') + 1]) || 5;
const serial = args.includes('--serial');

const spec = 'theme-flash';
const cmd = serial
  ? ['playwright', 'test', '--workers=1', '--retries=0', '--grep', '@extended']
  : ['playwright', 'test', spec, '--workers=1', '--retries=0'];

console.log(
  `#286 stress: ${runs} consecutive run(s), retries OFF, ${
    serial ? 'FULL SERIAL TIER (~16 min each — needs the machine to itself)' : `spec "${spec}" in isolation`
  }`,
);
if (!serial) {
  console.log(
    '  NOTE: this spec has never failed in isolation. A green result here is NOT evidence the race is fixed.',
  );
}

let pass = 0;
let fail = 0;
const durations = [];

for (let i = 1; i <= runs; i++) {
  const started = process.hrtime.bigint();
  const r = spawnSync('npx', cmd, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  const secs = Number(process.hrtime.bigint() - started) / 1e9;
  durations.push(secs);
  if (r.status === 0) pass++;
  else fail++;
  console.log(`  run ${i}/${runs}: ${r.status === 0 ? 'pass' : 'FAIL'} in ${secs.toFixed(1)}s`);
}

/*
 * The DURATIONS are reported, not just the verdicts, because they are what identified this as a
 * race rather than a budget in the first place: 33.0s failing against 3.4s passing on retry, in the
 * same process seconds apart. A saturated machine does not produce a tenfold gap between two
 * consecutive attempts. If a failure here runs to the full timeout while its neighbours finish in
 * seconds, that is the same signature.
 */
console.log(`\n#286 stress result: ${pass} passed / ${fail} failed of ${runs}`);
console.log(`  durations: ${durations.map((d) => `${d.toFixed(1)}s`).join(', ')}`);
process.exit(fail > 0 ? 1 : 0);
