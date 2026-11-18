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
# Playwright empties test-results/ at the start of every run, so a failing round's error-context.md (the page's aria
# snapshot) was wiped by the next passing round and never reached the artifact. Each failing round's results are set
# aside here and put back under test-results/round-<n>/ once the loop ends.
kept="$(mktemp -d)"
for ((i = 1; i <= rounds; i++)); do
  if npx playwright test "${args[@]}" >"round-$i.log" 2>&1; then
    pass=$((pass + 1))
    echo "round $i: pass"
  else
    fail=$((fail + 1))
    echo "round $i: FAIL"
    tail -60 "round-$i.log"
    if [ -d test-results ]; then cp -r test-results "$kept/round-$i"; fi
    # The run dir a failing round keeps (scripts/test-run-dir.mjs) holds main's and the daemon's diagnostics logs, with
    # timestamps: when an attach was asked, answered or timed out. Its logs only — the Chromium profile beside them is
    # tens of megabytes and says nothing.
    while IFS= read -r run_dir; do
      if [ -d "$run_dir" ]; then
        mkdir -p "$kept/round-$i/run-dir"
        (cd "$run_dir" && find . -type f -name '*.log' -exec cp --parents {} "$kept/round-$i/run-dir/" \;)
      fi
    done < <(sed 's/\x1b\[[0-9;]*m//g' "round-$i.log" | grep -oE '/[^ :]*/throng_e2e_[A-Za-z0-9_-]+' | sort -u)
  fi
done
mkdir -p test-results
for dir in "$kept"/round-*; do
  if [ -d "$dir" ]; then mv "$dir" test-results/; fi
done
rm -rf "$kept"

summary="### $spec: $pass passed, $fail failed of $rounds"
echo "$summary"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$summary" >>"$GITHUB_STEP_SUMMARY"; fi
[ "$fail" -eq 0 ]
