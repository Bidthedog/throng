# Feature Specification: Three CI Pipelines — PR Checks, Full Pipeline, Tag-Only Release

**Feature Branch**: `feature/S072-ci-pipelines`

**Created**: 2026-11-17

**Status**: Draft

**Input**: Maintainer, 2026-11-17, after the 1.0.0-alpha17 release took a day of re-gating: "optimise this so it
gives us the best coverage, but also minimises build times where possible." Pull requests run `ci.yml` only, with
every quick test on every platform in parallel and a very limited integration and E2E set. Nothing runs on a merge
to master. A full build-and-package pipeline runs everything, every night and on demand, without publishing. A
release runs only on a release tag, runs that full pipeline first, then publishes. Agent-invoked runs fail fast;
the nightly runs to completion and reports every failure at the end.

## Background

Measured on 2026-11-17 (alpha17):

| Run | Wall time | Where it goes |
|---|---|---|
| PR CI (`ci.yml`) | 13 min | macOS unit + component in one job (9–10 min) |
| Full gate (`gate.yml`) | 61 min | Windows runs eight stages one after another in one job; its E2E stage alone is 46 min (154 parallel-tier tests in 16 min, then 302 serial-tier tests in 30 min, all on one runner) |
| `release.yml` on a tag | 31 min | builds and verification, with E2E reused from a green gate on the same tree |
| `release.yml` on every push to master | ~31–90 min | a full rehearsal of the above on each merge, including the full Windows E2E suite when no gate covered that tree |

A release today needs a green full gate on the release branch **before** the merge, then the tag run after it. Each
flake found on the way costs a fix PR, a rebase and another hour-long gate. alpha17 needed eight gates.

The repository is public, so hosted runner minutes are free; the binding limits are GitHub's concurrency caps
(about 20 concurrent jobs, 5 of them macOS).

## Requirements this feature changes

| Requirement | What it said | What replaces it |
|---|---|---|
| 065 Clarification 2026-11-06 Q1 | Every release commit reaches master through a PR whose required checks passed, **and the full gate runs on that tree**. | The release commit reaches master through a PR whose required checks (FR-004) passed. The full suite runs on the tagged tree inside the release run (FR-022). |
| 065 FR-008 | The full gate (`gate.yml`) MUST pass on the release commit's tree before the tag is pushed. | Withdrawn. FR-022: the release run executes the full pipeline on the tagged tree before anything publishes. |
| 065 FR-013 | Preflight refuses a latest `release.yml` or full gate on master that is not green at first attempt, and an open nightly-failure issue. | FR-027: preflight reads the latest **nightly** full pipeline on master and the nightly-failure issue. `release.yml` no longer runs on master. |
| 065 FR-014 | `release.yml` MAY omit its E2E suite when a full gate passed on the identical tree (`e2e-reuse`). | Withdrawn. The release run always executes the full pipeline (FR-022). |
| 065 SC-003 | Every published release's commit has a green `gate.yml` run on its tree. | SC-006 below: every published release's tag run contains a green full pipeline on that tree. |
| 065 US2 Independent Test | Introduce a failure the gate catches into the release branch. | The failure is introduced on the tagged tree; the release run fails fast before publishing (US4). |
| 034 US7, FR-052, FR-056 | The critical E2E selection gates CI on a push or pull request; every remaining E2E test runs at release. | FR-006: PR CI runs no E2E test; FR-011: the full pipeline (nightly, on demand, and inside every release) runs every E2E test. |
| 034 FR-054 | The critical selection MUST NOT exceed fifty tests (`CORE_CAP = 50`). | Withdrawn. PR CI runs no E2E (FR-006), so no selection is capped for it. |
| 034 SC-016 | CI's E2E stage takes under 10 minutes on a push or a pull request. | Withdrawn. PR CI runs no E2E; SC-001 bounds the whole PR run at 5 minutes. There is no push trigger. |
| 034 SC-023 | `release.yml`'s `e2e-full` gates `build-installer`, the other half of the `@core` trade. | FR-022/FR-023: the full pipeline gates publication; packaging runs alongside the tests rather than after them. |
| 062 FR-046, SC-008 | Unit, component, integration, contract, `@core` and `@linux` E2E MUST run on Linux in pull-request CI and in the gate. | PR CI runs FR-005's set on Linux; every E2E test, including `@linux`, and the rest of integration run in the full pipeline (FR-011). |
| 070 US6, FR-036, FR-046, SC-002 | Every layer plus `@core` and `@macos` E2E run in PR CI on both macOS releases (on a ready PR), and the same lanes in the gate. | PR CI runs only on Linux (FR-007); every layer, every E2E test and both macOS releases run in the full pipeline on both releases (FR-011). |
| 070 FR-039 | The Windows and Linux lanes keep running unchanged by the macOS work (a branch-end job-inventory check). | Withdrawn: it bound 070's branch; this feature changes those lanes on purpose, and its check is removed (FR-028). |
| 070 FR-050 | The macOS typing-latency measurement runs in the gate's macOS lane. | It runs in the full pipeline's macOS lane (FR-011). |
| 070 FR-045 | The unattended release builds and verifies the macOS copies. | Unchanged in substance; it now happens inside the full pipeline the release run calls (FR-022). |
| 055 calibration (clarification and amendment) | The calibration E2E is asserted in the gate; the release lane only logs it. | The full pipeline asserts it on every run, the release run included (FR-011). |
| Constitution, Development Workflow & Quality Gates | Lint, typecheck and every test layer MUST run in CI on every pull request; E2E runs `@core` on every PR and its full extent on a release. | Amended (FR-032): lint, typecheck, unit, component and contract run on every PR, integration runs a declared bounded subset, and E2E does not run on PRs; every layer runs in full nightly and inside every release. |
| Constitution, Principle V tag rule | `@core` gates continuous integration; `@extended` runs at release. | Amended (FR-032): no significance tag selects a PR lane; every E2E test runs in the full pipeline. |

