/**
 * Windows Recycle-Bin restore (024 US3, #85). There is no Electron/Node API to restore a trashed
 * item, so this drives the Shell.Application COM automation through PowerShell: it finds the recycle
 * bin entries whose ORIGINAL location + name match `originalPath` and invokes the Restore verb of one.
 *
 * This is the platform-risk item the spec flags for a focused validation pass. It is best-effort and
 * MUST reject (not hang, not silently succeed) when the item is gone, so the undo degrades to the
 * FR-008 refusal. Non-Windows platforms do not use this — `NodeFileSystem` is constructed with the
 * default rejecting `restoreItem` there.
 *
 * One PowerShell process does both halves: it LISTS the candidates as one JSON line on stdout, then
 * waits on stdin for the index of the one to restore. Which one is a decision made here, in
 * `chooseRecycleBinItem`, so it is unit-tested without a Recycle Bin; the script only enumerates.
 */
import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import { logExpected } from '@throng/core';
import { watchChild } from '@throng/platform-node';

/** A recycle-bin entry from the target's folder whose displayed name matches the target's, with or without extension. */
export interface RecycleBinCandidate {
  /** Its position in the script's list; what is written back to restore it. */
  readonly index: number;
  /** Its displayed name equals the target's leaf exactly. */
  readonly exact: boolean;
  /**
   * Its recycled file (`$R…`, which keeps the original extension whatever Explorer displays) has the target's
   * extension. Only meaningful for a non-exact match, where the display hid the extension.
   */
  readonly extMatches: boolean;
  /** When it was deleted, epoch ms; 0 when the shell did not say. */
  readonly deletedAtMs: number;
}

/** What the script saw: the candidates, plus enough to explain an empty result. */
export interface RecycleBinListing {
  readonly scanned: number;
  /** Up to five bin items named like the target, from ANY folder, as `name <- 'original folder'`. */
  readonly sample: readonly string[];
  readonly candidates: readonly RecycleBinCandidate[];
}

/** An open enumeration of the bin: restore one of its candidates, or let it go. */
export interface RecycleBinSession {
  readonly listing: RecycleBinListing;
  restore(index: number): Promise<void>;
  cancel(): void;
}

export type OpenRecycleBin = (originalPath: string) => Promise<RecycleBinSession>;

/** The closest at or before `deletedAt`, else the newest — `LinuxTrash.restore`'s rule. Ties keep enumeration order. */
function closestDeletion(matches: readonly RecycleBinCandidate[], deletedAt: number): RecycleBinCandidate {
  const atOrBefore = matches.filter((c) => c.deletedAtMs <= deletedAt).sort((a, b) => b.deletedAtMs - a.deletedAtMs);
  const newest = [...matches].sort((a, b) => b.deletedAtMs - a.deletedAtMs);
  return atOrBefore[0] ?? newest[0]!;
}

/**
 * Which candidate is the item `originalPath` deleted at `deletedAt`.
 *
 * == THE SHELL ITEM NAME MAY HAVE NO EXTENSION (#373) ==
 *
 * A Shell.Application item's Name is the name as EXPLORER WOULD DISPLAY IT, so it honours "Hide
 * extensions for known file types" — ON by default on a fresh Windows install. So a candidate is
 * named either `a.txt` (exact) or `a` (stripped). The two samples that identified it, for the same
 * operation: `a.txt <- C:\Users\...` on a workstation, and `a <- C:\actions-runner\...` on the gate runner.
 *
 * == THE STRIPPED NAME IS AMBIGUOUS, SO IT IS NEVER GUESSED AT ==
 *
 * With extensions hidden, app.ts and app.js both display as "app". Taking the first stripped match
 * restores whichever the shell enumerates first, and the undo still reports success. So a stripped
 * match counts only when its recycled file carries the target's extension; failing that, a lone
 * stripped match is accepted (#373's behaviour) and two or more are refused as ambiguous. Refusing
 * is safe — the undo degrades to the FR-008 refusal and the file stays recoverable by hand.
 *
 * == SEVERAL DELETIONS OF ONE PATH: THE CLOSEST AT OR BEFORE `deletedAt` (#708) ==
 *
 * Delete a.txt, recreate it, delete it again, and the bin holds two a.txt. The first in enumeration
 * order was taken, so undo could bring back the OLDER copy and leave the one just deleted in the bin.
 */
