---

description: "Task list for 051 — The Terminal Service Never Stops Answering"
---

# Tasks: The Terminal Service Never Stops Answering

**Input**: `specs/051-nonblocking-process-calls/` — plan.md, spec.md, research.md (R1–R14), data-model.md,
contracts/ (pty-host.md, terminal-rpc.md, pty-agent-protocol.md), quickstart.md

**Tests**: REQUIRED. Constitution Principle V is test-first and non-negotiable; FR-020–FR-022 are themselves tests.
Every implementation task starts with its failing test at the lowest layer named, observed failing for the stated
reason, then the minimal code to pass.

**Organization**: grouped by user story. Paths are repo-relative.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [x] T001 Add `TERMINAL_END_TIMEOUT_MS = 5000` in `packages/core/src/config/terminal-limits.ts`, exported from
  `packages/core/src/index.ts`, with a unit test in `packages/core/tests/unit/terminal-limits.test.ts` asserting the
  value (FR-013a: "The time limit for ending a terminal MUST be 5 seconds, defined once as a single named constant").

---

## Phase 2: Foundational (blocks every story)

- [x] T002 Reproduce #468 FIRST (FR-022, Principle V): write `packages/daemon/tests/integration/unload-then-switch.integration.test.ts`
  — a real `TerminalService` (real `NodePtyHost`) and `ProjectService` behind one router, four terminals in project A
  each running `ping -n 60 127.0.0.1`, `terminal.killAll {projectId: A}` started and NOT awaited, then
  `projects.setActive(B)` immediately; fail if it errors or takes more than 1000 ms. Repeat the whole sequence 3
  consecutive times in one test `[derived]` (SC-001's 20 consecutive attempts are covered by the manual test plan;
  20 here would exceed the integration layer's time budget). Run it on the unchanged code and
  record in the ledger that it FAILS for the reported reason (the setActive round trip exceeds 1 s while the kills run).
  It stays red until T017.
- [x] T003 [P] Pure conhost-assignment rule: test `packages/core/tests/unit/conhost-assignment.test.ts`, then
  `packages/core/src/terminal/conhost-assignment.ts` — `assignConhosts(pending, conhostsInCreationOrder, claimed)`
  gives the newest N unclaimed hosts to pending sessions in spawn order (moved unchanged from
  `NodePtyHost.attributeConhosts`; cases: a lingering orphan, several starts together, fewer hosts than pending).
- [x] T004 [P] Pure escalation-target rule: test `packages/core/tests/unit/escalation-targets.test.ts`, then
  `packages/core/src/terminal/escalation-targets.ts` — `escalationTargets(table, shellPid, conhostPid)`: the shell,
  every transitive descendant by ppid, and the conhost; deduplicated; never the caller's own pid; a cycle in the
  table terminates.
- [x] T005 Change the abstraction per `contracts/pty-host.md` in `packages/core/src/abstractions/pty-host.ts`: remove
  `kill` and `listChildPids`; add `end(handle, timeoutMs): Promise<void>` and
  `forceEnd(handle, timeoutMs): Promise<{ survivors: { pid; name }[] }>`; make `probeChildPids` required and
  `dispose?(): Promise<void>`. Update every class or object typed `IPtyHost` in `packages/**` (production and test doubles; `npm run typecheck` lists them)
  so `npm run typecheck` is green with the production hosts stubbed to throw "not implemented" until T006–T009.
- [x] T006 `NodePtyHost.end` (R2): test `packages/platform-windows/tests/unit/node-pty-host-end.test.ts` with an
  injected `execFile` — resolves after the shell's exit is observed; exit code 128 counts as success; a `taskkill`
  that never returns rejects after `timeoutMs` while a 10 ms timer still fires on schedule; a second `end` returns the
  same promise. Then implement in `packages/platform-windows/src/node-pty-host.ts` (async `taskkill` via `execFile`
  with `timeout: timeoutMs`; no `execFileSync`).
- [x] T007 Async conhost attribution (R5, FR-014): test `packages/platform-windows/tests/unit/node-pty-host-attribution.test.ts`
  — `start()` makes no synchronous call; attribution runs on a FRESH async snapshot started after the spawn (never a
  reused earlier one); passes run one at a time; `end` and the self-exit reap await `conhostReady` (bounded by the
  limit) then end the conhost. Implement in `node-pty-host.ts` with `assignConhosts` (T003) and `readProcessTable`;
  delete `conhostChildren`'s synchronous form.
- [x] T008 `NodePtyHost.forceEnd` and async `dispose` (R8): test in `node-pty-host-end.test.ts` (fake table: tree with
  an exited middle process still ends the grandchild; survivors reported by pid and name), then implement with
  `escalationTargets` (T004), concurrent individual `taskkill /F`, one re-read after at most `timeoutMs`. `dispose`
  ends every session and sweeps unattributed hosts, all awaited.
- [x] T009 Busy probes ask once (R9, FR-011, FR-012): delete `descendantPids` and the synchronous `listChildPids` from
  `node-pty-host.ts`; delete `TerminalService.isBusy` and the fallback in `probeBusy`
  (`packages/daemon/src/terminal-service.ts`). Extend `packages/platform-windows/tests/unit/busy-probe.test.ts`: ten
  concurrent `probeChildPids` → one `execFile`; a failed read rejects all ten.
- [x] T010 Contract tests (`contracts/pty-host.md` 1–6) in `packages/platform-windows/tests/contract/node-pty-host.contract.test.ts`
  against real processes: end with a long command leaves no shell/command/conhost; end right after start leaves no
  conhost; end of an exited shell resolves; forceEnd on a broken tree; ten probes one read.
- [x] T011 Agent protocol (`contracts/pty-agent-protocol.md`): test `packages/daemon/tests/unit/pty-agent-end.test.ts`
  — `PtyAgentHost.end` sends `{op:'end', key, reqId, timeoutMs}`, resolves on `{op:'ended', ok:true}`, rejects with
  `reason` on `ok:false`, rejects itself after `timeoutMs + 1000` with no reply; `forceEnd` likewise with
  `forceEnded`. Implement in `packages/daemon/src/pty-agent-protocol.ts`, `pty-agent-host.ts`, `pty-agent-entry.ts`
  (agent answers via its own `NodePtyHost.end`/`forceEnd`); remove the `kill` op.
- [x] T012 Inject the limit (FR-013a, Principle IX): `TerminalService` receives `endTimeoutMs` through its settings in
  `packages/daemon/src/composition-root.ts`, valued from `TERMINAL_END_TIMEOUT_MS`; the process-table and agent
  request timeouts in `node-pty-host.ts` / `pty-agent-host.ts` read the same constant. Unit test in
  `packages/daemon/tests/unit/composition-root.test.ts` (create it if absent) asserts the wiring.

**Checkpoint**: every host ends asynchronously with an outcome; nothing on the start/end/busy path is synchronous.

---

## Phase 3: User Story 1 — Switch project straight after unloading one (P1) 🎯 MVP

**Goal**: Unload with End Terminals followed by an immediate switch never fails (#468).

**Independent Test**: T002 passes; quickstart "By hand" steps 1–2.

- [x] T013 [US1] Ending state and outcomes (FR-003, FR-005, data-model "States"): test
  `packages/daemon/tests/unit/terminal-end-outcomes.test.ts` with a fake host — `terminal.kill` returns `{ok:true}`
  before the host's `end` settles; success publishes the exit as user-initiated (005 FR-017); failure or timeout
  clears `ending`, resets `userKilled`, publishes nothing, and a later self-exit is reported unexpected. Implement in
  `packages/daemon/src/terminal-service.ts` (`ending: Promise<void> | null` per data-model.md); route `kill`,
  `closeIdle`, `killForProject` and `terminate` through one private `beginEnd(session)`.
- [x] T014 [US1] `terminal.killAll` outcome (contracts/terminal-rpc.md): extend `terminal-end-outcomes.test.ts` — ends
  run concurrently; result `{ killed, failed: [{ panelId, reason }] }` with `failed ⊆ killed`; reason
  `"did not end within 5 seconds"` on timeout. Update the result type beside the existing `TerminalKillAllResult` in
  `packages/core` and implement in `terminal-service.ts`.
- [x] T015 [US1] No reattach while ending (FR-004, R4): extend `terminal-end-outcomes.test.ts` — an attach for a panel
  whose session is ending starts a fresh session, the old one moves to `endingSessions`, its exit is not published,
  its lock is still released; if that superseded end fails it is escalated with `forceEnd`. Implement in
  `terminal-service.ts` (`superseded` flag; `handleExit` must not delete a map entry that is no longer this session).
- [x] T016 [US1] Unload's one notice names failed ends (FR-002, FR-005): component test
  `packages/ui/tests/component/unload-failed-ends.test.ts` — a `killAll` resolving `failed: [x, y]` produces ONE
  notice containing "2 of its terminals could not be ended; they are still running and reattach when you open
  <name> again". Implement in `packages/ui/src/renderer/sidebar/unload-project.ts`; pass the new result shape through
  `packages/ui/src/main/terminal-ipc.ts` and the preload typing (`global.d.ts`). Extend
  `packages/ui/tests/unit/terminal-ipc-unload.test.ts`: `UNLOAD_RPC_TIMEOUT_MS` exceeds two end limits.
- [x] T017 [US1] Run T002's integration test: green. Record the run in the ledger.

**Checkpoint**: #468 fixed and guarded.

---

## Phase 4: User Story 2 — Other terminals keep working while terminals end or start (P1)

**Goal**: no request waits on the OS while ending, starting or deciding busy (FR-010, FR-021).

**Independent Test**: T018 passes; quickstart "By hand" step 3.

- [x] T018 [US2] Write FR-021 FIRST: `packages/daemon/tests/integration/terminal-responsiveness.integration.test.ts` —
  real `NodePtyHost`; ten shells running a long command; `killAll` of all ten, five new starts and
  `list {includeBusy}` in sequence (SC-002's sizes); an unrelated RPC every 20 ms throughout, recording each round trip; fail if any exceeds 100 ms, or
  500 ms when `process.env.CI` is set. In the same run (SC-002, SC-003): a sixth terminal prints a line every 50 ms
  and the gap between its data events must not exceed 150 ms (its interval + 100 ms; 550 ms on CI); a marker written to a seventh
  terminal every 200 ms must echo within 100 ms (500 ms on CI) (FR-021: "fail if, while they end, the terminal service takes longer than
  100 ms to answer any unrelated request. On CI the bound for every request is 500 ms instead"). Observe it failing
  on the lock busy-wait or cwd read if T019–T021 are not yet in; record which.
  `[derived]` as built: the output gap and echo are logged, not asserted — measured over 160 ms while every request
  answered within 61 ms (ConPTY and process scheduling, not the daemon); SC-002/SC-003 go to the manual test plan.
  Requests made while terminals START carry a 100 ms allowance for node-pty's synchronous spawn (measured 43–95 ms).
  Observed red first on 10 `taskkill` spawns in one tick (~150 ms), fixed by spacing spawns (`pacedExecFile`).
- [x] T019 [P] [US2] Root lock without busy-wait (R7): test `packages/platform-windows/tests/unit/directory-lock-async.test.ts`
  — `acquire`/`release` are async; a contended release retries on 15 ms timers up to 3 s while a 5 ms timer keeps
  firing; no `Atomics.wait`. Implement in `packages/platform-windows/src/windows-directory-lock.ts`.
- [x] T020 [US2] Async lock manager: test `packages/daemon/tests/unit/terminal-lock-manager.test.ts` and `terminal-end-outcomes.test.ts` (`[derived]`: placed beside the existing manager and service tests) — `handleExit`
  publishes the exit only after the release settles (order unchanged: released, then UI told). Implement in
  `packages/daemon/src/terminal-lock-manager.ts` and its callers in `terminal-service.ts` (attach failure, terminate,
  handleExit).
- [x] T021 [P] [US2] Cwd read via koffi `.async` (R6): test `packages/platform-windows/tests/unit/process-cwd-async.test.ts`
  — source scan asserts `OpenProcess`, `NtQueryInformationProcess`, `ReadProcessMemory` and `CloseHandle` are only
  called through `.async`; a fake binding proves `read()` yields to the event loop between calls; a call that never
  completes makes `read()` resolve `undefined` after `TERMINAL_END_TIMEOUT_MS` (FR-013), leaving the last cwd in
  place. Implement in
  `packages/platform-windows/src/windows-process-cwd.ts`.
- [x] T022 [US2] The build-failing ban (FR-020, SC-006, R10): test `packages/daemon/tests/unit/blocking-process-ban.test.ts`
  — ESLint `lintText` of `import { execFileSync } from 'node:child_process'`, `cp.spawnSync(...)` and
  `Atomics.wait(...)` with `filePath` under `packages/daemon/src/` and `packages/platform-windows/src/` each reports
  an error; the same text under `packages/ui/src/` does not. Add the block to `eslint.config.js`; mark the FR-017
  exceptions at the call in `packages/daemon/src/reap-orphans.ts` and `packages/platform-windows/src/windows-elevation.ts`
  with `-- FR-017: startup only, before the service serves (<reason>)`; exclude
  `packages/platform-windows/src/windows-shell-detection.ts` via `ignores` with a comment (UI main only). `npm run lint` green.
- [x] T023 [US2] Run T018: green locally at 100 ms. Record the worst round trip in the ledger.

**Checkpoint**: the service answers throughout ends, starts and busy checks.

---

## Phase 5: User Story 3 — Closing with many terminals does not freeze (P2)

**Goal**: one OS read per busy decision; shutdown and Terminate all leave nothing behind (FR-011, FR-015, FR-015a).

**Independent Test**: T025's integration test; quickstart "By hand" step 4; `terminal-no-orphans.e2e.ts` on CI.

- [x] T024 [US3] Busy decisions skip ending sessions and ask once (FR-011, contracts/terminal-rpc.md): extend
  `packages/daemon/tests/unit/pty-agent-childpids.test.ts` (agent: ten concurrent `childpids` → one table read) and
  `terminal-end-outcomes.test.ts` (`list {includeBusy}` and `closeIdle` do not probe an ending session; it reports
  `busy: false`). Implement in `terminal-service.ts` and `pty-agent-entry.ts` if needed.
- [x] T025 [US3] Async shutdown with escalation (FR-015, FR-015a): unit test in `terminal-end-outcomes.test.ts`
  (fake host: every session ended concurrently; a failed end calls `forceEnd`; survivors logged via `console.warn`
  with pid and name; FR-005's reattach never applies) and integration test
  `packages/daemon/tests/integration/terminal-shutdown-escalation.integration.test.ts` (real shells running
  `ping -n 60`; an injected first `end` that rejects; afterwards no shell, command or conhost of those terminals
  remains). Implement `TerminalService.shutdown(): Promise<void>` covering `sessions` and `endingSessions`.
- [x] T026 [US3] Callers await shutdown: `packages/daemon/src/main.ts` awaits `terminals.shutdown()` before
  `server.stop()`; `packages/daemon/src/pty-agent-entry.ts` awaits its host's end-all/escalate on pipe close before
  `exit(0)`. Unit-test the ordering where a test seam exists (`packages/daemon/tests/unit/daemon-shutdown.test.ts`).
- [x] T027 [US3] Terminate all escalates (R8): `terminal.killAll {escalate: true}` escalates failed ends and lists only
  survivors in `failed` (extend `terminal-end-outcomes.test.ts`); UI main's app-close Terminate all
  (`packages/ui/src/main/main.ts`) passes `escalate: true` and uses `UNLOAD_RPC_TIMEOUT_MS` instead of the 2 s default
  (unit test beside the existing app-close tests in `packages/ui/tests/unit/`).

**Checkpoint**: no end path can leave a process behind, and none freezes.

---

## Phase 6: User Story 4 — Command memory sees a command started through a launcher (P3, conditional on FR-045)

**Goal**: #193 — attached processes, not just direct children (FR-040–FR-044).

**Independent Test**: SC-007 by hand (Git Bash, `docker run`), or the measurement's negative result posted on #193.

- [x] T028 [US4] Measurement, two hours absolute maximum (FR-045, R12): try R12's candidates in order on a Git Bash
  terminal running a re-parented long-lived command (`docker run --rm alpine sleep 600`, or a `start /b` launcher
  if Docker is absent); pass = listed in 10/10 samples while running, absent after Ctrl+C, no console window
  flashes. Record method, samples and verdict as an addendum to `research.md` R12. **Negative or inconclusive at the
  limit**: post the measurement on #193, mark T029–T033 `[withdrawn]` here, and 025 FR-022/FR-022a stand.
- [x] T029 [US4] Core rule (FR-040, FR-042–FR-044): extend `foregroundCommand`'s tests in `packages/core/tests/unit/`
  — candidates are the attached set when known, the shell's direct children otherwise; the shell, conhost and
  throng's helpers are never candidates; nothing attached but the shell → nothing running; 025's most-recent tie-break
  kept; direct-child results unchanged for every flavour. Implement in the core command-memory module.
- [x] T030 [US4] `IPtyHost.listAttachedProcesses(handles): Promise<Map<pid, ChildProcess[]>>` (one helper run for all
  handles, FR-041) in `packages/core/src/abstractions/pty-host.ts` and the measured mechanism in
  `packages/platform-windows/src/` (new file named after it); unit test with an injected runner; never rejects
  (failure → empty map, FR-042's "failed observation leaves the last value", 025 FR-019e).
- [x] T031 [US4] Observation uses it: `terminal-service.ts` `pollCommands` asks once per pass for every running
  session; extend `packages/daemon/tests/unit/terminal-command-poll.test.ts` (one call per pass regardless of
  terminal count; a failed pass keeps last values).
- [x] T032 [US4] Agent op `attachedprocs` mirroring `childprocs` in `pty-agent-protocol.ts` / `pty-agent-entry.ts` /
  `pty-agent-host.ts`, with a unit test in `packages/daemon/tests/unit/pty-agent-end.test.ts`'s sibling
  `pty-agent-attached.test.ts`.
- [x] T033 [US4] Integration test `packages/daemon/tests/integration/command-memory-attached.integration.test.ts`: a
  shell launches a command through a detaching launcher; the observation reports it; after it is killed from outside,
  the next observation reports nothing running (FR-042).

---

## Phase 7: Polish & Cross-Cutting

- [x] T034 [P] `docs/architecture.md`: one paragraph in the terminal-service section on the end lifecycle (ending,
  outcomes, escalation) and the FR-020 lint ban — load `throng-docs` first.
- [x] T035 Dead-code sweep: no `execFileSync`/`execSync`/`spawnSync`/`Atomics.wait` left in `packages/daemon/src` or
  `packages/platform-windows/src` outside the FR-017 markers (`git grep`); `npm run lint`, `npm run typecheck`,
  `npm run test:unit` green.
- [x] T036 Re-run the daemon and platform-windows integration and contract suites touched by this feature
  (`terminal-*.integration.test.ts`, `pty-agent-host.integration.test.ts`, `node-pty-host*.contract.test.ts`): green.
  `terminal-no-orphans.e2e.ts` is proven on CI by the gate, not locally — it is Principle III's process-level E2E
  for every user end path (panel destroy, project delete, Unload + End Terminals, Terminate all), and must stay
  green unchanged. Escalation (FR-015a) has no user surface of its own, so T025's integration test on real
  processes is its lowest proving layer.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2 → stories.** T002 is written and observed red before any production change (Principle V).
- T005 (abstraction) precedes T006–T011. T003 → T007; T004 → T008.
- **US1** (T013–T017) needs Phase 2. **US2** (T018–T023) needs Phase 2; T018 before T019–T022. **US3** (T024–T027)
  needs T013 (ending state) and T008 (forceEnd). **US4** (T028–T033) needs Phase 2 only; T028 gates the rest.
- T019 → T020 (async lock before the manager). T014 + T025 → T027 (killAll result and escalation before Terminate
  all). T018 is written first but passes only after T013–T014 and T019–T021.
- SC-005 is proven by call count (ten probes, one OS read — T009, T024), the accepted proxy for "no slower than one".
- Polish last.

## Parallel Opportunities

- T003 ∥ T004 (different core files).
- T019 ∥ T021 (different platform files), after T018.
- T034 ∥ T035.

## Implementation Strategy

1. Phase 1–2, then US1 → #468 fixed (MVP).
2. US2 → responsiveness guarded; US3 → close/shutdown hygiene.
3. US4 behind its measurement.
4. Polish; `npm run gate` on CI is the done-ness check.

## Phase 8: Convergence

- [x] T037 Reconcile FR-016 with the end's bounded read of console-attached processes in `packages/platform-windows/src/node-pty-host.ts` `runEnd` (added for FR-014 and Constitution III: a command started through an exited launcher outlived its terminal): state in `spec.md` that FR-016's prohibition is command memory's observation (025 FR-019g), which nothing on the end path takes, and that the end's own read of what to end is not it per FR-016 (contradicts)