Nothing else is superseded. **065 FR-003** (a release comes only from a commit on master), **FR-005** (the `release`
Environment), **FR-011** (an unpublished tag may be re-cut; FR-031 below makes that, plus deleting the attempt's artifacts, the
required recovery) and the five publish gates in `docs/releasing.md` stand
unchanged.

## Clarifications

### Session 2026-11-17

- Q: When should each pipeline run? → A: PR CI on every push to a pull request, nothing else. Nothing on a merge to
  master. The full pipeline nightly and on demand. The release only on a release tag.
- Q: How do runs fail? → A: Agent-invoked runs (a release tag, a manual dispatch) fail fast, so the agent that started
  them reads the breakage at once. The nightly runs to completion and logs every failure at the end, so an agent can
  fix everything at once the next day.
- Q: Which macOS releases does PR CI run on? → A: The current one only (later superseded: PR CI runs on Linux only;
  see the platforms question below).
- Q: How is the tag-only release workflow first proven? → A: By the next real release. A run that does not publish is
  discarded: its tag and build artifacts are deleted, the cause fixed, and the same version re-tagged and rebuilt —
  never a new version per failed attempt (FR-030, FR-031; refined by the infrastructure question below).
- Q: When one PR CI job fails, are the rest cancelled or run to the end? → A: Every PR CI job runs to completion; the
  verdict check fails if any failed (FR-002).
- Q: How long may a pull request wait for its verdict? → A: 5 minutes for 90% of runs, and PR CI runs no E2E test at
  all (SC-001, FR-006).
- Q: Which platforms does PR CI run on? → A: Linux only. Windows and both macOS releases run in the full pipeline
  (FR-007).
- Q: When a release run fails on infrastructure rather than a test, re-run or start again? → A: Re-run the failed
  and cancelled jobs once, in the same run, on the same tag; no re-tag. A test or build failure needs a fix, which is
  a new commit, so only then is the tag moved to it (FR-031).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A pull request gets a verdict in minutes (Priority: P1)

A contributor or agent pushes to a pull request, draft or ready. Within five minutes every quick check has run on
Linux in parallel, and the pull request shows one clear pass or fail.

**Why this priority**: PR CI is the loop every change goes round, many times a day. Its wall time is paid on every
push.

**Independent Test**: Push a trivial change to a draft pull request and time the run from push to verdict; push a
change that breaks one unit test and confirm the unit job fails, the other jobs still finish, and the verdict check
fails.

**Acceptance Scenarios**:

