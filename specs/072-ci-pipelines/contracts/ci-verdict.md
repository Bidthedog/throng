# Contract: `ci.yml` and the `CI verdict` check

## Trigger

`pull_request` to `master`, types `opened, synchronize, reopened, ready_for_review`. No draft guard, no
`workflow_dispatch`, no `push`, no `schedule`. Concurrency `ci-<PR number>`, cancel-in-progress.

## Jobs (all `runs-on: ubuntu-24.04`)

| Job id | Name | Runs |
|---|---|---|
| `lint` | Lint & type-check | `npm run lint`, `npm run typecheck` |
| `unit` | Unit | vitest `unit` (+ `unit-isolated`) project |
| `component` | Component (`n`/2) | vitest `component` project, `--shard=n/2` |
| `contract` | Contract | vitest `contract` project |
| `integration` | Integration (critical path) | `npm run build`, vitest `integration` project `--tags-filter=critical-path` |
| `verdict` | CI verdict | `needs` every job above, `if: always()`, exits 1 unless every need's result is `success` |

No job fails fast (FR-002). No E2E (FR-006). No Windows or macOS (FR-007).

## Branch protection

master's required status checks are exactly `["CI verdict"]` (FR-004).

## Guarantees (asserted by `ci-workflow.test.ts`)

The trigger set above, every job on Linux, no Playwright invocation, the verdict's `needs` covering every other job,
and no `fail-fast: true` / run-cancel step.
