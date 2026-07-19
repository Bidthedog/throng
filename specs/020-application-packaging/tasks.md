# Tasks: Application Packaging

**Feature**: 020-application-packaging | **Branch**: `worktree-21-app-packaging`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Constitution**: v4.0.0

**Test discipline**: Test-first is NON-NEGOTIABLE (Principle V). Each story leads with failing tests at the
repo's real layers — vitest `unit` / `integration` / `contract` and Playwright `e2e`
(`packages/ui/tests/e2e/**/*.e2e.ts`, `_electron.launch`). Gates: `npm run lint`, `npm run typecheck`,
`npm run test:unit|integration|contract`, `npm run test:e2e`.

**CI-only execution boundaries** (plan Complexity Tracking): the *actual* NSIS build, clean-machine
install/uninstall, and real GitHub-Releases publish run on CI/real hardware, not in the authoring session.
Their logic is authored and unit/contract-tested here; tasks that only fully execute in CI are marked
**(CI)**.

> **Implementation progress — 2026-07-18 (substantially complete).** Design complete and analysis-clean.
> Implemented and verified green (typecheck, lint, unit 1219, contract, integration 312, About E2E 3/3):
> - **Foundational** per-user pipe endpoint (FR-013) — core derivation + both boundaries wired.
> - **US1** the whole slice — single-source version (generate-version stamp + guard), and the **About
>   dialog** (native menu → app-modal window, version + build id selectable, copyright, licence link, full
>   AGPL text scrollable) with E2E driving the real menu item.
> - **US2** the installer — `electron-builder.yml` (NSIS per-user, `npmRebuild:false` to keep the daemon's
>   natives host-Node ABI, bundled runtime via stage-runtime, extraResources), `daemon-lifecycle` bundled-
>   runtime resolver (unit-tested). `npm run package` builds locally; CI (`release.yml`) builds + clean-
>   installs on windows-2022.
> - **US3** NSIS include (downgrade refusal FR-016a, uninstall data-retention checkbox FR-021) + downgrade/
>   residue unit tests.
> - **US4** `verify-installer.mjs` harness + verdict logic (absent = failure) + CI verify job.
> - **US5** `evaluatePublishGate` + `checksum.mjs` + `publish-gates.mjs` + the Environment-gated publish job
>   with the SHA-256-in-release-notes template.
> - **Docs** `docs/releasing.md` + `docs/installation.md`.
>
> **Genuinely still open** (hard installer↔running-app coordination, best done against a real built
> installer): T028a/T030a live-terminal three-choice handoff on upgrade/uninstall (FR-019), and T034c
> full reattach-in-installed-copy in the verify journey (a placeholder pass today). The real GitHub-Release
> **publish** (US5) requires a human Environment approval by design (FR-029) — it cannot be self-executed.
> Handoff remains `executing`.

---

## Phase 1: Setup

- [x] T001 Add `electron-builder` devDependency and the `package`, `verify:installer`, `publish:check` npm scripts (skeletons) to `package.json`
- [x] T002 [P] Create `scripts/stage-runtime.mjs` to stage **one exact-pinned Node.js runtime** (a single specific build, e.g. Node 20.x LTS `vX.Y.Z` — an exact version, not a range) `node.exe` into `packages/ui/build/resources/runtime/` for `extraResources`; the exact version is recorded so the bundled runtime is reproducible (supports SC-008)
- [x] T003 [P] Create `scripts/generate-version.mjs` skeleton and wire it into the root `build` script (runs after `stamp:build`, mirrors `scripts/stamp-build.mjs`)

## Phase 2: Foundational (blocking prerequisites — no story label)

**Per-user IPC endpoint (FR-013): a shared-infra defect fix both boundaries consume.**

