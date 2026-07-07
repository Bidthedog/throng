// Launch the built throng app ELEVATED ("as administrator") so the run-as-admin
// terminal path (FR-025) can be exercised end to end: with an elevated app the
// daemon it spawns is elevated too, so `terminal.capabilities.elevated` is true —
// the "Run as administrator" checkbox enables and a confirmed admin terminal shows
// the red ADMIN pill. Run the plain `npm start` for the non-elevated comparison.
//
// Windows-only. Elevation requires UAC, which a plain `npm run` cannot trigger from
// its own (medium-integrity) shell, so we relaunch through PowerShell's
// `Start-Process -Verb RunAs` (the UAC prompt). Assumes `dist/` is already built
// (the `start:admin` npm script runs `npm run build` first).
//
// The elevated instance uses its OWN named pipe (THRONG_PIPE_NAME below) so its
// daemon is fully isolated from a normally-launched throng's persistent daemon —
// no cross-integrity pipe collisions, and nothing to kill when switching modes.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

if (process.platform !== 'win32') {
  console.error('start:admin is Windows-only (it relies on UAC / Start-Process -Verb RunAs).');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const electronExe = require('electron'); // default export = path to electron.exe
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainJs = join(repoRoot, 'packages', 'ui', 'dist', 'main', 'main.js');
// A distinct pipe (and thus a distinct, elevated daemon) for the admin instance.
const adminPipe = '\\\\.\\pipe\\throng.daemon.admin';

// The script the ELEVATED PowerShell will run: set the isolated pipe, move to the
// repo root, then launch the built Electron app. Single-quoted paths are literal,
// so spaces are safe. Encoded as base64/UTF-16LE (-EncodedCommand) to avoid every
// nested-quoting pitfall between the two PowerShell layers.
const elevatedScript = [
  `$env:THRONG_PIPE_NAME = '${adminPipe}'`,
  `Set-Location -LiteralPath '${repoRoot}'`,
  `& '${electronExe}' '${mainJs}'`,
].join('\n');
const encoded = Buffer.from(elevatedScript, 'utf16le').toString('base64');

console.log('Requesting elevation (accept the UAC prompt)…');
console.log(`  app:   ${electronExe}`);
console.log(`  entry: ${mainJs}`);
console.log(`  pipe:  ${adminPipe}  (isolated elevated daemon)`);

// Outer (non-elevated) PowerShell just fires the UAC prompt and returns; the
// elevated app runs in its own hidden PowerShell host and outlives this process.
const launch =
  `Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList ` +
  `'-NoProfile','-WindowStyle','Hidden','-EncodedCommand','${encoded}'`;

const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', launch], {
  stdio: 'inherit',
});

if (res.status !== 0) {
  // Non-zero usually means the UAC prompt was declined.
  console.error('\nElevated launch did not start (UAC declined?).');
  process.exit(res.status ?? 1);
}
console.log('\nElevated throng launched. Close its window to exit; the elevated daemon then idles out.');
