<#
.SYNOPSIS
  Clear throng's DEV-mode state: stop the dev processes, then delete the dev data folders.

.DESCRIPTION
  A dev throng leaves state in two places and processes in three.

  The processes matter because throng's daemon is DESIGNED to outlive its window (Principle III:
  terminals keep running when the UI closes). So "I closed throng" does not mean throng has stopped
  - a daemon and its pty-agent can sit there for hours holding the data folder open, which is why
  deleting the folder fails with a permission error even though nothing is visibly running.

  Everything here is scoped to the DEV instance by matching each process's command line against the
  repository it was launched from. The installed throng runs from Program Files or
  %LOCALAPPDATA%\Programs and stores its data in %APPDATA%\throng - this never touches either.

.PARAMETER RepoRoot
  Only stop processes launched from under this path. Defaults to the repository this script lives in,
  which is what makes "kill throng" mean "kill MY throng" rather than every throng on the machine.

.PARAMETER KeepData
  Stop the processes but leave the data folders alone.

.PARAMETER Backup
  Rename the data folders aside (with a timestamp) instead of deleting them, so a suspect database
  can still be inspected afterwards.

.PARAMETER WhatIf
  Report what would happen and change nothing.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$RepoRoot,
    [switch]$KeepData,
    [switch]$Backup
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    # The script lives at <repo>/.claude/skills/<skill>/scripts/, so the repo is four levels up.
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
}
$RepoRoot = $RepoRoot.TrimEnd('\')

Write-Host "throng dev state" -ForegroundColor Cyan
Write-Host "  repository: $RepoRoot"

# --- 1. Find the dev processes -------------------------------------------------------------------
#
# Matched by COMMAND LINE, not by process name. `node.exe` and `electron.exe` are far too common to
# kill by name, and the daemon in particular looks like any other node process - the only thing that
# says "this one is mine" is the path it was launched from.

$patterns = @(
    @{ Name = 'app';       Match = 'packages\ui\dist\main\main.js' },
    @{ Name = 'daemon';    Match = 'packages\daemon\dist\main.js' },
    @{ Name = 'pty-agent'; Match = 'pty-agent-entry.js' }
)

$all = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine }
$targets = @()
foreach ($p in $patterns) {
    foreach ($proc in $all) {
        if ($proc.CommandLine -like "*$RepoRoot*" -and $proc.CommandLine -like "*$($p.Match)*") {
            $targets += [pscustomobject]@{ Kind = $p.Name; Pid = $proc.ProcessId; Cmd = $proc.CommandLine }
        }
    }
}

# Terminals the daemon spawned, and the conhost each one drags along. These are children rather than
# throng itself, and they are the ones that linger as orphans when a daemon is killed abruptly - so
# they are collected from the daemon's process tree rather than guessed at by name.
$daemonPids = @($targets | Where-Object { $_.Kind -eq 'daemon' } | Select-Object -ExpandProperty Pid)
if ($daemonPids.Count -gt 0) {
    foreach ($child in $all) {
        if ($daemonPids -contains $child.ParentProcessId) {
            $targets += [pscustomobject]@{ Kind = 'child'; Pid = $child.ProcessId; Cmd = $child.Name }
        }
    }
}

if ($targets.Count -eq 0) {
    Write-Host "  processes : none running" -ForegroundColor DarkGray
} else {
    Write-Host "  processes :" -ForegroundColor Yellow
    foreach ($t in $targets) {
        $short = if ($t.Cmd.Length -gt 70) { $t.Cmd.Substring(0, 70) + '...' } else { $t.Cmd }
        Write-Host ("    {0,-9} pid {1,-7} {2}" -f $t.Kind, $t.Pid, $short)
    }
}

# Stop children first, then the daemon, then the app. Killing the daemon first would orphan the
# terminals it owns - the exact mess this script exists to clear up.
$order = @{ 'child' = 0; 'pty-agent' = 1; 'daemon' = 2; 'app' = 3 }
foreach ($t in ($targets | Sort-Object { $order[$_.Kind] })) {
    if ($PSCmdlet.ShouldProcess("pid $($t.Pid) ($($t.Kind))", 'Stop-Process')) {
        try {
            Stop-Process -Id $t.Pid -Force -ErrorAction Stop
        } catch {
            # A process that has already gone is a success, not a failure.
            Write-Host "    could not stop pid $($t.Pid): $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
    }
}
if ($targets.Count -gt 0 -and $PSCmdlet.ShouldProcess('data folders', 'wait for handles to close')) {
    Start-Sleep -Seconds 2  # give Windows a moment to release the folder handles
}

# --- 2. Remove the dev data ----------------------------------------------------------------------
#
# %APPDATA%\throng - WITHOUT the -dev suffix - belongs to the INSTALLED throng and is deliberately
# not in this list. Losing a user's real projects while clearing dev state would be a poor trade.

$folders = @(
    (Join-Path $env:APPDATA 'throng-dev'),
    (Join-Path $env:USERPROFILE '.throng-dev')
)

if ($KeepData) {
    Write-Host "  data      : kept (-KeepData)" -ForegroundColor DarkGray
} else {
    foreach ($folder in $folders) {
        if (-not (Test-Path $folder)) {
            Write-Host "  data      : $folder - not present" -ForegroundColor DarkGray
            continue
        }
        if ($Backup) {
            $dest = "$folder.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            if ($PSCmdlet.ShouldProcess($folder, "rename to $dest")) {
                Move-Item -LiteralPath $folder -Destination $dest
                Write-Host "  data      : moved aside -> $dest" -ForegroundColor Green
            }
            continue
        }
        if ($PSCmdlet.ShouldProcess($folder, 'Remove-Item -Recurse')) {
            # Retry: a handle can outlive the process that held it by a moment, and a single failed
            # delete would otherwise leave the state half-cleared - the worst of both outcomes.
            $removed = $false
            foreach ($attempt in 1..5) {
                try {
                    Remove-Item -LiteralPath $folder -Recurse -Force -ErrorAction Stop
                    $removed = $true
                    break
                } catch {
                    Start-Sleep -Milliseconds 400
                }
            }
            if ($removed) {
                Write-Host "  data      : deleted $folder" -ForegroundColor Green
            } else {
                Write-Host "  data      : COULD NOT DELETE $folder - something still holds it" -ForegroundColor Red
                Write-Host '              something outside this repo still holds it - see the skill for how to find it' -ForegroundColor DarkYellow
                exit 1
            }
        }
    }
}

Write-Host "done." -ForegroundColor Cyan
