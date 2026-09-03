# Tasks: Release Notes & Multi-Artifact Publication

**Feature**: 042 | **Branch**: `feature/S042-I350-I351-release-notes-and-artifacts`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Format: `[ID] [P?] [Story] Description`

- **[P]** — parallelisable: a different file, with no dependency on an incomplete task.
- **[US1] / [US2] / [US3]** — the user story from spec.md the task serves. Setup, Foundational and
  Polish tasks carry no story label.

**Tests are requested, and they come first.** Every pure module here is written test-first at the
**unit** layer, which is the lowest layer that can prove any of it. **No E2E test is added by this
feature** — nothing here is reachable from the application UI, so the `@core`/`@extended` budget
ratchet in `packages/ui/tests/e2e/e2e-budget.json` is untouched and must stay untouched.

## Path Conventions

- Pure logic: `packages/core/src/config/`, tested from `packages/core/tests/unit/`.
- Build-time CLIs: `scripts/*.mjs`, tested from `packages/core/tests/unit/` by importing the CLI's
  exported `main()` and driving it against a temp directory.
- Pipeline: `.github/workflows/release.yml`, `electron-builder.yml`.
- Docs: `docs/`, `CHANGELOG.md`.

---

## Phase 1: Setup

- [x] T001 Read `scripts/publish-gates.mjs` and `packages/core/src/config/publish-gate.ts` together and confirm the shape every new module copies: pure decision in core, env/argv marshalling in the CLI, no logic in YAML
- [x] T002 [P] Add the `release-artifacts` and `release-notes` exports to `packages/core/src/index.ts` as empty barrels so the CLIs can import them before they exist

---

## Phase 2: Foundational (blocking prerequisites)

**Everything below blocks all three user stories.** The artifact declaration is what US1's checksum
table, US2's verification set and US3's new formats all resolve against.

- [x] T003 Write failing unit tests for `declareArtifactSet` in `packages/core/tests/unit/release-artifacts.test.ts`: the returned set is non-empty, every filename carries the version, roles are unique, filenames are unique
- [x] T004 Write failing unit tests for `resolveArtifact` in `packages/core/tests/unit/release-artifacts.test.ts`: resolving a known role returns exactly one artifact; resolving an unknown role throws naming the role and listing the valid ones; **two artifacts sharing the `.exe` extension resolve to different files**
- [x] T005 Write failing unit tests for `reconcileArtifactSet` in `packages/core/tests/unit/release-artifacts.test.ts`: exact match passes; a declared-but-absent file reports `missing`; **a produced-but-undeclared file reports `unexpected` and fails**; `reason` is a single sentence naming the discrepancy
- [x] T006 Implement `ReleaseArtifactRole`, `ReleaseArtifact`, `ReleaseArtifactSet`, `ReconcileResult`, `declareArtifactSet`, `resolveArtifact` and `reconcileArtifactSet` in `packages/core/src/config/release-artifacts.ts` per [data-model.md](./data-model.md), declaring only the `setup` role for now
- [x] T007 Export the new types and functions from `packages/core/src/index.ts` and run `npm run test:unit` to green T003–T005
- [x] T008 Write failing unit tests for the `artifact-set.mjs` CLI in `packages/core/tests/unit/release-cli-artifact-set.test.ts`, covering every documented exit code in [contracts/artifact-set.md](./contracts/artifact-set.md): 0 for `list`/`resolve`/`reconcile` success, 2 unknown role, 3 declared artifact missing, 4 reconcile failure — each asserting the stderr message names the role or artifact
- [x] T009 Implement `scripts/artifact-set.mjs` with `list`, `resolve` and `reconcile` subcommands, `--dir` defaulting to `dist/installer`, and the version read only from the root `package.json`
- [x] T010 Run `npm run test:unit` and confirm T008 is green; `resolve` must print the bare path and nothing else so `$(…)` interpolation is safe

