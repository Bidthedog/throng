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
$targetDir = Split-Path $target -Parent
$leaf = Split-Path $target -Leaf
$leafNoExt = [System.IO.Path]::GetFileNameWithoutExtension($leaf)
$shell = New-Object -ComObject Shell.Application
$bin = $shell.Namespace(0xA)
$items = @($bin.Items())
$match = $null
$seen = @()
#
# == THE SHELL ITEM NAME MAY HAVE NO EXTENSION, AND THAT WAS THE BUG (#373) ==
#
# A Shell.Application item's Name is the name as EXPLORER WOULD DISPLAY IT, so it honours
# "Hide extensions for known file types" -- which is ON by default on a fresh Windows install.
# The original lookup rebuilt the path as Join-Path $orig $it.Name and compared that to the full
# target, so on any machine with that default the rebuilt path was ...\\open against a target of
# ...\\open.txt, nothing ever matched, and EVERY undo of a delete told the user their file was no
# longer in the Recycle Bin. It was there the whole time.
#
# Invisible on a developer machine with extensions shown, which is why it survived. The two
# samples that identified it, for the same operation: a.txt <- C:\\Users\\... on a workstation,
# and a <- C:\\actions-runner\\... on the gate runner.
#
# So the folder is compared on its own and the name is accepted in EITHER form. Column 1 is
# "Original Location" -- measured on Windows 11 10.0.26200, not assumed.
#
#
# == THE STRIPPED NAME IS AMBIGUOUS, SO IT IS NEVER GUESSED AT ==
#
# With extensions hidden, EVERY item from the target's folder displays without one -- so app.ts and
# app.js are both shown as "app". An earlier version of this took the first stripped-name match and
# broke, which restores whichever the shell happens to enumerate first: undo app.ts, get app.js
# back, and the call still resolves, so the undo reports success while the file the user asked for
# is still in the bin and its editor is still stranded. index.html/index.css and README.md/README.txt
# make that an ordinary Tuesday, and deleting several files at once reaches it directly.
#
# So: an EXACT name match wins outright, because it cannot be ambiguous. The stripped-name fallback
# is only used when it identifies exactly ONE item in the target's folder; two or more is reported
# as ambiguous rather than resolved by enumeration order. Refusing is safe -- the undo degrades to
# the FR-008 refusal, which tells the user, and the file stays recoverable by hand.
#
$exact = $null
$stripped = @()
foreach ($it in $items) {
  $orig = $bin.GetDetailsOf($it, 1)
  if ($it.Name -ieq $leaf -or $it.Name -ieq $leafNoExt) {
    if ($seen.Count -lt 5) { $seen += ("{0} <- '{1}'" -f $it.Name, $orig) }
  }
  if ([string]::IsNullOrEmpty($orig)) { continue }
  if ($orig -ine $targetDir) { continue }
  if ($it.Name -ieq $leaf) { $exact = $it; break }
  if ($it.Name -ieq $leafNoExt) { $stripped += $it }
}
if ($null -ne $exact) {
  $match = $exact
} elseif ($stripped.Count -eq 1) {
  $match = $stripped[0]
} elseif ($stripped.Count -gt 1) {
  throw "ambiguous in recycle bin: $targetDir holds $($stripped.Count) items displayed as '$leafNoExt', so which one is '$leaf' cannot be told apart. Restore it from Explorer's Recycle Bin instead."
}
#
# WHEN IT DOES NOT MATCH, SAY WHAT WAS THERE. "not in recycle bin" is true of two completely
# different faults: an empty bin, meaning the delete never recycled at all, and an item present
# under a name or path that does not compare equal. The count plus the items sharing the target's
# name tell those apart in ONE run rather than one each -- which is how #373 was found.
#
if ($null -eq $match) {
  $sample = if ($seen.Count -gt 0) { $seen -join ' ; ' } else { "(no bin item is named '$leaf' or '$leafNoExt')" }
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
