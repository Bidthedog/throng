# Research: Three CI Pipelines

All decisions below were made from the workflows on master at `a8d7d3ea` and the alpha17 run timings in the spec's
Background. No NEEDS CLARIFICATION remains.

## R1 — Four workflow files, one of them reusable

- **Decision**: `ci.yml` (PRs only), `pipeline.yml` (new; replaces `gate.yml`; triggers `schedule`,
  `workflow_dispatch` and `workflow_call`), `release.yml` (`push: tags: ['v*']` only; calls `pipeline.yml`, then
  signs, publishes and deploys), and `pages.yml` (`workflow_dispatch` only; the release still dispatches it).
  `gate.yml` is deleted.
- **Rationale**: a called workflow's jobs run inside the caller's run, so the artifacts `pipeline.yml` uploads are
  downloadable by `release.yml`'s publish jobs in the same run (FR-023). One definition of "the full pipeline" serves
  the nightly, a dispatch and a release.
- **Alternatives**: keep `gate.yml` and grow `release.yml` (two copies of the packaging graph, which is today's drift
  source); a release that dispatches the pipeline and polls it (two runs, artifacts across runs, no single verdict).

## R2 — Fail fast across jobs: each job cancels its own run on failure

- **Decision**: a first `plan` job resolves `fail_fast` (`true` unless `github.event_name == 'schedule'`). Every test,
  build and verify job ends with `if: failure() && needs.plan.outputs.fail_fast == 'true'` → `gh run cancel
  ${{ github.run_id }}` (`actions: write`). Inside a job, fail-fast runs pass vitest `--bail=1` and Playwright
  `--max-failures=1`; the nightly passes neither.
- **Rationale**: GitHub Actions has no cross-job fail-fast; matrix `fail-fast` only covers one matrix. Cancelling the
  run also cancels the caller's later jobs in a release run, so nothing publishes (FR-019, FR-022). The cancel lands
  within seconds of the failing step (SC-005).
- **Alternatives**: a watcher job polling the run (an extra runner and a polling delay); `fail-fast: true` per matrix
  (does not stop other jobs).

## R3 — The nightly runs to completion

- **Decision**: no job's `if` depends on a test job's result. A verify job depends only on its own artifact's build
  (`!cancelled() && needs.build-x.result == 'success'`). The `verdict` and `report` jobs use `if: always()`.
- **Rationale**: FR-020. A failing Linux integration test must not skip Windows packaging.

## R4 — Sharding and parallelism

- **Decision**:
  - Each layer runs as its own job per platform: unit, component, integration, contract, E2E, admin E2E and
    calibration.
  - **Windows E2E** runs in 4 shards with Playwright `--shard=i/N`. `scripts/run-e2e-local.mjs` gains a
    `THRONG_E2E_SHARD` that it applies to both tiers, so each shard runs its share of the parallel tier, then its share
    of the serial tier.
  - **Linux E2E** runs in 2 shards; **macOS E2E** in 2 shards per release.
  - The `shards` dispatch input overrides the counts.
  - **Packaging** jobs start at minute 0, needing only `plan`.
- **Rationale**: 46 min of Windows E2E ÷ 4 ≈ 12 min, plus about 3 min of setup. The serial tier must stay one-at-a-time
  within a machine (focus-stealing specs), but separate runners are separate machines.
- **Risk**: the full suite has never run on Linux or macOS beyond `@core` plus the platform's own tests. Their shard
  counts are first guesses, tuned from the first full dispatch on this branch. macOS is capped at 5 concurrent jobs,
  so its jobs queue.

## R5 — PR CI in 5 minutes on Linux

- **Decision**: Linux-only jobs, running in parallel:
  - `lint` (lint + typecheck, one runner);
  - `unit`;
  - `component`, in 2 vitest `--shard`s;
  - `contract`;
  - `integration` (build, then `--tags-filter=critical-path`);
  - `verdict` (`needs` all of the above, `if: always()`, fails unless every one succeeded).

  npm cache on. No `workflow_dispatch`, no draft guard. Concurrency per PR with cancel-in-progress.
- **Rationale**:
  - Linux unit and component took 3 min together on alpha17's CI and integration/contract 4 min, setup included.
    Split, each job's tests fit in 1–2 min after about 1.5 min of setup.
  - One verdict check is the only required check, so job renames never touch branch protection again (FR-004).
- **Alternatives**: required checks per job (every rename is a settings change).

## R6 — The integration subset is a vitest tag

- **Decision**:
  - Mark at most 15 of the 210 integration files with `{ tags: ['critical-path'] }` at the top `describe`. The
    `critical-path` tag is already declared in `vitest.config.ts`, and `td` maps it.
  - A unit guard counts the files carrying the tag and fails over 15.
  - Selection: one file per subsystem that PR CI otherwise leaves unexercised (daemon persistence, PTY host lifecycle,
    config write and watch, editor save, explorer file operations, the IPC bridge), choosing the cheapest file that
    covers each. The total stays ≤ 90 s on Linux.
- **Alternatives**: a file list in the workflow (it drifts from the tests); directory-based selection (no such
  directory split exists).
- **Chosen (T007, 2026-11-17)**: 15 files, 77 tests:
  - persistence: `workspace-persistence`, `workspace-layout-v3`;
  - PTY: `pty-agent-host`, `terminal-write-ordering`;
  - config: `config-store`, `config-write-serialisation`, `config-watcher-partial-read`;
  - editor: `editor-service-save`, `editor-fidelity`;
  - explorer: `files-move-same-folder`, `rename-case-only`, `node-file-system-copy-cancel`;
  - IPC and daemon: `daemon-unavailable`, `health-ping`, `link-ipc-confinement`.
