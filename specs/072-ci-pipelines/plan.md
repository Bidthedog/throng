# Implementation Plan: Three CI Pipelines — PR Checks, Full Pipeline, Tag-Only Release

**Branch**: `feature/S072-I658-ci-pipelines` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/072-ci-pipelines/spec.md`

## Summary

The workflows change as follows:
- **`ci.yml`** shrinks to a Linux-only, E2E-free pull-request check with one `CI verdict` job (research R5).
- **`gate.yml`** is replaced by a reusable `pipeline.yml`:
  - It runs every layer on every platform as parallel jobs, shards the Windows E2E suite, and packages and verifies
    every artifact alongside the tests (R1, R4).
  - Dispatched and called runs cancel themselves at the first failure.
  - The nightly runs to completion and writes one report (R2, R3, R8).
- **`release.yml`** keeps only its tag trigger. It calls `pipeline.yml`, then signs, publishes and deploys from that
  run's artifacts.
- **`pages.yml`** loses its push trigger.

Around the workflows:
- Release preflight reads the nightly (R9).
- A discard script recovers a failed attempt (R10).
- The workflow guards, docs, skills and README badges follow (R12, R14).
- The constitution takes a MAJOR amendment (R15).

## Technical Context

**Language/Version**: GitHub Actions YAML; Node 24 `.mjs` scripts (repo rule: no Python); TypeScript 6 tests on Node 26

**Primary Dependencies**: `gh` CLI on runners, `js-yaml` (already a dev dependency, used by the workflow tests), vitest 4 (tags, `--shard`, `--bail`, json reporter), Playwright (`--shard`, `--max-failures`, JSON reporter)

**Storage**: GitHub Actions artifacts (7-day retention for builds); one GitHub issue for the nightly report

**Testing**: vitest `unit` project for the workflow, script and tag guards; the feature itself is proven by real runs: a PR CI run on this PR, and dispatches of `pipeline.yml` on this branch (quickstart)

**Target Platform**: GitHub-hosted runners — `ubuntu-24.04`, `windows-2022`, the macOS labels in `.github/macos-runners.json`

**Project Type**: CI/CD configuration and release tooling in an npm-workspaces Electron monorepo

**Performance Goals**: PR CI ≤ 5 min at p90 (SC-001); full pipeline ≤ 35 min (SC-002); tag → published ≤ 45 min (SC-003); fail-fast stop ≤ 2 min (SC-005)

**Constraints**: the repo is public (free minutes) with ~20 concurrent jobs and 5 macOS; the signing key is only ever read by `sign-index` in the `release` Environment; publication only from a `v*` tag on master; no local full-suite runs

**Scale/Scope**: 4 workflow files; 6 scripts (2 new, 2 changed, 2 removed); ~8 test files; ≤ 15 integration files tagged; docs, two skills, CLAUDE.md, README badges, constitution

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Assessment |
|---|---|
| I–IV, IX, XI, XII (product architecture) | Not touched. No product code changes |
| V Test-first (NON-NEGOTIABLE) | ✅ Every workflow rule gets a failing unit guard first (`ci-workflow`, `pipeline-workflow`, the updated release guards), and each script gets a unit test with an injected API before it is written. ⚠ Principle V's tag rule is amended (FR-032) |
| VI Simple, discoverable UX | N/A. Developer-facing only. The failure report names each failure with a link (FR-021) |
| VII Change review | ✅ Strengthened. One required check, and publication only from a tag on master after a green full pipeline |
| VIII SOLID / DRY / YAGNI | ✅ One pipeline definition replaces the gate plus the release's packaging copy. No watcher job (R2) |
| X Externalised configuration | ✅ Shard counts, stages and platforms are dispatch inputs, with defaults in the workflow |
| XIII Every failure leaves a trace | ✅ The nightly report lists every failure. A fail-fast run's first failure is its last step |
| Quality gates: CI on every PR | ⚠ **Amended (MAJOR 7.0.0)**. Every layer except E2E still runs on every PR (integration as a bounded subset); E2E runs nightly and in every release. Justified in Complexity Tracking |
| Documentation currency | ✅ CLAUDE.md, `docs/testing.md`, `docs/releasing.md`, `docs/environment.md`, CONTRIBUTING.md, the PR template, both skills and the README badges in this change (FR-029) |
| Incremental delivery | ✅ One PR. `pipeline.yml` is proven by dispatch on this branch before `gate.yml` is deleted |

**Post-design re-check**: unchanged. The only constitutional change is FR-032's amendment, tracked below.

## Project Structure

### Documentation (this feature)

```text
specs/072-ci-pipelines/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── pipeline-dispatch.md     # pipeline.yml inputs, modes, run names, outputs
│   ├── ci-verdict.md            # PR CI jobs and the one required check
│   ├── release-run.md           # release.yml job graph and recovery
│   └── nightly-report.md        # the report job, the issue and its comment format
├── checklists/requirements.md
└── tasks.md                     # /speckit-tasks
```

### Source Code (repository root)

```text
.github/workflows/
├── ci.yml                         # REWRITE  PR-only, Linux, no E2E, CI verdict
├── pipeline.yml                   # NEW      full pipeline (schedule, dispatch, call)
├── release.yml                    # REWRITE  tag-only caller → sign, publish, deploy
├── pages.yml                      # EDIT     dispatch only
└── gate.yml                       # DELETE
scripts/
├── run-e2e-local.mjs              # EDIT     THRONG_E2E_SHARD across both tiers; --max-failures in fail-fast
├── gate-lib.mjs / gate.mjs        # EDIT     gate-only workflow coupling removed (local `npm run gate` stays)
├── release-preflight.mjs          # EDIT     nightly pipeline instead of release.yml + gate
├── pipeline-report.mjs            # NEW      nightly report and issue lifecycle
├── release-discard.mjs            # NEW      delete tag + build artifacts of an unpublished attempt
├── release-e2e-reuse.mjs          # DELETE
└── check-platform-jobs-unchanged.mjs  # DELETE (070's one-time branch-end check)
packages/ui/tests/unit/
├── ci-workflow.test.ts            # NEW
├── pipeline-workflow.test.ts      # NEW
├── integration-subset.test.ts     # NEW      ≤ 15 critical-path integration files
├── pipeline-report.test.ts        # NEW
├── release-discard.test.ts        # NEW
├── release-preflight.test.ts      # EDIT
├── release-unattended.test.ts     # EDIT
├── release-repositories.test.ts   # EDIT
├── macos-runners.test.ts          # EDIT
├── e2e-tags.test.ts               # EDIT     CORE_CAP removed
├── docs-currency.test.ts          # EDIT     workflow badges
├── release-e2e-reuse.test.ts      # DELETE
└── workflows-unchanged.test.ts    # DELETE
packages/*/tests/integration/      # ≤ 15 files gain { tags: ['critical-path'] }
README.md · CLAUDE.md · CONTRIBUTING.md · .github/PULL_REQUEST_TEMPLATE.md
docs/testing.md · docs/releasing.md · docs/environment.md
.claude/skills/throng-release/** · .claude/skills/throng-testing/**
.specify/memory/constitution.md    # via /speckit-constitution (MAJOR 7.0.0)
```

**Structure Decision**: all CI behaviour lives in the four workflow files. Logic that needs testing lives in `.mjs`
scripts with unit tests; workflow structure is asserted by YAML-parsing unit guards, the repo's existing pattern.

## Delivery order

1. Guards and scripts first, each test-first (`pipeline-report`, `release-discard`, preflight, shard support). The
   constitution amendment lands here too, before the first workflow commit that relies on it.
2. Add `pipeline.yml` alongside `gate.yml`, then prove it by dispatch on this branch:
   - one stage;
   - a failing test, to prove fail-fast;
   - every stage.

   Triage the first full Linux and macOS E2E failures: fix each, or give it its platform tag with an issue.
3. Rewrite `ci.yml` and tag the integration subset. This PR's own CI proves it.
4. Rewrite `release.yml` and `pages.yml`, and delete `gate.yml` and the retired scripts and tests.
5. Docs, skills, CLAUDE.md, README badges; re-read the amended constitution against the final workflows.
6. After maintainer approval: required checks → `CI verdict`. At merge: tell the website session the new badge URLs.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Quality-gates amendment: integration runs a ≤ 15-file subset and E2E does not run on PRs | The maintainer's 5-minute PR target (SC-001) and the alpha17 cost: every flake on a 13-min PR run and a 61-min gate cost a day | Running every layer on every PR cannot fit 5 minutes. E2E alone needs 12+ min even sharded. The full suite still runs nightly and gates every release (FR-011, FR-022) |
| Release gated on the full Linux and macOS E2E suites, which have never run | FR-011's "everything on every platform" | Keeping `@core`-only there leaves 400+ tests unproven on two shipping platforms. The first full dispatch (delivery step 2) triages them before merge |