1. **Given** a draft or ready pull request to master, **When** a commit is pushed to it, **Then** PR CI starts, and no
   other workflow starts.
2. **Given** a PR CI run, **When** it runs, **Then** lint and typecheck run once, and unit, component and contract
   tests and the integration subset each run as their own job on Linux, with no E2E test, in
   parallel.
3. **Given** every PR CI job passed, **When** the verdict check completes, **Then** it passes, and it is the check
   master's branch protection requires.
4. **Given** a newer push to the same pull request, **When** the older run is still going, **Then** the older run is
   cancelled.

---

### User Story 2 - The full pipeline proves everything every night, without publishing (Priority: P1)

Every night the full pipeline runs every test of every layer on every platform and builds, packages and verifies
every artifact, on master, without a tag and without publishing anything. It runs to the end whatever fails, and
leaves one report listing every failure for an agent to fix the next day.

**Why this priority**: it is the only place the whole suite and the whole packaging path run outside a release, and
it is what release preflight relies on.

**Independent Test**: Let one nightly run with one deliberately failing integration test and one failing E2E test on
a test branch dispatched in nightly mode; confirm every other job still ran to completion and one report names both
failures with links.

**Acceptance Scenarios**:

1. **Given** the nightly schedule fires, **When** the pipeline runs on master, **Then** every layer runs on every
   platform, every artifact is built and verified, and nothing is signed with the release key, published, or pushed to
   a repository or store.
2. **Given** a nightly run in which two jobs fail, **When** the run ends, **Then** every other job ran to completion,
   and one consolidated report on master's nightly-failure issue lists every failing job and test with a link to each.
3. **Given** an open nightly-failure issue, **When** a later nightly run is fully green, **Then** that run records the
   green result on the issue and closes it.
4. **Given** a nightly run, **When** it finishes, **Then** the built installers and packages are downloadable from the
   run for 7 days.

---

### User Story 3 - An agent runs exactly what it needs remotely, and hears about the first failure at once (Priority: P1)

An agent (or the maintainer) dispatches the full pipeline on any branch, choosing which stages, platforms and tests to
run: the whole thing, one layer, a set of E2E tests, one test stressed many times. The run stops at the first failure,
so the agent reads it straight away.

**Why this priority**: agents verify their work remotely, because the full suite must never run on the workstation.
A run that keeps going after a failure wastes the agent's wait.

**Independent Test**: Dispatch the pipeline on a branch with `stages=unit` and a failing unit test on Windows; confirm
only the unit jobs ran, the Windows unit job stopped at the failing test, and the other in-progress jobs were
cancelled.

**Acceptance Scenarios**:

1. **Given** a manual dispatch with a stage subset, **When** the pipeline runs, **Then** only the selected stages run,
   on the selected platforms, with the selected test filter.
2. **Given** a manual dispatch, **When** any test fails, **Then** its job stops at that test, and every other
   in-progress job in the run is cancelled.
3. **Given** a manual dispatch naming one E2E test and a round count, **When** it runs, **Then** that test runs that
   many times with retries off, and every round's evidence is kept.
4. **Given** a dispatch with a subset of stages, **When** release preflight later looks for a full green pipeline,
   **Then** that run does not count.

---

### User Story 4 - A release tag runs the full pipeline, then publishes (Priority: P1)

The release agent merges the release PR and pushes the tag. That tag, and only a tag, starts the release run: the full
pipeline on the tagged tree, then signing, publication and the package repositories, using the artifacts that run
built. The first failure stops the run before anything publishes.

**Why this priority**: it replaces the pre-merge gate and the separate tag run with one run, and removes the release
workflow from every other trigger.

**Independent Test**: Push a release tag on a master commit whose tree breaks one E2E test; confirm the run failed at
that test, cancelled the rest, and published nothing. Re-cut the tag after the fix and confirm it publishes.

**Acceptance Scenarios**:

1. **Given** a `v*` tag pushed on a commit on master, **When** the release run starts, **Then** it first runs the full
   pipeline on that tree in full, whatever any input says.
2. **Given** the full pipeline inside a release run fails, **When** the first failure happens, **Then** the rest of the
   run is cancelled and nothing is signed or published.
3. **Given** the full pipeline inside a release run passes, **When** publication runs, **Then** it publishes the exact
   artifacts that run built and verified.