**Checkpoint**: the declaration exists and is resolvable by role. Nothing in the pipeline uses it yet.

---

## Phase 3: User Story 1 — A release says what changed in it (Priority: P1) 🎯 MVP

**Goal**: a published release body states what changed in that release, above an unchanged invariant
footer.

**Independent test**: publish two consecutive versions and compare their bodies — they differ by more
than a version number and a hash. Provable at Tier 1–3 of [quickstart.md](./quickstart.md) without
any new artifact existing.

### Tests for User Story 1

- [x] T011 [P] [US1] Write failing unit tests for the changelog parser in `packages/core/tests/unit/release-notes.test.ts`: a well-formed section parses into ordered `NotesSection`s; recognised headings are grouped; an **unrecognised heading is passed through in place, never dropped**; HTML comments and the `# Changelog` title are ignored
- [x] T012 [P] [US1] Write failing unit tests for the four `NotesLookupResult` causes in `packages/core/tests/unit/release-notes.test.ts`: `no-section-for-version`, `section-empty`, `version-mismatch` (carrying `foundVersion`), and the success case — plus the rule that **`## 1.0.0` does not satisfy a publish of `1.0.1`**
- [x] T013 [P] [US1] Write a failing unit test in `packages/core/tests/unit/release-notes.test.ts` asserting the parser **never falls back**: given a changelog with a section for the previous version only, looking up the current version returns `no-section-for-version` rather than the previous version's notes
- [x] T014 [P] [US1] Write failing unit tests for `isEmptyByDeclaration` in `packages/core/tests/unit/release-notes.test.ts`: only the exact literal `- No user-visible changes in this release.` sets it; any other empty section is `section-empty`
- [x] T015 [P] [US1] Write failing unit tests for body composition in `packages/core/tests/unit/release-notes.test.ts`: the footer is present, last, and in the order warning → verification guidance → checksum table → source revision; the table has **one row per artifact** with that artifact's own filename
- [x] T016 [P] [US1] Write a failing unit test in `packages/core/tests/unit/release-notes.test.ts` for the size cap (FR-010): given an oversized changelog, the notes are truncated at a section boundary with a pointer to `CHANGELOG.md`, the **footer is untouched**, and composition still succeeds

### Implementation for User Story 1

- [x] T017 [US1] Implement `ReleaseNotes`, `NotesSection`, `NotesLookupResult`, the changelog parser, and `composeReleaseBody` in `packages/core/src/config/release-notes.ts` per [contracts/release-notes.md](./contracts/release-notes.md); export from `packages/core/src/index.ts`
- [x] T018 [US1] Run `npm run test:unit` and green T011–T016
- [x] T019 [US1] Create `CHANGELOG.md` at the repository root with the format from [contracts/release-notes.md](./contracts/release-notes.md), an `## Unreleased` section, and a leading HTML comment noting which sections were reconstructed after the fact
- [x] T020 [US1] Write failing unit tests for `scripts/release-notes.mjs` in `packages/core/tests/unit/release-cli-release-notes.test.ts` covering exits 0, 2, 3 and 4 with their messages
- [x] T021 [US1] Implement `scripts/release-notes.mjs` with `render --version --out --artifacts --sha`; it MUST NOT hash anything itself — digests arrive via `--artifacts` so 020 FR-042a's last-step-reads-the-bytes ordering is preserved
- [x] T022 [US1] Extend `PublishGateInput` in `packages/core/src/config/publish-gate.ts` with `notesBindToVersion`, evaluated after the version checks and before the sign-off check, with its own refusal message; extend `packages/core/tests/unit/publish-gate.test.ts` first
- [x] T023 [US1] Feed `notesBindToVersion` from `scripts/publish-gates.mjs` by calling the notes lookup for the package version
- [x] T024 [US1] Add a **render release body** step to the `verify-installer` job in `.github/workflows/release.yml` that writes the composed body and uploads it as a run artifact (FR-006), so a non-publishing dispatch rehearses the composition
- [x] T025 [US1] Replace the hardcoded `notes=` heredoc at `.github/workflows/release.yml:249-260` with `--notes-file` from `scripts/release-notes.mjs`, keeping the existing prerelease branch on a SemVer suffix intact (FR-008)

