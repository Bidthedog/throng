<#
.SYNOPSIS
  Run a command WITHOUT administrator rights, even when the caller has them.

.DESCRIPTION
  GitHub's Windows runners run elevated, and throng's E2E specs that assume a normal-integrity
  daemon call `skipIfElevated()` — so on CI they self-skipped. When this script was written that was
  84 spec files and 208 tests, a third of the suite saying nothing.

  THIS SCRIPT DID NOT SOLVE THAT, and nothing on a hosted runner can: see the measurements below.
  What solved it was narrowing the guard from 85 files to 22 (25 tests), so the specs that never
  depended on the process tree now simply run elevated. This script survives for a SELF-HOSTED
  runner with UAC enabled, where the mechanisms below do work.

  What "de-elevated" has to mean here is set by the test, not by intuition: `isElevated()` asks
  whether `net session` succeeds, which is a question about ADMINISTRATOR RIGHTS, not about integrity
  level. Lowering integrity while keeping the Administrators group would leave every one of those
  specs still skipping. The token must lack admin rights.

  Two mechanisms are tried, because which one works depends on the machine:

    runas-trustlevel   `runas /trustlevel:0x20000` runs the command under a RESTRICTED token with
                       Administrators marked deny-only. Same user, same session, same desktop — which
                       matters, because Electron needs a desktop. Works with UAC disabled.

    schtasks-limited   A scheduled task with RunLevel Limited is started by the service using the
                       caller's FILTERED token. This is the textbook answer and it fails on a GitHub
                       runner, because UAC is disabled there and a filtered token does not exist —
                       measured: the task ran with full admin rights and the shard guard caught it.

  The product's own de-elevation (WindowsDeElevatedLauncher) cannot be reused: it borrows the
  interactive shell's token via CreateProcessWithTokenW, and a runner has no interactive shell to
  borrow from. That is what `skipWithoutInteractiveDesktop()` documents.

  Each strategy is PROBED first with a one-second check that reports whether it actually dropped
  admin rights. Only a strategy that passes its probe is used for the real command. Without that, a
  strategy that cannot work costs a full E2E run to discover.

  This never falls back to running with admin rights. A suite that looks like it ran while verifying
  nothing is the failure being fixed, not an acceptable degradation.

.NOTES
  Scheduled tasks and restricted-token launches inherit no environment, so everything the run needs
  is written into a wrapper explicitly. A variable the workflow sets but $Forward omits will silently
  not reach the tests.
#>
[CmdletBinding()]
param(
  # The command line to run, e.g. './scripts/ci-e2e-shard.ps1 -Shard "1/3"'
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]] $CommandParts
)

$ErrorActionPreference = 'Stop'
$command = ($CommandParts -join ' ')
$work = (Get-Location).Path

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# THRONG_DEELEVATE_FORCE exercises the drop path from an ordinary shell, so it can be tested by
# someone who is not currently an administrator — which is most people reproducing a CI problem.
$force = $env:THRONG_DEELEVATE_FORCE -eq '1'

if (-not (Test-Admin) -and -not $force) {
  Write-Host '[deelevate] already running without admin rights — executing directly'
  pwsh -NoProfile -Command $command
  exit $LASTEXITCODE
}

# Variables the run needs; a de-elevated launch starts with none of them.
$Forward = @(
  'CI', 'GITHUB_ACTIONS', 'GITHUB_STEP_SUMMARY', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY',
  'GITHUB_RUN_ID', 'GH_TOKEN', 'RUNNER_TEMP', 'TEMP', 'TMP', 'PATH', 'SystemRoot',
  'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramFiles', 'ProgramData', 'NUMBER_OF_PROCESSORS'
) + (Get-ChildItem env: | Where-Object { $_.Name -like 'THRONG_*' } | ForEach-Object { $_.Name })

function New-Wrapper([string] $Body, [string] $Stamp, [string] $LogFile) {
  $sets = foreach ($name in ($Forward | Select-Object -Unique)) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($null -ne $value -and $value -ne '') {
      # `set "K=V"` tolerates spaces, parens and semicolons in PATH without further quoting.
      'set "' + $name + '=' + ($value -replace '%', '%%') + '"'
    }
  }
  $path = Join-Path $work "deelevated-$Stamp.cmd"
  # The wrapper redirects its OWN output rather than being redirected by the caller. That keeps the
  # launch argument free of quotes, which matters: `runas` takes the command as one string, and
  # Start-Process re-quotes embedded quotes in a way cmd then mis-parses — measured as the trustlevel
  # probe silently producing no output at all.
  @(
    '@echo off'
    ('cd /d "' + $work + '"')
    $sets
    ('call :main > "' + $LogFile + '" 2>&1')
    'exit /b %ERRORLEVEL%'
    ':main'
    $Body
  ) | Set-Content -Path $path -Encoding ascii
  return $path
}

<# The 8.3 short form of a path: no spaces, so it needs no quoting on a command line. #>
function Get-ShortPath([string] $Path) {
  $fso = New-Object -ComObject Scripting.FileSystemObject
  try { return $fso.GetFile($Path).ShortPath } catch { return $Path }
}

# --- the two ways of dropping admin rights -------------------------------------------------------

function Start-ViaTrustLevel([string] $Wrapper) {
  # 0x20000 = "Basic User": the same token with Administrators deny-only. The short path keeps the
  # whole argument quote-free, which is what makes it survive Start-Process and cmd intact.
  $short = Get-ShortPath $Wrapper
  Start-Process -FilePath 'runas.exe' `
    -ArgumentList @('/trustlevel:0x20000', "cmd.exe /c $short") `
    -WindowStyle Hidden | Out-Null
}

