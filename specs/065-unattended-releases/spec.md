# Feature Specification: Unattended Releases

**Feature Branch**: `feature/S065-unattended-releases`

**Created**: 2026-11-06

**Status**: Draft

**Input**: The maintainer, 2026-11-06: "Update the release skill and pipelines so there are no human gates. If I ask for a release, either by version number or the default of the next alpha or beta, the release runs completely unattended, end to end. Everything required for the release is automated." And: "The release skill should also run npm audit, update patches and minor versions, automatically fix any issues it encounters, PR those in, and run the release process again until we have a published package. The full gate must run for a release." A nightly release that starts itself is the next step and is out of scope here.

## Requirements this feature changes

This feature removes the human QA sign-off from publication. Each requirement below is superseded where it makes a person the last gate, and stands in every other respect.

| Requirement | What it said | What replaces it |
|---|---|---|
| 020 FR-028 (c) | Publication needs a human QA sign-off recorded for the exact package. | Withdrawn. Conditions (a) and (b) stand, with 042 FR-005 and FR-013 and 058 FR-030 beside them. FR-003 below stands in for the review a person gave. |
| 020 FR-029 | The sign-off is an explicit act by a person, never automation, a default or time. | Withdrawn (FR-001). |
| 020 FR-030 | A sign-off binds to the exact package. | Withdrawn with the sign-off. The binding of a release to its package stands through FR-033 and SC-002's four-way version match. |
| 020 SC-005 | No release publishes without version, verification **and QA sign-off**. | No release publishes without every machine gate satisfied; each refusal still names the unmet gate. |
| 042 FR-006 | The body is rendered before publication so the person signing off approves the text that ships. | The body is still rendered before publication, and any refusal stops the release there (FR-004). It is the record of what shipped, not something a person approves. |
| 063 FR-021, second clause | The human QA sign-off remains the only route to publication. | A `v*` tag on a commit already on master is the only route (FR-002, FR-003). |
| 064 FR-009 | The signing key is usable only by a job behind the human QA sign-off. | The key stays a `release` Environment secret, readable only by a job running for a `v*` tag, after the on-master check (FR-003, FR-005). |

020 FR-037 stands: no gate has an override, and nothing in this feature adds one.

## Clarifications

### Session 2026-11-06

- Q: What reviews a release once no person does? → A: Every release commit reaches master through a pull request whose required checks passed, and the full gate runs on that tree. The tag must point at a commit already on master. A tag pushed on any other commit is refused before a key is read.
- Q: Can a dispatch still publish? → A: No. A dispatch is always a rehearsal. Only a `v*` tag publishes, so nothing can publish a branch that never merged.
- Q: How does the release continue after a failure? → A: The runbook fixes the cause on its own branch, merges it through a PR with green checks, and runs the release again. A version that never published may be re-cut on the fixed commit. A published version is never reused.
- Q: When does the release stop instead of continuing? → A: When the fix needs a decision only the maintainer can make, or the same failure survives three attempts. It reports what it found and what it tried.

### Session 2026-11-07

The alpha15 sweep met an advisory (minimatch, GHSA-g3hv-75wg-m249) whose only fix was a major of a dev-only transitive dependency, and stopped under the edge case and FR-010 as first written. The maintainer: "CAN we upgrade? IF we can't, and its only a dev advisory, then the release skill should accept that by default. If we CAN upgrade, then it should upgrade and test it. If the upgrade fails, then roll it back and publish without it, notifying me of the result after the release, and suggesting corrective action."

- Q: What does the release do with an advisory whose only fix is a major? → A: It attempts the major and proves it. If it holds, it ships in the sweep (FR-007a). If it fails, or there is no fix at all, an advisory that reaches only development tooling is accepted and reported after the release; one that reaches what ships still stops (FR-007b, FR-010).

### Session 2026-11-08

alpha15 reached `publish` and then waited on a required reviewer, and only then found master's `release.yml` had been red for two days. The maintainer: "master must be green and no flakes should exist. An agent should respond to a failed preflight check and attempt a fix, without asking me."