**Checkpoint**: a release body says what changed, the footer is unchanged, and a missing section
refuses the publish. Deliverable on its own over today's single artifact.

---

## Phase 4: User Story 2 — Every artifact is named, verified and checksummed (Priority: P2)

**Goal**: the pipeline resolves, verifies and publishes a declared set rather than the first `.exe`
it finds.

**Independent test**: with today's single artifact, removing or renaming an expected file fails the
run with a message naming which artifact was missing.

### Tests for User Story 2

- [x] T026 [P] [US2] Write failing unit tests for the extended verdict in `packages/core/tests/unit/verification-verdict.test.ts`: a verdict passes only when **every** role in the declared set has an `ArtifactVerdict` that passed and binds to that artifact's sha256; a verdict covering two of three artifacts is a refusal naming the artifact with no verdict (FR-016)
- [x] T027 [P] [US2] Write a failing unit test in `packages/core/tests/unit/verification-verdict.test.ts` for the three step states: a step outside a role's `applicableSteps` is `not-applicable`; a verdict marking a step `not-applicable` for a role that **does** declare it applicable is **invalid**, not merely failing
- [x] T028 [P] [US2] Extend `packages/core/tests/unit/publish-gate.test.ts` with the `artifactSetReconciles` input and its refusal message, ordered before the sign-off check

### Implementation for User Story 2

- [x] T029 [US2] Extend `VerificationVerdict` with `artifacts: ArtifactVerdict[]` and replace `isVerdictPassingFor(verdict, version, sha)` with `isVerdictPassingFor(verdict, version, artifactSet)` in `packages/core/src/config/verification-verdict.ts`
- [x] T030 [US2] Add `applicableSteps` to each `ReleaseArtifact` in `packages/core/src/config/release-artifacts.ts`, per the table in [contracts/verification-verdict.md](./contracts/verification-verdict.md)
- [x] T031 [US2] Add `artifactSetReconciles` to `evaluatePublishGate` in `packages/core/src/config/publish-gate.ts`
- [x] T032 [US2] Run `npm run test:unit` and green T026–T028
- [x] T033 [US2] Add a `--role` argument to `scripts/verify-installer.mjs` and make it emit an `ArtifactVerdict` keyed by role, recording inapplicable steps as `not-applicable` rather than skipping or passing them
- [x] T034 [US2] Update `scripts/publish-gates.mjs` to resolve the artifact set, feed `artifactSetReconciles`, and pass the set (not one sha) to `isVerdictPassingFor`
- [x] T035 [US2] Replace the `ls dist/installer/*.exe | head -n1` resolution at `.github/workflows/release.yml:178` with `node scripts/artifact-set.mjs resolve <role>`
- [x] T036 [US2] Replace the same resolution at `.github/workflows/release.yml:235`
- [x] T037 [US2] Replace the same resolution at `.github/workflows/release.yml:246`, and make the checksum step compute a digest **per artifact** rather than one
- [x] T038 [US2] Replace the `path: dist/installer/*.exe` upload glob at `.github/workflows/release.yml:142` with an explicit list derived from the declared set
- [x] T039 [US2] Add a `reconcile` step to `.github/workflows/release.yml` immediately after `npm run package`, so a build producing the wrong set fails at the build rather than four jobs later (FR-013)
- [x] T040 [US2] Make the publish step attach **every** artifact in the set to the release, not one file

**Checkpoint**: no step resolves an artifact ambiguously. This is the prerequisite for adding any
format.

---

## Phase 5: User Story 3 — throng without an installer (Priority: P3)

**Goal**: a portable executable and a zip archive, each verified to the same end state as the
installer.

