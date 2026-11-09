# Tasks: Terminal Output Pipeline — Cost Follows What Is Visible

**Input**: Design documents from `specs/061-terminal-output-pipeline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/terminal-output.md, quickstart.md

**Tests**: Required by Principle V. Each test task is written first and observed failing.

**Order**: US2 precedes US1 although both are P1, because US1 makes every return to a project a detach and re-attach,
and that seam must already be exact.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Build the load harness (FR-060): one visible terminal and N terminals printing steady output in non-active projects, recording messages per window per second, main-process and window main-thread CPU, and echo latency, in `packages/ui/tests/measure/terminal-load.measure.ts` with its own config `packages/ui/tests/measure/playwright.measure.config.ts`, reusing `openApp()` from `packages/ui/tests/e2e/harness.ts`
- [X] T002 Run T001 at N = 1 and N = 20 on unchanged code and record the baseline, machine and load under a new `## Measurements` heading in `specs/061-terminal-output-pipeline/spec.md`

## Phase 2: Foundational

- [X] T003 [P] Add `TERMINAL_RETAINED_LINES` = 10,000, `TERMINAL_RETAINED_CHARS` = 8,388,608, `TERMINAL_BATCH_INTERVAL_MS` = 17, `TERMINAL_BATCH_MAX_CHARS` = 1,048,576 and `TERMINAL_REPLAY_SLICE_CHARS` = 65,536 in `packages/core/src/terminal/output-constants.ts`, exported through `packages/core/src/terminal/index.ts`
- [X] T004 Write a failing contract test for `replayEnd`, the `terminal.output` fields (`sessionId`, `data`, `end`, `lengths`) and `TerminalSubscribeParams` in `packages/daemon/tests/contract/terminal-output.contract.test.ts`
- [X] T005 Add those types per `contracts/terminal-output.md` in `packages/ipc-contract/src/terminal.ts`, and mirror the payload in `packages/ui/src/renderer/global.d.ts` and `packages/ui/src/preload/preload.cts`

## Phase 3: User Story 2 - Coming back shows exactly what happened (P1)

**Goal**: A returning view shows the latest 10,000 lines, each once and in order.

**Independent Test**: A terminal printing numbered lines, switched away and back 20 times, shows each number once, in order.

- [X] T006 [P] [US2] Write failing unit tests for `RetainedOutput`: at most 10,000 lines, at most 8,388,608 characters, oldest lines evicted first, trim to just after a line feed, a retained window with no line feed dropped to empty, and `\r`-only output staying bounded, in `packages/ui/tests/unit/retained-output.test.ts`
- [X] T007 [US2] Implement `RetainedOutput` with `append`, `snapshot` and `length`, per `data-model.md`, in `packages/core/src/terminal/retained-output.ts`
- [X] T008 [P] [US2] Write failing unit tests for `TerminalOutputGate` covering every interleaving of attach and live delivery: drop another session's delivery, drop `end <= replayEnd`, write the rest in order, split by `lengths`, and log and write on a gap (FR-012, FR-013), in `packages/ui/tests/unit/terminal-output-gate.test.ts`
- [X] T009 [US2] Rewrite the gate to be position-aware per `data-model.md` in `packages/ui/src/renderer/terminal/output-gate.ts`
- [X] T010 [P] [US2] Write failing unit tests slicing a replay into pieces of at most 65,536 characters that rejoin exactly, in `packages/ui/tests/unit/replay-slices.test.ts`
- [X] T011 [US2] Implement the slicing in `packages/ui/src/renderer/terminal/replay-slices.ts`
- [X] T012 [US2] Write a failing daemon integration test that `terminal.attach` returns `replayEnd` equal to the position at the snapshot and that deliveries carry contiguous positions, in `packages/daemon/tests/unit/terminal-output-position.test.ts` (unit: a fake host shows it, no shell needed)
- [X] T013 [US2] In `packages/daemon/src/terminal-service.ts`, replace `scrollback` and `MAX_SCROLLBACK` with `retained` and `outputPosition`, return `replayEnd`, publish `sessionId` and `end`, route the synthetic startup-failure output through the same path, and read `retained.length` for `scrollbackChars`
- [X] T014 [US2] Update the tests pinning 64 KB to the new limits in `packages/daemon/tests/` `terminal-service-wiring.test.ts` and `terminal-hygiene.integration.test.ts` (FR-016 supersedes them)
- [X] T015 [US2] Write a failing component test that a replay is written in slices, `replayingTail` holds until the last slice, `.xterm-screen` is at opacity 0 until then, and the panel is created with `scrollback: 10000`, in `packages/ui/tests/component/terminal-replay-slices.test.ts`
- [X] T016 [US2] Wire `scrollback: TERMINAL_RETAINED_LINES`, the position-aware gate, sliced replay and the opacity hold into `packages/ui/src/renderer/terminal/use-terminal.ts`, with the rule in the terminal stylesheet under `packages/ui/src/renderer/`
- [X] T017 [US2] Update the `onOutput` fixtures to the new payload in the `packages/ui/tests/component/` and `packages/ui/tests/unit/` files that use it
- [X] T018 [US2] Add one E2E covering SC-007 and SC-010 with `@extended @terminal` tags in `packages/ui/tests/e2e/terminal-return-output.e2e.ts`, listed in `packages/ui/tests/e2e/parallel-plan.json` and re-seeded in `packages/ui/tests/e2e/e2e-budget.json`
- [X] T019 [US2] Measure with T001 and record in `specs/061-terminal-output-pipeline/spec.md`, including the time a 10,000-line replay blocks the window (Principle XII)