- Q: What must hold before a release starts? → A: Master proved green at first attempt, no nightly failure left open, and the `release` Environment as FR-005 requires. A failure is fixed by the runbook, unasked (FR-013).
- Q: Must `release.yml` repeat a suite the gate just ran? → A: No. A full gate, green at its first attempt on the identical tree, stands in for it (FR-014).

### Session 2026-11-12

alpha16's sweep opened its own PR (#620) as FR-007 required, so the release waited on two PRs, each with its own checks, before its own could start. The maintainer: "if this is running as part of a release, then it should roll the sweep and updates into the release PR, so we are not waiting for multiple PRs as part of a release."

- Q: Where does the release's dependency sweep land? → A: On the release branch, as a commit of its own before the release commit, in the release PR. It no longer reaches master through a PR of its own (FR-007, superseding its first version). The commit stays separate so a dependency failure still reads as one, and the release's full gate proves the sweep with everything else. A major taken to clear an advisory (FR-007a) rides the same way; a fix for a failure the release meets still gets its own PR (FR-009).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask for a release and get a published package (Priority: P1)

The maintainer asks for a release, naming a version or not, and walks away. The next thing they see is a published release, or a report saying exactly why there is none.

**Independent Test**: Ask for "the next alpha" with `1.0.0-alpha14` published. Without any further input, `1.0.0-alpha15` is published with its notes, its seven artifacts and its signed repository bundle, and `apt` and `dnf` serve it.

**Acceptance Scenarios**:

1. **Given** the latest release is `1.0.0-alpha14`, **When** the maintainer asks for a release without a version, **Then** `1.0.0-alpha15` is released.
2. **Given** a version is named, **When** the release runs, **Then** that exact version is released, prerelease suffix included.
3. **Given** every check passes, **When** the tag's pipeline reaches publication, **Then** it publishes without waiting for anyone.

---

### User Story 2 - A failure is fixed, not handed back (Priority: P1)

Something breaks on the way: an advisory, a dependency that no longer builds, a failing test, a pipeline fault. The release fixes it through a pull request and tries again.

**Independent Test**: Introduce a failure the gate catches into the release branch. The release opens a fix PR, merges it once its checks pass, and publishes on the next attempt.

**Acceptance Scenarios**:

1. **Given** `npm audit` reports an advisory with a fix, **When** the release runs, **Then** the fix is a commit of its own on the release branch, before the release commit, and lands on master with the release PR.
2. **Given** a release run fails after its tag was pushed and before it published, **When** the cause is fixed on master, **Then** the same version is re-cut on the fixed commit and released.
3. **Given** a failure needs a decision only the maintainer can make, **When** the release meets it, **Then** it stops and reports the decision needed, publishing nothing.

---

### User Story 3 - Nothing unreviewed can publish (Priority: P1)

Removing the person must not open a route around review.

**Independent Test**: Push a `v*` tag on a commit that is not on master. The run refuses before reading the signing key or creating a release.

**Acceptance Scenarios**:

1. **Given** a tag on a branch commit, **When** its pipeline reaches sign-index or publish, **Then** both refuse, naming the commit.
2. **Given** a dispatched run, **When** it completes, **Then** nothing is signed or published, whatever its inputs.

### Edge Cases

- **A tag whose run failed before publication**: the version was never published, so its tag may be deleted and re-cut on the fixed commit. A published version stays immutable (020 FR-034).
- **A major upgrade is needed to clear an advisory**: the release attempts it and proves it (FR-007a). Only an advisory that reaches what ships, and that the attempt cannot clear, is a maintainer decision; the release stops and says so. *(Amended 2026-11-07; the first version stopped on every such advisory.)*
- **An advisory reaches only development tooling and cannot be cleared**: it is accepted, and the final report names it with a corrective action (FR-007b).
- **A package deliberately held back** (for example `better-sqlite3` at 12.x): the sweep honours the hold.
- **`deploy-repositories` fails after publication**: the release is out. The job is re-run, and the release counts as published once the repositories serve it.

## Requirements *(mandatory)*

### Functional Requirements

**The pipeline**

