#!/usr/bin/env bash
#
# Stress ONE E2E test until it fails on demand, or show it no longer does (the pipeline's `stress` job).
#
# Separate invocations, never `--repeat-each` (throng-testing, references/flakes.md): each round is its own `playwright
# test` process with its own app and config root, exactly as the suite runs it, with retries OFF so a first-attempt
# failure counts as one. Every round's log is kept for the artifact upload.
#
#   SPEC     packages/ui/tests/e2e/<file>.e2e.ts
#   GREP     optional: one test in the file
#   ROUNDS   separate invocations to run
#
# On Linux, run it under scripts/ci-linux-display.sh.
set -euo pipefail

spec="${SPEC:?SPEC is not set}"
grep_title="${GREP:-}"
rounds="${ROUNDS:-20}"

if [[ "$spec" != *.e2e.ts ]]; then
  echo "::error::stress_spec must be a full path ending .e2e.ts" >&2
  exit 2
fi

args=("$spec" --workers=1 --retries=0)
if [ -n "$grep_title" ]; then args+=(--grep "$grep_title"); fi

pass=0
fail=0
for ((i = 1; i <= rounds; i++)); do
  if npx playwright test "${args[@]}" >"round-$i.log" 2>&1; then
    pass=$((pass + 1))
    echo "round $i: pass"
  else
    fail=$((fail + 1))
    echo "round $i: FAIL"
    tail -60 "round-$i.log"
  fi
done

summary="### $spec: $pass passed, $fail failed of $rounds"
echo "$summary"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$summary" >>"$GITHUB_STEP_SUMMARY"; fi
[ "$fail" -eq 0 ]