4. **Given** a `v*` tag on a commit not on master, **When** the release run starts, **Then** it refuses before running
   the pipeline.
5. **Given** a push to a branch, or a manual dispatch, **When** anyone tries to start the release workflow that way,
   **Then** it does not run.
6. **Given** a release run that failed on a test and published nothing, **When** the release agent recovers, **Then**
   the tag and that run's installers and packages are deleted, the fix merges through its own PR, and the **same**
   version is tagged on the fixed commit and built again from scratch.
7. **Given** a release run that failed on an infrastructure fault, **When** the release agent recovers, **Then** the
   failed and cancelled jobs are re-run once in that same run, on the same tag.

---

### User Story 5 - A merge to master costs nothing (Priority: P2)

Merging a pull request starts no workflow at all.

**Why this priority**: with so few contributors, a run after merge repeats what the PR's own CI and the next nightly
already prove.

**Independent Test**: Merge a pull request and list the workflow runs started by the resulting push; there are none.

**Acceptance Scenarios**:

1. **Given** a pull request is merged, **When** master moves, **Then** no workflow run starts.
2. **Given** a change to the website's sources is merged, **When** master moves, **Then** the site is not redeployed
   until the next release or a manual dispatch of the site workflow.

---

### Edge Cases

- **A release tag is re-cut** while its previous run is still going: the older run is cancelled; the new one runs in
  full.
- **A change breaks only Windows or macOS**: PR CI (Linux only) passes; the next nightly reports it, or an agent
  dispatches the full pipeline on the branch for that platform before merging when the change is platform-specific.
- **A version's attempts keep failing**: each attempt is discarded and re-cut under the same version (FR-031); only the
  three-attempts stop rule in the release runbook ends the loop, never a version bump.
- **A dispatch on the same branch while another dispatch runs**: the newer replaces the older. A dispatch never
  cancels the nightly, and the nightly never cancels a dispatch or a release run.
- **The nightly fails, then a release is attempted**: preflight refuses until the nightly-failure issue is closed by a
  fully green full run on master's head, nightly or dispatched with every stage (FR-021, FR-027).
- **Concurrency caps**: the full pipeline's jobs exceed the concurrent-job and macOS caps at peak; extra jobs queue.
  The shard counts are chosen so a full run stays within SC-002 under the caps.
- **An infrastructure fault** (a runner lost, a network failure fetching dependencies) in a fail-fast run: it fails
  the run like any other failure; the agent re-runs the failed and cancelled jobs once in the same run (for a release,
  on the same tag, FR-031). A second infrastructure failure is reported, not re-run again.
- **A flaky test in the nightly**: it is reported as a failure with its retries' evidence, never as a pass.
- **The full pipeline is called by a release with inputs absent**: absent inputs mean "everything", never "nothing".
- **An E2E shard collects zero tests** (a bad split or filter): that shard fails.
- **The PR's verdict check** must fail when any job it summarises was cancelled, skipped by error, or failed.

## Requirements *(mandatory)*

### Functional Requirements

**PR CI**

- **FR-001**: PR CI MUST run on every push to a pull request targeting master, draft or ready, and MUST NOT run on any
  other event (no dispatch, no schedule, no branch push).
- **FR-002**: Every PR CI job MUST run in parallel with the others; no job MUST wait on another except the verdict
  check (FR-004) and any job that only reads a configuration list. PR CI MUST NOT fail fast: a failing job MUST NOT
  cancel the others, and every job MUST run to completion, so one push shows every platform's result.
- **FR-003**: Lint and typecheck MUST run once per PR run, not once per platform.
- **FR-004**: PR CI MUST end with one verdict check that passes only when every other PR CI job passed. Master's branch
  protection MUST require that check (and only checks that exist in PR CI).
- **FR-005**: PR CI MUST run, each as its own job: every unit test, every component test, every
  contract test and the integration subset (FR-008). It MUST NOT run integration tests outside the subset.
- **FR-006**: PR CI MUST NOT run any E2E test. Every E2E test runs in the full pipeline only (FR-011). The `@core` /
  `@extended` significance tags no longer select a CI lane, and the fifty-test `@core` cap is withdrawn.
- **FR-007**: PR CI MUST run on Linux only. Windows and both supported macOS releases MUST NOT run PR CI; they run
  every layer in the full pipeline (FR-011).
