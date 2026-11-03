# Run the @admin E2E subset on a hosted runner, which is elevated. ci.yml runs it on every ready PR
# and gate.yml on the nightly; the reason it is its own job is at ci.yml's `e2e-admin`.
#
# `npx playwright test` DIRECTLY, never `npm run test:e2e:admin`: that script exists to hop UAC from
# a non-elevated shell (Start-Process -Verb RunAs) and is pointless, and interactive (-NoExit), where
# the process is already elevated.

$env:THRONG_E2E_WORKERS = '1'
# Clears playwright.config.ts's grepInvert so @admin is SELECTED rather than excluded.
$env:THRONG_E2E_INCLUDE_ADMIN = '1'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = 'admin-report.json'
# The worst case here, connect + readiness (019 C7), must fit inside the de-elevation spec's own
# LAUNCH_BUDGET_MS, or a late failure reads as "it hung (#94)", the very failure the spec exists to
# detect. Connect is 1.5x the slowest launch measured: the launcher compiles C# in PowerShell, which on
# a cold runner took 5.1, 6.4, 6.6 and 13.4 s (then 0.3 s), so an 8 s budget failed the first launch
# about one job in four. The second budget covers only the agent's ack, which is quick once it is up.
# Production defaults (15000/15000) are untouched; these are injected settings, not code (Principle X).
$env:THRONG_AGENT_CONNECT_TIMEOUT_MS = '20000'
$env:THRONG_AGENT_READY_TIMEOUT_MS = '8000'

# Quote '@admin': in PowerShell a bare @admin is the splatting operator on an (undefined) variable
# $admin, so the tag expands to nothing and Playwright selects zero tests, which the fail-on-zero
# guard below then reports as an uncovered de-elevation path.
npx playwright test --grep '@admin' --workers=1 --reporter=list,json
$testsFailed = $LASTEXITCODE -ne 0

# A run that selected NOTHING must fail. Playwright exits 0 on an empty selection, so exit code alone
# cannot tell "all @admin specs passed" from "no @admin spec ran", and SC-008 measures EXECUTED > 0,
# not exit 0. A green bar bought by an empty selection is precisely the proof-that-cannot-fail this
# feature abolishes.
if (-not (Test-Path admin-report.json)) { throw 'No @admin JSON report was produced.' }
$stats = (Get-Content admin-report.json -Raw | ConvertFrom-Json).stats
$executed = $stats.expected + $stats.unexpected + $stats.flaky
Write-Host "@admin executed=$executed (expected=$($stats.expected) unexpected=$($stats.unexpected) flaky=$($stats.flaky) skipped=$($stats.skipped))"
if ($executed -lt 1) {
  throw "No @admin test EXECUTED ($($stats.skipped) skipped). This runner is elevated, so an @admin spec that skips or is grep-excluded means the de-elevation path is unverified: the hole 019 FR-013a closes."
}
if ($testsFailed) { throw 'The @admin E2E suite failed.' }
