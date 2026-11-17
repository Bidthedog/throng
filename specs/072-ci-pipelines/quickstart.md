# Quickstart: validating the three pipelines

Run from the worktree; every check below is remote (no local full-suite runs).

## 1. Guards (local, seconds)

```bash
npx vitest run --project unit packages/ui/tests/unit/ci-workflow.test.ts packages/ui/tests/unit/pipeline-workflow.test.ts \
  packages/ui/tests/unit/release-unattended.test.ts packages/ui/tests/unit/release-repositories.test.ts \
  packages/ui/tests/unit/macos-runners.test.ts packages/ui/tests/unit/integration-subset.test.ts \
  packages/ui/tests/unit/pipeline-report.test.ts packages/ui/tests/unit/release-discard.test.ts \
  packages/ui/tests/unit/release-preflight.test.ts packages/ui/tests/unit/e2e-tags.test.ts packages/ui/tests/unit/docs-currency.test.ts
```

Expected: all pass.

## 2. PR CI (US1, SC-001)

Push to PR #659. Expected:
- only `ci.yml` starts;
- every job runs on Linux;
- `CI verdict` reports;
- the wall time is under 5 minutes.

Then push a commit that breaks one unit test. Expected: the unit job fails, every other job still finishes, and
`CI verdict` fails.

## 3. Pipeline, partial and fail-fast (US3, SC-005, SC-008)

```bash
gh workflow run pipeline.yml --ref feature/S072-I658-ci-pipelines -f stages=unit -f platforms=windows
```

Expected: run name `pipeline (partial: unit on windows)`; finishes in under 15 min.

With a deliberately failing test on the branch, expected:
- the failing job stops at that test;
- the run is cancelled within 2 minutes.

## 4. Pipeline, full (US2, SC-002)

```bash
gh workflow run pipeline.yml --ref feature/S072-I658-ci-pipelines
```

Expected:
- run name `pipeline (full)`;
- every layer runs on Windows, Linux and both macOS releases;
- packaging and every verification run;
- nothing is signed or published;
- the wall time is under 35 minutes.

Triage the Linux and macOS E2E failures this first run finds before merging.

## 5. Nightly behaviour (US2)

Dispatching with a nightly-mode override is not offered; the nightly's run-to-completion and report are proven by the
unit tests of `pipeline-report.mjs` and `pipeline-workflow.test.ts`, then observed on the first scheduled run after
merge.

## 6. Release (US4)

The first real release after merge is the first run (FR-030). Expected:
- the tag starts `release.yml` alone;
- `pipeline` runs in full;
- publication follows.

A failure follows `contracts/release-run.md`'s recovery.

## 7. Nothing on master (US5, SC-004)

After merge:

```bash
gh run list --branch master --event push --limit 5
```

Expected: no runs started by the merge.
