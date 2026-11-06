# Tasks: Every failure leaves a trace in the diagnostic log

**Input**: `specs/066-failure-logging/` — [plan](plan.md), [spec](spec.md), [research](research.md),
[data model](data-model.md), [contract](contracts/diagnostics.md), [quickstart](quickstart.md)

**Tests**: required — Principle V, test-first. Each implementation task is preceded by the failing test that
proves it, at the layer named.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Create `specs/066-failure-logging/audit.md` with the table from data-model.md *Audit entry* and one section per package (core, daemon, persistence, platform-linux, platform-node, platform-windows, ui main, ui preload, ui renderer, ui collector), seeded with the research baseline's site lists

## Phase 2: Foundational (blocks every story)

- [x] T002 [P] Failing unit tests in `packages/core/tests/unit/diagnostics.test.ts`: `LogLevel` includes `fatal` ordered above `error`; `passesThreshold(threshold, 'fatal')` is true for every threshold; `parseLogLevel('fatal')` returns `fatal`; `formatLogLine` renders `FATAL`
- [x] T003 Add `fatal` to `LogLevel`, `LOG_LEVELS` and `passesThreshold` in `packages/core/src/diagnostics/log-level.ts`, and the `FATAL` label in `packages/core/src/diagnostics/log-format.ts`, making T002 pass
- [x] T004 [P] Failing unit tests in `packages/core/tests/unit/diagnostics-caught.test.ts` (new): `logCaught(where, err)` writes one `console.warn` line `<where>: <message>`; `logExpected(where, reason, err)` writes `console.debug` `<where>: expected — <reason>: <message>` and throws a programming error when `reason` is empty; `logFatal(component, err)` writes `console.error` prefixed `[FATAL]`; none throws when the error is not an `Error`, is circular, or its getter throws
- [x] T005 Implement `packages/core/src/diagnostics/caught.ts` and export it from `packages/core/src/diagnostics/index.ts` and `packages/core/src/index.ts`, making T004 pass
- [x] T006 [P] Failing unit tests in `packages/core/tests/unit/diagnostics-retention.test.ts` (new) for `retentionPlan`: a file's day is its mtime date; keeps files whose day is among the last `keepDays` distinct days present (gaps between days do not count); then deletes oldest-first until under `maxTotalBytes`; never deletes an un-rotated file whose day is `today` (any process's live file, including a daemon session started days ago), while rolled `.n.log` files stay eligible; returns `trimmedBytes`; legacy unprefixed names are handled the same way; `normaliseRetention` clamps `keepDays` to 1–30 and `maxTotalBytes` to 50 MB–65536 MB (65536 is the descriptor's `hardMax`, not the slider's 2048); `sessionFileName('daemon', date, 42)` is `daemon-YYYYMMDD-HHMMSS-42.log`
- [x] T007 Implement `RetentionPolicy`, `normaliseRetention`, `retentionPlan` and `sessionFileName` in `packages/core/src/diagnostics/rotation.ts`; remove `RotationPolicy.keep` and `rotationPlan`'s count-based deletion (roll-over by size stays); making T006 pass
- [x] T008 [P] Failing integration tests in `packages/platform-node/tests/integration/node-file-log.integration.test.ts` (new, real temp folder): rolls over at `maxFileBytes`; on creation prunes by `retentionPlan` and writes the trim record `log retention trimmed N files (M MB) to stay under C MB`; re-prunes on the first write after the date changes (injected clock); an identical line repeated within 60 s is collapsed and flushed as `(repeated N times in Ns)` on the next different line, at window end, and on `close()`; SC-005: 3600 identical failures one second apart (injected clock) produce at most 61 lines; `attachConsole` maps a `[FATAL]`-prefixed `console.error` to the fatal level; `logAlways('fatal', …)` is written under a `fatal`-filtered threshold; FR-016: an unwritable folder, and a folder deleted mid-session, throw nothing and do not block the caller, and each such failure writes one `throng log: …` line to `process.stderr` (contract *The logger's own failures*) so it still reaches the developer console
- [x] T009 Extend `createFileLog` in `packages/platform-node/src/node-file-log.ts` with `retention`, session file naming, date-change re-prune, repeat collapsing, `close()` and the `[FATAL]` mapping, making T008 pass
- [x] T010 [P] Failing integration tests in `packages/platform-node/tests/integration/watch-child.integration.test.ts` (new, real `node -e` children): a child that throws while loading is logged with its exit code and stderr tail ≤ 4 KB; a long-lived child's unasked exit logs at fatal, a helper's at warn; `expectedExit` returning a reason logs at debug; a spawn `error` (missing executable) is logged; an exit throng asked for (`expectedExit` says so) is not logged as a failure; `logChildFailure` logs name, error and stderr
- [x] T011 Implement `watchChild` and `logChildFailure` in `packages/platform-node/src/watch-child.ts` and export them, making T010 pass

**Checkpoint**: levels, helpers, retention, logger and child watching exist and are proven.

## Phase 3: User Story 1 — A failing part of an installed build is explained in the logs (P1) 🎯 MVP

**Goal**: every process throng starts, every window and every panel leaves a record when it fails.
**Independent test**: quickstart rows 1–5.

### Processes

- [x] T012 [US1] Failing tests extending `packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts`: with an injected `log`, a connect lapse, an established agent's crash, an agent `error` event and a late launch reason each produce one log record naming the agent and the reason
- [x] T013 [US1] Inject a `log` into `PtyAgentHost` (`packages/daemon/src/pty-agent-host.ts`) and log each failure `failKey`/`failAllLive` surfaces, plus launch reasons; wire it in `packages/daemon/src/composition-root.ts`; making T012 pass
- [x] T014 [US1] Failing unit test in `packages/daemon/tests/unit/pty-agent-log.test.ts`: the agent log is opened in the folder given as the second argument — an `appdata:<rel>` argument resolves against the agent's own `APPDATA` (contract *PTY agent*), an absolute one is used as is — named by `sessionFileName('pty-agent', …)`, levelled and rotated; with no argument it falls back to `THRONG_LOG_DIR`, never `tmpdir()`
- [x] T015 [US1] Replace `packages/daemon/src/pty-agent-log.ts` with a `createFileLog`-backed log; `packages/daemon/src/pty-agent-entry.ts` reads `logDir` from `argv[3]`, installs `uncaughtException` → `logFatal`; making T014 pass
- [x] T016 [US1] Pass the log folder as the agent's argument in `packages/daemon/src/composition-root.ts` (plain spawn, now via `watchChild` with `longLived: true`) and in `packages/platform-windows/src/windows-de-elevated-launcher.ts` (both launcher argv and the shim's command line), encoding a logs folder under `%APPDATA%` as `appdata:<rel>`; extend `packages/platform-windows/tests/unit/windows-de-elevated-launcher*.test.ts` (or the nearest existing launcher test) to assert the argument is carried and encoded
- [x] T017 [US1] Failing integration test `packages/ui/tests/integration/daemon-spawn-failure.integration.test.ts` (new): a daemon entry that exits during load leaves a fatal record with its exit code and the tail of `daemon-startup.log` (the daemon's stdout/stderr file, already in the logs folder: `daemon-lifecycle.ts` opens it under `logDir`) in `main.log`
- [x] T018 [US1] Watch the daemon spawn in `packages/ui/src/main/daemon-lifecycle.ts` with `watchChild` (`longLived: true`; an exit after `stopDaemon` is expected), making T017 pass; daemon `packages/daemon/src/main.ts` uses `logFatal` in its crash hooks and pass `retention` from `THRONG_LOG_KEEP_DAYS`/`THRONG_LOG_MAX_TOTAL_MB`
- [x] T019 [US1] Failing test extending the resource-monitor host tests (`packages/ui/tests/integration/resource-monitor*.test.ts` or nearest): an unasked collector exit with code 0 or non-zero logs at fatal; a stop throng asked for does not; a repeated `{type:'error'}` with the same cause after recovery is logged again
- [x] T020 [US1] Watch the collector fork with `watchChild` in `packages/ui/src/main/main.ts` / `packages/ui/src/main/resource-monitor-host.ts`; give `packages/ui/src/collector/resource-collector-entry.ts` its own `createFileLog` (component `collector`, folder from env set by main) and `uncaughtException`/`unhandledRejection` → `logFatal`; making T019 pass

### Windows and panels

- [x] T021 [P] [US1] Failing unit test `packages/ui/tests/unit/diagnostics-hooks.test.ts`: `installCrashHandlers` logs `render-process-gone`, `child-process-gone`, `unresponsive` (after its timeout), `preload-error` and a failed first load at fatal; `uncaughtException` at fatal
- [x] T022 [US1] Extend `installCrashHandlers` in `packages/ui/src/main/diagnostics.ts` and register `unresponsive`/`preload-error` per window in `packages/ui/src/main/main.ts`, making T021 pass
- [x] T023 [P] [US1] Failing unit test `packages/ui/tests/unit/diagnostics-ipc.test.ts`: `throng:diagnostics:log` writes `fatal` via `logAlways`, others through the threshold, caps messages at 8 KB, rejects unknown levels; renderer `console-message` at every level reaches `main.log` with component `renderer`, filtered by the configured threshold in main (so `logExpected`'s debug lines are kept when debug is on)
- [x] T024 [US1] Add `registerDiagnosticsLogIpc` in `packages/ui/src/main/renderer-debug-log.ts` (or a new `diagnostics-ipc.ts`), the `console-message` forwarder per window, and `diagnostics.log` in `packages/ui/src/preload/preload.cts` and `packages/ui/src/renderer/global.d.ts`; making T023 pass
- [x] T025 [P] [US1] Failing component test `packages/ui/tests/component/panel-error-boundary.test.ts`: a panel body that throws while rendering, and one whose effect throws (both tear the panel down — research R5), each render the shared failure banner in that panel only, and calls `diagnostics.log('fatal', 'panel', …)` once with the panel's subject (project › tab › panel); siblings keep rendering
- [x] T026 [US1] Implement `packages/ui/src/renderer/workspace/panel-error-boundary.tsx` and wrap every panel body where panels are rendered (`packages/ui/src/renderer/workspace/` panel host), making T025 pass; add the dev seam `THRONG_TEST_PANEL_THROW` read in main and passed to the renderer for quickstart's hand check — inert when `app.isPackaged`, like the other `THRONG_TEST_*` seams
- [x] T027 [US1] Failing component test `packages/ui/tests/component/renderer-error-hooks.test.ts`: a `window` `error` event and an `unhandledrejection` each reach `diagnostics.log` at error; the root's `onUncaughtError` reaches it at fatal
- [x] T028 [US1] Install the window listeners and pass `onUncaughtError`/`onCaughtError`/`onRecoverableError` to `createRoot` in `packages/ui/src/renderer/main.tsx` (and the sub-workspace and preferences entry points), making T027 pass

### Retention and settings

Retention (FR-017–FR-020) rides in US1: a record pruned away, or written to a folder nobody is pointed at, explains nothing.

- [x] T029 [US1] Failing unit tests extending `packages/core/tests/unit/settings-metadata*.test.ts` (nearest existing): `diagnostics.keepDays` (slider 1–30, default 3) and `diagnostics.maxTotalMb` (slider 50–2000 step 50 — a step under 1% of the range fails `slider-descriptors.test.ts` — default 100, `hardMax: 65536`) exist; `diagnostics.keepFiles` does not; a settings file still carrying `keepFiles` loads without error
- [x] T030 [US1] Add the two descriptors and defaults in `packages/core/src/config/settings-metadata.ts` (and shipped defaults generator), remove `keepFiles` (031 FR-015 row superseded by 066 FR-020); feed both to UI main's log and, via `THRONG_LOG_KEEP_DAYS`/`THRONG_LOG_MAX_TOTAL_MB`, to the daemon in `packages/ui/src/main/main.ts`; remove `THRONG_LOG_KEEP`; making T029 pass
- [x] T031 [US1] Update `docs/preferences.md` (Logging group), `docs/environment.md` (new and removed variables, `THRONG_TEST_PANEL_THROW`) and `docs/architecture.md` (one logs folder, every process, fatal level, retention); run `packages/ui/tests/unit/docs-currency.test.ts`

**Checkpoint**: quickstart rows 1–5 green; a crash anywhere leaves a fatal record in the one logs folder.

## Phase 4: User Story 2 — A new process or failure path cannot ship silent (P2)

**Goal**: the audit is done and the guard keeps it done.
**Independent test**: quickstart row 6.

- [x] T032 [US2] Write the guard `packages/ui/tests/unit/failure-logging-guard.test.ts` (TypeScript compiler API over `packages/*/src`, contract *Source markers*): fails naming file:line on a `catch` or `.catch(cb)` that neither logs (`logCaught`/`logExpected`/`logFatal`/`console.*`/an injected `log`/`process.stderr.write`) nor throws/rejects, on a `logExpected` whose reason argument is not a non-empty string literal or template (FR-012), and on a `spawn`/`fork`/`execFile` not passed to `watchChild`/`logChildFailure` and not marked `// child-exempt: <reason>`; self-test with in-memory fixtures for each rule; register it in `packages/ui/tests/unit/guards-are-live.test.ts`. It is RED against the baseline; T033–T042 make it green
- [x] T033 [P] [US2] Audit `packages/core/src` (20 fallback catches; `src/testing` included): classify each in audit.md, apply `logCaught`/`logExpected`
- [x] T034 [P] [US2] Audit `packages/daemon/src` (13 empty, 4 `.catch`, 16 fallback; `ipc-server.ts` malformed lines, `terminal-events.ts` dropped sink, `reap-orphans.ts`, `terminal-service.ts` unclassified launch failures)
- [x] T035 [P] [US2] Audit `packages/persistence/src` (1 empty, 4 fallback; `workspace-repository.ts` corrupt layout)
- [x] T036 [P] [US2] Audit `packages/platform-linux/src` (4 empty, 6 `.catch`, 13 fallback; `fc-list`, `getconf` children)
- [x] T037 [P] [US2] Audit `packages/platform-node/src` (3 empty, 2 `.catch`, 4 fallback; `off-loop-exec.ts` worker failure); the logger's own catches write to `process.stderr` per contract *The logger's own failures* — logging, not an exemption
- [x] T038 [P] [US2] Audit `packages/platform-windows/src` (3 empty, 19 `.catch`, 22 fallback; FFI load failures; `windows-directory-lock.ts`, `windows-seams.ts`, `windows-shell-detection.ts`, `windows-elevation.ts`, `windows-font-enumeration.ts`, `node-pty-host.ts` children; `windows-network-trace.ts` worker)
- [x] T039 [P] [US2] Audit `packages/ui/src/main` (34 empty, 26 `.catch`, ~60 fallback; `daemon-events.ts`/`daemon-client.ts`/`instance-guard.ts`/`daemon-supervisor.ts` dropped messages and disconnects; `recycle-bin-restore.ts` child)
- [x] T040 [P] [US2] Audit `packages/ui/src/renderer` (27 empty, 30 `.catch`, ~50 fallback; `TreeErrorBoundary` logs through `diagnostics.log`)
- [x] T041 [P] [US2] Audit `packages/ui/src/preload` and `packages/ui/src/collector`
- [x] T042 [US2] Any audited site whose underlying failure is itself a reachable defect: file an issue (github-issues, after finding-bugs) and record its number in audit.md; the site still logs
- [x] T043 [US2] Guard green on the full tree; prove it with one mutation per rule (an empty `catch {}`, a `.catch(() => {})`, an unwatched `spawn`) each named by file:line, then reverted

**Checkpoint**: quickstart row 6 green; audit.md complete (SC-004).

## Phase 5: User Story 3 — The rule is part of the constitution (P3)

- [x] T044 [US3] Amend `.specify/memory/constitution.md`: Principle XIII *Every Failure Leaves a Trace* (FR-001–FR-003, the five levels and when fatal applies), version 6.2.0 → 6.3.0 MINOR argued, Last Amended 2026-11-06, the SYNC IMPACT REPORT block (sections added, templates reviewed ✅/⚠, deferred TODOs)
- [x] T045 [US3] Add the XIII row to the Constitution Check in `.specify/templates/plan-template.md`; update the principle count in `CONTRIBUTING.md` (*Constitution check*) and `.claude/skills/throng-spec-governance/SKILL.md` (*The twelve principles*) and `.claude/skills/throng-failure-notices/SKILL.md` (rules)

## Phase 6: Polish

- [x] T046 Record the 031 FR-015 `keepFiles` supersession in `specs/031-tab-strip-and-config-bounds/spec.md` with a superseded-by marker pointing at 066 FR-020
- [x] T047 Run quickstart.md end to end; lint, typecheck, unit, component; integration for touched files
- [x] T048 Remove the stale comment in `packages/daemon/src/pty-agent-entry.ts:31-36` that says the log folder is inherited

## Dependencies

- Phase 2 blocks everything. T003 before T005 (fatal level); T007 before T009; T009 before T015, T018, T020.
- US1 before US2: the audit uses `watchChild` and the helpers, and the guard must see the processes already watched.
- US3 is independent and may land any time after Phase 2.
- Within US2, T033–T041 are disjoint packages: parallel. T043 last.

## Parallel examples

- Phase 2: T002, T004, T006, T008, T010 (distinct test files) together; then T003, T005, T007 in sequence (T007 and T009 share the rotation types).
- US2: T033–T041 one per package.

## Implementation strategy

MVP = Phase 2 + US1: every failure reaches the one logs folder, with the fatal level and retention. US2 then
sweeps the backlog and locks it with the guard; US3 writes the rule down.