**Independent test**: on a clean machine, extract the archive, run throng, spawn a terminal, delete
the folder — nothing installed, nothing left behind.

- [x] T041 [US3] Add `portable` and `zip` to `win.target` in `electron-builder.yml`, each with an explicit `artifactName` carrying the version, matching the existing `throng-setup-${version}.${ext}` pattern
- [x] T042 [US3] Extend the tests in `packages/core/tests/unit/release-artifacts.test.ts` for the three-role set, then add the `portable` and `archive` roles with their labels and `applicableSteps` to `packages/core/src/config/release-artifacts.ts`
- [x] T043 [US3] Run `npm run package` and `node scripts/artifact-set.mjs reconcile`; correct the declared `artifactName`s in `electron-builder.yml` until the set reconciles — the declaration is the contract, so a mismatch is fixed at the builder, not by loosening the declaration
- [x] T044 [US3] Add the archive verification path to `scripts/verify-installer.mjs`: extract to a temp folder, launch, assert version, assert the daemon runs under the bundled runtime, no service, core journey, reattach, checksum, then remove the folder and residue-scan
- [x] T045 [US3] Add the portable verification path to `scripts/verify-installer.mjs`, and point `scripts/residue-scan.mjs` at the **unpack location**, not only the download folder
- [x] T046 [US3] Prove the portable residue scan can actually fail: deliberately leave the unpack directory in place, re-run verification, and confirm it reports residue. A scan that passes here is pointed at the wrong location and its green means nothing
- [x] T047 [US3] Measure portable start-up against SC-005's three-minute download-to-terminal bar and record the number in `docs/releasing.md`; throng is not asar-packed, so a self-extracting build unpacks a large tree on every launch (research D4)

### T045 — what verifying a portable build actually took

**All three artifacts now verify green.** The portable verdict passes every applicable step, with
`interrupted-install`, `install`, `shortcut`, `no-write` and `uninstall` recorded
`not-applicable` rather than passed.

It took seven attempts, and **every failure was this harness getting in its own way — none was a
defect in the artifact.** That was settled by launching the portable build the way a user does:
4 processes, one with a real window. The build was never broken.

Seven causes, in the order they were found:

1. `cmd /c start` needs a console. From CI and from a backgrounded shell there isn't one, so the
   harness sat silent for eight minutes. Replaced with a detached `spawn`.
2. The launch probe collided with the developer's own running throng: Electron keys its
   single-instance lock to `userData`, and a *packaged* build does not isolate it. The probes now
   pass their own `--user-data-dir`.
3. The residue scan counted **any** throng-named process as residue, including the developer's own.
   Attribution is now by path.
4. The unpack launch held the lock on the **probe's** profile, starving every probe after it. The
   two now use separate profiles.
5. Discovery required a *new* directory under TEMP; electron-builder's portable target reuses a
   **stable** one, so the second run skipped the very tree it was looking for.
6. **The launcher deletes its unpack directory when it exits.** Unpack → kill the launcher → drive
   the unpacked exe is impossible by construction: step two destroys what step three needs. The
   harness now **copies the tree before stopping the launcher** and probes the copy.
7. **The copy was taken too early.** `throng.exe` appears first and the remaining ~135 MB lands
   behind it, so copying on first sight took a torn read that started, attached a debugger and hung
   forever. The harness now waits for the tree's listing to be identical twice in a row.

And one fix that had to be **undone**: supplying `PORTABLE_EXECUTABLE_DIR` and
`PORTABLE_EXECUTABLE_FILE`, the variables the launcher sets, looked obviously correct and was the
cause of the failure it was meant to fix — with them set the app exits 1 the moment Playwright
attaches. The archive is the same binary driven the same way without them, and passes.

**Two things now guard the result.** `--keep-residue` leaves the tree in place and requires
`residue-scan` to come back `failed`; it does, so the ordinary green means something. And the
launcher's own cleanup is no longer asserted on, because the harness force-kills the launcher and so
prevents it — that assertion passed or failed depending on how the kill landed, which was observed
both ways in one afternoon.

