// A global watchdog for the verification harness (058 FR-028).
//
// A hung installer once held a verify job to its 45-minute limit, and a job cancelled at its limit
// uploads nothing: no verdict, no log, no hint of which step it was in. This runs as a SEPARATE
// process, because a harness blocked inside a synchronous call cannot run a timer of its own. The
// harness records its progress in a file as each step begins; when the time is up this process dumps
// the process tree, writes the verdict with the step that was running marked failed and named, and
// stops the harness.
//
//   node verify-watchdog.mjs --progress <file> --verdict-out <file> --pid <harness pid> [--minutes 30]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildArtifactVerdict, combinationsOf, declareArtifactSet } from '@throng/core';

/**
 * The failing verdict for a run that was still in `progress.current` when time ran out.
 * Pure, so what the file says when it is needed is not first read in anger.
 *
 * @param {{version: string, combinationId: string, sha256: string, current: string,
 *          results: Record<string, boolean|string>, unprovenReasons?: Record<string, string>}} progress
 * @param {number} minutes
 */
export function watchdogVerdict(progress, minutes) {
  const set = declareArtifactSet(progress.version);
  const combination = combinationsOf(set).find((c) => c.id === progress.combinationId);
  if (!combination) throw new Error(`unknown combination '${progress.combinationId}'`);
  const results = { ...progress.results, [progress.current]: false };
  const verdict = buildArtifactVerdict(combination, progress.sha256 ?? '', results, progress.unprovenReasons);
  return {
    version: progress.version,
    ...verdict,
    passed: false,
    failedStep: progress.current,
    harnessError: `watchdog: step '${progress.current}' was still running after ${minutes} minutes`,
  };
}

/** Every process that could be holding an installer up, with its command line. */
export function processTreeDump() {
  const script =
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(msiexec|powershell|pwsh|node|throng|Uninstall throng|throng-setup.*|conhost)' } | " +
    "ForEach-Object { '{0} <- {1} {2} {3}' -f $_.ProcessId, $_.ParentProcessId, $_.Name, $_.CommandLine }";
  try {
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30000 });
  } catch (error) {
    return `(could not list processes: ${error instanceof Error ? error.message : String(error)})`;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function run(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const progressFile = flag('--progress');
  const verdictOut = flag('--verdict-out');
  const pid = Number(flag('--pid'));
  const minutes = Number(flag('--minutes') ?? 30);
  const deadline = Date.now() + minutes * 60_000;

  while (Date.now() < deadline) {
    await delay(5000);
    if (!alive(pid)) return; // the harness finished (or died) on its own
  }

  console.error(`[verify-watchdog] ${minutes} minutes are up; the harness is still running. Process tree:\n${processTreeDump()}`);
  try {
    const progress = JSON.parse(readFileSync(progressFile, 'utf8'));
    writeFileSync(verdictOut, JSON.stringify(watchdogVerdict(progress, minutes), null, 2));
    console.error(`[verify-watchdog] step '${progress.current}' was running; failing verdict → ${verdictOut}`);
  } catch (error) {
    console.error(`[verify-watchdog] could not write the verdict: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', timeout: 30000 });
  } catch {
    /* already gone */
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run(process.argv.slice(2));
}

export const watchdogScript = fileURLToPath(import.meta.url);
