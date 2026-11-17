#!/usr/bin/env bash
#
# One E2E shard of the full pipeline (072 R4), the same on every platform:
#
#   bash scripts/ci-e2e-shard.sh                                  Windows and macOS
#   scripts/ci-linux-display.sh bash scripts/ci-e2e-shard.sh      Linux, under a real display
#
#   SHARD_INDEX, SHARD_COUNT   this shard of N (1-based)
#   E2E_FILTER                 optional: a Playwright grep, a spec path (.e2e.ts) or a category tag
#   FAIL_FAST                  'true' stops at the first failing test (fail-fast runs only)
#
# Unfiltered, it is `npm run test:e2e` (both tiers, this shard's share of each, see scripts/run-e2e-local.mjs). Filtered,
# it is one Playwright run of what the filter selects, at one worker. Either way an empty shard fails the job: there is
# deliberately no --pass-with-no-tests.
set -euo pipefail

index="${SHARD_INDEX:?SHARD_INDEX is not set}"
count="${SHARD_COUNT:?SHARD_COUNT is not set}"
filter="${E2E_FILTER:-}"
fail_fast="${FAIL_FAST:-false}"

if [ -z "$filter" ]; then
  export THRONG_E2E_SHARD="$index/$count"
  if [ "$fail_fast" = true ]; then export THRONG_E2E_FAIL_FAST=1; fi
  exec npm run test:e2e
fi

args=(--workers=1 "--shard=$index/$count")
if [ "$fail_fast" = true ]; then args+=(--max-failures=1); fi
case "$filter" in
  *.e2e.ts) args+=("$filter") ;;
  *) args+=(--grep "$filter") ;;
esac
exec npm run test:e2e:raw -- "${args[@]}"