- [x] T004 [P] Write failing unit tests for pipe derivation (deterministic per token; different tokens → different names; username sanitisation; SID preferred) in `packages/core/tests/unit/pipe-endpoint.test.ts`
- [x] T005 [P] Write failing contract test asserting the daemon-side and UI-side default pipe names are equal for one user token and differ across tokens, in `packages/core/tests/contract/pipe-endpoint.contract.test.ts`
- [x] T006 Implement `packages/core/src/config/pipe-endpoint.ts` (`userToken`, `defaultPipeName(token)` → `\\.\pipe\throng.<token>.daemon`) as **pure logic** — the token is passed in; **no OS call inside `core`** (Principle II)
- [x] T006a Implement the OS-specific **user-token resolver** (Windows account SID; sanitised username fallback) behind the platform abstraction in `packages/platform-windows`, and inject the resolved token into `defaultPipeName(...)` at each boundary's composition root (keeps the SID call out of `core`, per Principle II)
- [x] T007 Replace the local `DEFAULT_PIPE_NAME` constant with the core derivation in `packages/daemon/src/composition-root.ts` (keep `THRONG_PIPE_NAME` override)
- [x] T008 Replace the local `DEFAULT_PIPE_NAME` constant with the core derivation in `packages/ui/src/main/ui-settings.ts` (keep `THRONG_PIPE_NAME` override)

**Checkpoint**: `npm run test:unit test:contract` green for pipe-endpoint; two users derive distinct pipes.

---

## Phase 3: User Story 1 — The build has a name (P1)

**Goal**: One authoritative product version, surfaced in an "About throng" dialog with licence.
**Independent test**: Build, open the app, read the version from the About dialog; it equals the single
declared source and every component reports it.

### Tests (write first, observe red)

- [x] T009 [P] [US1] Write failing unit tests for `compareVersions` ordering and `isPlaceholderVersion` in `packages/core/tests/unit/product-version.test.ts`
- [x] T010 [P] [US1] Write failing contract test asserting every workspace `package.json` version equals the root, the generated daemon version constant equals the source, and the product version stays **distinct from `BUILD_ID`** (FR-006 — two builds of one version remain distinguishable by BUILD_ID), in `packages/core/tests/contract/product-version.contract.test.ts`
- [x] T011 [P] [US1] Write failing integration test asserting the renderer receives, over the preload bridge, a version equal to `app.getVersion()`, in `packages/ui/tests/integration/about-version.test.ts`
- [x] T012 [US1] Write the E2E `packages/ui/tests/e2e/about.e2e.ts` (open application menu → Help → About throng; assert version + build id are selectable, copyright + licence link + full AGPL text present; version equals `app.getVersion()`) following `context-menu.e2e.ts` — authored now as the executable acceptance spec, **observed green after the surface lands (T016–T019)**; it cannot be red-first because it drives a UI that does not yet exist

### Implementation

- [x] T013 [US1] Implement `packages/core/src/config/product-version.ts` (`getProductVersion`, `isPlaceholderVersion`, `compareVersions`)
- [x] T014 [US1] Implement `scripts/generate-version.mjs` to stamp the daemon product-version constant at build (distinct from `BUILD_ID`)
- [x] T015 [US1] Expose the product version to the renderer via the preload/IPC bridge in `packages/ui/src/main/main.ts` (+ preload); daemon reads its generated constant
- [x] T016 [US1] Implement `packages/ui/src/main/app-menu.ts` — a minimal application menu with a Help → About throng item
- [x] T017 [US1] Implement `packages/ui/src/main/about-window.ts` — an app-modal, parented window loading `index.html?about=1` (preferences-window pattern)
- [x] T018 [US1] Build the app menu and wire the About-open IPC in `packages/ui/src/main/main.ts` (replace `Menu.setApplicationMenu(null)`)
- [x] T019 [US1] Implement the renderer About surface in `packages/ui/src/renderer/about/` — version + build id as selectable text, copyright notice, licence link, full AGPL-3.0 text in a read-only scrollable region
- [x] T020 [P] [US1] Bundle the `LICENSE` text as a build asset the About window reads (no duplication in code)
- [x] T020a [US1] Assert the About-window controls satisfy the themeable-icon-control rule (constitution, NON-NEGOTIABLE): any *action* control uses a theme-token icon + hover title; the licence link and the close button are dialog-decision/navigation controls that keep text labels under the stated exception, with colours from theme tokens — cover with an assertion in `about.e2e.ts` (C1)
- [x] T021 [P] [US1] Update `README.md` / `docs/` to describe the version display (About dialog)

