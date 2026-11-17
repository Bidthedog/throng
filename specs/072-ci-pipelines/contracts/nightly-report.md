# Contract: the nightly report

## When it runs

`pipeline.yml`'s `report` job, `if: always()`, `needs` every other job, and only when the run is **full** and on
`master` (a nightly, or a full dispatch on master). Partial runs and branch runs never touch the issue.

## Inputs

- The run's jobs and their conclusions (`gh api repos/{o}/{r}/actions/runs/{id}/jobs`).
- Every uploaded test result: vitest JSON (`results-<job>.json`) and Playwright JSON (`e2e-report*.json`).

## Behaviour

| Run outcome | Issue `Nightly pipeline failed on master` | Action |
|---|---|---|
| any job failed | none open | open it (labels `bug`, `area:infra`) with the report as its first comment |
| any job failed | open | add the report as a new comment |
| every job succeeded, a test passed only on retry | either | as "any job failed": a flake is not fully green (FR-021) |
| every job succeeded, no flake | open | comment "Green on <run link> at <sha>" and close it |
| every job succeeded, no flake | none open | nothing |

A job counts as failed when its conclusion is `failure`, `cancelled` or `timed_out`; `skipped` (a stage the run did not
select) is not a failure. The `report` job ignores itself.

## Report format

```markdown
**Nightly pipeline failed** — <run link> on `<sha8>` (<date>)

### Failed jobs (N)
- [<job name>](<job url>) — <conclusion>

### Failed or flaky tests (M)
- `<file>` › <test title> — <platform>/<layer> — [log](<job url>)
```

Every failed job appears, including those that produced no test result (a build or a crashed runner). Every failed
or flaky test appears once per platform it failed on.