- **FR-001**: Publication MUST NOT wait for any human act. Every publish condition MUST be evaluated by the machine. *(Supersedes 020 FR-028(c), FR-029, FR-030.)*
- **FR-002**: Only a run for a `v*` tag MAY sign indexes or publish. A dispatched run MUST NOT, whatever its inputs.
- **FR-003**: Each job that reads the signing key or creates a release MUST first refuse a tag whose commit is not on master, before reading any secret.
- **FR-004**: The release body MUST be rendered, from every publish condition except "already published", before any signing or publishing job starts. Any refusal MUST fail that render and stop the release. *(Restates 042 FR-006.)*
- **FR-005**: The `release` Environment MUST have no required reviewers, and MUST accept deployments only from `v*` tags.

**The runbook (`throng-release`)**

- **FR-006**: A request naming a version MUST release that version. A request naming none MUST release the next version on the current prerelease track (`alpha14` → `alpha15`). "The next beta" or "the next rc" MUST start that track at 1, or advance it if it has started. A version without a prerelease suffix MUST be released only when named.
- **FR-007**: Every release MUST first run `npm audit` and fix every advisory that has a fix, and take every patch and minor update. The sweep MUST be a commit of its own on the release branch, before the release commit, and reach master in the release PR. *(Amended 2026-11-12; the first version required each to reach master through its own pull request before the release branch was cut.)* Majors and deliberately held packages MUST be left as they are, and named in the release PR.
- **FR-007a**: When an advisory's only fix is a major upgrade, the runbook MUST attempt that upgrade (an `overrides` entry when the package is transitive) and prove it: the local checks, plus a before-and-after comparison of whatever the package governs (for a packaging tool, the packaged file list). An upgrade that holds MUST ship in FR-007's sweep commit. One that fails, there or later in the release, MUST be removed from the sweep commit before the release continues.
- **FR-007b**: An advisory that cannot be cleared (no fix, or its major upgrade failed under FR-007a) MUST be accepted without stopping when it reaches only development tooling — `npm ls <package> --omit=dev` lists nothing. The release MUST publish without it, and the final report MUST name the advisory, the attempt and its result, and a corrective action. One that reaches what ships MUST stop the release (FR-010).
- **FR-008**: The full gate (`gate.yml`) MUST pass on the release commit's tree before the tag is pushed.
- **FR-009**: On any failure (gate, required check, release pipeline), the runbook MUST diagnose the cause, fix it on its own branch, merge it through a PR whose checks pass, and run the release again until a release is published.
- **FR-010**: The runbook MUST stop, publishing nothing further, and report when a fix needs a maintainer decision (a major upgrade other than FR-007a's, an advisory reaching what ships that FR-007a cannot clear, a requirement change) or when the same failure survives three attempts.
- **FR-011**: A tag whose release never published MAY be deleted and re-cut. A published version MUST NOT be reused or moved.
- **FR-013**: Before anything else, the runbook MUST run `scripts/release-preflight.mjs`, which MUST refuse: a `release` Environment not as FR-005 requires; a latest finished `release.yml` or full gate on master that is not a success at its first attempt; and an open nightly-failure issue. The runbook MUST fix what it reports without asking, by FR-009's route, and MUST apply FR-005's setting itself. Only a guard refusing that change, or FR-010, stops it.
- **FR-014**: `release.yml` MAY omit its full E2E suite when a full `gate.yml` run succeeded at its first attempt on the identical git tree. Any doubt MUST run the suite. FR-008 stands.

**Documentation**

- **FR-012**: `docs/releasing.md`, `docs/environment.md` and the `throng-release` skill MUST describe the unattended release, and MUST NOT describe a sign-off.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A release request reaches a published release, or a stop report, with no human input after the request.
- **SC-002**: No run for a tag on a commit outside master signs or publishes anything.
- **SC-003**: Every published release's commit has a green `gate.yml` run on its tree.

## Assumptions

- Branch protection on master stays as it is: a pull request with the required checks passing, no approvals needed.
- The maintainer can still stop a release at any time by cancelling its run.

## Out of Scope

- A release that starts itself (nightly or on a schedule). This feature is the manual half of that.
- Code signing (#118).
