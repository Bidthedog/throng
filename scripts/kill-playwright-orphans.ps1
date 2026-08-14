<#
.SYNOPSIS
  Stop Playwright runner processes left behind by a test run in THIS checkout.

.DESCRIPTION
  `throng-clear-dev-state` already handles the app, the daemon, the pty-agent and the
  shells the daemon spawned. What it does not cover is Playwright's own machinery: the
  `playwright test` runner and the worker processes it forks. A gate that is interrupted
  part-way through the E2E stage leaves those behind, and they keep file handles on the
  run folder.

  Scoping is by COMMAND LINE, never by process name. `node.exe` is far too common to kill
  by name, and doing so would take out unrelated work — including other worktrees running
  their own gate at the same time, which is a supported thing to do. A process is only a
  target if its command line mentions both this repository root and Playwright.

.PARAMETER RepoRoot
  Only stop processes launched from under this path. Defaults to the repository this
  script lives in.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
    # The script lives at <repo>/scripts/, so the repo is one level up.
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$RepoRoot = $RepoRoot.TrimEnd('\')

# THREE conditions, all required. Dropping any one of them is not a loosening, it is a
# different and much worse script — the first draft of this file used only the last two and
# matched its OWN powershell process (whose -File argument contains the word "playwright")
# plus every bash.exe whose command line happened to mention it. It killed itself, and it
# would have killed the developer's shells.
#
#   1. node.exe only        — the Playwright runner and its workers are node. A shell, an
#                             editor or a powershell that merely NAMES playwright is not a
#                             runner and must never be a target.
#   2. launched from here   — scoped to this checkout, so a sibling worktree running its own
#                             gate concurrently is untouched.
#   3. actually playwright  — the CLI entry point or the test runner, not the bare word.
#
# And never this process or its parent, belt-and-braces, even though a node filter already
# excludes both.
$selfPids = @($PID, (Get-CimInstance Win32_Process -Filter "ProcessId = $PID").ParentProcessId)

$targets = @()
foreach ($proc in (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine })) {
    if ($proc.Name -ne 'node.exe') { continue }
    if ($selfPids -contains $proc.ProcessId) { continue }
    if ($proc.CommandLine -notlike "*$RepoRoot*") { continue }
    if ($proc.CommandLine -notmatch 'playwright[\\/](cli|test)|playwright\s+test|@playwright') { continue }
    $targets += $proc
}

if ($targets.Count -eq 0) {
    Write-Host "  playwright: none running" -ForegroundColor DarkGray
    exit 0
}

Write-Host "  playwright:" -ForegroundColor Yellow
foreach ($t in $targets) {
    Write-Host ("    {0,-6} {1}" -f $t.ProcessId, $t.Name)
}

foreach ($t in $targets) {
    if ($PSCmdlet.ShouldProcess("PID $($t.ProcessId) ($($t.Name))", 'Stop-Process')) {
        try {
            Stop-Process -Id $t.ProcessId -Force -ErrorAction Stop
        }
        catch {
            # A process that has already gone is a success, not a failure — a parent
            # runner takes its workers with it, so by the time the loop reaches them
            # they are frequently already dead.
            if ($_.Exception -isnot [Microsoft.PowerShell.Commands.ProcessCommandException]) {
                Write-Host "    could not stop $($t.ProcessId): $($_.Exception.Message)" -ForegroundColor DarkYellow
            }
        }
    }
}
