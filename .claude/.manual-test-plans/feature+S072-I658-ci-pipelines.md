# Manual test plan: Three CI pipelines (072)

Spec: `specs/072-ci-pipelines/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | A pull request's checks on GitHub | signed off | 94cacf4c0fa8 | 2026-11-17 | |
| MT-02 | The README badges | signed off | 94cacf4c0fa8 | 2026-11-17 | |

## MT-01: A pull request's checks on GitHub

Covers: FR-001, FR-002, FR-004, FR-006, FR-007, SC-001
Paths: `.github/workflows/ci.yml`

### Steps
1. Open https://github.com/Bidthedog/throng/pull/659 and scroll to the checks box. Every check is a `CI` job: Lint & type-check, Unit, Component (1/2), Component (2/2), Contract, Integration (critical path) and CI verdict. No Windows, macOS or E2E check appears.
2. Click **Details** on any of them. The job ran on Ubuntu, and the run took about 4 minutes from start to the verdict.
3. Open https://github.com/Bidthedog/throng/actions/runs/44170178443. Unit is red, every other job ran to the end and is green, and CI verdict is red.

### Negative cases
- No check named `Gate`, `E2E (@core)` or `E2E (@admin, elevated)` appears on the PR.

## MT-02: The README badges

Covers: FR-029
Paths: `README.md`

### Steps
1. Open https://github.com/Bidthedog/throng/blob/feature/S072-I658-ci-pipelines/README.md. Three pipeline badges sit at the top: **CI**, **Nightly pipeline** and **Release**.
2. Click **CI**. GitHub opens the CI workflow's runs, filtered to pull requests.
3. Click **Nightly pipeline**. GitHub opens the pipeline workflow's scheduled runs. Until the first nightly runs after merge, the badge reads "no status" and the list is empty.

### Negative cases
- No badge reads "Nightly gate", and none links to `gate.yml`.
