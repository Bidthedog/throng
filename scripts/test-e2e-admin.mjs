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
const elevatedScript = [
  `Set-Location -LiteralPath '${repoRoot}'`,
  `Write-Host 'Running elevated E2E: ${target}' -ForegroundColor Cyan`,
  // Opt @admin specs back in (the normal config's grepInvert excludes them).
  `$env:THRONG_E2E_INCLUDE_ADMIN='1'`,
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
