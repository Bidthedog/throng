#!/usr/bin/env bash
#
# The pipeline's plan (072 FR-017, FR-018, FR-019, FR-020): turns the trigger and the dispatch inputs into the job outputs
# every other job of .github/workflows/pipeline.yml reads. The workflow's `plan` job runs it and nothing else.
#
# Inputs arrive through the environment, never interpolated into a script line, and each is checked against an allowlist
# here: a typo fails the run (exit 2, an ::error:: line) instead of quietly running nothing.
#
#   EVENT         github.event_name: schedule, workflow_dispatch, or push (a call from release.yml's tag run)
#   STAGES        comma list, or all / empty
#   PLATFORMS     comma list, or all / empty
#   E2E_FILTER    Playwright grep, a spec path (.e2e.ts) or a category tag
#   TEST_FILTER   a vitest file path, or a -t name pattern
#   SHARDS        windows=4,linux=2,macos=2 (any subset)
#   STRESS_SPEC / STRESS_GREP / STRESS_ROUNDS
#   HAND_TESTS / TRACE   'true' on a dispatch only
#   RUN_TO_COMPLETION    'true' on a dispatch only: fail_fast=false, as the nightly
#
# Outputs go to $GITHUB_OUTPUT, one `key=value` per line.
set -euo pipefail

fail() {
  echo "::error::$*" >&2
  exit 2
}

event="${EVENT:-}"
stages_in="${STAGES:-}"
platforms_in="${PLATFORMS:-}"
e2e_filter="${E2E_FILTER:-}"
test_filter="${TEST_FILTER:-}"
shards_in="${SHARDS:-}"
stress_spec="${STRESS_SPEC:-}"
stress_grep="${STRESS_GREP:-}"
stress_rounds="${STRESS_ROUNDS:-20}"
out="${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set}"

ALL_STAGES=(lint typecheck unit component integration contract e2e admin calibration package verify)
ALL_PLATFORMS=(windows linux macos-current macos-previous)

contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

# A list input into the global array SELECTED: 'all' or empty is everything; anything not on the allowlist is refused. Not
# a command substitution, so `fail` ends the script instead of a subshell.
SELECTED=()
select_from() {
  local label="$1" raw="$2"
  shift 2
  local universe=("$@") picked=() item
  SELECTED=()
  if [ -z "$raw" ] || [ "$raw" = all ]; then
    SELECTED=("${universe[@]}")
    return 0
  fi
  IFS=',' read -r -a picked <<<"$raw"
  for item in "${picked[@]}"; do
    item="${item// /}"
    contains "$item" "${universe[@]}" || fail "unknown $label '$item' (expected ${universe[*]} or all)"
    SELECTED+=("$item")
  done
}

json_array() {
  local first=1 item
  printf '['
  for item in "$@"; do
    if [ "$first" = 0 ]; then printf ','; fi
    first=0
    case "$item" in
      '' | *[!0-9]*) printf '"%s"' "$item" ;;
      *) printf '%s' "$item" ;;
    esac
  done
  printf ']'
}

emit() { printf '%s=%s\n' "$1" "$2" >>"$out"; }

# Filters are free text, so they get the strictest check: no shell metacharacter, no quote, bounded length.
check_text() {
  local label="$1" value="$2"
  if [ "${#value}" -gt 200 ]; then fail "$label is longer than 200 characters"; fi
  if [[ ! "$value" =~ ^[A-Za-z0-9\ _./@:\|\*-]*$ ]]; then fail "$label carries a character outside [A-Za-z0-9 _./@:|*-]"; fi
}

dispatch=false
[ "$event" = workflow_dispatch ] && dispatch=true

# A schedule and a call always run the full pipeline and ignore every input (contract: Triggers).
if [ "$dispatch" = false ]; then
  stages_in=all platforms_in=all e2e_filter='' test_filter='' shards_in='' stress_spec='' stress_grep=''
fi

mode=agent
fail_fast=true
if [ "$event" = schedule ]; then
  mode=nightly
  fail_fast=false
fi
# A dispatch asked to run to completion sweeps for every failure at once, as the nightly does; a release never does.
if [ "$event" = workflow_dispatch ] && [ "${RUN_TO_COMPLETION:-}" = true ]; then
  fail_fast=false
fi

check_text e2e_filter "$e2e_filter"
check_text test_filter "$test_filter"
check_text stress_grep "$stress_grep"
if [ -n "$stress_spec" ] && [[ ! "$stress_spec" =~ ^[A-Za-z0-9_./-]+\.e2e\.ts$ ]]; then
  fail "stress_spec must be a path ending .e2e.ts, got '$stress_spec'"
fi
[[ "$stress_rounds" =~ ^[0-9]{1,3}$ ]] && [ "$stress_rounds" -ge 1 ] || fail "stress_rounds must be 1 to 999, got '$stress_rounds'"

select_from stage "$stages_in" "${ALL_STAGES[@]}"
stages=("${SELECTED[@]}")
select_from platform "$platforms_in" "${ALL_PLATFORMS[@]}"
platforms=("${SELECTED[@]}")

# A stress run is one E2E spec on one platform (windows by default), and nothing else.
stress=false
stress_platform=windows
if [ -n "$stress_spec" ]; then
  stress=true
  if [ -n "$platforms_in" ] && [ "$platforms_in" != all ]; then
    stress_platform="${platforms[0]}"
    contains "$stress_platform" windows linux || fail "a stress run takes platforms=windows or linux, got '$stress_platform'"
  fi
  stages=()
  platforms=()
fi

