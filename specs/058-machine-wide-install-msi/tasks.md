---
description: "Task list for 058 — machine-wide installation and the MSI"
---

# Tasks: Machine-Wide Installation & the MSI

**Input**: Design documents from `/specs/058-machine-wide-install-msi/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Required — constitution Principle V (test-first). Every implementation task is preceded by
the test that fails without it. Layers are the repo's own: vitest `unit`, `component`, `integration`;
Playwright E2E. Installers themselves are proved by the release matrix (US5), not by vitest.

**Organization**: by user story. Phases are ordered by **dependency**, not strictly by priority: US5
(P1) verifies the artifacts US1–US4 produce, so it comes after them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [x] T001 Capture electron-builder's generated MSI project as a test fixture: write a throwaway hook in the job's temp dir that copies the `.wxs` path it is given to `packages/core/tests/unit/fixtures/msi-template-output.wxs`; after `npm run build` and `npm run stage:runtime`, run `npx electron-builder --win msi --publish never -c.msi.oneClick=false -c.msi.perMachine=false -c.msiProjectCreated=<that hook>` (the fixture is the deliverable; the built MSI is discarded); prepend an XML comment recording the `app-builder-lib` version; delete the throwaway hook

---

- [x] T057 Find the tests that assert behaviour this spec supersedes (020 FR-040 per-user-only, 020 FR-012 no elevation for every path, 003 FR-034 silent second launch, the portable pipe suffix): `git grep -n -i "perMachine\|machine-wide\|allowElevation\|second launch\|second-instance\|PORTABLE_PIPE_SUFFIX\|\.portable" -- packages/*/tests scripts` and `grep -rn "FR-034\|FR-040" specs/003-*/spec.md specs/020-*/spec.md`; list each hit in the ledger with the task that will change it (T014, T025, T027 or T036), so no old assertion is left to contradict the new behaviour (CLAUDE.md, *find the requirement that already governs it*)

## Phase 2: Foundational — the release model (blocks US1–US5)

**Purpose**: the declared set with the MSI and scopes, combinations, verdicts and gate — every
installer task and the pipeline resolve through these.

- [x] T002 [P] Write failing unit tests in `packages/core/tests/unit/release-artifacts.test.ts` for: role `'msi'` with filename `throng-<version>.msi` and label `Installer (MSI, for managed deployment)`; `scopes` `['per-user','machine']` for `setup` and `msi` and `[]` for `portable` and `archive`; an `audience` line on every artifact; `combinationsOf(set)` yielding exactly `setup-user, setup-machine, msi-user, msi-machine, portable, archive` with `verdictFile` `verification-verdict-<id>.json`, scope steps per data-model.md (per-user → `standard-account-install`; machine → `second-account`, `in-use-upgrade`, `not-elevated-launch`, plus `silent-elevation-refused` for `setup` only), and `install-labels` + `no-write` on every setup/msi combination; reconcile treating `.msi` as a candidate extension
- [x] T003 [P] Write failing unit tests in `packages/core/tests/unit/verification-verdict-set.test.ts` for: the six new steps; a `reattach-across-copies` coexistence step; `StepOutcome` `'unproven'`; `RUNNER_LIMITED_STEPS` (initially only the GUI half of `second-account`); `unproven` on a non-listed step treated as `failed`; verdict identity by `combination`; `isVerdictPassingForCombinations` failing on a missing combination, a failed step, or an applicable step marked `not-applicable`; a `CoexistenceVerdict` with steps `all-installed`, `each-launches-own-version`, `second-launch-refused`, `same-data-folder`, `reinstall-one-leaves-others`, `uninstall-one-leaves-others`, all required `passed`
- [x] T004 Extend `packages/core/src/config/release-artifacts.ts` (role, scopes, audience, `combinationsOf`, `InstallScope`) to pass T002
- [x] T005 Extend `packages/core/src/config/verification-verdict.ts` (steps, `unproven`, `RUNNER_LIMITED_STEPS`, combination verdicts, coexistence verdict) to pass T003
- [x] T006 Write failing unit tests in `packages/core/tests/unit/publish-gate.test.ts`: refusal naming a missing combination id, a failed step (`<id>: <step>`), an `unproven` non-runner-limited step, a missing or failing coexistence verdict; pass with `unproven` on a runner-limited step and that step listed in the gate's `reportedGaps`
- [x] T007 Extend `packages/core/src/config/publish-gate.ts` to pass T006
- [x] T008 [P] Write failing unit tests in `packages/ui/tests/unit/release-notes-cli.test.ts` (and `packages/core/tests/unit/release-notes.test.ts`) for the download table carrying each artifact's `audience` line, four SHA-256 rows for four artifacts, and a verification-gaps line listing every `unproven` step when given one
- [x] T009 Extend `packages/core/src/config/release-notes.ts` and `scripts/release-notes.mjs` to pass T008
- [x] T010 Write failing unit tests for `artifact-set.mjs list --combinations [--json]` (tab-separated `<id>\t<role>\t<scope|->\t<verdictFile>`, exit 0) in `packages/ui/tests/unit/release-artifact-set-cli.test.ts`, and for `publish-gates.mjs` reading combination + coexistence verdict files in a new `packages/ui/tests/unit/publish-gates-cli.test.ts`
- [x] T011 Extend `scripts/artifact-set.mjs` and `scripts/publish-gates.mjs` to pass T010

**Checkpoint**: the model knows four artifacts and six combinations; nothing produces an MSI yet, so `reconcile` fails until US2 — expected.

---

## Phase 3: User Story 1 — Install throng for everyone on a machine (P1) 🎯 MVP

**Goal**: the setup offers *Only for me* (default) and *Anyone who uses this computer*; a
machine-wide install works for every account, never removes another copy, never elevates the app it
launches, and handles another account using it.

**Independent test**: spec US1 — clean machine, two standard accounts, install machine-wide from the
setup, each account launches throng and opens a working terminal; default run installs per-user with
no prompt.

- [x] T012 [P] [US1] Write the failing guard test `packages/ui/tests/unit/nsis-vendored-templates.test.ts`: asserts `node_modules/app-builder-lib/package.json` version equals the pinned version and the SHA-256 of upstream `templates/nsis/installer.nsi`, `installSection.nsh`, `multiUserUi.nsh` equal the pinned hashes recorded in `packaging/nsis/UPSTREAM.md`; asserts the vendored `packaging/nsis/installSection.nsh` contains no `uninstallOldVersion HKEY_CURRENT_USER`; asserts `packaging/nsis/multiUserUi.nsh`'s `${Case} 1223` branch shows the FR-010a message (contracts/install-switches.md, *Elevation-declined text*); asserts `packaging/installer.nsh` defines `customCheckAppRunning` and contains no `taskkill`/`KillProcess` (T018), and wraps the data deletion in `SetShellVarContext current` (T019). The YAML-only tasks (T014, T040) are proved by packaging (T021, T041), not by this test
- [x] T013 [US1] Vendor `installSection.nsh` and `multiUserUi.nsh` from `app-builder-lib` 26.17.0 into `packaging/nsis/`, record upstream version and hashes (those two plus `installer.nsi`) in `packaging/nsis/UPSTREAM.md`; make `packaging/installer.nsh` shadow them with `!addincludedir <template dir>` then `!cd` into `packaging/nsis/` (research D3), and neutralise from `customInit` the two `installer.nsi` behaviours the spec forbids (silent per-machine auto-elevation; per-machine default when an `HKLM` entry exists); modify `installSection.nsh` to drop the HKCU cross-scope uninstall (FR-017), write `DisplayName` `throng <version> (per-user)` / `throng <version> (all users)` and shortcut `throng (per-user)` / `throng (all users)` from `$installMode` (FR-017b, research D4), and use `/REBOOTOK` + `SetRebootFlag` for in-use files on the machine-wide path; modify `multiUserUi.nsh` per research D3 — pass T012
- [x] T058 [US1] **Move the downgrade refusal** out of `packaging/installer.nsh` `customInit` (which runs before the scope is chosen and so only ever reads `HKCU`) into `packaging/nsis/installSection.nsh` before `uninstallOldVersion`, reading `SHELL_CONTEXT` for the chosen scope and refusing with `SetErrorLevel 2` (contracts/install-switches.md) — FR-015, FR-022; extend T012 first to assert the check sits in `installSection.nsh`, reads `SHELL_CONTEXT`, and is gone from `customInit`
- [x] T014 [US1] Update `electron-builder.yml` `nsis:` block: `allowElevation: true` (no `script:` — it would skip the uninstaller pass, research D3); keep `perMachine: false`, `oneClick: false`; update the block comments to cite 058 FR-001/FR-005 and research D3
- [x] T015 [P] [US1] Write failing unit tests in `packages/core/tests/unit/install-in-use.test.ts` for `classifyInstallUse(processes, installRoot, performingSid)`: processes under the install root split into `own` pids and `others` (one entry per account, `{ account, pids }`); processes under a **different** install root ignored (FR-017); `decision` `'free' | 'own-only' | 'others'`; `message` null unless `'others'`, and then exactly the contracts/install-switches.md refusal text naming each account; path comparison case-insensitive with separators normalised
- [x] T016 [US1] Implement `packages/core/src/config/install-in-use.ts` to pass T015 — **with no imports at all** (not even other core modules), because its built file is shipped standalone beside the helper (T017); export it from `@throng/core` (message `release`, owner of the barrel)
- [x] T017 [US1] Write `packaging/in-use.mjs` (lists `Win32_Process` via PowerShell CIM with `GetOwner`, imports `classifyInstallUse` from **`./in-use-classify.js` beside it** — never from `@throng/core`, which neither a pre-058 install root nor `$PLUGINSDIR` can resolve — prints the JSON verdict, exit 0). Packaging copies `packages/core/dist/config/install-in-use.js` to `packages/ui/build/resources/in-use/in-use-classify.js` and `packaging/in-use.mjs` beside it (extend `scripts/stage-runtime.mjs` or add a `prepackage` step — message `release`, owner of `scripts/**`), and `electron-builder.yml` ships that folder via `extraResources` to `resources/in-use/` (the MSI's path). Test in `packages/ui/tests/unit/in-use-cli.test.ts`: `main()` against an injected process list, **and** the staged pair copied into an empty temp dir with no `node_modules` runs under `node` and prints a verdict (C1)
- [x] T018 [US1] Replace the running-app guard in `packaging/installer.nsh`: define `customCheckAppRunning` and rewrite `customInit`'s check to run `in-use.mjs` — **the staged pair from T017, embedded in the setup with `File` and extracted to `$PLUGINSDIR`**, because a pre-058 install root does not carry it — with the existing install's `resources\runtime\node.exe` (every release since 020 bundles it) against **this copy's** install root only; `own-only` → the existing three-choice handoff text; `others` interactive → the refusal text, exit `2`, nothing changed; `others` silent → continue (reboot path from T013), never terminating a process (FR-015, FR-016a); fresh install (no existing root) → free
- [x] T019 [US1] In `packaging/installer.nsh` `customUnInstall`, wrap the "also delete my data" deletion in `SetShellVarContext current` … restore, so a machine-wide uninstall deletes only the performing account's `%APPDATA%\throng` and `%USERPROFILE%\.throng` (FR-016); keep `IfSilent` → retain
- [x] T020 [US1] Confirm the finish-page launch uses `StdUtils::ExecShellAsUser` when elevated (FR-007, research D10); if the template path does not, launch through it in `packaging/installer.nsh` `customFinishPage`-equivalent; note the result in `packaging/nsis/UPSTREAM.md`
- [x] T021 [US1] Package locally (`npm run package`) and confirm the setup builds with the vendored script and the install-mode page appears; record the check in the ledger (no installer is run on the workstation)

**Checkpoint**: setup offers both scopes; per-user unchanged by default.

---

## Phase 4: User Story 4 — Many copies installed, one throng running (P2)

**Goal**: one running throng per user across every copy and switch; a different copy's launch raises
the inline notice; pre-058 copies excluded; portable shares the namespace; a different build's daemon
replaced; dev and test runs isolated.

**Independent test**: spec US4 scenarios 3–6 at the app level — two launches in one namespace → one
window, focus, notice for a different `execPath`; different namespace → independent.

- [x] T022 [P] [US4] Write failing unit tests in `packages/core/tests/unit/instance-identity.test.ts`: `instanceLockName(pipeName)` = `<pipeName>.instance`; `copyIdentity(execPath, version)` → `{ installRoot: dirname(execPath), version }`; `isSameCopy` case-insensitive, separator-normalised; `parseLaunchMessage` accepting `{"execPath":string,"version":string|null}` and rejecting anything else; `differentCopyNoticeText` producing exactly the contracts/instance-lock.md text
- [x] T023 [US4] Implement `packages/core/src/config/instance-identity.ts` to pass T022
- [x] T024 [P] [US4] Update `packages/ui/tests/unit/instance-paths.test.ts` to fail until the portable suffix is gone: a portable launch (`PORTABLE_EXECUTABLE_DIR` set) resolves the same pipe as an installed launch; dev keeps `.dev`; `THRONG_PIPE_NAME` still wins
- [x] T025 [US4] Remove `PORTABLE_PIPE_SUFFIX` and the portable branch from `instancePipeName` in `packages/ui/src/main/instance-paths.ts` (research D6), keeping `isPortableLaunch` only if another caller uses it — pass T024
- [x] T026 [P] [US4] Write failing integration tests in `packages/ui/tests/integration/instance-guard.test.ts` driving `createInstanceGuard` with real `net` pipes and injected focus/notice sinks: first process becomes primary; a second in the same namespace gets `EADDRINUSE`, delivers its launch message, resolves `secondary`; the primary calls focus once and the notice sink only when the install root differs; a different namespace is independent; a primary whose legacy lock fails resolves `yields-to-legacy` and releases the pipe; a `second-instance` event with `argv[0]` from another root is treated as a different-copy launch with `version: null`
- [x] T027 [US4] Implement `packages/ui/src/main/instance-guard.ts` (contracts/instance-lock.md; OS edges injected per Principle IX) to pass T026; delete `packages/ui/src/main/single-instance.ts` and its unit test, moving any still-relevant assertions into the new tests
- [x] T028 [US4] Wire `instance-guard` into `packages/ui/src/main/main.ts` in place of `acquireSingleInstance`, before `app.whenReady()`, after the dev-userData redirection; route the different-copy notice to the main window over a new IPC channel declared in `packages/ui/src/main/instance-notice-channels.ts` (the bridge-parity test requires channel literals under `packages/ui/src`) and exposed in `packages/ui/src/preload/preload.cts`
- [x] T029 [P] [US4] Write failing component tests in `packages/ui/tests/component/different-copy-notice.test.ts`: renders the contract text inline; a second event while visible re-flashes and updates `launchedRoot` without adding a second notice; dismissible through the themed icon control the existing failure notices use
- [x] T030 [US4] Implement the notice in `packages/ui/src/renderer/common/different-copy-notice.tsx` and mount it in `packages/ui/src/renderer/app.tsx`, following the `throng-failure-notices` skill's surface rules — pass T029
- [x] T031 [P] [US4] Extend `packages/daemon/tests/integration/health-ping.integration.test.ts` to fail until `health.ping` reports `packaged: boolean` (false for a daemon started from the source tree)
- [x] T032 [US4] Add `packaged` to `packages/ipc-contract/src/health-ping.ts` and `packages/daemon/src/health-service.ts` (true when the daemon entry lies under a packaged `resources\app` tree) — pass T031
- [x] T033 [P] [US4] Extend `packages/ui/tests/integration/daemon-foreign-instance.test.ts` and `daemon-deleted-entry.test.ts`: a different-build daemon from another **packaged** path on the pipe is retired and replaced (FR-021a); a different-build daemon from a **dev tree** is still left alone (#192); a daemon with no `packaged` field is treated as packaged; a deleted-entry daemon is replaced (#429, research D6)
- [x] T034 [US4] Narrow the #192 guard in `packages/ui/src/main/daemon-lifecycle.ts` `ensureDaemon` per research D7 — pass T033; update its comment to cite 058 FR-021a
- [x] T035 [US4] Make `scripts/verify-installer.mjs` set `THRONG_PIPE_NAME`, `THRONG_CONFIG_ROOT`, `THRONG_DATABASE_PATH` with every `--user-data-dir` launch (FR-018a, research D8), and check the E2E harness (`packages/ui/tests/e2e/harness.ts`) already sets `THRONG_PIPE_NAME` for every launch; add a unit assertion where the harness builds its env
- [x] T036 [US4] Write `packages/ui/tests/e2e/single-instance.e2e.ts` tagged `@extended @window`: launch the app with a fixed `THRONG_PIPE_NAME`; launch again with the same name → no second window, first window focused; then have the spec itself connect to `<pipe>.instance` and write a launch message with a different `execPath` (no product seam) → the notice shows the running copy's location and version; add the spec to `packages/ui/tests/e2e/parallel-plan.json` if it steals focus (per CLAUDE.md), and re-seed `packages/ui/tests/e2e/e2e-budget.json`

**Checkpoint**: one running throng per namespace; notice works; dev and tests isolated.

---

## Phase 5: User Story 2 — Deploy through managed tooling with an MSI (P2)

**Goal**: a dual-purpose MSI, machine-wide by default when run elevated, per-user otherwise, with its
own folder and labels, in-use handling, scope-dialog elevation and a de-elevated launch.

**Independent test**: spec US2 — silent elevated install → machine-wide; second standard account
launches; silent upgrade and uninstall; downgrade refused; standard user silent install → per-user.

- [x] T037 [P] [US2] Write failing unit tests in `packages/core/tests/unit/msi-project.test.ts` against `fixtures/msi-template-output.wxs` for `transformMsiProject(wxs, options)`: `ApplicationFolderName` → `throng MSI` (FR-017a); `ProductName` set per scope by a type-51 action before `CostInitialize` (`throng (MSI, per-user)` / `throng (MSI, all users)`); `THRONG_SCOPE` public property, and a type-51 action before `FindRelatedProducts` in both sequences setting `MSIINSTALLPERUSER` empty when `MsiRunningElevated` and neither `THRONG_SCOPE` nor an explicit `MSIINSTALLPERUSER` was supplied (research D2); `MSIRESTARTMANAGERCONTROL=Disable`; shortcut names `throng MSI (per-user)` / `throng MSI (all users)`; the in-use custom action calling `resources\in-use\in-use.mjs` (with the installed copy's `resources\runtime\node.exe`; skipped when no copy of this scope is installed) in the UI sequence with the refusal dialog; the template's `MajorUpgrade` `DowngradeErrorMessage` retained, so installing an older MSI over this copy is refused with that message and a non-success code (FR-025); the scope-dialog elevation relaunch action and the declined-elevation text (research D10a); `runAfterFinish` replaced by an `explorer.exe` launch (FR-007); each transform idempotent and throwing when its anchor is missing
- [x] T038 [US2] Implement `packages/core/src/config/msi-project.ts` to pass T037
- [x] T039 [US2] Write `packaging/msi-project.cjs` (reads the `.wxs` path electron-builder passes, applies `transformMsiProject` from the built `@throng/core`, writes it back) with a unit test of its export in `packages/ui/tests/unit/msi-project-hook.test.ts`
- [x] T040 [US2] Add to `electron-builder.yml`: `msi` in `win.target`; an `msi:` block with `oneClick: false`, `perMachine: false`, `artifactName: throng-${version}.${ext}`, a fixed recorded `upgradeCode`, `runAfterFinish: true`, `createStartMenuShortcut: true`; top-level `msiProjectCreated: packaging/msi-project.cjs`; comments citing 058 FR-003a/FR-023–FR-025 and research D1
- [x] T041 [US2] Package locally and run `node scripts/artifact-set.mjs reconcile` — four artifacts, exit 0; if WiX rejects the transformed project, fix the transform (and its test) rather than the fixture. If the scope-dialog elevation relaunch cannot be built, **stop and put it to the user** with the finding — research D10a's rule, which applies FR-003a's stop-and-ask to the analogous MSI limitation rather than silently weakening FR-010a
- [x] T042 [US2] Confirm per-user MSI never requests elevation: inspect the built package's summary information (word-count bit for "elevated privileges not required") in a unit-level check over the built file when present, skipped with a stated reason otherwise, in `packages/ui/tests/integration/msi-package.test.ts`

**Checkpoint**: four artifacts reconcile.

---

## Phase 6: User Story 3 — Script a machine-wide install from the setup (P2)

**Goal**: the setup's silent switches per contracts/install-switches.md, with a loud non-elevated
failure.

**Independent test**: spec US3 — elevated `/S /allusers` → machine-wide, exit 0; non-elevated → exit
740, nothing installed; `/S` alone → per-user.

- [x] T043 [US3] Extend T012's guard test: the vendored `multiUserUi.nsh` silent `/allusers` path without admin attaches to the parent console, prints the contracts/install-switches.md message and exits `740` without calling `UAC_RunElevated`
- [x] T044 [US3] Implement that branch in `packaging/nsis/multiUserUi.nsh` (FR-010) — pass T043

**Checkpoint**: proved for real by US5's `silent-elevation-refused` step.

---

## Phase 7: User Story 5 — Every format and scope verified before a release publishes (P1)

**Goal**: per-combination verification on clean runners with a genuine standard account, the
coexistence run, the gate over all of them, the rendered body.

**Independent test**: spec US5 — `release.yml` with `publish: false` yields seven verdicts and a body
with four checksum rows; removing one verdict makes the gate refuse naming it.

- [x] T045 [P] [US5] Write failing unit tests in `packages/ui/tests/unit/verify-installer-args.test.ts` for the harness's argument handling: `--scope` required for `setup`/`msi`, refused for `portable`/`archive` (exit 2 naming valid scopes); `--coexistence` mode; verdict written as a combination verdict; the second-account helper's create/use/delete sequence invoked in a `finally` (injected runner)
- [x] T046 [US5] Extend `scripts/verify-installer.mjs`: `--scope`; the MSI driver (`msiexec /i … /qn` with `THRONG_SCOPE`, `/x` to uninstall, exit-code handling incl. `3010`); `install-labels` (registered `DisplayName` + shortcut name per research D4); `standard-account-install`; `no-service` widened for machine-wide combinations to also assert no scheduled task references the install root and no throng process runs as SYSTEM or for no signed-in user after install (FR-012); `second-account` (FR-029 — the shared Start-menu shortcut exists for that account (FR-004), own daemon by process owner, medium integrity, own pipe, working terminal, isolation both ways; GUI half may record `unproven` with reason, headless daemon half may not); `in-use-upgrade` (exit 3010, other account's process alive, `PendingFileRenameOperations` populated); `not-elevated-launch`; `silent-elevation-refused` — pass T045
- [x] T047 [US5] Add `--coexistence` to `scripts/verify-installer.mjs` per contracts/verification-matrix.md (five copies; the coexistence steps, including `reattach-across-copies` — a terminal started from one copy is reattached from another copy of the same build, FR-021; same-version reinstall as the upgrade proxy; refuses on a dirty profile unless `--allow-dirty-profile`)
- [x] T048 [US5] Rework `.github/workflows/release.yml`: `build-installer` uploads four named artifacts; a `combinations` job emits `artifact-set.mjs list --combinations --json` as a matrix; `verify-installer` becomes a matrix job (one runner per combination, `fail-fast: false`) uploading `verification-verdict-<id>.json`; a `coexistence` job after it; a `render-body` job collecting every verdict, rendering `release-body-preview.md` with the gaps line, and writing `unproven` steps to the job summary; `publish` derives `THRONG_VERDICT_FILES` from `list --combinations` plus the coexistence file; update header comments. The first `publish: false` rehearsal's tag-to-approval wall-clock is recorded in the runbook by T053 (spec Assumption, *Release-pipeline runtime grows*)
- [x] T049 [US5] Rename the `build-installer` job's display name from "Build the per-user installer" to "Build the release artifacts" and keep every retention/needs relationship intact (publish still needs every verify job)

**Checkpoint**: a `publish: false` rehearsal can run.

---

## Phase 8: Polish & Cross-Cutting — documentation and runbook (FR-035–FR-038)

- [x] T050 [P] Rewrite `docs/installation.md` per FR-035 using the `throng-docs` skill: which scope and download, interactive and silent install/upgrade/uninstall for both installers (contracts/install-switches.md), what the administrator prompt means per path, portable/archive need no rights and have no scope (FR-003), many copies one running, one data folder; remove the "no machine-wide install" statement
- [x] T051 [P] Update `docs/environment.md`: `THRONG_PIPE_NAME`, `THRONG_CONFIG_ROOT`, `THRONG_DATABASE_PATH` and `--user-data-dir` described as development and test only (FR-020), and the namespace rule
- [x] T052 [P] Update `docs/releasing.md`: four-role artifact table, the combination matrix and coexistence job, the new refusals (FR-036)
- [x] T053 [P] Update `.claude/skills/throng-release/SKILL.md` and `references/artifact-set.md`, `verification.md`, `publishing.md`, `build-and-packaging.md`: artifact table, job list, passing-verdict shape per combination, new refusals and failure rows (vendored-template guard, MSI transform anchor missing, `740`, `3010`), remove #351 and #361 from open work (FR-037)
- [x] T054 [P] Add `## Unreleased` entries in `CHANGELOG.md` for machine-wide installation, the MSI, and side-by-side copies with one running instance (FR-038), linking #361 and #351
- [x] T055 Run the `throng-docs` audit and `npx vitest run --project unit docs-currency`; fix every finding
- [x] T056 Write the manual test plan with `planning-manual-tests` from spec acceptance scenarios and quickstart §6 (restart completion, interactive refusal, declined elevation in both installers, label check, exactly one administrator prompt per machine-wide install — SC-001, an older release's archive running alongside — FR-022, an MSI downgrade refused — FR-025), each group citing its FR/SC ids

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2**: T001's fixture is needed by T037 only; Phase 2 can start at once.
- **Phase 2** blocks US1, US2, US3, US5 (they resolve artifacts and verdicts through it). US4 does not
  depend on Phase 2 and can run beside it.
- **US1 (Phase 3)** before **US3 (Phase 6)** — same vendored files.
- **US2 (Phase 5)** needs T016 (in-use classifier) from US1.
- **US5 (Phase 7)** needs US1–US4 complete.
- **Phase 8** last; T053 needs T048's final job shape.

### Parallel opportunities

- T002, T003, T008 (different test files); T012, T015 (US1); T022, T024, T026, T029, T031, T033 (US4);
  T050–T054 (docs).
- US4 entirely in parallel with Phase 2 and US1 — it touches app code only.

## Implementation Strategy

1. Phase 2 + US4 together (model and app code, both fully testable locally).
2. US1, then US3 (setup), then US2 (MSI) — each ends with a local package + reconcile.
3. US5 — the matrix; its first rehearsal on CI is the proof for every installer behaviour.
4. Docs, runbook, manual test plan.

MVP: Phase 2 + US1 + US4 — machine-wide setup with the one-running-throng rule.