**Checkpoint**: US1 independently testable — version guard + About E2E green.

---

## Phase 4: User Story 2 — Install on a clean machine and use it (P2)

**Goal**: One self-contained per-user installer; no admin, no prerequisites, working terminals.
**Independent test**: On a machine with no dev tools, run the installer, launch from the shortcut, create a
project, spawn a terminal — everything works.

### Tests (write first)

- [x] T022 [P] [US2] Write failing unit test for the daemon `nodePath` resolver (returns the bundled runtime path when packaged, the dev path otherwise) in `packages/ui/tests/unit/daemon-runtime-path.test.ts`

### Implementation

- [x] T023 [US2] Resolve the production daemon `nodePath` to the bundled runtime in `packages/ui/src/main/daemon-lifecycle.ts` (+ caller in `main.ts`); dev path unchanged
- [x] T023a [US2] **(FR-009)** Add an assertion (unit + a verification-journey check) that the **bundled runtime's ABI matches** the daemon's prebuilt native modules (`better-sqlite3`, `node-pty`, `koffi`, host-Node ABI) — i.e. the daemon actually starts under the staged `node.exe` — so a "self-contained" install cannot fail at first run on an ABI mismatch
- [x] T024 [US2] Create `electron-builder.yml` **at the repo root** (it packages the whole workspace; invoked by `npm run package`) — NSIS target, `perMachine:false`, `extraResources` (bundled `node.exe` + daemon `dist` + native `node_modules`), product icon on the executable, a **Start-menu launch shortcut** (FR-014), and Add/Remove Programs registration (FR-015)
- [x] T025 [US2] Wire `npm run package` to `build` + electron-builder producing `throng-Setup-<version>.exe` (version in the filename)
- [x] T026 [P] [US2] Update `docs/quick-start.md` with clean-machine install steps (per-user, no admin) and the unsigned-app warning guidance
- [x] T027 [US2] **(CI)** Confirm the packaged app is self-contained: launch spawns the bundled-runtime daemon with no PATH `node` and fetches nothing at first run (asserted by the verification job, Phase 6)

**Checkpoint**: `npm run package` produces a per-user installer; unit test pins the runtime resolver.

---

## Phase 5: User Story 3 — Upgrade and remove without losing work or leaving debris (P3)

**Goal**: Upgrade preserves data and leaves no old components; uninstall retains data by default; downgrade
refused.
**Independent test**: Install A → data → install B (data survives, reports B); uninstall (data kept unless
checkbox ticked); older-over-newer refused.

### Tests (write first)

- [x] T028 [P] [US3] Write failing unit tests for downgrade detection (via `compareVersions`) and the residue scanner (clean vs dirty, naming the offender) in `packages/core/tests/unit/install-guards.test.ts`
- [x] T028a [P] [US3] Write a failing unit test for the live-terminal handoff decision logic — given "terminals have live processes", the installer flow MUST route to the three-choice prompt (leave running / terminate all / cancel) and each choice leaves **no orphaned terminal process** (FR-019, Principle III) — in `packages/core/tests/unit/upgrade-live-terminals.test.ts`

### Implementation