- **FR-008**: The integration subset MUST be declared by a tag on the test files, MUST hold at most fifteen files, and
  a guard test MUST fail the build when it exceeds fifteen.
- **FR-009**: A newer push to a pull request MUST cancel that pull request's older PR CI run.

**Nothing on master**

- **FR-010**: No workflow MUST start on a push to master. The release workflow's branch trigger and the site
  workflow's push trigger MUST be removed. The site MUST still deploy on a release and on a manual dispatch.

**Full pipeline**

- **FR-011**: The full pipeline MUST run every test of every layer and tier on every supported platform, as far as each
  test declares that platform: lint, typecheck, unit, component, integration, contract, every E2E test including
  `@extended`, `@admin` (elevated), `@linux` and `@macos`, the memory calibration (asserted) and the macOS
  typing-latency measurement.
- **FR-012**: The full pipeline MUST build and package every declared artifact for every platform, verify each declared
  install combination, run the side-by-side coexistence check and the package-repository verification, and render the
  release body with the version taken from the manifest.
- **FR-013**: The full pipeline MUST NOT read the release signing key, publish a release, upload to a package
  repository or store, or deploy the site, on any trigger or input.
- **FR-014**: The full pipeline MUST NOT need a tag. The artifacts it builds MUST be kept as downloadable run
  artifacts for a bounded retention period.
- **FR-015**: Everything independent MUST run in parallel: each test layer on each platform as its own job; the
  Windows E2E suite split across several runners; packaging on each platform starting at the beginning of the run,
  alongside the tests. Verification of an artifact waits only on that artifact's build.
- **FR-016**: The full pipeline MUST run on a nightly schedule on master, on manual dispatch on any branch, and when
  called by the release workflow.
- **FR-017**: A manual dispatch MUST be able to select: which stages run (all, or any subset of lint, typecheck, unit,
  component, integration, contract, E2E, admin E2E, calibration, packaging and verification); which platforms; an E2E test filter
  (a grep, a spec file, or a category); a unit/component/integration/contract file or test-name filter; the number of
  E2E shards; one E2E test with a round count to stress it with retries off; and, never on a nightly or a release call, the
  manual test plan on runners and Playwright traces on failure. Absent inputs MUST mean everything.
- **FR-018**: The full pipeline MUST end with a verdict job that records whether the run was full or partial, the
  commit and tree it tested, and its result. A run is **full** when it selects every stage and every platform with no
  test filter and no stress input; a nightly or a release call is always full. Every other run is **partial**.

**Failure behaviour**

- **FR-019**: A release run and a manually dispatched full pipeline MUST fail fast: a failing test MUST stop its job at
  that test, and the first failing job MUST cancel every other in-progress job in the run.
- **FR-020**: The nightly run MUST NOT fail fast: every job MUST run to completion whatever else fails, and every test
  in a job MUST run whatever else fails in it.
- **FR-021**: At the end of a nightly run with any failure, one consolidated report MUST be written to master's single
  nightly-failure issue (opening it if none is open): every failing job and every failing or flaky test, each with a
  link to its job and evidence. A later fully green full run (FR-018) on master's head (the nightly, or a full dispatch) MUST record that on the issue and close it. A partial dispatch MUST NOT close it.

**Release**

- **FR-022**: The release workflow MUST run only on a pushed `v*` tag. It MUST first run the full pipeline on the tagged
  tree, in full, regardless of inputs, and MUST sign, publish and deploy the package repositories only after it passed.
- **FR-023**: Publication MUST use the artifacts built and verified in the same release run.
- **FR-024**: The release run MUST check that the tagged commit is on master before running the full pipeline, and
  MUST keep the existing on-master guard before signing and publishing.
- **FR-025**: The release workflow MUST NOT run on a branch push or a manual dispatch, and MUST NOT reuse an earlier
  run's test verdict.
- **FR-026**: Re-pushing a tag for the same version MUST cancel that version's in-progress release run.

**Preflight, guards and governance**

- **FR-027**: Release preflight MUST refuse when the latest full pipeline run (FR-018) on master (the nightly, or a full
  dispatch) did not succeed at its first attempt, or when the nightly-failure issue is open. A partial dispatch MUST NOT satisfy it. It MUST NOT look for a release workflow run on
  master.