**Measured start-up** (T047), launch to a window: portable **23.1 s cold, 23.3 s warm** — it
re-extracts every time, exactly as [research.md](./research.md) D4 predicted; archive **58.1 s** to
extract once, then **1.6 s** per launch. Both well inside SC-005's three-minute bar, so D4's
sanctioned fallback of dropping `portable` in favour of `zip` was **not needed**.

**Checkpoint**: three artifacts, each verified, each in the release body with its own checksum.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T048 [P] Seed `CHANGELOG.md` with sections for `1.0.0-alpha1`, `alpha2` and `alpha3`, compiled from the work between those tags
- [x] T049 [P] Update `docs/installation.md` to say which artifact a reader should choose and why, keeping its existing statement that the release notes carry the checksum true (FR-023)
- [x] T050 [P] Update `docs/releasing.md` §4 and *What runs where* with the artifact set, where notes come from, who reviews them and when, and exactly what fails a release (FR-024)
- [x] T051 [P] Check `README.md` for any claim about what a release contains and correct it; the README describes the current shipped state only and must not become a changelog
- [x] T052 Run `npm run lint` and `npm run typecheck` and fix to zero errors
- [x] T053 Establish done-ness. **`npm run gate` was NOT run locally**, deliberately: the full suite is dispatched to the self-hosted runner rather than run on the workstation, and that runner (#358) has not landed. CI stands in and covers seven of the gate's eight stages plus both E2E lanes — lint, typecheck, build, unit, component, integration, contract, `E2E (@core)` and `E2E (@admin, elevated)`, the last of which only CI can run at all. The only stage nothing has run is the **full `@extended` E2E lane**, which belongs to the release pipeline. Locally: lint 0 errors, typecheck 0 errors, unit 335 files / 3310 tests, component 100 / 1031, integration 96 / 546, contract 25 / 138. No E2E is added by this change and the budget ratchet is untouched, so the E2E stages are expected to be unaffected — and were.
- [x] T054 Confirm `packages/ui/tests/e2e/e2e-budget.json` is unchanged, since no E2E is added

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 → Phase 2** — the shape must be understood before the modules are written.
- **Phase 2 → everything.** The declaration blocks US1's checksum table, US2's verdict set and US3's
  new formats.
- **Phase 3 (US1) → independent of Phase 4 and 5** once Phase 2 lands. It is the MVP and ships alone.
- **Phase 4 (US2) → Phase 5 (US3).** Hard dependency: adding a second `.exe`-producing target before
  the resolutions are explicit is exactly the defect this feature removes.
- **Phase 6** last.

### Within each story

Tests before implementation, always. Every implementation task in Phases 2–4 has a failing test
written before it.

### Parallel opportunities

- T011–T016 are one file but independent cases; write them together.
- T026–T028 touch three different test files: fully parallel.
- T048–T051 are four different documents: fully parallel.
- **T035, T036 and T037 are NOT parallel** — all three edit `.github/workflows/release.yml`.

---

## Implementation Strategy

### MVP

**Phase 1 + Phase 2 + Phase 3 (US1).** That delivers the headline value of #350 — a release that says
what changed — over today's single artifact, with no new format and no verification change. It is
independently shippable and independently valuable.

### Incremental delivery

1. **Phase 2** — the declaration, used by nobody. Safe, invisible.
2. **Phase 3** — notes. Shippable; #350 closes here.
3. **Phase 4** — explicit resolution. Shippable; still one artifact.
4. **Phase 5** — the two new artifacts. #351's portable and archive half closes here; its MSI half is
   #361.

### What no phase can prove

The `gh release create` call, the Environment approval, the prerelease flag and the published body's
rendering on GitHub are only reachable at a real release. T024 exists partly to shrink that
remainder. See *Provability* in [plan.md](./plan.md) — this is stated, not worked around.
