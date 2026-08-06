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
  [Parameter(Mandatory = $true)] [string] $Shard,          # e.g. "3/3" - reporting label only
  # Which group of shard-plan.json to run. The plan is built from measured durations; Playwright's
  # own --shard splits by test count in file order, which let the alphabet decide and produced
  # 3.7 / 8.3 / 36-minute shards.
  [string] $Group = '',
  [string] $ReportFile = 'shard-report.json',
  [int]    $TrackingIssue = 75
)

$ErrorActionPreference = 'Stop'

function Invoke-Shard {
  if (Test-Path $ReportFile) { Remove-Item $ReportFile -Force }
  # Clear the blob dir too, so a retry's merged report isn't a doubled copy of this shard.
  if (Test-Path 'blob-report') { Remove-Item 'blob-report' -Recurse -Force }
  # `test:e2e:raw`, NOT `test:e2e`. The latter is the local two-pass runner, which re-runs a fixed
  # list of contention-sensitive specs at one worker — meaningless here (a shard is already
  # single-worker on its own runner) and actively wrong, because its explicit file list would
  # override this shard's group and run other shards' specs.
  if ($Group) {
    $env:THRONG_E2E_GROUP = $Group
    npm run test:e2e:raw
  }
  else {
    npm run test:e2e:raw -- --shard=$Shard
  }
  # Publish the code through a script-scoped variable, NEVER as this function's return value.
  #
  # `return $LASTEXITCODE` looks equivalent and is not. A PowerShell function returns its whole
  # OUTPUT STREAM, and a native command's stdout is part of that stream — so `$code = Invoke-Shard`
  # bound an ARRAY of every line npm printed, with the exit code last. `-eq` against an array is not
  # a comparison but a FILTER returning the matching elements, and the result is then judged for
  # truthiness. Playwright prints STRINGS, and `[bool]'0'` is $true in PowerShell (a non-empty
  # string) where `[bool]0` is $false. So a single output line that is exactly "0" made
  # `if ($code -eq 0)` take the pass branch with a failed run behind it.
  #
  #   $code = @('...', '0', '...', 1); $code -eq 0   ->   '0'   ->   [bool]'0' = $true
  #
  # Measured on run 30935446702: shard 3 reported "pass" in GitHub while its own blob report ended
  # `"status": "failed"` with 51 tests failing all four attempts. The strict gate below never ran,
  # which is why a suite with 51 known-red tests looked green for as long as it did.
  $script:ShardExit = $LASTEXITCODE
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

# Say out loud what a green run does and does not cover.
#
# GitHub's hosted runners have administrator rights and UAC disabled, and BOTH ways of giving them up
# were measured failing here (run 30947653266): a Limited scheduled task still reported admin=True
# because with UAC off there is no filtered token to fall back on, and `runas /trustlevel` produced
# nothing at all. `scripts/run-deelevated.ps1` is kept for a self-hosted runner that has UAC on.
#
# A handful of spec files still self-skip on CI via skipIfElevated(). That number used to be ~85, and
# an audit (run 30979816073, which ran every guarded spec elevated) showed 71 files had no reason for
# the guard at all — the whole editor cluster among them. What remains are the specs whose SUBJECT is
# the process tree: conhost reaping, command observation, working-directory reading, run-as-admin.
#
# The count is printed live on every run because what made the old gap dangerous was silence, not
# size — nobody can fix an environment limit from inside the repo, but everybody should see it.
if ($env:CI -eq 'true') {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $elevated = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($elevated) {
    $guarded = @(Select-String -Path 'packages/ui/tests/e2e/*.e2e.ts' -Pattern 'skipIfElevated' -List).Count
    Write-Host "::warning::E2E shard ${Shard} runs WITH administrator rights, so $guarded spec files self-skip via skipIfElevated(). A green E2E stage says nothing about those specs; they are covered by a developer's non-elevated run."
  }
  else {
    Write-Host "shard ${Shard}: running without admin rights — skipIfElevated specs will execute"
  }
}

Invoke-Shard
$code = [int]$script:ShardExit

# A scalar, or this whole gate is decorative — see the note in Invoke-Shard.
if ($code -isnot [int]) {
  Write-Host "::error::E2E shard $Shard could not determine an exit code (got '$code'). Treating as a hard failure."
  exit 1
}

# Trust a zero exit only if the report agrees with it. Playwright writing `unexpected > 0` while
# exiting 0 should be impossible; after this gate silently passed a failed shard, "impossible" is
# not a thing to stake the branch on, and the check costs one file read.
if ($code -eq 0) {
  $ok = Get-Stats
  if ($ok -and (([int]$ok.unexpected) -gt 0 -or ([int]$ok.flaky) -gt 0)) {
    Write-Host "::error::E2E shard $Shard exited 0 but its report says unexpected=$($ok.unexpected) flaky=$($ok.flaky). Refusing to call that a pass."
    exit 1
  }
  Write-Summary "E2E shard $Shard passed."
  exit 0
}

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

# A shard that collected NOTHING is a build or configuration fault, and those are DETERMINISTIC.
#
# It reaches here looking exactly like an infra fault — 0 unexpected, 0 flaky, non-zero exit — so the
# retry below fires and buys a second identical failure. Measured on run 31028134235: every spec
# failed to import `@throng/persistence` because the shard ran `test:e2e:raw`, which had no
# `pretest:e2e:raw` build hook, and Playwright still spent 94s transpiling 70 spec files before
# saying "No tests found" — twice, for 3m10s of a 5m6s job. With the build hook in place a retry
# would repeat the BUILD too, making the waste worse rather than better.
#
# `expected` is Playwright's count of tests it planned to run. Zero of them means the suite never
# existed, which no retry has ever fixed.
if ([int]$stats.expected -eq 0) {
  Write-Host "::error::E2E shard $Shard collected NO tests (expected=0, exit $code). That is a build or configuration fault, not a transient one — failing immediately rather than retrying an identical failure."
  Write-Summary "E2E shard $Shard collected no tests — build/config fault, not retried."
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

Invoke-Shard
$code2 = [int]$script:ShardExit
if ($code2 -eq 0) {
  Write-Summary "E2E shard $Shard passed on infra-retry."
  exit 0
}

$stats2 = Get-Stats
$u2 = if ($stats2) { [int]$stats2.unexpected } else { 1 }
$f2 = if ($stats2) { [int]$stats2.flaky } else { 0 }
Write-Host "::error::E2E shard $Shard failed again after infra-retry (unexpected=$u2, flaky=$f2, exit $code2). Staying red."
exit $code2
