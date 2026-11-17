#!/usr/bin/env bash
#
# One vitest layer of the full pipeline (072 FR-015), the same on every platform. The pipeline's vitest jobs run this and
# upload the JSON result file it writes, which scripts/pipeline-report.mjs reads.
#
#   LAYER         unit, component, integration or contract
#   RESULT_FILE   where the JSON report goes (results-<platform>-<layer>.json)
#   FAIL_FAST     'true' stops at the first failing test (--bail=1); the nightly never sets it (FR-019, FR-020)
#   TEST_FILTER   optional: a vitest file path, or a name pattern (-t)
#
# There is deliberately no --passWithNoTests: a filter that selects nothing fails its job.
set -euo pipefail

layer="${LAYER:?LAYER is not set}"
result="${RESULT_FILE:?RESULT_FILE is not set}"
fail_fast="${FAIL_FAST:-false}"
filter="${TEST_FILTER:-}"

case "$layer" in
  unit | component | integration | contract) ;;
  *)
    echo "::error::LAYER must be unit, component, integration or contract, got '$layer'" >&2
    exit 2
    ;;
esac

# Integration and contract spawn the REAL daemon (`node packages/daemon/dist/main.js`) and read its dist/BUILD_ID, so the
# daemon is built first: on a clean checkout there is no dist/.
if [ "$layer" = integration ] || [ "$layer" = contract ]; then npm run build; fi

args=(--reporter=default --reporter=json "--outputFile.json=$result")
# The skip-reasons reporter lists every skip by its platform guard's reason, and fails one that gives none (070 FR-038).
if [ "${RUNNER_OS:-}" = macOS ]; then args+=(--reporter=./packages/platform/tests/support/skip-reasons.reporter.ts); fi
if [ "$fail_fast" = true ]; then args+=(--bail=1); fi
if [ -n "$filter" ]; then
  case "$filter" in
    */* | *.test.*) args+=("$filter") ;;
    *) args+=(-t "$filter") ;;
  esac
fi

exec npm run "test:$layer" -- "${args[@]}"