export function chooseRecycleBinItem(listing: RecycleBinListing, originalPath: string, deletedAt: number): RecycleBinCandidate {
  const leaf = win32.basename(originalPath);
  const leafNoExt = win32.basename(originalPath, win32.extname(originalPath));
  const exact = listing.candidates.filter((c) => c.exact);
  if (exact.length > 0) return closestDeletion(exact, deletedAt);
  const stripped = listing.candidates.filter((c) => !c.exact);
  const sameExt = stripped.filter((c) => c.extMatches);
  if (sameExt.length > 0) return closestDeletion(sameExt, deletedAt);
  if (stripped.length === 1) return stripped[0]!;
  const targetDir = win32.dirname(originalPath);
  if (stripped.length > 1) {
    throw new Error(
      `ambiguous in recycle bin: ${targetDir} holds ${stripped.length} items displayed as '${leafNoExt}', so which one is '${leaf}' cannot be told apart. Restore it from Explorer's Recycle Bin instead.`,
    );
  }
  // WHEN IT DOES NOT MATCH, SAY WHAT WAS THERE. "not in recycle bin" is true of two different faults: an empty bin (the
  // delete never recycled) and an item present under a name or folder that does not compare equal. The count plus the
  // items sharing the target's name tell those apart in ONE run — which is how #373 was found.
  const sample = listing.sample.length > 0 ? listing.sample.join(' ; ') : `(no bin item is named '${leaf}' or '${leafNoExt}')`;
  throw new Error(`not in recycle bin: ${originalPath} (scanned ${listing.scanned} item(s); sample: ${sample})`);
}

/**
 * Lists the bin items from $env:THRONG_RESTORE_TARGET's folder named like its leaf, as one JSON line,
 * then restores the one whose index arrives on stdin (an empty line restores nothing).
 * Column 1 of GetDetailsOf is "Original Location" — measured on Windows 11 10.0.26200, not assumed.
 */
