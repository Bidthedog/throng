/**
 * Top-level test runner: establishes ONE run folder for the entire `npm run
 * test` (a single `throng_e2e_<runhash>` under %TEMP%), then runs the four
 * suites in the same order as the old `&&` chain — unit, integration, contract,
 * e2e — with every child process and worker scratching into that one folder.
 *
 * The chain is fail-fast (first failing suite stops the run and sets the exit
 * code), matching the previous `&&` behaviour. The run folder is torn down in a
 * `finally` so a clean run leaves nothing behind, while a crash/interrupt (which
 * skips this cleanup) leaves it for inspection.
 */
import { spawnSync } from 'node:child_process';
import { ensureRunDir, cleanupRunDir } from './test-run-dir.mjs';

const SUITES = ['test:unit', 'test:integration', 'test:contract', 'test:e2e'];

// `--e2e-workers=N` (used by `npm run test:parallel`) sets the E2E worker count
// for the whole run; the child `playwright` inherits it via THRONG_E2E_WORKERS.
// The integration/contract layers stay single-file-serial regardless (they spawn
// real OS processes and cannot parallelize — see docs/testing.md).
const workersArg = process.argv.find((a) => a.startsWith('--e2e-workers='));
if (workersArg) process.env.THRONG_E2E_WORKERS = workersArg.split('=')[1];

const { dir, owned } = ensureRunDir();
console.log(`[throng test] run dir: ${dir}`);

let exitCode = 0;
try {
  for (const suite of SUITES) {
    const res = spawnSync('npm', ['run', suite], {
      stdio: 'inherit',
      env: process.env,
      shell: true,
    });
    if (res.status !== 0) {
      exitCode = res.status ?? 1;
      break; // fail-fast, like the previous `&&` chain
    }
  }
} finally {
  if (owned) cleanupRunDir(dir);
}

process.exit(exitCode);