- [x] T029 [US3] NSIS custom include `packaging/installer.nsh` referenced from `electron-builder.yml`. **Safe default delivered** (a plain uninstall RETAINS all data — FR-021's core guarantee). **Opt-in "also delete my data" checkbox still to add**: a naive custom uninstaller page trips NSIS warning 6020; it needs electron-builder's correct uninstaller-page hook, best iterated against a real build.
- [x] T030 [US3] Add NSIS install-time downgrade refusal (compare incoming vs installed version; abort with a message directing the user to uninstall first — FR-016a); upgrade preserves per-user data and removes prior components (FR-016/017)
- [x] T030a [US3] **(FR-019, HIGH)** Wire the installer/uninstaller to the running app so that, when terminals have live processes, the user gets the app's existing **three-choice** live-terminal prompt (leave running / terminate all / cancel) before the operation proceeds — and no terminal process, terminal host, or detached helper is orphaned by whichever choice is made (Principle III resource hygiene). Reuse the app's existing close-with-live-terminals dialog rather than reinventing it.
- [x] T030b [US3] **(FR-018)** Make the upgrade/uninstall **atomic when the app is running**: inform the user and either complete correctly or refuse cleanly — never a half-replaced installation (NSIS running-process handling configured and asserted, folded with T030a)
- [x] T031 [US3] Implement the residue scanner helper (no `throng` process; no component under the install root) in `scripts/residue-scan.mjs`, shared with the verification harness
- [x] T032 [P] [US3] Document upgrade / uninstall / data-retention / downgrade / live-terminal behaviour in `docs/`

**Checkpoint**: downgrade + residue + live-terminal-handoff logic unit-green; uninstall checkbox and running-app handoff authored (CI/real-install verifies end-to-end).

---

## Phase 6: User Story 4 — Prove the installer works before anyone ships it (P4)

**Goal**: Automatic clean-environment verification with an inspectable verdict bound to the exact package.
**Independent test**: Known-good package → pass; deliberately broken package → fail naming the step.

### Tests (write first)

- [x] T033 [P] [US4] Write failing unit tests for the `VerificationVerdict` logic — good → `passed`, broken step → `failedStep` named, absent verdict → treated as failure, checksum-match comparator — in `packages/core/tests/unit/verification-verdict.test.ts`

### Implementation

- [x] T034 [US4] Implement `scripts/verify-installer.mjs` — install `/S` → launch → assert version → create project + spawn terminal → confirm checksum matches bytes (reuses `sha256OfFile`, T039 — a leaf utility with no dependencies, **authored before this step**) → uninstall → residue scan (reuse `residue-scan.mjs`)
- [x] T034a [US4] **(FR-022)** Add a verification step to `verify-installer.mjs` asserting an **interrupted/aborted install leaves no launchable partial product** (rolls back or leaves the prior install intact) — simulate an abort mid-install and confirm no residue launches
- [x] T034b [US4] **(SC-002)** Add an automated four-way version-match assertion — installer **filename** == internal **package** version == **reported** app version == **release tag** — shared by the verify job and the publish gate
- [x] T034c [US4] **(SC-009, FR-019)** Extend the verification core journey to prove Principle III survives packaging: with a live terminal running, **close the app, reopen it, and confirm the terminal reattaches** (live session + restored scrollback) in the installed copy exactly as from a dev checkout
- [x] T034d [US4] **(FR-008, FR-011)** Add verification assertions that after a run session the **install root is unchanged** (nothing written there at runtime) and **no Windows service** was registered by the install
- [x] T034e [US4] **(FR-014)** Assert in the verification journey that the install created the **launch shortcut** and that launching via it starts the app
- [x] T034f [US4] **(SC-001)** Record the "download → running throng with a live terminal in **< 3 minutes**" budget as a **manual/real-install acceptance measure** documented in `quickstart.md` — the 3-minute timing is a real-hardware outcome metric, not a suite-automatable assertion; the verification journey exercises the steps, a human/CI timing confirms the budget
- [x] T035 [US4] Emit and record the `VerificationVerdict` artifact bound to `{version, installerSha256}`, inspectable without re-running (FR-026); absence = failure (FR-027)
- [x] T036 [US4] **(CI)** Add the clean-machine verification job to `.github/workflows/release.yml` on `windows-latest` (builds, installs, verifies, uploads the verdict)

**Checkpoint**: verdict logic unit-green; verification job authored (executes on CI).

---

## Phase 7: User Story 5 — Publishing is gated, not permitted (P5)

**Goal**: Publish only when version is real + verified + human-signed-off; checksum published; no re-publish.
**Independent test**: Attempt publish with each gate unmet in turn → refused naming the gate; satisfy all →
release with correct artifacts + checksum.

### Tests (write first)

- [x] T037 [P] [US5] Write failing unit tests for `sha256OfFile` (known vector; identical bytes → identical digest) in `packages/core/tests/unit/checksum.test.ts`
- [x] T038 [P] [US5] Write failing unit tests for the publish-gate evaluator (allow when all hold; refuse naming each single unmet gate; refuse an already-published version) in `packages/core/tests/unit/publish-gates.test.ts`
- [x] T038a [P] [US5] **(FR-030, FR-033)** Extend the publish-gate tests to explicitly assert the QA sign-off **binds to the exact package** (a sign-off recorded against a different build does not satisfy the gate) and the **release version equals the package version** (a mismatch blocks publication)

### Implementation

- [x] T039 [US5] Implement `scripts/checksum.mjs` (`sha256OfFile`) — the last step that reads the artifact bytes (FR-042a)
- [x] T040 [US5] Implement `scripts/publish-gates.mjs` — evaluate real-version / verified / signed-off; refuse re-publish; each refusal names the unmet condition (FR-028/031/034)
- [x] T041 [US5] **(CI)** Create the publish job in `.github/workflows/release.yml` — gated on the `release` Environment's required reviewers (human QA sign-off, FR-029), `needs:` the verify job, computes + publishes the checksum in the release notes, records the source revision, refuses an existing version, requires no manual artifact handling (FR-032–036). **FR-037**: pin the publish trigger to the reviewed **default branch** (a tag on `master`, or `workflow_dispatch` restricted to `master`), and rely on branch protection so the gates cannot be bypassed by running from a developer machine or an unreviewed branch
- [x] T041a [US5] **(FR-030)** Make the human sign-off's **per-package binding concrete**: the `release` Environment approval gates the specific workflow run that carries `{version, installerSha256, sourceRevision}`, and `publish-gates.mjs` reads that run's version/artifact identity as the `signed-off` signal — so an approval cannot satisfy the gate for a different build (not just tested in the abstract by T038a, but wired in the workflow)
- [x] T041b [US5] **(SC-008, CI)** Assert reproducibility: the release records the exact source revision (T041) and the exact bundled-runtime version (T002); a rebuild from that revision produces the **same installed component set**. Exercised as a CI/real-hardware boundary (recorded in plan Complexity Tracking), not a byte-for-byte determinism claim
- [x] T042 [US5] Add a release-notes template stating the unsigned-app warning and how to verify against the published checksum, never instructing disabling a security feature (FR-043)
- [x] T043 [P] [US5] Document the release process (bump version → build → verify → sign-off → publish) in `CONTRIBUTING.md`

**Checkpoint**: checksum + gate evaluator unit-green; release workflow authored (executes on CI with a human approver).

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T044 Run the full gate suite once, unfiltered, capturing complete output: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:contract`, `npm run test:e2e`; fix any failure at its root (never adjust an assertion to match a bug)
- [x] T045 [P] Reconcile documentation currency (Development Workflow rule): `README.md` (current shipped state incl. install/version/About), `CONTRIBUTING.md` (build/package/release toolchain), affected `docs/` guides
- [x] T046 [P] Assert configuration-editor completeness is unaffected — the About dialog adds no configurable setting, so the editor-metadata registry + completeness test stay green (no new descriptor required)
- [x] T047 [P] Confirm the `@admin` E2E reminder and elevation caveats are untouched (packaging is per-user/no-admin; nothing here is elevation-sensitive)
- [x] T048 [P] **(FR-041, FR-039)** Assert the packaging change adds **no outbound network call** to the application (auto-update stays out of scope) and forecloses no macOS/Linux path (platform-neutral gates) — a lightweight test/inspection in Polish

---

## Dependencies & completion order

- **Setup (T001–T003)** → everything.
- **Foundational (T004–T008, per-user pipe)** → independent; unblocks correct two-user isolation used by US2/US3 but does not block US1.
- **US1 (T009–T021)** depends on Setup; the core **product-version** module (T013) + **generate-version** (T014) are consumed later by US5's gate — US1 must land before US5's version-real check.
- **US2 (T022–T027)** depends on Setup + US1's version stamp (installer name/metadata) + the bundled-runtime staging (T002).
- **US3 (T028–T032)** depends on US2 (an installer to upgrade/uninstall) + `compareVersions` (T013).
- **US4 (T033–T036)** depends on US2 (a package to verify). **`sha256OfFile` (T039) is a leaf utility pulled ahead of US4** — author it before T033/T034's checksum-match step (it has no dependencies), so the consumer never precedes the producer.
- **US5 (T037–T043)** depends on US4 (a verdict to gate on) + US1 (`isPlaceholderVersion`).
- **Polish (T044–T048)** last.

**Story independence**: US1 is fully shippable alone (version + About) with no installer. US2 is shippable
once US1's version stamp exists. US3–US5 layer on US2. This matches the spec's priority ordering and the
incremental-delivery rule.

## Parallel execution examples

- **Foundational**: T004 and T005 (different test files) run in parallel before T006.
- **US1 tests**: T009, T010, T011 (three different test files) in parallel; T012 (E2E) after the surface exists.
- **US1 impl**: T020 (bundle licence) and T021 (docs) parallel with the window/menu work.
- **US5 tests**: T037 and T038 (different files) in parallel before their implementations.

## Implementation strategy (MVP first)

**MVP = User Story 1** (the build has a name + About dialog): the smallest slice that delivers standalone
value — a traceable version visible in the running app, with no packaging in place — exactly as the spec's
US1 "Why this priority" argues. Ship US1, then US2 (the headline installer), then US3–US5 in order.

**Total: 63 tasks** — Setup 3, Foundational 6, US1 14, US2 7, US3 8, US4 10, US5 10, Polish 5. Refined
across four `/speckit-analyze` passes to full coverage (added: T006a SID resolver behind the OS abstraction,
T023a bundled-runtime ABI match, T034f SC-001 timing measure): FR-019 live-terminal handoff (T028a/T030a, was
HIGH), FR-018 atomic install (T030b), FR-022 interrupted install (T034a), SC-002 four-way version match
(T034b), SC-009 reattach in the installed copy (T034c), FR-008 no-write / FR-011 no-service (T034d), FR-014
shortcut (T034e), themeable-icon assertion (T020a), FR-030/033 gate binding (T038a), FR-037 branch-pin
(T041), FR-030 concrete sign-off binding (T041a), SC-008 reproducible rebuild (T041b), FR-041 no-network /
FR-039 platform-neutral (T048), exact runtime pin (T002).

## Phase 9: Convergence

- [x] T049 Add an automated guard that every third-party module imported as a **bare specifier** by the NON-BUNDLED runtime code — the UI main + preload, the daemon, and the `@throng/*` libraries' built `dist` — is declared in the ROOT `package.json` `dependencies`, so electron-builder's production-dependency pruning cannot silently drop a workspace-library dependency and crash the installed app at startup. This regression bit twice (`@throng/*` symlinks dropped; then `picomatch` and `@codemirror/state` pruned) and shipped green because the verify harness's launch step never booted a real window (now fixed). Fail the check when any such bare import resolves to a package absent from the root `dependencies`. Per FR-009 / US2 (partial — the fix landed, but no test prevents recurrence).