**Checkpoint**: Replay is exact and holds 10,000 lines. Transport is unchanged.

## Phase 4: User Story 1 - Typing stays fast (P1)

**Goal**: Output reaches only windows showing the terminal, and leaves the daemon only when one does.

**Independent Test**: With 20 busy background terminals, zero output frames leave the daemon for them and zero reach the window.

- [X] T020 [P] [US1] Write failing unit tests for `TerminalOutputRoutes` with fake contents: send only to routed windows, once per window with two views, release on detach and on `destroyed`, a mirror surviving the other window's release, and `viewsForSubscribe()` (FR-001, FR-004, FR-005, FR-006, FR-062), in `packages/ui/tests/unit/terminal-output-routes.test.ts`
- [X] T021 [US1] Implement `TerminalOutputRoutes` with `add`, `remove`, `send` and `viewsForSubscribe` in `packages/ui/src/main/terminal-output-routes.ts`, guarding destroyed contents as `broadcast.ts` does
- [X] T022 [US1] In `packages/ui/src/main/terminal-ipc.ts`, add the route before the `terminal.attach` RPC, remove it on a failed attach other than `stillStarting`, on detach and in the `destroyed` backstop (FR-003, FR-004)
- [X] T023 [US1] In `packages/ui/src/main/daemon-events.ts`, send `terminal.output` through the routes while `grid`, `exit`, `cwd` and `command` stay broadcast, and send `viewsForSubscribe()` in `terminal.subscribe`; construct and inject the routes where `DaemonEvents` is built
- [X] T024 [P] [US1] Write failing unit tests that one listener delivers each payload only to that panel's views, in order, and is released with the last view (FR-007, FR-008), in `packages/ui/tests/unit/terminal-output-router.test.ts`
- [X] T025 [US1] Implement the router in `packages/ui/src/renderer/terminal/output-router.ts` and replace the per-view `bridge.onOutput` in `packages/ui/src/renderer/terminal/use-terminal.ts`
- [X] T026 [US1] Write failing daemon integration tests counting frames at a sink: zero output frames with no output view over a sample, scrollback and attention still recorded (FR-001a, FR-002, SC-001), and a mirror keeping output after one view detaches (FR-005), in `packages/daemon/tests/unit/terminal-output-subscription.test.ts`
- [X] T027 [US1] Write a failing daemon integration test that after the last sink closes and `terminal.subscribe` arrives listing a view, output resumes without a re-attach, and that a subscribe with an empty list stops it (FR-005a), in the same file, plus one test over a real socket in `packages/daemon/tests/integration/terminal-output-subscription.integration.test.ts`
- [X] T028 [US1] Add `outputViews` to the session in `packages/daemon/src/terminal-service.ts`, add on attach, remove on detach, leave it alone in `forgetViews()`, and publish only while it is non-empty; add a method that replaces every session's set
- [X] T029 [US1] Pass `terminal.subscribe` params to that method in `packages/daemon/src/ipc-server.ts`
- [X] T030 [US1] Cover a panel hidden by Focus Mode keeping its output (US1 scenario 5), as the second test in `packages/ui/tests/e2e/terminal-return-output.e2e.ts`
- [X] T031 [US1] Measure with T001 (routing and gate separately, FR-061) and record in `specs/061-terminal-output-pipeline/spec.md`; check SC-001 – SC-003

**Checkpoint**: Cost follows what is visible, without batching.

## Phase 5: User Story 3 - A busy visible terminal costs less (P2)

**Goal**: A sustained stream reaches the window at no more than 60 messages a second, with no added echo delay.

**Independent Test**: One visible terminal printing fast is delivered at no more than 60 messages a second.

- [X] T032 [P] [US3] Write failing unit tests with fake timers for `TerminalEvents`: the first chunk after quiet sent at once, later chunks gathered for 17 ms since the last send, sent at 1,048,576 characters, `lengths` matching the chunks, flushed before `grid`, `exit`, `cwd`, `command` and `attention` for that panel, other panels unaffected, and no timer left when idle (FR-020, FR-021, FR-024, FR-025), in `packages/daemon/tests/unit/terminal-events-batching.test.ts`
- [X] T033 [US3] Implement per-panel batching in `packages/daemon/src/terminal-events.ts`, with a `flush(panelId)` method and timers cleared on session end (FR-070)
- [X] T034 [US3] Call `flush` before taking the replay snapshot in `packages/daemon/src/terminal-service.ts`, with a test in `packages/daemon/tests/unit/terminal-output-position.test.ts` that no delivery straddles `replayEnd`
- [X] T035 [US3] Extend `packages/ui/tests/component/terminal-clear-keeps-screen.test.ts` to show a batch with `lengths` gives the same result as the same chunks delivered singly: a clear inside a batch, PSReadLine partial redraws that must not add up to a clear, and the resize suppression (FR-022)
- [X] T036 [US3] Make the view call `writeChunk` once per `lengths` entry in `packages/ui/src/renderer/terminal/use-terminal.ts`
- [X] T037 [US3] Confirm `packages/daemon/tests/integration/terminal-mirror.integration.test.ts` and `terminal-end-burst.integration.test.ts` cover FR-023 and pending output before exit, extending them where they do not
- [X] T038 [US3] Measure with T001 and record in `specs/061-terminal-output-pipeline/spec.md`; check SC-004 and SC-005

