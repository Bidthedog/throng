/**
 * Windows Recycle-Bin restore (024 US3, #85). There is no Electron/Node API to restore a trashed
 * item, so this drives the Shell.Application COM automation through PowerShell: it finds the recycle
 * bin entry whose ORIGINAL location + name matches `originalPath` and invokes its Restore verb.
 *
 * This is the platform-risk item the spec flags for a focused validation pass. It is best-effort and
 * MUST reject (not hang, not silently succeed) when the item is gone, so the undo degrades to the
 * FR-008 refusal. Non-Windows platforms do not use this — `NodeFileSystem` is constructed with the
 * default rejecting `restoreItem` there.
 */
import { spawn } from 'node:child_process';

/**
 * PowerShell that restores the most-recent recycle-bin item whose original path equals $env:THRONG_RESTORE_TARGET.
 * Throws (non-zero exit) if no match is found, which the caller turns into a refusal.
 */
const RESTORE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$target = $env:THRONG_RESTORE_TARGET
$shell = New-Object -ComObject Shell.Application
$bin = $shell.Namespace(0xA)
$items = @($bin.Items())
$leaf = Split-Path $target -Leaf
$match = $null
$seen = @()
#
# Column 1 is "Original Location", MEASURED rather than assumed — Windows 11 (10.0.26200), where
# GetDetailsOf($null, 1) reports that header exactly. An earlier attempt at this scanned the first
# eight columns for whichever one formed the target path, on the theory that the index moves between
# builds. Two things came out of probing it against a real bin: the index was right all along, and
# the scan was WORSE THAN THE BUG IT WAS MEANT TO FIX — column 2 is "Date Deleted", and
# Join-Path on a date throws DriveNotFoundException, which under 'Stop' aborts the whole restore.
#
# Nothing in the suite would have caught that: node-file-system.test.ts injects a SIMULATED bin, so
# this script is exercised by no automated test at all. Probe it by hand before changing it.
#
foreach ($it in $items) {
  $orig = $bin.GetDetailsOf($it, 1)
  #
  # SAMPLE THE ITEMS THAT SHARE THE TARGET'S NAME, not the first three in the bin.
  #
  # The first sampling took whatever came first, which on a runner with fifty entries is three
  # unrelated leftovers — it proved the bin was populated and nothing else. The interesting item is
  # the one CALLED what we are looking for: if it is there with a different original location, that
  # difference IS the bug; if it is not there at all, the delete never recycled it. Same one run,
  # two answers, and the earlier sample could give neither.
  #
  if ($it.Name -ieq $leaf -and $seen.Count -lt 5) {
    $seen += ("{0} <- '{1}'" -f $it.Name, $orig)
  }
  if ([string]::IsNullOrEmpty($orig)) { continue }
  if ((Join-Path $orig $it.Name) -ieq $target) { $match = $it; break }
}
#
# WHEN IT DOES NOT MATCH, SAY WHAT WAS THERE.
#
# "not in recycle bin" is true of two completely different faults: the delete never recycled (an
# empty bin — a defect somewhere else entirely), and the item being present under a path that does
# not compare equal (a short 8.3 name, a casing difference, a redirected temp). The count and a
# sample of what the bin actually reported tell those apart in ONE run rather than one each.
#
if ($null -eq $match) {
  $sample = if ($seen.Count -gt 0) { $seen -join ' ; ' } else { "(no bin item is named '$leaf')" }
  throw "not in recycle bin: $target (scanned $($items.Count) item(s); sample: $sample)"
}
$restore = $match.Verbs() | Where-Object { ($_.Name -replace '&','') -ieq 'Restore' } | Select-Object -First 1
if ($null -eq $restore) { throw "no Restore verb" }
$restore.DoIt()
`;

/** Restore `originalPath` from the Windows recycle bin. Rejects when it cannot be recovered. */
export function restoreFromRecycleBin(originalPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', RESTORE_SCRIPT],
      { env: { ...process.env, THRONG_RESTORE_TARGET: originalPath }, windowsHide: true },
    );
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (c: string) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`recycle-bin restore failed (${code}): ${stderr.trim() || 'unknown'}`));
    });
  });
}