- **FR-028**: The repository's workflow guards and tests (the job-inventory guard, the macOS-runner guard, the release
  publication guards and the E2E tag and budget guards) MUST describe the new pipelines, and MUST still enforce: no
  literal macOS runner label, no self-hosted runner, the signing key read only in the signing job, publication only on
  a tag on master.
- **FR-029**: Every agent-facing document that names a pipeline (the project's agent instructions, the testing and
  releasing docs, the environment doc, the contributing guide, the PR template, and the release and testing skills)
  MUST describe the new pipelines and the new release order in the same change.
- **FR-030**: The tag-only release workflow's first run MUST be the next real release. No test tag and no rehearsal
  path is added for it; a failure on that run is handled by FR-031.
- **FR-031**: A release run that fails MUST be recovered without a new version:
  - **Infrastructure fault** (a lost runner, a network or service failure, with no test or build failing on its own
    terms): the release agent re-runs that run's failed and cancelled jobs once, on the same tag and commit. No re-tag.
  - **Test or build failure**: the fix is a new commit, so the release agent deletes the tag (remote and local) and the
    installers and packages that run built, merges the fix through its own PR, and pushes the same tag again on the
    fixed master commit, which builds everything from scratch. The failed run's test evidence is kept until its
    retention expires.
  - The version MUST NOT be bumped because an attempt failed. A run that published MUST NOT be touched (065 FR-011).
- **FR-032**: The constitution's quality-gates section, Principle V's tag rule and Principle II's "macOS is proved
  by CI" (which now names the full pipeline as where that proof runs) MUST be amended to match FR-005,
  FR-006, FR-008 and FR-011, through the constitution amendment process, in this change.

### Key Entities

- **PR CI run**: the checks one push to a pull request starts; ends in one verdict check.
- **Full pipeline run**: every layer, every platform, every artifact; nightly, dispatched or release-called; full or
  partial; fail-fast unless nightly.
- **Release run**: one tag's full pipeline followed by signing, publication and repository deployment.
- **Nightly-failure issue**: the single open record of what the last red nightly found; closed by a green nightly.
- **Integration subset**: the bounded, tagged set of integration tests PR CI runs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 90% of PR CI runs reach a verdict within 5 minutes of the push (baseline 13 min).
- **SC-002**: A full pipeline run with every stage finishes within 35 minutes wall time (baseline: 61 min gate plus
  31 min release run).
- **SC-003**: A release goes from tag push to published within 45 minutes when nothing fails, with no full-suite run
  needed before the release PR merges.
- **SC-004**: Zero workflow runs are started by pushes to master over any 30-day period.
- **SC-005**: In a fail-fast run, the run is marked failed, and no further job starts, within 2 minutes of the first
  failing test finishing.
- **SC-006**: Every published release's tag run contains a green full pipeline on the tagged tree.
- **SC-007**: Every nightly with failures leaves exactly one report that names 100% of its failing jobs and tests.
- **SC-008**: An agent can verify one test layer remotely on a branch in under 15 minutes from dispatch.

## Assumptions

- "Every platform" means the platforms the product supports: Windows, Linux, and the two macOS releases the runner list
  declares. A test that declares a platform-specific tag runs only there.
- The full E2E suite has never run on Linux or macOS beyond `@core` and the platform's own tests. Running all of it
  there (FR-011) is expected to surface failures; they are fixed or tagged to their platform through ordinary work,
  and the nightly reports them until then.
- The serial E2E tier stays one test at a time **within** a runner (focus-stealing specs); splitting it across runners
  is safe because each runner is its own machine.
- Fail-fast keeps the existing infrastructure-fault rule: one re-run of failed jobs is allowed for an infrastructure
  fault only, never for a test failure.
- Artifacts are retained for 7 days unless the plan finds a reason otherwise.
- Changing master's required status checks is a repository setting outside the tree; it is applied with the
  maintainer's approval when the new verdict check first exists.
- Running the full pipeline locally stays forbidden; `npm run gate` remains the local entry point for a single stage.

## Out of Scope

- Changing what any individual test asserts, beyond tagging tests into the integration subset.
- Code signing (#118) and automatic update (#119).
- A pipeline that starts a release by itself.