**Checkpoint**: Batching is in; clear detection is unchanged.

## Phase 6: User Story 4 - A terminal never hides its bottom rows (P2)

**Goal**: Every row of the grid is inside the panel at fractional scales.

**Independent Test**: A maximised panel at 125%, 150% and 175% has its last row inside the panel.

- [X] T039 [US4] Load `replicating-bugs` and write the reproducing spec launching Electron with `--force-device-scale-factor` at 1.25, 1.5 and 1.75, maximised, comparing the last row's box with the panel's, with `@extended @terminal` tags, in `packages/ui/tests/e2e/terminal-fractional-scale.e2e.ts`; update `e2e-budget.json` and `parallel-plan.json`
- [X] T040 [US4] Run T039 alone at one worker, establish the cause and state it in `specs/061-terminal-output-pipeline/spec.md` (FR-040). If it is not the hypothesised one, add the requirement FR-044 calls for before going on, and adjust T041 – T043 to it
- [X] T041 [US4] Per T040's cause, move the panel's padding onto xterm's own element in `packages/ui/src/renderer/terminal/terminal.css`, which the fit addon subtracts (FR-041)
- [X] T042 [US4] Confirm T039 passes after T041
- [X] T043 [US4] Add a `matchMedia` resolution listener that re-measures on a scale change and is removed on dispose (FR-042), covered by a component test in `packages/ui/tests/component/terminal-scale-change.test.ts`
- [ ] T044 [US4] Confirm the 008 and 028 tests on grid and rendering stay green (FR-043, FR-045), and that T039 now passes

**Checkpoint**: #162's symptom is reproduced and fixed at fractional scales.

## Phase 7: User Story 5 - Evaluate a GPU renderer (P3)

**Goal**: A measured answer on the GPU renderer.

**Independent Test**: The US3 measurement with and without it.

- [ ] T045 [US5] Measure the busy-terminal case with and without `@xterm/addon-webgl` on the workstation, using a local uncommitted change, and record the result in `specs/061-terminal-output-pipeline/spec.md` (FR-050, SC-006)
- [ ] T046 [US5] Only if SC-006's 20% is met: add the dependency to `packages/ui/package.json`, load it in `packages/ui/src/renderer/terminal/use-terminal.ts` with fallback on context loss and creation failure (FR-051), test the fallback in `packages/ui/tests/component/terminal-gpu-fallback.test.ts`, and bring any user-facing switch through the configuration-editor gate

## Phase 8: Polish

- [X] T047 [P] Remove `appendScrollback` and its test from `packages/core/src/terminal/scrollback-tail.ts` and `packages/ui/tests/unit/scrollback-tail.test.ts` if no caller remains, and correct the comments in `packages/daemon/src/terminal-events.ts` and `packages/ui/src/main/daemon-events.ts` that describe broadcasting output to every window
- [X] T048 Load `throng-docs`, update the output path in `docs/architecture.md` and add the measurement script to `docs/testing.md`
- [X] T049 Take final measurements with T001 and complete `specs/061-terminal-output-pipeline/spec.md`
- [X] T051 Keep the command poll from holding the daemon's event loop: start `/proc` reads in steps in `packages/platform-linux/src/proc-table.ts`, test it in `packages/platform-linux/tests/unit/proc-table-loop.test.ts`, and re-measure SC-002
- [ ] T050 Run lint, typecheck, unit and component locally, push when the maintainer asks, and dispatch `gate.yml` on the branch; quote the run URL and SHA (FR-070 and SC-009 are shown by the orphan and terminal suites in it)

## Dependencies

- Setup, then Foundational, block everything. T002 must run before any production change.
- US2 → US1 → US3. US3's snapshot flush needs US2's `replayEnd`.
- US4 and US5 are independent of the others; US5 uses the US3 measurement.
- Within US1, T021 – T023 precede T028, because routes supply the subscribe list.

## Parallel Opportunities

- T003 with T004.
- In US2: T006, T008 and T010 (separate test files).
- In US1: T020 and T024.
- US4 can run alongside US3, except that T036 and T042 both edit `use-terminal.ts`.

## Implementation Strategy

**MVP**: Phases 1 – 4 (US2 and US1) deliver #481's complaint. Each later phase lands green and is measured on its own (FR-061).
