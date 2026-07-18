// Run the elevation-gated E2E ELEVATED so the FR-025c mixed-mode matrix actually
// executes (an elevated test process spawns an elevated daemon → the "run as admin"
// checkbox and de-elevation can be exercised end to end). Windows-only; relies on
// UAC via PowerShell's `Start-Process -Verb RunAs`.
//
// The elevated runner opens a VISIBLE console (-NoExit) so you can read the results;
// close the window when done. Assumes `dist/` is built (the npm script builds first).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

if (process.platform !== 'win32') {
  console.error('test:e2e:admin is Windows-only (UAC / Start-Process -Verb RunAs).');
  process.exit(1);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// Target file(s) can be overridden by CLI args; default to the integrity suite.
const target = process.argv.slice(2).join(' ') || 'terminal-admin-integrity.e2e.ts';

// The elevated PowerShell: cd to the repo, run Playwright for the target, keep the
// window open. Encoded (base64/UTF-16LE) to avoid nested-quoting between PS layers.
/*
 * 017 — forward the test-run environment ACROSS the elevation hop.
 *
 * `Start-Process -Verb RunAs` launches a new process through UAC, and an elevated process does NOT
 * inherit the caller's environment block. That is why `THRONG_E2E_INCLUDE_ADMIN` already has to be
 * re-set *inside* the encoded script below rather than simply exported by the parent.
 *
 * The same is true of every other knob — and for `THRONG_E2E_RETRIES` that silence was dangerous:
 * running `THRONG_E2E_RETRIES=0 npm run test:e2e:admin` LOOKED like a retries-disabled run, but the
 * variable never arrived, so the elevated suite quietly executed at the config default of 2 retries.
 * Any "zero first-attempt failures" conclusion drawn from it would have been a green bar bought by a
 * retry — the precise laundering this feature exists to abolish.
 */
const forwarded = [
  'THRONG_E2E_RETRIES',
  'THRONG_E2E_INCLUDE_QUARANTINE',
  'THRONG_E2E_WORKERS',
  // 019 — the de-elevated PTY agent's connect/readiness budgets. The @admin de-elevation
  // spec's own LAUNCH_BUDGET_MS (25s) is SHORTER than the production worst case of
  // connect 15s + readiness 15s (C7), so that run injects smaller budgets. Without them
  // on this list they never arrive, the run silently executes at the 15/15 default, and a
  // lapse at ~29s is reported as "it hung (#94)" — the very failure the spec exists to
  // detect. Exactly the class of silence THRONG_E2E_RETRIES was bitten by above.
  'THRONG_AGENT_CONNECT_TIMEOUT_MS',
  'THRONG_AGENT_READY_TIMEOUT_MS',
]
  .filter((name) => process.env[name] !== undefined)
  .map((name) => `$env:${name}='${process.env[name]}'`);

const elevatedScript = [
  `Set-Location -LiteralPath '${repoRoot}'`,
  `Write-Host 'Running elevated E2E: ${target}' -ForegroundColor Cyan`,
  // Opt @admin specs back in (the normal config's grepInvert excludes them).
  `$env:THRONG_E2E_INCLUDE_ADMIN='1'`,
  ...forwarded,
  `npx playwright test ${target} --workers=1`,
  `Write-Host ''`,
  `Write-Host 'Done. Review the results above; close this window when finished.' -ForegroundColor Cyan`,
].join('\n');
const encoded = Buffer.from(elevatedScript, 'utf16le').toString('base64');

console.log('Requesting elevation (accept the UAC prompt); results appear in the elevated window…');

const launch =
  `Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList ` +
  `'-NoExit','-NoProfile','-EncodedCommand','${encoded}'`;

const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', launch], {
  stdio: 'inherit',
});
if (res.status !== 0) {
  console.error('\nElevated E2E did not start (UAC declined?).');
  process.exit(res.status ?? 1);
}