function Start-ViaScheduledTask([string] $Wrapper, [string] $TaskName) {
  $action = 'cmd.exe /c "' + $Wrapper + '"'
  $created = schtasks /create /TN $TaskName /TR $action /SC ONCE /ST 23:59 /RL LIMITED /IT /F 2>&1
  if ($LASTEXITCODE -ne 0) { throw "could not register task: $created" }
  schtasks /run /TN $TaskName 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'could not start task' }
}

function Remove-Task([string] $TaskName) {
  if ($TaskName) { schtasks /delete /TN $TaskName /F 2>&1 | Out-Null }
}

# --- probe: does this strategy actually drop admin rights? ---------------------------------------

function Test-Strategy([string] $Name) {
  $stamp = [Guid]::NewGuid().ToString('N').Substring(0, 8)
  $probeOut = Join-Path $work "deelevated-probe-$stamp.txt"
  $body = 'pwsh -NoProfile -Command "' +
          '$i=[Security.Principal.WindowsIdentity]::GetCurrent();' +
          '$p=New-Object Security.Principal.WindowsPrincipal($i);' +
          'Write-Output (\"admin=\" + $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"'
  $wrapper = New-Wrapper -Body $body -Stamp $stamp -LogFile $probeOut
  $task = "throng-probe-$stamp"
  try {
    if ($Name -eq 'runas-trustlevel') { Start-ViaTrustLevel $wrapper }
    else { Start-ViaScheduledTask $wrapper $task }

    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 1
      if (Test-Path $probeOut) {
        $text = (Get-Content $probeOut -Raw -ErrorAction SilentlyContinue)
        if ($text -match 'admin=(\w+)') {
          $isAdmin = $Matches[1] -eq 'True'
          Write-Host ("[deelevate] probe {0}: admin={1}" -f $Name, $isAdmin)
          return (-not $isAdmin)
        }
      }
    }
    Write-Host "[deelevate] probe ${Name}: produced no result"
    return $false
  }
  catch {
    Write-Host "[deelevate] probe ${Name}: $_"
    return $false
  }
  finally {
    if ($Name -ne 'runas-trustlevel') { Remove-Task $task }
    Remove-Item $wrapper, $probeOut -Force -ErrorAction SilentlyContinue
  }
}

Write-Host '[deelevate] running with admin rights — choosing a way to drop them'

$chosen = $null
foreach ($name in @('runas-trustlevel', 'schtasks-limited')) {
  if (Test-Strategy $name) { $chosen = $name; break }
}

if (-not $chosen) {
  Write-Host '::error::[deelevate] no strategy could drop administrator rights on this machine. Refusing to run the suite with admin rights, because every skipIfElevated() spec would self-skip and the result would mean nothing.'
  exit 1
}
Write-Host "[deelevate] using $chosen"

# --- the real run ---------------------------------------------------------------------------------

$stamp = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$logFile = Join-Path $work "deelevated-$stamp.log"
$codeFile = Join-Path $work "deelevated-$stamp.code"
$taskName = "throng-e2e-$stamp"
# The space before `>` is load-bearing: `echo 7> file` redirects HANDLE 7 and writes nothing, so an
# exit code of 1-9 silently produced an empty file. Measured, not theorised.
$body = @(
  ('pwsh -NoProfile -Command "' + ($command -replace '"', '""') + '"')
  ('echo %ERRORLEVEL% > "' + $codeFile + '"')
)
$wrapper = New-Wrapper -Body ($body -join "`r`n") -Stamp $stamp -LogFile $logFile

try {
  if ($chosen -eq 'runas-trustlevel') { Start-ViaTrustLevel $wrapper }
  else { Start-ViaScheduledTask $wrapper $taskName }

  # Stream the log while it runs, so the job shows progress instead of being silent for half an hour.
  # Completion is judged by the CODE FILE: `schtasks /query` output is localised and a missed match
  # once null-referenced here, and the trustlevel route has no status to query at all.
  $shown = 0
  $deadline = (Get-Date).AddMinutes(60)
  while ($true) {
    Start-Sleep -Seconds 10
    if (Test-Path $logFile) {
      $lines = @(Get-Content $logFile -ErrorAction SilentlyContinue)
      if ($lines.Count -gt $shown) {
        $lines[$shown..($lines.Count - 1)] | ForEach-Object { Write-Host $_ }
        $shown = $lines.Count
      }
    }
    if (Test-Path $codeFile) { break }
    if ((Get-Date) -gt $deadline) {
      Write-Host '::error::[deelevate] the de-elevated run exceeded 60 minutes — abandoning'
      exit 1
    }
  }

  Start-Sleep -Seconds 2
  if (Test-Path $logFile) {
    $lines = @(Get-Content $logFile -ErrorAction SilentlyContinue)
    if ($lines.Count -gt $shown) { $lines[$shown..($lines.Count - 1)] | ForEach-Object { Write-Host $_ } }
  }

  $code = [int]((Get-Content $codeFile -Raw).Trim())
  Write-Host "[deelevate] de-elevated run exited $code"
  exit $code
}
finally {
  if ($chosen -ne 'runas-trustlevel') { Remove-Task $taskName }
  # The log has already been streamed into this job's output, so the file itself is scratch.
  Remove-Item $wrapper, $codeFile, $logFile -Force -ErrorAction SilentlyContinue
}