- **Measured on Linux**:
  - `--tags-filter=critical-path` alone took 91 s, because vitest still imports all 194 files to read their tags
    (setup 85%).
  - The same filter with the tagged files passed as arguments took **8.6 s**. `ci.yml` therefore passes the list it
    gets from `grep -rlE "tags: \[[^]]*'critical-path'" packages/*/tests/integration`, so the tag stays the only
    declaration.
  - Every chosen file imports from source, and none spawns the built daemon, so the PR `integration` job needs no
    `npm run build`.

## R7 — Significance tags stay; the `@core` cap goes

- **Decision**: every E2E test keeps exactly one of `@core` / `@extended`. `e2e-tags.test.ts` keeps that rule and loses
  only the `CORE_CAP` assertion. `e2e-budget.json` and its ratchet are unchanged, because no test is re-tagged.
- **Rationale**: FR-006 withdraws the lane and the cap, not the classification. `td`'s adapter still maps
  `critical-path` to `@core`, and changing nothing else avoids churn across 522 tests.

## R8 — Nightly report and the single issue

- **Decision**:
  - Every test job uploads a machine-readable result: the vitest `json` reporter, or the Playwright JSON already
    produced (`THRONG_E2E_JSON_OUT`).
  - A final `report` job (`if: always()`, nightly or a full dispatch on master) runs `scripts/pipeline-report.mjs`. It
    lists failed jobs through the API, reads the uploaded results, and writes one comment, each failure linked, on the
    single open issue titled **"Nightly pipeline failed on master"** (opening it if none is open).
  - A fully green full run on master's head closes that issue with a comment (FR-021).
- **Rationale**: one place, every failure, linked. This continues the existing de-duplication in `gate.yml`'s
  `report-failure` job.
- **Alternatives**: one issue per failure (noise, and the next day's agent needs the set); a job summary only (not
  visible to preflight).

## R9 — Preflight reads the nightly

- **Decision**: `release-preflight.mjs` judges the latest completed **full** `pipeline.yml` run on master: `schedule`,
  or a dispatch whose run name is `pipeline (full)`. It must have succeeded at its first attempt, as 065 required, and
  the nightly issue must be closed. The `release.yml`-on-master check and `isFullGate` go; `isFullPipeline` replaces
  them. `release-e2e-reuse.mjs` and its test are deleted.

## R10 — Discarding a failed release attempt

- **Decision**: a new `scripts/release-discard.mjs <tag> [--dry-run]` that:
  1. refuses if a release for the tag exists;
  2. deletes the remote tag;
  3. lists `release.yml` runs for that tag and deletes each run's **build** artifacts (`throng-*`, `*-upgrade-fixture`,
     `repo-index-bundle`, `release-body`).

  Test evidence (`test-results-*`, `*-report*`, `installer-logs-*`, `verdict-*`) is kept until it expires. The local
  tag is deleted by the runbook.
- **Rationale**: FR-031. One command the release agent runs, testable with an injected API.

## R11 — Concurrency

- **Decision**:
  - `ci.yml`: group `ci-<PR>`, cancel-in-progress.
  - `pipeline.yml`: group `pipeline-<event>-<ref>`, cancel-in-progress for dispatch. A schedule run gets its own group,
    so a dispatch and the nightly never cancel each other. A called run gets a group keyed by `run_id`, because the
    caller already serialises.
  - `release.yml`: group `release-<ref>`, cancel-in-progress (a re-cut tag replaces its older run, FR-026).

## R12 — The workflow guards

- **Decision**:
  - `scripts/check-platform-jobs-unchanged.mjs` and `workflows-unchanged.test.ts` are removed. They were 070's
    one-time branch-end check (070 FR-039: Windows and Linux lanes unchanged by macOS work). This feature changes those
    lanes on purpose, so 070 FR-039 joins the supersession table.
  - `macos-runners.test.ts`'s required job ids move to the new workflows.
  - `release-unattended.test.ts` and `release-repositories.test.ts` move to the new `release.yml` shape (tag-only
    trigger, `pipeline` call, publish needs).
  - `self-hosted-runner-exposure.test.ts` is unchanged.
  - New guards: `ci-workflow.test.ts` and `pipeline-workflow.test.ts` (triggers, platforms, no publishing, no signing
    key, a fail-fast step on every job, report and verdict wiring).

## R13 — Calibration and hand tests

- **Decision**:
  - The memory calibration asserts on every full run. The release lane's `THRONG_CALIBRATE_LOG_ONLY` goes, since the
    release now runs the same jobs on the same runners as the nightly.
  - The `hand_tests` and `trace` inputs move from `release.yml` to `pipeline.yml`'s dispatch, and are never set by
    schedule or call.

## R14 — Required checks, badges, the website

- **Decision**:
  - Once `CI verdict` has reported on this PR, master's required checks become exactly `["CI verdict"]`, applied with
    `gh api` after the maintainer approves (a repository setting, outside the tree).
  - README badges:
    - CI → `ci.yml/badge.svg?event=pull_request`;
    - Nightly → `pipeline.yml/badge.svg?branch=master&event=schedule`;
    - Release → `release.yml/badge.svg` (tag runs only).

    `docs-currency.test.ts` gains assertions for the three.
  - The website session is told the final workflow names and badge URLs when this merges.

## R15 — Constitution amendment

- **Decision**: through `/speckit-constitution`, amend the Development Workflow & Quality Gates section, Principle V's
  tag rule and Principle II's "macOS is proved by CI" (the full pipeline is where that proof now runs) to FR-005,
  FR-006, FR-008 and FR-011. This is a **MAJOR** bump (6.9.0 → 7.0.0): it withdraws a stated
  guarantee, "every layer runs in CI on every pull request".
