#!/usr/bin/env node
/**
 * `npm run gate` — the one command that answers "is this done?".
 *
 * It runs every gating job in the same order CI does, stops at the FIRST failure,
 * prints one line per stage, and clears the processes a test run leaves behind
 * however it ends — pass, fail, or Ctrl+C.
 *
 * WHY FAIL-FAST MATTERS HERE, AND NOT ONLY AS TIDINESS
 *
 * The E2E stage costs ~21 minutes locally and ~36 runner-minutes on CI. Every
 * earlier stage costs seconds to a couple of minutes. Running the cheap stages to
 * completion before spending the expensive one is the entire economic argument for
 * this script: a lint error found in 12 seconds is a lint error that did not cost
 * 21 minutes of Electron launches to discover.
 *
 * So the chain breaks the moment a stage fails, and the E2E stage itself breaks at
 * its first failing TEST (THRONG_E2E_FAIL_FAST, honoured by run-e2e-local.mjs)
 * rather than grinding through 651 tests to tell you about the one you already
 * know about. Fix the failure — with the `running-tests` and `throng-testing`
 * skills — and run the gate again.
 *
 * WHY IT DOES NOT USE `npm test`
 *
 * `npm test` (run-tests.mjs) chains unit → integration → contract → e2e, which
 * makes "run everything except E2E" impossible to express and hides lint, typecheck
 * and build entirely. The gate names all seven stages explicitly, so what it
 * verifies is legible from the summary rather than buried in a wrapper.
 *
 * ORPHANS
 *
 * throng's daemon is DESIGNED to outlive its window (Principle III), so a killed or
 * failed E2E run routinely leaves a daemon, a pty-agent, the shells they started,
 * and a conhost per shell. They hold the dev data folder open and poison the next
 * run. Cleanup therefore runs in a `finally` AND on SIGINT/SIGTERM — the paths that
 * matter most, because an interrupted run is exactly when orphans survive.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { ensureRunDir, cleanupRunDir, sweepStaleRunDirs } from './test-run-dir.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

/**
 * The seven gating stages, cheapest first.
 *
 * The order is not arbitrary and is not merely "fast things first": each stage is
 * placed so that a failure it can detect is detected before anything more expensive
 * runs. `build` sits ahead of the test layers because integration and contract
 * spawn real OS processes against `dist/`, and a stale or broken build fails them
 * in a way that reads as a test defect rather than a build one.
 */
const STAGES = [
  { name: 'lint', script: 'lint' },
  { name: 'typecheck', script: 'typecheck' },
  { name: 'build', script: 'build' },
  { name: 'unit', script: 'test:unit' },
  { name: 'integration', script: 'test:integration' },
  { name: 'contract', script: 'test:contract' },
  { name: 'e2e', script: 'test:e2e', env: { THRONG_E2E_FAIL_FAST: '1' } },
];

function fmt(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.round(s - m * 60)).padStart(2, '0')}s`;
}

const PAD = Math.max(...STAGES.map((s) => s.name.length));

function line(mark, name, ms, extra = '') {
  console.log(`[gate] ${mark} ${name.padEnd(PAD)}  ${fmt(ms).padStart(7)}${extra}`);
}

/**
 * Stop what a test run leaves running. Scoped to THIS checkout by command line, so a
 * worktree's gate never kills the main checkout's app — or the user's installed
 * throng, which looks identical by process name.
 *
 * `-KeepData` is deliberate: the gate stops processes, it does not delete anyone's
 * dev projects and layout. Clearing data is `throng-clear-dev-state`'s job and a
 * decision the user makes, not a side effect of running tests.
 */
let cleanedUp = false;
function killOrphans(reason) {
  if (cleanedUp) return;
  cleanedUp = true;

  const clearDevState = join(
    REPO_ROOT,
    '.claude/skills/throng-clear-dev-state/scripts/clear-dev-state.ps1',
  );
  const killPlaywright = join(SCRIPT_DIR, 'kill-playwright-orphans.ps1');

  console.log(`\n[gate] clearing test orphans (${reason})`);

  for (const [label, file, args] of [
    ['app/daemon/pty-agent', clearDevState, ['-KeepData', '-RepoRoot', REPO_ROOT]],
    ['playwright runners', killPlaywright, ['-RepoRoot', REPO_ROOT]],
  ]) {
    if (!existsSync(file)) {
      console.log(`[gate]   ${label}: skipped (${file} not found)`);
      continue;
    }
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
      { stdio: 'inherit', shell: false },
    );
    if (r.status !== 0) console.log(`[gate]   ${label}: cleanup exited ${r.status}`);
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[gate] ${sig} — stopping`);
    killOrphans(sig);
    process.exit(130);
  });
}

// One run folder for the whole gate, so every layer's scratch lands under one
// parent and a clean run leaves nothing in %TEMP%. Same contract as run-tests.mjs.
sweepStaleRunDirs();
const { dir: runDir, owned } = ensureRunDir();
console.log(`[gate] run dir: ${runDir}`);
console.log(`[gate] ${STAGES.length} stages, fail-fast\n`);

const started = Date.now();
const results = [];
let failure = null;

try {
  for (const stage of STAGES) {
    const t0 = Date.now();
    const res = spawnSync('npm', ['run', stage.script], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, ...(stage.env ?? {}) },
    });
    const ms = Date.now() - t0;
    const code = res.status ?? 1;
    results.push({ ...stage, ms, code });

    if (code !== 0) {
      line('FAIL', stage.name, ms, `  exit ${code}`);
      failure = { stage, code };
      break; // fail-fast: nothing after this is worth its wall-clock
    }
    line(' ok ', stage.name, ms);
  }
} finally {
  killOrphans(failure ? 'after failure' : 'after run');
  if (owned) cleanupRunDir(runDir);
}

const total = Date.now() - started;
const ran = results.length;
const skipped = STAGES.length - ran;

console.log(`\n[gate] ${'-'.repeat(46)}`);
for (const r of results) line(r.code === 0 ? ' ok ' : 'FAIL', r.name, r.ms);
if (skipped > 0) {
  console.log(`[gate] .... ${skipped} stage(s) not run: ${STAGES.slice(ran).map((s) => s.name).join(', ')}`);
}
console.log(`[gate] ${'-'.repeat(46)}`);

if (failure) {
  console.error(
    `\n[gate] FAILED at '${failure.stage.name}' after ${fmt(total)} (exit ${failure.code}).\n` +
      `[gate] Fix that stage before re-running — use the 'running-tests' skill to re-run only what\n` +
      `[gate] failed, and 'throng-testing' if it is an E2E flake rather than a defect.\n`,
  );
  process.exit(failure.code);
}

console.log(`\n[gate] GREEN — all ${STAGES.length} stages passed in ${fmt(total)}.\n`);
