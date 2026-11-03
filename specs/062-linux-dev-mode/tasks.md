---

description: "Task list for Linux support in dev mode"
---

# Tasks: Linux Support in Dev Mode

**Input**: Design documents from `specs/062-linux-dev-mode/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required. Principle V is test-first, and FR-044 and FR-045 make the suites deliverables. Within each task the failing test comes first.

**Test layers**: `unit`, `unit-isolated`, `component`, `integration`, `contract` (vitest projects) and E2E (Playwright). Local runs follow `running-tests` and `throng-testing`: only the files under the cursor. Layer batches and E2E lanes run on CI.

## Phase 1: Setup

- [x] T001 Create `packages/platform-node`, `packages/platform-linux` and `packages/platform` with `package.json` and `tsconfig.json`; add them to root `tsconfig.json`, `vitest.config.ts` (aliases and `UNIT_GLOB_ROOTS`), `eslint.config.js`, `electron-builder.yml`, `scripts/stamp-build.mjs`, and `packages/daemon` and `packages/ui` manifests and references; run `npm install` to refresh `package-lock.json`
- [x] T002 Move `node-user-context.ts`, `node-file-log.ts`, `off-loop-exec.ts` and `process-tree.ts` from `packages/platform-windows/src` to `packages/platform-node/src`, re-exporting from `packages/platform-windows/src/index.ts` so every existing import and test keeps working (FR-009)

## Phase 2: Foundational

- [x] T003 Write `packages/core/tests/unit/host-traits.test.ts`, then implement `packages/core/src/platform/host-traits.ts` per contracts/host-traits.md: `configureHostTraits`, `hostTraits`, `resolveIpcAddress`, `trashTerm`, and `withHostTraits` in `packages/core/src/testing`; Windows values by default; a second, different configuration throws (FR-007, FR-011, FR-049)
- [x] T004 Make `packages/core/src/fs/path-id.ts` read `hostTraits().paths`; extend `packages/core/tests/unit` path tests with Linux cases: `README.md` versus `readme.md` differ, `\` stays a character, Windows cases still fold (FR-020, FR-021)
- [x] T005 Add `IUserDirectories`, `ITrashRestore` and `IOrphanSnapshot` to `packages/core/src/abstractions` with behaviour-only contract suites in `packages/core/src/testing`, and Windows implementations wrapping today's values, `restoreFromRecycleBin` and today's CIM snapshot, with no behaviour change (FR-049)
- [x] T006 Write `packages/platform/tests/unit/select-platform.test.ts`, then implement `packages/platform/src/index.ts`: `selectPlatform`, `PlatformServices`, `UnsupportedPlatformError` per contracts/platform-services.md (FR-007, FR-050)
- [x] T007 Route `packages/daemon/src/composition-root.ts`, `packages/daemon/src/main.ts`, `packages/daemon/src/pty-agent-entry.ts`, `packages/daemon/src/reap-orphans.ts`, `packages/ui/src/main/composition-root.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/main/diagnostics.ts`, `packages/ui/src/main/electron-shell-integration.ts` and `packages/ui/src/collector/composition-root.ts` through `@throng/platform`, keeping the Windows graph identical; configure host traits first in each entry, including the renderer entry from preload's `osName`
- [x] T008 Pass every `listen` and `connect` through `resolveIpcAddress` in `packages/daemon/src/ipc-server.ts`, `packages/daemon/src/pty-agent-entry.ts`, `packages/daemon/src/pty-agent-host.ts`, `packages/ui/src/main/daemon-client.ts`, `packages/ui/src/main/daemon-events.ts` and `packages/ui/src/main/instance-guard.ts`; add the stale-socket rule and owner-only directory with tests, including a 300-character checkout path and another user's directory; teach `packages/core/src/failure/cause.ts` the socket form (FR-011, FR-012)
- [x] T009 Add `packages/core/src/testing/platform-guards.ts` with `windowsOnly(reason)`, `linuxOnly(reason)` and `defaultTestShell()`, plus a unit test that a guard with an empty reason is refused (FR-042, FR-043)

- [x] T041 [US6] Add `packages/platform/tests/unit/windows-graph-unchanged.test.ts` asserting Windows selection returns today's classes; a unit test that Windows host traits leave `normaliseForCompare`, `defaultPipeName`, the shipped bindings, `trashTerm` and data folders byte-identical to their Windows values (FR-009, US6 scenarios 1, 2)
- [x] T049 Add `packages/platform/tests/unit/host-traits-entries.test.ts`: every process entry configures traits from `selectPlatform` before composing (FR-050, contracts/host-traits.md)
- [x] T050 Add `pathCompareKey` to `packages/core/src/fs/path-id.ts`, identical on Windows to today's `replace(/\\/g, '/').toLowerCase()`, and route the sites that inline that rule through it: `projects/project.ts`, `explorer/path-rules.ts`, `editor/path-display.ts`, `ui/src/main/editor-coordinator.ts`, `throng-holder.ts`, `file-link-resolver.ts`, and the renderer's `editor-state.ts`, `language-override.ts`, `fold-state-store.ts`, `document-language-events.ts`, `file-tree.tsx`, `tree-node.tsx`, `use-explorer-data.ts` (FR-020)

**Linux selection during the build**: `selectPlatform('linux')` is present from T006. A Linux class not yet written is a small stand-in that throws a named "not yet implemented" error when used, removed by the task that writes the class, and T042 removes the last. Windows is never affected.

## Phase 3: User Story 1 - Start throng from source (P1)

**Goal**: documented steps open a window, with the sandbox on.

**Independent test**: on a clean machine the documented steps reach an open window; `linux-smoke.e2e.ts`.

- [x] T010 [P] [US1] Write and test `scripts/linux/apparmor-profile.sh` (`install`, `status`, `remove`), covering the checkout and its worktrees, per research R1, with a bats-free test driving it against a temp root in `packages/ui/tests/unit/apparmor-profile.test.ts` (FR-002, FR-003)
- [x] T011 [P] [US1] Write `scripts/preflight-start.mjs` with its logic in a testable module and `packages/ui/tests/unit/preflight-start.test.ts`; point `start:ui` at it; on Windows it hands straight to Electron (FR-001, FR-004)
- [x] T012 [P] [US1] Implement `LinuxUserDirectories` in `packages/platform-linux/src/linux-user-directories.ts` against the T005 suite, with `XDG_*` handling and `0700` folders and `0600` database; wire `packages/ui/src/main/instance-paths.ts` and `packages/daemon/src/composition-root.ts` through the port (FR-005, FR-013)
- [x] T013 [P] [US1] Implement `LinuxPlatformInfo`, `LinuxRefusedUriSchemes`, `LinuxExecutableExtensions` and `LinuxFontEnumeration` in `packages/platform-linux/src` with contract tests in `packages/platform-linux/tests/contract` ; default font stacks resolve or fall back on the reference platform, with a unit test (FR-006, FR-031)
- [x] T014 [US1] Refuse to start as root in `packages/ui/src/main/main.ts`, with the decision in a unit-tested function; `LinuxElevation.isElevated()` is always false and elevation controls stay hidden on Linux (FR-019)
- [x] T015 [US1] Add `window.nativeWayland` to `packages/core/src/config/app-settings.ts`, `settings-metadata.ts` and shipped defaults, hidden off Linux; apply `ozone-platform` before `ready` in `packages/ui/src/main/main.ts`; use the PNG icon and set `WM_CLASS` through `app.setName`, asserted in `linux-smoke.e2e.ts` (FR-028, FR-032)
- [x] T016 [US1] Add `packages/ui/tests/e2e/linux-smoke.e2e.ts` tagged `@linux @boot @extended`: window opens, stays open, second launch works, data lands in XDG folders (US1 scenarios 1, 3); register it in `e2e-budget.json`, and add the `@linux` tag to `packages/ui/tests/unit/e2e-tags.test.ts`

## Phase 4: User Story 2 - Real terminals (P1)

**Goal**: installed shells, persistent, no orphans.

**Independent test**: full-screen program survives window close and reopen.

- [x] T017 [P] [US2] Implement `LinuxShellDetection` in `packages/platform-linux/src/linux-shell-detection.ts` against the shared suite, with fixture `/etc/shells` handling; a saved terminal naming an absent shell reports that (FR-014, edge case)
- [x] T018 [P] [US2] Implement `LinuxProcessCwd` and a shared `proc-table.ts` in `packages/platform-linux/src` reading `/proc`, with contract tests (FR-017)
- [x] T019 [US2] Implement `LinuxPtyHost` in `packages/platform-linux/src/linux-pty-host.ts` against `pty-host-contract.ts`, rewriting Windows spellings in that contract to behaviour terms without weakening Windows's run; process-table test proving the tree ends and strangers survive (FR-006, FR-010, FR-018, FR-044)
- [x] T020 [US2] Add shell recipes in `packages/core/src/terminal/command-recipe.ts`, `shell-history.ts` and `defaults.ts` for `bash zsh fish sh dash`; make `command-capture.ts` console-host filtering and `panel-title.ts` correct for Linux names; `packages/core/tests/unit` tests first, Windows cases unchanged and hide Windows-shell-only features for other shells, with tests (FR-015, FR-016)
- [x] T021 [US2] Implement Linux `IOrphanSnapshot` and make `packages/daemon/src/reap-orphans.ts` platform-neutral: `isThrongOwned` recognises `node` plus the same markers, kills through SIGKILL, and never touches a process throng did not start (FR-018)
- [x] T022 [US2] Run the agent path on Linux: `THRONG_FORCE_PTY_AGENT=1` works through the socket; add `packages/platform-linux/tests/integration/terminal-flavours.integration.test.ts` driving each shell present (startup command, args, title, cwd, history isolation), skipped per shell only when absent, with the reason printed (FR-015, FR-010)
- [x] T023 [US2] Add `packages/ui/tests/e2e/linux-terminal.e2e.ts` tagged `@linux @terminal @extended`: login shell default; keystrokes reach bash; survive window close and reopen; closing ends a backgrounded child, checked in `/proc`; and make `packages/ui/tests/e2e/harness.ts` conhost helpers platform-aware with `expectNoOrphans` reading `/proc` (US2 scenarios 1-5, SC-003)

## Phase 5: User Story 3 - Projects, editors, explorer (P1)

**Independent test**: `README.md` and `readme.md` stay two files through a restart.

- [x] T024 [P] [US3] Implement `LinuxPathForms` in `packages/platform-linux/src/linux-path-forms.ts` against the shared suite; absolute, relative, `~/` and `file:` forms; no drive or UNC reading; wire link resolution (FR-021, FR-022)
- [x] T025 [P] [US3] Implement `LinuxTrash` in `packages/platform-linux/src/linux-trash.ts` per research R8, with a contract test on real home-trash and volume-trash layouts in temp roots; bind in `packages/ui/src/main/composition-root.ts` in place of the `process.platform` branch; a rejected `trashItem` asks before a permanent delete, with a test in `packages/ui/tests/component` (FR-024, edge case)
- [x] T026 [US3] Replace user-visible "Recycle Bin" text in `packages/ui/src/renderer/explorer/use-explorer-data.ts`, `packages/ui/src/main/files-service.ts` and `packages/core/src/config/settings-metadata.ts` with `trashTerm()`; Windows strings byte-identical; component tests (FR-025)
- [x] T027 [US3] Prove in `packages/ui/tests/integration` that saves, moves and copies keep mode bits and that an atomic save writes through a symlink; fix `packages/ui/src/main` file services where they do not (FR-023)
- [x] T028 [US3] Case-variant, `\`-in-name, trailing-dot, non-UTF-8, symlink-cycle and symlink-delete tests in `packages/ui/tests/integration/linux-file-names.integration.test.ts`, with fixes in explorer and file services; Copy Path submenu forms for Linux in `packages/ui/src/renderer/explorer`; a test that line-ending defaults and existing-file handling are unchanged; dotfile handling follows the exclusion rules (FR-020, FR-021, FR-026, edge cases, SC-004)
- [x] T029 [US3] Report a watch-limit failure (`ENOSPC`) from `packages/ui/src/main/node-file-watcher.ts` through the existing notice model, saying how to raise it; a `C:\` path in carried-over settings reports per item through the existing missing-path route (edge cases, FR-004)
- [x] T030 [US3] Add `packages/ui/tests/e2e/linux-files.e2e.ts` tagged `@linux @explorer @extended`: two case-variant files, delete to trash and undo, reveal and open-with stubs reach the desktop's handlers ; `shell.openPath` and `showItemInFolder` are already portable, so the only code task is removing any Windows-only guard around them (US3 scenarios 1, 3, 4, FR-027)

## Phase 6: User Story 4 - Windows, focus and bindings (P2)

**Independent test**: title bar and tear-off work under XWayland; each default fires or is rebound.

- [x] T031 [US4] Add `LINUX_BINDINGS` and `DESKTOP_RESERVED_CHORDS` in `packages/core/src/config/keybindings.ts` with `shippedBindingsFor('linux')` no longer falling back; pick replacements for `focus.up`, `focus.down` and `view.resourceMonitor` free of both Principle IV tiers; `packages/core/tests/unit/keybindings-linux.test.ts` proves no default is reserved and only those differ; `SHIPPED_KEYBINDINGS` reads host traits (FR-033, FR-034, Principle IV)
- [x] T032 [US4] Pin `AltGr` handling for Linux in `packages/ui/tests/unit` and correct `packages/core/src/config/keybindings.ts` and the terminal key path if the pin fails; make `shipped-defaults` generation produce the running platform's bindings (FR-035)
- [x] T033 [US4] Add `packages/ui/tests/e2e/linux-window.e2e.ts` tagged `@linux @window @extended`: title bar controls, tear-off and return under X11; saved geometry; native-Wayland switch does not lose a window where a Wayland session exists, otherwise skips with its reason (US4 scenarios 1, 2, FR-029, FR-030)
- [x] T051 [US4] Verify, and fix where they fail, under X11: focus changes and the drag ghost (`packages/ui/src/main/ghost-window.ts`), clipboard through `ElectronClipboard`, and drag-and-drop between panels; under native Wayland make a refused `setPosition` leave the torn-off window open and usable in `packages/ui/src/main` window code, and list each degradation in `docs/linux.md` (FR-029, FR-030)
- [x] T052 [US4] Audit capability-absent surfaces: elevation controls, taskbar badge (`app.setBadgeCount` or `NoTaskbarBadge`), foreground hand-off and notifications each report absent through their interface with no OS check outside the implementation; `packages/ui/tests/unit` test per capability (FR-008)

## Phase 7: User Story 5 - Develop on Linux (P2)

**Independent test**: each layer reports true results on Linux.

- [x] T034 [US5] Make `scripts/gate.mjs`, `scripts/playwright-global-setup.mjs`, `scripts/playwright-global-teardown.mjs`, `scripts/run-e2e-local.mjs`, `scripts/residue-scan.mjs` and `scripts/daemon-probe.mjs` work on Linux; Windows-only release and installer scripts exit with a plain statement (FR-039)
- [x] T035 [US5] Make `.claude/worktree-prep.json` teardown cross-platform with `scripts/clear-dev-state.mjs`, and add Linux support to the `throng-clear-dev-state` skill (FR-040)
Sweeps T036-T038 work from the failure list of each layer's own run, one package at a time, and are done when that layer is green with every skip carrying a reason.

- [x] T036 [US5] Sweep `packages/*/tests` unit and component layers: fix neutral tests to be portable, guard Windows-asserting ones with `windowsOnly(reason)`, without changing what any test asserts about Windows; both layers green on the reference platform (FR-042, FR-043, FR-045, SC-007)
- [x] T037 [US5] Same sweep for integration and contract layers, run file by file; shared contract suites run for Linux classes in `packages/platform-linux/tests/contract` (FR-044, FR-045)
- [x] T038 [US5] Same sweep for `@core` E2E specs, with Windows-shell fixtures replaced by `defaultTestShell()` and process checks through the harness; `@core` lane runs on Linux (FR-043, FR-046)
- [x] T039 [US5] Write `scripts/ci-linux-setup.sh`; add the Linux jobs to `.github/workflows/ci.yml` and `gate-linux` to `.github/workflows/gate.yml`, leaving Windows jobs unedited; add `THRONG_GATE_E2E_GREP` to `scripts/gate.mjs`; add a skip-count report (contracts/ci-lanes.md, FR-046, SC-008)
- [x] T040 [US5] Confirm the Spec Kit bash scripts run from Linux and note it in `CONTRIBUTING.md` (FR-041)

## Phase 8: User Story 6 - Windows stays as it is (P1)

T041 sits in Phase 2, so the guard exists before the code it guards moves. SC-007's proof is the Windows gate, run on sign-off.

## Phase 9: User Story 7 - Resource Monitor (P3)

**Independent test**: figures agree with the system's tools.

- [x] T042 [US7] Implement `LinuxProcessMetrics` in `packages/platform-linux/src/linux-process-metrics.ts` against `process-metrics-contract.ts`; bind in `packages/ui/src/collector/composition-root.ts` (FR-037, FR-038, SC-010)
- [x] T043 [US7] Implement GPU from `fdinfo` where present and `Unavailable` otherwise, and `Unavailable` network with a stated reason; friendly names and descriptions in `packages/core/src/resources` for Linux process names; the console-host row absent (FR-037, FR-038, FR-008)
- [x] T044 [US7] Add `packages/platform-linux/tests/integration/process-metrics.integration.test.ts` comparing CPU and memory of a busy child with `/proc` readings by `ps`, and proving terminate ends only that process (US7 scenarios 1-3)

## Phase 10: Polish

- [x] T045 [P] Update `docs/installation.md`, `README.md`, `docs/quick-start.md`, `CONTRIBUTING.md`, `docs/architecture.md`, `docs/key-bindings.md`, `docs/testing.md`, `docs/environment.md` and `docs/preferences.md`; add `docs/linux.md` as the one known-differences list and index it in `docs/README.md`; `docs-currency.test.ts` green (FR-036, FR-047, FR-048)
- [x] T046 [P] Update `.claude/skills/throng-terminal-pty`, `throng-core-architecture` and `throng-testing` skill text and root `CLAUDE.md` for the second platform, and the `references/no-headless.md` Linux note
- [x] T047 Review every new seam for macOS readiness and record the result in `specs/062-linux-dev-mode/research.md` (SC-011)
- [x] T053 Add `packages/platform-linux/tests/integration/terminal-soak.integration.test.ts` tagged `regression`: 20 start, end and quit cycles leave no process (SC-003); add 20 reattach cycles to `linux-terminal.e2e.ts` (SC-002); measure echo latency with 10 terminals and print it on every run, in the manner of `references/performance-sla.md` (SC-006)
- [x] T048 Validate `specs/062-linux-dev-mode/quickstart.md` scenarios that do not need `sudo` on the reference machine; record the rest, including SC-001's timed clean-machine run and SC-005's walk of every binding on the desktop, in the manual test plan

## Dependencies

Setup → Foundational → US1 → US2 → US3. US4, US5, US6 and US7 follow US1, and T038 follows US2. Phase 10 is last. Phases 3-5 are the MVP: a window, terminals and files.

## Parallel opportunities

T010-T013 touch separate files; T017-T018; T024-T025; T045-T046.

## Implementation strategy

Foundation first with Windows proved unchanged at each commit by unit tests; then the window and terminals, since nothing else can be seen without them; then the sweep of existing suites; CI last, once there is something for it to prove.