# FR-018: full means every stage, every platform, no filter and no stress input.
full=false
if [ "$dispatch" = false ] ||
  { [ "${#stages[@]}" = "${#ALL_STAGES[@]}" ] && [ "${#platforms[@]}" = "${#ALL_PLATFORMS[@]}" ] &&
    [ -z "$e2e_filter" ] && [ -z "$test_filter" ] && [ "$stress" = false ]; }; then
  full=true
fi

has_stage() { [ "${#stages[@]}" -gt 0 ] && contains "$1" "${stages[@]}"; }
has_platform() { [ "${#platforms[@]}" -gt 0 ] && contains "$1" "${platforms[@]}"; }

p_windows=false p_linux=false p_macos_current=false p_macos_previous=false p_macos=false
has_platform windows && p_windows=true
has_platform linux && p_linux=true
has_platform macos-current && p_macos_current=true
has_platform macos-previous && p_macos_previous=true
{ [ "$p_macos_current" = true ] || [ "$p_macos_previous" = true ]; } && p_macos=true

layers=()
for layer in unit component integration contract; do has_stage "$layer" && layers+=("$layer"); done

# A verification job needs the artifact its build uploads, so `verify` alone would skip every job it selects.
if has_stage verify && ! has_stage package; then fail "stage verify needs stage package (verification installs what packaging built); ask for stages=package,verify"; fi

# A test PATH belongs to one vitest project, and every other layer would find no test file and fail empty (there is no
# --passWithNoTests), so a path selects only the layer that owns it. A name pattern (-t) runs in every selected layer. The
# test is the same one scripts/ci-vitest.sh makes to tell a path from a pattern.
if [ -n "$test_filter" ] && [ "${#layers[@]}" -gt 0 ]; then
  case "$test_filter" in
    */* | *.test.*)
      owner=''
      case "$test_filter" in
        */tests/unit/*) owner=unit ;;
        */tests/component/*) owner=component ;;
        */tests/integration/*) owner=integration ;;
        */tests/contract/*) owner=contract ;;
      esac
      [ -n "$owner" ] || fail "test_filter '$test_filter' is a path, but not under tests/unit, tests/component, tests/integration or tests/contract"
      contains "$owner" "${layers[@]}" || fail "test_filter '$test_filter' is a $owner test, and stages=${stages_in:-all} leaves $owner out"
      layers=("$owner")
      ;;
  esac
fi

# Shards per platform (R4). A filtered run is a handful of tests, and an empty shard fails its job, so it gets one.
declare -A shard_n=([windows]=4 [linux]=2 [macos]=2)
if [ -n "$shards_in" ]; then
  IFS=',' read -r -a pairs <<<"$shards_in"
  for pair in "${pairs[@]}"; do
    key="${pair%%=*}"
    val="${pair#*=}"
    [ "$key" != "$pair" ] && contains "$key" windows linux macos || fail "shards entry '$pair' is not windows=N, linux=N or macos=N"
    [[ "$val" =~ ^[0-9]$ ]] && [ "$val" -ge 1 ] || fail "shards entry '$pair' needs a count from 1 to 9"
    shard_n[$key]="$val"
  done
fi
if [ -n "$e2e_filter" ]; then shard_n=([windows]=1 [linux]=1 [macos]=1); fi
shard_list() { seq 1 "${shard_n[$1]}" | tr '\n' ' '; }

# Something has to run: a selection that no platform can host would pass as an empty run.
runs_something=false
if [ "$stress" = true ]; then runs_something=true; fi
{ has_stage lint || has_stage typecheck; } && runs_something=true
if [ "${#layers[@]}" -gt 0 ] || has_stage e2e || has_stage package; then
  { [ "$p_windows" = true ] || [ "$p_linux" = true ] || [ "$p_macos" = true ]; } && runs_something=true
fi
has_stage admin && [ "$p_windows" = true ] && runs_something=true
# The calibration job is the whole spec: an e2e_filter skips it.
has_stage calibration && [ -z "$e2e_filter" ] && [ "$p_windows" = true ] && runs_something=true
[ "$runs_something" = true ] || fail "the selection (stages=${stages_in:-all}, platforms=${platforms_in:-all}) matches no job"

# The hand tests and the trace are for a person at a dispatch, never for the nightly or a release (R13).
hand_tests=false trace=false
if [ "$dispatch" = true ]; then
  [ "${HAND_TESTS:-}" = true ] && hand_tests=true
  [ "${TRACE:-}" = true ] && trace=true
fi

emit mode "$mode"
emit fail_fast "$fail_fast"
emit full "$full"
emit stress "$stress"
emit stress_platform "$stress_platform"
emit stress_spec "$stress_spec"
emit stress_grep "$stress_grep"
emit stress_rounds "$stress_rounds"
emit hand_tests "$hand_tests"
emit trace "$trace"
emit e2e_filter "$e2e_filter"
emit test_filter "$test_filter"
for stage in "${ALL_STAGES[@]}"; do
  if has_stage "$stage"; then emit "stage_$stage" true; else emit "stage_$stage" false; fi
done
emit p_windows "$p_windows"
emit p_linux "$p_linux"
emit p_macos "$p_macos"
emit p_macos_current "$p_macos_current"
emit p_macos_previous "$p_macos_previous"
if [ "${#layers[@]}" -gt 0 ]; then emit layers "$(json_array "${layers[@]}")"; else emit layers '[]'; fi
for platform in windows linux macos; do
  # shellcheck disable=SC2046
  emit "shards_$platform" "$(json_array $(shard_list "$platform"))"
  emit "shard_n_$platform" "${shard_n[$platform]}"
done
