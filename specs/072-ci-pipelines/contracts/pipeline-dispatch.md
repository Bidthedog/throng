# Contract: `pipeline.yml`

## Triggers

- `schedule`: nightly on master. Mode `nightly` (no fail-fast), always full.
- `workflow_dispatch` on any ref. Mode `agent` (fail-fast).
- `workflow_call` from `release.yml`. Mode `agent`, always full, inputs ignored.

No `push`, `pull_request` or other trigger.

## Dispatch inputs (absent = everything / default)

| Input | Type | Default | Meaning |
|---|---|---|---|
| `stages` | string | `all` | comma list from `lint, typecheck, unit, component, integration, contract, e2e, admin, calibration, package, verify` |
| `platforms` | string | `all` | comma list from `windows, linux, macos-current, macos-previous` |
| `e2e_filter` | string | — | Playwright grep, or a spec path (`packages/ui/tests/e2e/x.e2e.ts`), or a category tag (`@editor`) |
| `test_filter` | string | — | vitest file path or `-t` name pattern for unit/component/integration/contract |
| `shards` | string | `windows=4,linux=2,macos=2` | E2E shard counts per platform |
| `stress_spec` / `stress_grep` / `stress_rounds` | string / string / number | — / — / 20 | run one E2E test N rounds, retries off, every round's evidence kept; implies `stages=e2e` on one platform (`platforms`, default `windows`) |
| `hand_tests` | boolean | false | also run the manual plan on runners (never in nightly or a release) |
| `trace` | boolean | false | Playwright traces on failure |
| `run_to_completion` | boolean | false | Every job and test runs to the end, as the nightly does (`fail_fast=false`); a dispatch only, never a release. Added 2026-11-18 at the maintainer's request |

## Run name

`pipeline (full)` when the run is full (see data model), otherwise `pipeline (partial: <stages> on <platforms>)`.
Preflight and the report treat only `pipeline (full)` and `schedule` runs as full.

## Guarantees (asserted by `pipeline-workflow.test.ts`)

1. It never references `secrets.REPO_SIGNING_KEY`, never uses `environment: release`, never runs `gh release
   create|upload|edit`, `gh workflow run pages.yml`, or any repository upload.
2. Every job except `plan`, `verdict` and `report` ends with a fail-fast cancel step gated on
   `needs.plan.outputs.fail_fast == 'true'`.
3. No job's `if` depends on a test job's result, except `verdict` and `report`.
4. Packaging jobs need only `plan` (and the macOS runner list); verify jobs need only their own build job.
5. No literal macOS runner label; no self-hosted runner.

## Outputs (to a caller)

- `verdict`: `success` | `failure`
- the artifacts `throng-*`, `verdict-*`, `release-body`, `linux-upgrade-fixture`, `macos-upgrade-fixture`, uploaded in
  the caller's run.
