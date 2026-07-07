---
description: "Task list for Application Bootstrap & Landing Page"
---

# Tasks: Application Bootstrap & Landing Page

**Input**: Design documents from `/specs/001-app-bootstrap/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: INCLUDED and MANDATORY. Constitution v1.5.1 Principle V (Test-First, Red-Green-Refactor)
is NON-NEGOTIABLE and spec FR-015 requires unit + integration + E2E layers, each with a passing
smoke test, and every component covered. Every implementation task is preceded by a test task that
MUST be observed failing first (**[Gap D]**).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1–US4); Setup/Foundational/Polish carry no label
- All paths are repository-relative (repo root = `D:\git\throng`)

## Path Conventions

npm-workspaces monorepo (per plan.md). Packages live under `packages/`:
`core`, `platform-windows`, `persistence`, `ipc-contract`, `daemon`, `ui`. Each package owns its
own `src/` and `tests/`. Root holds the orchestration config (`package.json`, `tsconfig.base.json`,
`vitest.config.ts`, `playwright.config.ts`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand up the monorepo, shared compiler config, test harnesses, and package skeletons.

- [X] T001 Create npm-workspaces monorepo root `package.json` at repo root (`"workspaces": ["packages/*"]`, `"type": "module"`, per-component scripts `build`, `test:unit`, `test:integration`, `test:contract`, `test:e2e`)
- [X] T002 [P] Create `tsconfig.base.json` at repo root (TS 5.x, `module`/`moduleResolution` NodeNext, `target` ES2022, `strict`, `experimentalDecorators`, `emitDecoratorMetadata` for InversifyJS)
- [X] T003 [P] Install shared dependencies at repo root: `typescript`, `vitest`, `@playwright/test`, `playwright`, `inversify`, `reflect-metadata`, `better-sqlite3`, `@types/better-sqlite3`, `electron`, `@types/node`, `concurrently`
- [X] T004 [P] Create `vitest.config.ts` at repo root defining three projects — `unit`, `integration`, `contract` — each with its include glob over `packages/**/tests/<layer>/`. Note: `contract` is a runner sub-suite of the **integration** layer (FR-015), not a fourth conceptual test layer.
- [X] T005 [P] Create `playwright.config.ts` at repo root configured for the Electron driver (`testDir: packages/ui/tests/e2e`)
- [X] T006 Scaffold the six workspace packages under `packages/` (`core`, `platform-windows`, `persistence`, `ipc-contract`, `daemon`, `ui`), each with a `package.json` and a `tsconfig.json` that extends `tsconfig.base.json`, plus an empty `src/`

**Checkpoint**: `npm install` succeeds; the monorepo and all four test runners resolve.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared `core` building blocks every user story depends on — typed settings,
the OS-abstraction interface, and the reusable OS contract-test suite (**[Gap A]**, **[Gap C]**).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T007 [P] Write failing unit test for the shared OS-contract suite in `packages/core/tests/unit/platform-info-contract.test.ts` — asserts `runPlatformInfoContract` passes for a compliant fake `IPlatformInfo` and fails for a non-compliant one (RED)
- [X] T008 Create the `IPlatformInfo` interface in `packages/core/src/abstractions/platform-info.ts` (`osName()`, `pathSeparator()`; no OS calls)
- [X] T009 Implement the reusable `runPlatformInfoContract(makeSubject)` suite in `packages/core/src/testing/platform-info-contract.ts`, asserting contract obligations 1–3 (makes T007 GREEN)
- [X] T010 [P] Create typed settings interfaces `IDaemonSettings`, `IUiSettings`, `IPersistenceSettings` in `packages/core/src/config/settings.ts` (Principle X / **[Gap C]**)
- [X] T011 Create the core barrel export in `packages/core/src/index.ts` re-exporting `abstractions`, `config`, and `testing`

**Checkpoint**: `core` builds and its unit smoke test passes (SC-003 for `core`); settings + OS
contracts are available to all stories.

---

## Phase 3: User Story 1 - Launch the application to a landing page (Priority: P1) 🎯 MVP

**Goal**: An Electron window opens to a throwaway "Hello World" landing page identifying the app as
"throng", behaving as a normal resizable/closable desktop window with a default theme.

**Independent Test**: Launch the app on Windows; confirm the window opens to the landing page, can
be resized, and closes cleanly (US1 acceptance scenarios; SC-001, SC-006, SC-008).

### Tests for User Story 1 (write first, observe failing) ⚠️

- [X] T012 [P] [US1] Write failing Playwright-Electron E2E test in `packages/ui/tests/e2e/landing.e2e.ts` — launches the app, asserts the window opens to a landing page showing "throng" + a placeholder welcome message, is resizable, and closes cleanly (SC-001/SC-006/SC-008)

### Implementation for User Story 1

- [X] T013 [P] [US1] Create the renderer landing page `packages/ui/src/renderer/index.html` and `packages/ui/src/renderer/landing.ts` ("throng" + placeholder welcome; a single default theme/stylesheet; placeholder content only, no product features)
- [X] T014 [P] [US1] Create a minimal sandbox preload `packages/ui/src/preload/preload.ts` (`contextBridge` stub; extended for ping in US3)
- [X] T015 [US1] Create the Electron main composition root `packages/ui/src/main/composition-root.ts` — a single InversifyJS container binding `IUiSettings` from documented defaults (overridable via env in this file only)
- [X] T016 [US1] Implement the Electron main entry `packages/ui/src/main/main.ts` — create the `BrowserWindow` (`contextIsolation: true`, `nodeIntegration: false`, sized from `IUiSettings`), load the landing page (makes T012 GREEN)
- [X] T017 [US1] Add the `start:ui` and `build` scripts to `packages/ui/package.json`

**Checkpoint**: `npm run start:ui` opens the throng landing page; the E2E smoke test passes (SC-003 for `ui`).

---

## Phase 4: User Story 2 - Build, run, and test every component from documented commands (Priority: P1)

**Goal**: Documented npm scripts install/build/run-each/run-all/test the whole skeleton, and the
shared platform-agnostic `core` is provably separated from the OS-specific boundary.

**Independent Test**: From a clean checkout, run the documented install/build/run-all/test commands;
confirm every component builds and the test suite is green, and a structural review confirms no
OS-specific calls leak into `core` (US2 acceptance scenarios; SC-002, SC-009, SC-010).

### Tests for User Story 2 (write first, observe failing) ⚠️

- [X] T018 [P] [US2] Write failing contract test in `packages/platform-windows/tests/contract/windows-platform-info.contract.test.ts` — calls `runPlatformInfoContract(() => new WindowsPlatformInfo())` and additionally asserts `osName() === "windows"` and `pathSeparator() === "\\"` (RED; **[Gap A]**)
- [X] T019 [P] [US2] Write failing structural guard test in `packages/core/tests/unit/no-os-imports.test.ts` — scans `packages/core/src` and asserts it imports no OS/Electron/`node:`-process APIs (SC-010)

### Implementation for User Story 2

- [X] T020 [US2] Implement `WindowsPlatformInfo` in `packages/platform-windows/src/windows-platform-info.ts` — the only place reading OS-specific facts (`os.platform()`, `path.sep`) (makes T018 GREEN; SC-003 for `platform-windows`)
- [X] T021 [US2] Add the root orchestration scripts to root `package.json`: `npm start` (run daemon + UI together via `concurrently`) and aggregate `npm test` (unit + integration + contract + e2e) (FR-014). Note: these aggregate scripts only run fully green once US3 (daemon) and US4 (persistence) targets exist; until then they are green for the components implemented so far (see Dependencies → US2)
- [X] T022 [P] [US2] Write `README.md` at repo root documenting the clean-checkout flow: install → build → run-each → run-all → test, with the command table from quickstart.md (FR-016, SC-009). Include a **Prerequisites** section (Node 20 LTS, Windows 11) that explicitly covers two edge cases as documentation-only: missing runtime/dependency → `node`/`npm` surface a clear error (no custom handling added — tooling default; spec Edge Case "Missing runtime/dependencies"), and non-Windows OS → unsupported this iteration and not presented as supported (spec Edge Case "Unsupported operating system")

**Checkpoint**: `npm install && npm run build && npm test` is green from a clean checkout; `core`↔OS separation is enforced by a passing guard test.

---

## Phase 5: User Story 3 - The UI communicates with the background daemon (Priority: P1)

**Goal**: A separate headless daemon process serves `health.ping` over a named pipe; the UI client
completes the round-trip, and reports the daemon as unavailable when it is not running.

**Independent Test**: Start the daemon and UI, trigger `health.ping`, confirm a successful
round-trip; with the daemon down, confirm the UI reports unavailable rather than hanging (US3
acceptance scenarios; SC-004, FR-010).

### Tests for User Story 3 (write first, observe failing) ⚠️

- [X] T023 [P] [US3] Write failing daemon integration test in `packages/daemon/tests/integration/health-ping.integration.test.ts` — start the real daemon, connect over the real pipe, send `health.ping`, assert `status === "ok"`, ISO-8601 `daemonStartedAt`, numeric `pid` (per `contracts/ipc-health-ping.md`)
- [X] T024 [P] [US3] Write failing client integration test in `packages/ui/tests/integration/daemon-unavailable.integration.test.ts` — with no daemon listening, assert the client resolves to `{ available: false, reason: ... }` within `pingTimeoutMs` and never throws/hangs (FR-010)

### Implementation for User Story 3

- [X] T025 [P] [US3] Create the shared JSON-RPC types in `packages/ipc-contract/src/health-ping.ts` (`HealthPingRequest`, `HealthPongResult`, `DaemonUnavailable`) plus `packages/ipc-contract/src/index.ts`
- [X] T026 [US3] Implement the daemon composition root `packages/daemon/src/composition-root.ts` — a single InversifyJS container binding `IDaemonSettings` and `IPersistenceSettings` from documented defaults
- [X] T027 [US3] Implement the named-pipe JSON-RPC server `packages/daemon/src/ipc-server.ts` — newline-delimited JSON-RPC 2.0, `health.ping` handler returning the pong; surface pipe-name-in-use explicitly (spec Edge Case)
- [X] T028 [US3] Implement the daemon entry `packages/daemon/src/main.ts` — compose container, listen on the injected pipe; install a graceful `SIGINT`/`SIGTERM` shutdown handler that closes the IPC server and releases the named pipe (FR-005 stop control; also mitigates the pipe-name-in-use edge case); add the `start:daemon` and `build` scripts to `packages/daemon/package.json` and document the stop control (Ctrl+C) in `quickstart.md` (makes T023 GREEN; SC-003 for `daemon`)
- [X] T029 [US3] Implement the named-pipe JSON-RPC client `packages/ui/src/main/daemon-client.ts` — connect, send `health.ping`, resolve to `DaemonUnavailable` on no-pipe/timeout (makes T024 GREEN)
- [X] T030 [US3] Wire the ping into the UI: bind `daemon-client` in `packages/ui/src/main/composition-root.ts`, expose the result through `packages/ui/src/preload/preload.ts`, and display success/unavailable on the landing page in `packages/ui/src/renderer/landing.ts`; extend the Playwright-Electron E2E (`packages/ui/tests/e2e/landing.e2e.ts`) to assert the landing page reflects a successful `health.ping` round-trip when launched via the run-all path (SC-004, per `contracts/ipc-health-ping.md` E2E obligation)

**Checkpoint**: `npm start` shows the landing page reflecting a successful ping; daemon-down path reports unavailable.

---

## Phase 6: User Story 4 - The persistence store is initialised (Priority: P2)

**Goal**: On startup the embedded SQLite store is opened and brought to the baseline (`user_version`
→ 1, no domain tables) idempotently, with a trivial read/write smoke check.

**Independent Test**: Start against a fresh data directory; confirm the DB file is created, the
baseline migration runs, re-running is a no-op, and a trivial read/write succeeds (US4 acceptance
scenarios; SC-005).

### Tests for User Story 4 (write first, observe failing) ⚠️

- [X] T031 [P] [US4] Write failing integration test in `packages/persistence/tests/integration/migration-runner.integration.test.ts` — fresh dir → file created and `user_version` set to 1; reopen → no-op (no changes); trivial read/write smoke succeeds (SC-005); surfaces open failure on an unwritable path (Edge Case)

### Implementation for User Story 4

- [X] T032 [P] [US4] Implement database open/connect `packages/persistence/src/database.ts` — better-sqlite3 open at the injected `IPersistenceSettings.databasePath`; surface open/init failures explicitly
- [X] T033 [US4] Implement the migration runner `packages/persistence/src/migration-runner.ts` — read `PRAGMA user_version`; if `< 1` apply the baseline (no domain tables) and set `user_version = 1`; if `== 1` make no changes (makes T031 GREEN; SC-003 for `persistence`)
- [X] T034 [US4] Create `packages/persistence/src/index.ts` and wire store-init into `packages/daemon/src/main.ts` so the daemon opens + migrates the store on startup

**Checkpoint**: Persistence integration test passes; the daemon initialises the store on startup.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Deferred-feature extension points, performance check, and full quickstart validation.

- [X] T035 [P] Add clearly-marked extension-point markers for deferred layers (projects, terminals, layouts, change review, agents) as code comments + a "Deferred / Extension Points" section in `README.md` (FR-007)
- [X] T036 [P] Add a concrete timing assertion to the Playwright-Electron E2E flow in `packages/ui/tests/e2e/landing.e2e.ts` that measures launch→landing-visible elapsed time and asserts it is `< 5000 ms`, automatically verifying NFR-001 / SC-001 (no manual eyeballing)
- [X] T037 Run the full `quickstart.md` V1–V6 validation on a clean Windows checkout and confirm every layer is green
- [X] T038 [P] Final structural review per SC-007 (zero product features) and SC-010 (`core` free of OS/Electron/process calls; `platform-windows` the only OS seam; `daemon` and `ui` each exactly one composition-root container)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phases 3–6)**: All depend on Foundational. Once it is complete they can proceed
  in parallel (if staffed) or sequentially in priority order (US1 → US2 → US3 → US4).
- **Polish (Phase 7)**: Depends on all targeted user stories being complete.

### User Story Dependencies

- **US1 (P1)**: After Foundational. Independent — needs only `core/config` (`IUiSettings`). The
  landing page renders without the daemon (daemon-unavailable is acceptable for US1's own test).
- **US2 (P1)**: After Foundational. Independent — `platform-windows` seam + structural guard +
  orchestration scripts/README. The aggregate `npm test`/`npm start` scripts invoke targets that
  come online as other stories land, but US2's own tasks and structural test stand alone.
- **US3 (P1)**: After Foundational. Independent — `ipc-contract` + daemon server + UI client. T030
  extends US1's UI files but the round-trip itself is independently testable via T023/T024.
- **US4 (P2)**: After Foundational. Independent — `persistence` package. T034 extends the daemon
  `main.ts` from US3; if US3 is not yet done, the persistence integration test (T031) still proves
  the store independently of the daemon.

### Within Each User Story

- The test task(s) MUST be written and observed FAILING before implementation (Red-Green-Refactor).
- Shared types/contracts before servers/clients; composition roots before entries; core impl
  before cross-component wiring.

### Parallel Opportunities

- Setup: T002, T003, T004, T005 run in parallel after T001.
- Foundational: T007 and T010 run in parallel; T008/T009/T011 are sequential on the same area.
- Once Foundational completes, US1–US4 can be worked in parallel by different contributors.
- Within a story, all `[P]` test tasks run together, and `[P]` implementation tasks touching
  different files run together.

---

## Parallel Example: User Story 3

```bash
# Write all US3 tests first (different files), observe them fail:
Task: "Daemon integration test in packages/daemon/tests/integration/health-ping.integration.test.ts"
Task: "Client integration test in packages/ui/tests/integration/daemon-unavailable.integration.test.ts"