const RESTORE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$target = $env:THRONG_RESTORE_TARGET
$targetDir = Split-Path $target -Parent
$leaf = Split-Path $target -Leaf
$leafNoExt = [System.IO.Path]::GetFileNameWithoutExtension($leaf)
$leafExt = [System.IO.Path]::GetExtension($leaf)
$shell = New-Object -ComObject Shell.Application
$bin = $shell.Namespace(0xA)
$items = @($bin.Items())
$seen = @()
$found = @()
$rows = @()
foreach ($it in $items) {
  $named = ($it.Name -ieq $leaf -or $it.Name -ieq $leafNoExt)
  if (-not $named) { continue }
  $orig = $bin.GetDetailsOf($it, 1)
  if ($seen.Count -lt 5) { $seen += ("{0} <- '{1}'" -f $it.Name, $orig) }
  if ([string]::IsNullOrEmpty($orig)) { continue }
  if ($orig -ine $targetDir) { continue }
  $extMatches = ($leafExt -ne '') -and ([System.IO.Path]::GetExtension([string]$it.Path) -ieq $leafExt)
  # The shell's deletion date: a FILETIME the COM bridge hands over as a UTC DateTime.
  $ms = 0
  try {
    $d = $it.ExtendedProperty('System.Recycle.DateDeleted')
    if ($null -ne $d) { $ms = ([DateTimeOffset][DateTime]::SpecifyKind([DateTime]$d, 'Utc')).ToUnixTimeMilliseconds() }
  } catch { $ms = 0 }
  $rows += [pscustomobject]@{ index = $found.Count; exact = ($it.Name -ieq $leaf); extMatches = [bool]$extMatches; deletedAtMs = [int64]$ms }
  $found += $it
}
$listing = [pscustomobject]@{ scanned = $items.Count; sample = [object[]]$seen; candidates = [object[]]$rows }
[Console]::Out.WriteLine(($listing | ConvertTo-Json -Compress -Depth 4))
[Console]::Out.Flush()
$chosen = [Console]::In.ReadLine()
if ([string]::IsNullOrWhiteSpace($chosen)) { exit 0 }
$match = $found[[int]$chosen]
$restore = $match.Verbs() | Where-Object { ($_.Name -replace '&','') -ieq 'Restore' } | Select-Object -First 1
if ($null -eq $restore) { throw "no Restore verb" }
$restore.DoIt()
`;

/** PowerShell 5.1's ConvertTo-Json writes a one-element array as its element; take either. */
function asArray<T>(value: unknown): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

/** Parse the script's listing line. Throws on anything that is not one. */
export function parseRecycleBinListing(line: string): RecycleBinListing {
  const raw = JSON.parse(line) as { scanned?: unknown; sample?: unknown; candidates?: unknown };
  return {
    scanned: typeof raw.scanned === 'number' ? raw.scanned : 0,
    sample: asArray<unknown>(raw.sample).map(String),
    candidates: asArray<Record<string, unknown>>(raw.candidates).map((c) => ({
      index: Number(c.index),
      exact: c.exact === true,
      extMatches: c.extMatches === true,
      deletedAtMs: typeof c.deletedAtMs === 'number' ? c.deletedAtMs : 0,
    })),
  };
}

/** The real bin: one PowerShell process, listing on stdout, the chosen index on stdin. */
const openPowerShellRecycleBin: OpenRecycleBin = (originalPath) =>
  new Promise((resolveOpen, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', RESTORE_SCRIPT],
      { env: { ...process.env, THRONG_RESTORE_TARGET: originalPath }, windowsHide: true },
    );
    // 066 FR-016 — a one-shot helper: a failed start or a non-zero exit is one warn line in main.log,
    // with the script's stderr (which names what the bin held), beside the refusal the caller shows.
    watchChild(child, {
      name: 'recycle-bin restore',
      longLived: false,
      log: (level, message) => console[level === 'fatal' ? 'error' : level](message),
    });
    let stderr = '';
    let stdout = '';
    let listed = false;
    const failure = (code: number | null): Error =>
      new Error(`recycle-bin restore failed (${code}): ${stderr.trim() || 'unknown'}`);
    const closed = new Promise<number | null>((resolve) => child.on('close', resolve));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (c: string) => (stderr += c));
    // A script that died before reading its answer breaks the pipe; its exit code is what reports that.
    child.stdin?.on('error', (error) =>
      logExpected('recycle-bin restore: write choice', 'the script may exit before it reads the chosen index', error),
    );
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      if (listed) return;
      stdout += c;
      const end = stdout.indexOf('\n');
      if (end < 0) return;
      listed = true;
      let listing: RecycleBinListing;
      try {
        listing = parseRecycleBinListing(stdout.slice(0, end).trim());
      } catch (error) {
        child.kill();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolveOpen({
        listing,
        restore: async (index) => {
          child.stdin?.end(`${index}\n`);
          const code = await closed;
          if (code !== 0) throw failure(code);
        },
        cancel: () => child.stdin?.end('\n'),
      });
    });
    child.on('error', reject);
    void closed.then((code) => {
      if (!listed) reject(failure(code));
    });
  });

/** Restore `originalPath`'s copy deleted at (or closest before) `deletedAt` from the Windows recycle bin. Rejects when it cannot. */
export async function restoreFromRecycleBin(
  originalPath: string,
  deletedAt: number,
  open: OpenRecycleBin = openPowerShellRecycleBin,
): Promise<void> {
  const session = await open(originalPath);
  let chosen: RecycleBinCandidate;
  try {
    chosen = chooseRecycleBinItem(session.listing, originalPath, deletedAt);
  } catch (error) {
    session.cancel();
    throw error;
  }
  await session.restore(chosen.index);
}
