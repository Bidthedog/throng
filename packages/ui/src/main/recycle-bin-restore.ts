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
$match = $null
foreach ($it in @($bin.Items())) {
  $orig = $bin.GetDetailsOf($it, 1)   # "Original Location" (folder) on Windows 10/11
  if ([string]::IsNullOrEmpty($orig)) { continue }
  $full = Join-Path $orig $it.Name
  if ($full -ieq $target) { $match = $it; break }
}
if ($null -eq $match) { throw "not in recycle bin: $target" }
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