# Then the independent building block can start in parallel with the test authoring:
Task: "Shared JSON-RPC types in packages/ipc-contract/src/health-ping.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: `npm run start:ui` opens the throng landing page; E2E test green.
5. Demo the running landing page (the surface every later feature iterates on).

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → landing page launches (MVP) → demo.
3. US2 → clean-checkout build/run/test loop + OS-seam proof → demo.
4. US3 → UI↔daemon ping round-trip → demo.
5. US4 → persistence store initialised → demo.
6. Polish → extension points, perf check, full quickstart validation.

### Parallel Team Strategy

After Foundational: Dev A → US1, Dev B → US2, Dev C → US3, Dev D → US4. Stories integrate
independently; US3's T030 and US4's T034 are the only cross-story touch-points and are sequenced last.

---

## Notes

- [P] = different files, no dependency on incomplete tasks.
- [Story] label maps each task to its user story for traceability.
- Verify every test fails before implementing (Principle V is NON-NEGOTIABLE).
- Commit after each task or logical group.
- Stop at any checkpoint to validate the story independently.
- SC-003 component coverage: `core` (T007), `platform-windows` (T018), `ui` (T012), `daemon` (T023),
  `persistence` (T031); `ipc-contract` types are exercised by T023/T024.
- Edge-case coverage map (spec.md → tasks):
  - Missing runtime/dependencies → documentation-only via T022 Prerequisites (tooling default; no code).
  - Unsupported (non-Windows) OS → documentation-only via T022 / quickstart Windows-11 scope; no code.
  - Build/test failure on clean checkout → T037 quickstart V1 validation (treated as a defect).
  - Daemon unavailable → T024 + T029 (client resolves `{available:false}`, no hang).
  - IPC channel address in use → T027 (daemon surfaces pipe-name-in-use; daemon stop in T028).
  - Database initialisation failure → T031 + T032 (open failure surfaced, not swallowed).
