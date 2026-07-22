<#
.SYNOPSIS
  Run one E2E shard and apply the issue-#75 flake policy: a GENUINE test flake/failure stays RED,
  but a pure INFRA fault (a worker- or global-teardown crash that no test owns) is retried once.

.DESCRIPTION
  `failOnFlakyTests: true` (playwright.config.ts, constitution Principle V) makes a test that only
  passes on retry redden the run — deliberately, so flakes are fixed not laundered green. But some
  faults belong to NO test: a wedged app blowing the *worker-teardown* budget, a globalSetup/
  globalTeardown throwing. Playwright reports those as "1 error was not a part of any test" and
  exits non-zero, and NO retry absorbs them — that is the exact way master went red on run
  29909576080 without a real defect in the code under test.

  Classification is by the shard's JSON report:
    * unexpected > 0  -> a test FAILED            -> RED, no retry.
    * flaky      > 0  -> a test FLAKED            -> RED, no retry (the strict gate holds).
    * both zero, exit <> 0 -> an INFRA fault owned by no test -> retry the shard ONCE.
  A missing/unparseable report on a non-zero exit is treated as RED (never hide a setup/build
  failure). This can only ever turn an infra fault green on a clean retry; it can never turn a real
  test flake or failure green, because those carry flaky/unexpected > 0.

.NOTES
  Emits a GITHUB_STEP_SUMMARY note and, when an infra retry happens, a comment on the tracking
  issue (#75) via `gh` if a token is available — so the flake tail stays visible instead of silent.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Shard,          # e.g. "3/3"
  [string] $ReportFile = 'shard-report.json',
  [int]    $TrackingIssue = 75
)

$ErrorActionPreference = 'Stop'

function Invoke-Shard {
  if (Test-Path $ReportFile) { Remove-Item $ReportFile -Force }
  # Clear the blob dir too, so a retry's merged report isn't a doubled copy of this shard.
  if (Test-Path 'blob-report') { Remove-Item 'blob-report' -Recurse -Force }
  npm run test:e2e -- --shard=$Shard
  return $LASTEXITCODE
}

function Get-Stats {
  if (-not (Test-Path $ReportFile)) { return $null }
  try { return (Get-Content $ReportFile -Raw | ConvertFrom-Json).stats }
  catch { return $null }
}

function Write-Summary([string] $line) {
  Write-Host $line
  if ($env:GITHUB_STEP_SUMMARY) { $line | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8 }
}

$code = Invoke-Shard
if ($code -eq 0) { Write-Summary "E2E shard $Shard passed."; exit 0 }

$stats = Get-Stats
if ($null -eq $stats) {
  Write-Host "::error::E2E shard $Shard exited $code and produced no readable JSON report — treating as a hard failure (no retry)."
  exit $code
}

$unexpected = [int]$stats.unexpected
$flaky      = [int]$stats.flaky
Write-Host "shard $Shard report: expected=$($stats.expected) unexpected=$unexpected flaky=$flaky skipped=$($stats.skipped) (exit $code)"

if ($unexpected -gt 0 -or $flaky -gt 0) {
  Write-Host "::error::E2E shard $Shard has a genuine test failure/flake (unexpected=$unexpected, flaky=$flaky). Staying red — the flake gate holds (Principle V)."
  exit $code
}

# Pure infra fault: no test failed or flaked, yet the run exited non-zero.
Write-Host "::warning::E2E shard $Shard hit an INFRA fault (0 unexpected, 0 flaky, exit $code) — a worker/global-teardown error owned by no test. Retrying the shard once (issue #75)."
Write-Summary "⚠️ E2E shard $Shard infra-retried (0 unexpected / 0 flaky / exit $code)."

$run = "$($env:GITHUB_SERVER_URL)/$($env:GITHUB_REPOSITORY)/actions/runs/$($env:GITHUB_RUN_ID)"
if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) {
  try {
    $body = "Infra-level E2E fault auto-detected and retried on shard **$Shard** (0 unexpected, 0 flaky, exit $code — a worker/global-teardown error no test owns). Run: $run"
    gh issue comment $TrackingIssue --body $body 2>&1 | Out-Null
  } catch { Write-Host "note: could not comment on #$TrackingIssue ($_)" }
}

$code2 = Invoke-Shard
if ($code2 -eq 0) {
  Write-Summary "E2E shard $Shard passed on infra-retry."
  exit 0
}

$stats2 = Get-Stats
$u2 = if ($stats2) { [int]$stats2.unexpected } else { 1 }
$f2 = if ($stats2) { [int]$stats2.flaky } else { 0 }
Write-Host "::error::E2E shard $Shard failed again after infra-retry (unexpected=$u2, flaky=$f2, exit $code2). Staying red."
exit $code2
