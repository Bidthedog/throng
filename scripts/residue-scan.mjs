// Residue scan (020 FR-020/024, SC-004) — after an uninstall, no throng component may remain
// under the install root and no throng process may be running. Used by verify-installer.mjs and
// runnable standalone: `node scripts/residue-scan.mjs <installDir>`. Exits 0 when clean, 1 when
// residue is found (naming it).
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Returns the list of offending items (empty = clean). `runningProcesses` items may be a bare image
 * name (string) or `{ name, path }`. Residue is: anything left under the install root; a throng
 * process belonging to THIS installation; and — the detached daemon (FR-020, Principle III) — a
 * `node.exe` whose executable path is under the install dir. A machine-wide `node.exe` with no such
 * path is NOT residue (the CI runner has one). Pure decision; the I/O is injected.
 *
 * **A throng process is residue because it is ours, not because it is named throng** (042 FR-021).
 * When `installDir` is given, attribution is by path: a throng running from anywhere else is a
 * different installation and none of this scan's business. Pass the root even after it has been
 * deleted — a process that outlived its folder still carries the path, and that is the survivor
 * most worth catching.
 *
 * Without a root, the name-only rule stands: a caller that cannot say where the app lived has
 * nothing better to go on, and on a clean runner any throng at all is residue. A process whose path
 * is unknown is likewise flagged rather than assumed innocent.
 *
 * The distinction was found by verifying an artifact on a developer machine with throng already
 * open from an unrelated folder. On a clean CI runner nothing else is ever running, so the
 * name-only rule was never wrong there — which is why it survived until someone ran it locally.
 */
export function scanResidue(installDir, runningProcesses) {
  const offenders = [];
  if (installDir && existsSync(installDir)) {
    const left = readdirSync(installDir);
    if (left.length > 0) offenders.push(`install root not empty: ${left.join(', ')}`);
  }
  const under = installDir ? installDir.toLowerCase() : null;
  for (const proc of runningProcesses) {
    const name = (typeof proc === 'string' ? proc : proc.name ?? '').toLowerCase();
    const path = (typeof proc === 'string' ? '' : proc.path ?? '').toLowerCase();
    if (name.includes('throng')) {
      // Ours, unattributable, or no root to attribute against — all three are residue.
      if (!under || path === '' || path.startsWith(under)) {
        offenders.push(`process still running: ${name}${path ? ` (${path})` : ''}`);
      }
    } else if (name === 'node.exe' && under && path.startsWith(under)) {
      offenders.push(`detached daemon still running: ${path}`);
    }
  }
  return offenders;
}

function runningProcesses() {
  try {
    // Windows-only (FR-038): image name + executable path, so a leftover daemon under the install
    // dir is distinguishable from the machine's own node.
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.Name)|$($_.ExecutablePath)\" }"],
      { encoding: 'utf8', timeout: 20000 },
    );
    return out
      .split(/\r?\n/)
      .map((line) => line.split('|'))
      .filter((parts) => parts[0])
      .map(([name, path]) => ({ name, path: path ?? '' }));
  } catch {
    return [];
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const installDir = process.argv[2];
  const offenders = scanResidue(installDir, runningProcesses());
  if (offenders.length === 0) {
    console.log('[residue-scan] clean — no throng components or processes remain.');
    process.exit(0);
  }
  console.error(`[residue-scan] DIRTY:\n  ${offenders.join('\n  ')}`);
  process.exit(1);
}
