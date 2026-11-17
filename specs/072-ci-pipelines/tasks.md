---

description: "Task list for 072 — Three CI Pipelines"
---

# Tasks: Three CI Pipelines — PR Checks, Full Pipeline, Tag-Only Release

**Input**: Design documents from `specs/072-ci-pipelines/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (pipeline-dispatch, ci-verdict,
release-run, nightly-report), quickstart.md

**Tests**: Test-first (constitution Principle V). Every workflow rule gets a failing YAML-parsing **unit** guard
before the workflow changes, and every script a failing unit test with an injected API before it is written. The
workflows themselves are proven by real runs (quickstart §2–§4). There is no component, integration, contract or
E2E test layer for this feature, beyond tagging existing integration files (US1).

**Organization**: grouped by user story. `pipeline.yml` serves US2, US3 and US4, so its skeleton and guard are
foundational (Phase 2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 from spec.md

Paths are repository-relative. `WF` = `.github/workflows/`, `UT` = `packages/ui/tests/unit/`.

---

## Phase 1: Setup

**Purpose**: none needed. `js-yaml`, vitest 4 (`tags`, `--shard`, `--bail`) and Playwright (`--shard`,
`--max-failures`) are already dependencies. The baseline (lint, typecheck, unit: 837 files) is green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: E2E sharding, and the `pipeline.yml` skeleton with its guard, which US2, US3 and US4 build on.

- [x] T001 Write failing unit tests in `UT/run-e2e-shard.test.ts` for a pure helper `e2eTierArgs({ tier, shard, failFast, grep })` exported from `scripts/run-e2e-local.mjs`. With `THRONG_E2E_SHARD=i/N`, both the parallel and the serial tier get `--shard=i/N`; `failFast` adds `--max-failures=1` to each tier; a grep still selects a single untiered run (today's behaviour). Run it and read the failure.
- [x] T002 Implement `e2eTierArgs` and wire `THRONG_E2E_SHARD` and `THRONG_E2E_FAIL_FAST` through `scripts/run-e2e-local.mjs`, keeping `npm run gate`'s local behaviour. Make T001 pass; re-run `UT/script-imports-parse.test.ts` and `UT/gate-stage-args.test.ts`.
- [x] T003 Write `UT/pipeline-workflow.test.ts` (failing: `WF/pipeline.yml` is absent), asserting `contracts/pipeline-dispatch.md` *Guarantees*:
  - triggers exactly `schedule`, `workflow_dispatch` (with the inputs table) and `workflow_call`;
  - no `REPO_SIGNING_KEY`, no `environment: release`, no `gh release`, no `workflow run pages.yml`;
  - every job except `plan`, `verdict` and `report` has, as its **last** step, `if: failure() && needs.plan.outputs.fail_fast == 'true'` running `gh run cancel` (without `failure()` the step never runs after a failing step);
  - no workflow passes `--pass-with-no-tests` / `--passWithNoTests`, so an empty shard or filter fails its job;
  - the concurrency group is keyed by event and ref for schedule and dispatch, and by `run_id` for a `workflow_call`, so it never equals the caller's `release-<ref>`;
  - `plan` computes `full` exactly as spec FR-018 defines it (every stage, every platform, no filter, no stress input; always for schedule and call);
  - no `if` other than `verdict`'s and `report`'s reads a test job's result;
  - packaging jobs need only `plan` and `macos-runners`; each verify job needs only its build;
  - a `run-name` yielding `pipeline (full)` / `pipeline (partial: …)`;
  - `permissions` granting `actions: write` (the fail-fast cancel) and nothing broader than each job needs;
  - every build-artifact upload (`throng-*`, `*-upgrade-fixture`, `release-body`) sets `retention-days: 7` (FR-014).
- [x] T004 Create `WF/pipeline.yml`, **copying** the logic from `WF/gate.yml` and `WF/release.yml` (packaging, verification, coexistence, repository verification, render-body). T023 removes the copies from `release.yml`, and T028 deletes `gate.yml`, so the release guards stay green in between:
  - a `plan` job resolving `mode`, `fail_fast`, `full` and the selected stages and platforms (`data-model.md` *Pipeline run*);
  - per-platform jobs for lint/typecheck (Linux), unit, component, integration, contract, E2E (Windows 4 shards, Linux 2, macOS 2 per release, via `THRONG_E2E_SHARD`), admin E2E (Windows), calibration (asserted, `THRONG_CALIBRATE` on), macOS typing latency;
  - build-installer, build-linux and build-macos needing only `plan`/`macos-runners`, with their verify jobs, coexistence and verify-repositories;
  - render-body with the manifest version;
  - a `verdict` job (records `HEAD^{tree}`, fails unless every selected job succeeded);
  - concurrency per research R11;
  - vitest `--bail=1` and Playwright `--max-failures=1` only when `fail_fast`;
  - `permissions: actions: write` for the cancel step, and `retention-days: 7` on build-artifact uploads.

  Make T003 pass. Keep `WF/gate.yml` in place for now.

- [x] T004a Amend the constitution through `/speckit-constitution` **before T008** (MAJOR 6.9.0 → 7.0.0, research R15):
  - Development Workflow & Quality Gates and Principle V's tag rule move to FR-005, FR-006, FR-008 and FR-011;
  - Principle II's "macOS is proved by CI" names the full pipeline (dispatched or nightly) as where that proof runs, now that PR CI is Linux-only;
  - the Sync Impact Report lists the templates reviewed.

  No commit from T008 on contradicts the constitution in force.

**Checkpoint**: the pipeline exists beside the gate and can be dispatched; the constitution matches what follows.

---

## Phase 3: User Story 1 — A pull request gets a verdict in minutes (P1) 🎯 MVP

**Goal**: PR CI runs only on pull requests, on Linux, with no E2E, and reports one `CI verdict` within 5 minutes.

**Prerequisite**: T004a (the constitution amendment) is committed before T008.

**Independent test**: quickstart §2.

- [x] T005 [P] [US1] Write `UT/ci-workflow.test.ts` (failing against today's `WF/ci.yml`), asserting `contracts/ci-verdict.md`:
  - triggers exactly `pull_request` (types `opened, synchronize, reopened, ready_for_review`), with no `workflow_dispatch`/`push`/`schedule` and no draft guard;
  - every job on `ubuntu-24.04`;
  - no `playwright`/`test:e2e` anywhere;
  - jobs `lint`, `unit`, `component` (a 2-shard matrix), `contract`, `integration` and `verdict` (named `CI verdict`, `needs` every other job, `if: always()`);
  - no `fail-fast: true`, no `gh run cancel`;
  - `verdict`'s script fails when any need's result is anything but `success` (failure, cancelled or skipped);
  - no `--passWithNoTests`;
  - concurrency `ci-<PR>` with cancel-in-progress.

  (No self-hosted runner: `UT/self-hosted-runner-exposure.test.ts` already covers every workflow file.)
- [x] T006 [P] [US1] Write `UT/integration-subset.test.ts` (failing): scan `packages/*/tests/integration/**/*.test.ts` for `tags: ['critical-path']` and assert 1 to 15 files carry it (FR-008), naming the files in the failure message.
- [x] T007 [US1] Choose and tag the integration subset. For each subsystem (daemon persistence, PTY host lifecycle, config write and watch, editor document save, explorer file operations, IPC bridge), time its integration files on Linux with `td run --runner integration --scope file`. Tag the top `describe` of the cheapest file that exercises that subsystem's main path with `{ tags: ['critical-path'] }`: at most 15 files, ≤ 90 s total. Record the chosen files and times, and the Linux `npm run build` time the `integration` job pays first, in `research.md` R6. If build plus subset exceeds 3 min, build only what the subset needs. Make T006 pass.
- [x] T008 [US1] Rewrite `WF/ci.yml` to `contracts/ci-verdict.md`: Linux jobs `lint` (lint + typecheck), `unit`, `component` (vitest `--shard=${{ matrix.shard }}/2`), `contract`, `integration` (`npm run build`, then `--tags-filter=critical-path`) and `verdict`; npm cache; all Windows, macOS and E2E jobs removed. Make T005 pass.
- [x] T009 [US1] Update `UT/macos-runners.test.ts`'s required job ids: drop `ci.yml`'s `macos-runners`, `macos-fast`, `macos-test` and `macos-e2e`; add `pipeline.yml`'s macOS job ids. Keep the "no literal macOS label" assertion over every workflow.
- [x] T010 [P] [US1] Remove the `CORE_CAP` constant and its assertion from `UT/e2e-tags.test.ts` (034 FR-054 withdrawn by FR-006), keeping the one-significance-tag rule and the `@admin`-not-`@core` rule.
- [x] T011 [US1] Push and prove on PR #659 (quickstart §2):
  - only `ci.yml` runs;
  - every job is on Linux;
  - `CI verdict` reports within 5 minutes; record the wall time in the ledger.

  Then push a deliberately broken unit test and confirm the other jobs finish and `CI verdict` fails. Revert it.

**Checkpoint**: PR CI meets SC-001 on this PR.

---

## Phase 4: User Story 2 — The full pipeline proves everything every night, without publishing (P1)

**Goal**: a nightly that runs everything to completion and leaves one consolidated report.

**Independent test**: quickstart §4, plus `UT/pipeline-report.test.ts`.

- [x] T012 [P] [US2] Write `UT/pipeline-report.test.ts` (failing), with an injected GitHub API, for `scripts/pipeline-report.mjs` per `contracts/nightly-report.md`:
  - opens the issue `Nightly pipeline failed on master` (labels `bug`, `area:infra`) when none is open;
  - comments on an open one, never opening a second;
  - lists every failed job, including a job with no test result, and every failed or flaky test once per platform, each linked;
  - on an all-green full run on master's head, comments "Green on …" and closes the issue;
  - does nothing for a partial run or a non-master ref.
- [x] T013 [US2] Implement `scripts/pipeline-report.mjs` (Node `.mjs`, `gh api` through an injectable runner) to make T012 pass.
- [x] T014 [US2] In `WF/pipeline.yml`:
  - have every vitest job write `--reporter=json --outputFile=results-<job>.json` and upload it, and every E2E job upload its Playwright JSON;
  - add the `report` job (`needs` every job, `if: always() && needs.plan.outputs.full == 'true' && github.ref == 'refs/heads/master'`, `issues: write`) running `scripts/pipeline-report.mjs`;
  - add the nightly `schedule` (`0 1 * * *`).

  Extend `UT/pipeline-workflow.test.ts` for the report wiring first.
- [ ] T015 [US2] Dispatch a full run on this branch (quickstart §4): `gh workflow run pipeline.yml --ref feature/S072-I658-ci-pipelines`. Record the wall time and each job's duration in the ledger. Tune the shard counts in `WF/pipeline.yml` toward SC-002 (≤ 35 min).
- [ ] T016 [US2] Triage every failure the first full run finds, above all the Linux and macOS E2E tests that have never run there:
  - a defect is fixed test-first on this branch (`replicating-bugs`);
  - a test that genuinely cannot hold on that platform gets that platform's skip and a linked issue (`github-issues`), never a blanket exclusion.

  Re-dispatch the failed stages only, until a full run is green.

**Checkpoint**: one fully green full run of every stage on this branch.

---

## Phase 5: User Story 3 — An agent runs exactly what it needs and hears about the first failure at once (P1)

**Goal**: dynamic dispatch selection and a fail-fast stop.

**Independent test**: quickstart §3.

- [x] T017 [US3] Extend `UT/pipeline-workflow.test.ts` (failing first) for `contracts/pipeline-dispatch.md`'s inputs: `stages`, `platforms`, `e2e_filter` (grep, spec path or category), `test_filter`, `shards`, `stress_spec`/`stress_grep`/`stress_rounds`, `hand_tests` and `trace`. Also assert:
  - each job's `if` honours `stages`/`platforms`;
  - the stress job runs one spec N rounds with `--retries=0` and uploads every round;
  - `hand_tests` and `trace` are never set on schedule or call.
- [x] T018 [US3] Implement the inputs in `WF/pipeline.yml`'s `plan` job and job conditions, moving `stress` and `hand-tests` in from `WF/gate.yml` and `WF/release.yml`. Make T017 pass.
- [ ] T019 [US3] Prove it (quickstart §3):
  - dispatch `-f stages=unit -f platforms=windows` and confirm the run name `pipeline (partial: unit on windows)` and that only those jobs ran;
  - push a temporary failing unit test and dispatch `-f stages=unit,component`; confirm the failing job stopped at that test and the run was cancelled within 2 minutes (SC-005);
  - revert it.

**Checkpoint**: an agent can verify one layer remotely in under 15 minutes (SC-008).

---

## Phase 6: User Story 4 — A release tag runs the full pipeline, then publishes (P1)

**Goal**: `release.yml` runs only on a tag, calls the full pipeline and publishes only after it, with a defined
recovery.

**Independent test**: the release guards, `UT/release-discard.test.ts`, and the next real release (FR-030).

- [x] T020 [P] [US4] Update `UT/release-unattended.test.ts` and `UT/release-repositories.test.ts` (failing first) to `contracts/release-run.md`:
  - trigger exactly `push: tags: ['v*']`, with no `branches`, no `workflow_dispatch` and no inputs;
  - an `on-master` job before a `pipeline` job that `uses: ./.github/workflows/pipeline.yml`;
  - `sign-index` → `publish` → `deploy-repositories`, each `!cancelled()` plus `needs.<x>.result == 'success'`;
  - the signing key only in `sign-index` (environment `release`);
  - no `e2e-reuse`, `e2e-full`, `skip_e2e`, `hand_tests` or `trace`;
  - concurrency `release-${{ github.ref }}` with cancel-in-progress (FR-026), distinct from the called pipeline's group;
  - the `pipeline` call job grants at least the permissions `pipeline.yml`'s jobs request (`actions: write`, `contents: read`, and `issues: write` for the `report` job: GitHub rejects a call that grants less than the called jobs request).

  Keep every existing assertion that still describes the new shape.
- [x] T021 [P] [US4] Write `UT/release-discard.test.ts` (failing), with an injected API, for `scripts/release-discard.mjs <tag> [--dry-run]`:
  - exits 3 and deletes nothing when a release exists;
  - otherwise deletes the remote tag and, for every `release.yml` run on that tag, the artifacts named `throng-*`, `*-upgrade-fixture`, `repo-index-bundle` and `release-body`;
  - keeps `test-results-*`, `*report*`, `installer-logs-*` and `verdict-*`;
  - `--dry-run` deletes nothing and prints the plan.
- [x] T022 [US4] Implement `scripts/release-discard.mjs` to make T021 pass.
- [x] T023 [US4] Rewrite `WF/release.yml` to `contracts/release-run.md`: the tag trigger only; `on-master`; `pipeline` (`uses`, no `secrets: inherit`, `permissions: { actions: write, contents: read, issues: write }`); `sign-index`, `publish` and `deploy-repositories` downloading the same run's artifacts; concurrency `release-<ref>`. Remove `e2e-reuse`, `e2e-full` and every job moved into `pipeline.yml`. Make T020 pass.
- [x] T024 [P] [US4] Write failing cases in `UT/release-preflight.test.ts`, then change `scripts/release-preflight.mjs`:
  - judge the latest full `pipeline.yml` run on master (`schedule`, or the run name `pipeline (full)`) at first attempt;
  - refuse an open `Nightly pipeline failed on master` issue;
  - drop the `release.yml`-on-master check;
  - replace `isFullGate` with `isFullPipeline`.
- [x] T025 [US4] Delete `scripts/release-e2e-reuse.mjs` and `UT/release-e2e-reuse.test.ts`.

**Checkpoint**: release guards green; the first real release is the live proof (FR-030).

---

## Phase 7: User Story 5 — A merge to master costs nothing (P2)

**Goal**: no workflow starts on a push to master.

**Independent test**: quickstart §7, after merge.

- [x] T026 [P] [US5] Add a case to `UT/pipeline-workflow.test.ts`, or a new `UT/no-master-push.test.ts`, failing first, asserting that no file in `WF/` has a `push` trigger with `branches`, and that `WF/pages.yml` triggers only on `workflow_dispatch`.
- [x] T027 [US5] Remove `WF/pages.yml`'s `push` trigger (keep `workflow_dispatch`). Make T026 pass.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T028 Delete `WF/gate.yml`, `scripts/check-platform-jobs-unchanged.mjs` and `UT/workflows-unchanged.test.ts` (070 FR-039 superseded). Remove `gate.yml` references from `scripts/gate-lib.mjs`, `scripts/gate.mjs` and test comments where they name the workflow (`git grep -n "gate.yml"` must list only historical `specs/` and `CHANGELOG.md`).
- [x] T029 [P] README badges:
  - `README.md`'s CI badge → `actions/workflows/ci.yml/badge.svg?event=pull_request`;
  - Nightly → `pipeline.yml/badge.svg?branch=master&event=schedule`, labelled "Nightly pipeline";
  - Release → `release.yml/badge.svg` (tag runs).

  First add failing assertions for the three URLs to `UT/docs-currency.test.ts`.
- [x] T030 [P] Update `CLAUDE.md` (*Verifying done-ness*, *E2E on CI*, *Running tests locally*) to the three pipelines: dispatch `pipeline.yml` with `stages` instead of `gate.yml`; PR CI is Linux-only with no E2E and drafts included; nothing on master; a change that is Windows- or macOS-specific gets a `pipeline.yml` dispatch for that platform before merge.
- [x] T031 [P] Load `throng-docs` and update `docs/testing.md` (lanes table, `npm run gate`, the *On Linux* / *On macOS* lanes, the `regression` tag line), `docs/releasing.md` (intro, flow diagram, failure recovery with `release-discard.mjs`) and `docs/environment.md` (`THRONG_GATE_E2E_GREP`, `THRONG_CALIBRATE_LOG_ONLY`, the new `THRONG_E2E_SHARD` and `THRONG_E2E_FAIL_FAST`). Run its audit and `UT/docs-currency.test.ts`.
- [x] T032 [P] Update `CONTRIBUTING.md` (testing bullets, the `@admin` job line) and `.github/PULL_REQUEST_TEMPLATE.md` (E2E and `@admin` evidence come from a `pipeline.yml` dispatch run link).
- [x] T033 [P] Update the `throng-release` skill (`.claude/skills/throng-release/SKILL.md` and `references/build-and-packaging.md`, `publishing.md`, `verification.md`):
  - running order: PR (CI) → merge → tag → release run;
  - preflight: the nightly;
  - recovery: infrastructure re-run, or `release-discard.mjs` and re-tag;
  - remove rehearsal by `release.yml` dispatch (use a `pipeline.yml` dispatch);
  - remove the *Never* items about `e2e-reuse` and the 50-test trade.
- [x] T034 [P] Update the `throng-testing` skill (`.claude/skills/throng-testing/SKILL.md`, `references/gate.md`, `references/e2e-harness.md`, `references/tiers-and-workers.md`, `references/elevation.md`): which lane runs where, dispatching `pipeline.yml` with `stages`/`e2e_filter`/`stress_*`, the cap removal, `@admin` in the pipeline only, and dispatching for a platform-specific change before merge.
- [x] T035 Re-read the amended constitution (T004a) against the final workflows; any drift is corrected through `/speckit-constitution`, not by hand.
- [ ] T036 Run the short gates on the final tree: `npm run lint`, `npm run typecheck`, `npx vitest run --project unit --maxWorkers=50%` and `npx vitest run --project component --maxWorkers=50%`. Then dispatch a full `pipeline.yml` on the final head and record the green run URL and SHA (`CLAUDE.md` *Verifying done-ness*).
- [ ] T037 After `CI verdict` has reported on PR #659 and the maintainer approves, read master's required status checks back, then set them to exactly `["CI verdict"]` with `gh api -X PATCH repos/Bidthedog/throng/branches/master/protection/required_status_checks -F strict=true -f 'contexts[]=CI verdict'` (FR-004; `strict` keeps the existing up-to-date rule as it is today). Read the result back.
- [ ] T038 At merge, message the website session (named by the maintainer) with the final workflow names and the three badge URLs from T029, so the site's badges follow. Then record the post-merge checks in the PR: no run started by the merge (SC-004, quickstart §7); the first scheduled nightly's result; the next release as the tag-only workflow's first run (FR-030, SC-003; no task builds anything for FR-030).

---

## Dependencies & Execution Order

- **Phase 2** (T001–T004) blocks US2, US3 and US4. US1 (T005–T011) depends only on T009 knowing `pipeline.yml`'s macOS job ids (T004).
- **US2** (T012–T016) after T004. T016 after T015.
- **US3** (T017–T019) after T004. It shares `WF/pipeline.yml` with US2, so T018 runs after T014.
- **US4** (T020–T025) after T004. T023 after T020 and T004. T025 after T024.
- **US5** (T026–T027) is independent; T027 after T026.
- **Polish**: T028 after T018 and T023 (nothing still reads `gate.yml`). T004a before T008. T035 after T034. T036 last before T037. T038 at merge.

## Parallel Opportunities

- T005, T006 and T010 (different test files) together.
- T012, T020, T021 and T024 together once T004 is in.
- T029–T034 together (different documents).

## Implementation Strategy

1. **MVP = US1** after Phase 2: fast PR CI is the most-used loop.
2. US2 + US3 (`pipeline.yml` complete and proven by dispatch, first full-run triage).
3. US4 + US5 (tag-only release, nothing on master), then delete `gate.yml`.
4. Polish: docs, skills, constitution, the final gate, required checks, the website message.
