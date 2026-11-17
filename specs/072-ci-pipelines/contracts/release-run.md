# Contract: `release.yml`

## Trigger

`push: tags: ['v*']` only. No `branches`, no `workflow_dispatch`, no inputs. Concurrency `release-<ref>`,
cancel-in-progress.

## Job graph

```
on-master ──▶ pipeline (uses ./.github/workflows/pipeline.yml, full, fail-fast)
                 └─▶ sign-index (environment: release) ──▶ publish (environment: release) ──▶ deploy-repositories
```

- `on-master`: fails unless `github.sha` is an ancestor of `origin/master` (FR-024). The existing guards inside
  `sign-index` and `publish` stay.
- `sign-index`, `publish`, `deploy-repositories`: `!cancelled()` plus `needs.<x>.result == 'success'` for every need,
  as `release-unattended.test.ts` already requires; they download the pipeline's artifacts from the same run.
- No `e2e-reuse`, no `e2e-full`, no `skip_e2e`, `hand_tests` or `trace` (FR-025).

## Recovery (runbook; `release-discard.mjs`)

| Failure | Action |
|---|---|
| Infrastructure fault only | `gh run rerun <run> --failed` once, on the same tag |
| Test or build failure, nothing published | `node scripts/release-discard.mjs v<version>` (deletes the remote tag and the run's build artifacts, keeps the test evidence), `git tag -d v<version>`, fix through its own PR, re-tag the same version on master |
| Published | Never touched; cut the next version |

`release-discard.mjs` exits 3 without deleting anything if a release for the tag exists. `--dry-run` lists what it
would delete.
