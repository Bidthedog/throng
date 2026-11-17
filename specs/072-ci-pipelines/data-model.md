# Data Model: Three CI Pipelines

No application data changes. The entities are run-level records that the workflows and scripts read and write.

## Pipeline run

| Field | Source | Rule |
|---|---|---|
| `trigger` | `github.event_name` | `schedule`, `workflow_dispatch` or `push` (called from a tag's release run) |
| `mode` | `plan` job output | `nightly` when `schedule`, otherwise `agent` |
| `fail_fast` | `plan` job output | `false` for `nightly`, `true` for `agent` (FR-019, FR-020) |
| `full` | `plan` job output | spec FR-018: `true` when the trigger is `schedule` or `push`, or a dispatch with `stages=all`, `platforms=all`, no `e2e_filter`/`test_filter` and no `stress_*` input |
| `run name` | `run-name:` | `pipeline (full)` or `pipeline (partial: <stages> on <platforms>)`; preflight and the report key on `pipeline (full)` |
| `stages`, `platforms`, `e2e_filter`, `test_filter`, `shards`, `stress_*`, `hand_tests`, `trace` | dispatch inputs | absent means everything / the default (FR-017); packaging and verification are stages (`package`, `verify`), not inputs |
| `tree` | `verdict` job | `git rev-parse HEAD^{tree}`, recorded in the verdict artifact (FR-018) |
| `result` | `verdict` job | success only when every selected job succeeded |

**States**: queued → running → (cancelled by a fail-fast step | completed: success / failure). A nightly run is never
cancelled by its own jobs.

## PR CI run

| Field | Rule |
|---|---|
| trigger | `pull_request` to master: `opened`, `synchronize`, `reopened`, `ready_for_review`; drafts included |
| jobs | `lint`, `unit`, `component` (2 shards), `contract`, `integration` (critical-path subset), `verdict` |
| `CI verdict` | success only when every other job succeeded; the one required check |

## Release run

| Field | Rule |
|---|---|
| trigger | `push` of a `v*` tag; nothing else |
| `on-master` | the tagged commit is an ancestor of `origin/master`, checked before the pipeline and again before signing |
| `pipeline` | a `pipeline.yml` call: full, fail-fast |
| publish chain | `sign-index` → `publish` → `deploy-repositories`, each `needs` the pipeline's success |
| recovery | infrastructure fault → re-run failed and cancelled jobs once; test or build failure → `release-discard.mjs`, fix, re-tag the same version (FR-031) |

## Nightly-failure issue

| Field | Rule |
|---|---|
| title | `Nightly pipeline failed on master` (exactly one open at a time) |
| labels | `bug`, `area:infra` |
| comment per red nightly | the run link, then every failed job and every failed or flaky test, each linked |
| closed by | a fully green full run on master's head (`full == true`), with a comment linking that run |
| read by | `release-preflight.mjs`: an open issue refuses a release |

## Integration subset

| Field | Rule |
|---|---|
| membership | integration test files whose top `describe` carries `tags: ['critical-path']` |
| bound | ≤ 15 files, enforced by `integration-subset.test.ts` (FR-008) |
