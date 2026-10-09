# Implementation Plan: The Terminal Service Never Stops Answering

**Branch**: `feature/S051-S052-I468-I190-I193-I397-I111-nonblocking-calls-follow-moves` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/051-nonblocking-process-calls/spec.md` (4 user stories, FR-001–FR-045,
SC-001–SC-007, two clarification sessions). Refs #468, #190, #193. Shares a branch and PR (#475) with spec 052.

## Summary

The daemon stops answering whenever it asks Windows about processes, because those questions are synchronous. This
feature makes every such question awaited, gives every end a definite outcome, and guards both with tests:

- **Ends become awaited outcomes** (R2, R4): `IPtyHost.kill(): void` becomes `end(handle, timeoutMs): Promise<void>`
  over async `taskkill`, settling on the observed exit. `terminal.kill` acknowledges at once; `terminal.killAll`
  resolves with `{ killed, failed }` while the daemon keeps serving — which is all #468 needs.
- **An ending terminal** (R4) is not reattached; a failed or timed-out end makes it an ordinary running terminal
  again, and Unload's one notice says so. A superseded end that fails is escalated rather than orphaned.
- **One time limit** (R3): `TERMINAL_END_TIMEOUT_MS = 5000`, declared once and injected into the terminal service.
- **No synchronous call while serving** (R5–R7, R9): conhost attribution moves to the async process table; the cwd
  read uses koffi `.async`; the root lock drops its busy-wait; the synchronous `listChildPids` leaves the interface.
- **Shutdown escalates** (R8): a failed end at daemon shutdown, agent shutdown or app-close Terminate all becomes a
  forced kill of the whole tree by individual pid, with survivors logged.
- **Guards** (R10, R11): an ESLint ban on synchronous process calls in the daemon and platform layer, proven live by
  a unit test; a daemon integration test for responsiveness under ends, starts and busy checks; a daemon
  integration test reproducing #468.
- **#193** (R12) is a gated phase: a two-hour measurement first, then attached-process observation, or withdrawal.

## Technical Context

**Language/Version**: TypeScript (repo toolchain), Node 24, Electron 44

**Primary Dependencies**: node-pty (ConPTY), koffi (FFI, `.async` calls), Node `child_process.execFile`, ESLint flat
config, Vitest. **No new dependency.**

**Storage**: N/A — no persistence, schema or migration change.

**Testing**: unit (pure rules, hosts with injected `execFile`, ESLint `lintText` guard), integration `osSerial`
(daemon with the real `NodePtyHost`: responsiveness, #468, escalation), contract (`IPtyHost` against
`NodePtyHost`), component (Unload notice text). Existing E2E `terminal-no-orphans.e2e.ts` must stay green; no new
E2E (R11).

**Target Platform**: Windows 11. Every change sits behind `IPtyHost` / `IProcessCwd` / the lock abstraction, so
another platform supplies its own non-waiting equivalents (Principle II).

**Project Type**: desktop application, npm-workspaces monorepo.

**Performance Goals**: no daemon RPC waits more than 100 ms locally (500 ms on CI) while terminals end, start or are
checked for busy (FR-021, SC-002, SC-003); a switch after Unload answers within 1 s (FR-022, SC-001); busy decisions
for ten terminals cost one OS call (SC-005).

**Constraints**: Principle III (no orphaned process on any end path, conhost included); 005 FR-017 (user-initiated
exits stay user-initiated); 025 FR-019a/b/e (shared, non-blocking, failure keeps last value); 046 (busy fail-safe,
Unload's single notice).

**Scale/Scope**: `packages/core` (pty-host abstraction, end-timeout constant, conhost-assignment and
escalation-target rules), `packages/platform-windows` (`node-pty-host.ts`, `windows-directory-lock.ts`,
`windows-process-cwd.ts`, `windows-elevation.ts` marker), `packages/daemon` (`terminal-service.ts`,
`terminal-lock-manager.ts`, `pty-agent-*`, `main.ts`, `composition-root.ts`, `reap-orphans.ts` marker),
`packages/ui` (main `terminal-ipc.ts` + app-close Terminate all, renderer `unload-project.ts`), `eslint.config.js`,
tests. US4 adds a helper and a core rule change if its measurement passes.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Not engaged.** No project boundary moves. |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** `end`/`forceEnd` are `IPtyHost` methods; the conhost-assignment and escalation-target rules are pure core functions; every Win32 and `taskkill` call stays in `platform-windows`. |
| **III. Detached, Tagged & Persistent Terminals** | **Engaged — the high-risk row.** Every end path keeps reaping shell, command and conhost; the end-before-attribution gap closes (FR-014); shutdown escalates (FR-015a); a superseded end that fails is escalated rather than orphaned (R4). Verified by integration tests on process counts plus the existing process-level E2E. |
| **IV. Native Terminal Support** | **Engaged, satisfied.** No binding; FR-044 keeps every flavour's command memory as today. |
| **V. Test-First (NON-NEGOTIABLE)** | **Engaged.** #468 starts with an integration reproduction observed failing (FR-022). Every task opens with a failing test at the lowest layer that can show it (R11). No E2E is added. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged, satisfied.** No new UI; one sentence added to Unload's existing notice. |
| **VII. Change Review & Approval** | **Not engaged.** |
| **VIII. SOLID, DRY & YAGNI** | **Engaged.** One `end` primitive replaces six kill call sites' bespoke handling; the synchronous `listChildPids` is deleted rather than kept beside `probeChildPids`. |
| **IX. DI & Composition Root** | **Engaged, satisfied.** The end limit reaches `TerminalService` through its injected settings in `composition-root.ts`; no new container. |
| **X. Externalised Configuration** | **Engaged — see Complexity Tracking.** The 5 s end limit is a constant by clarification (FR-013a), injected, not a user setting. |
| **XI. Dockable Workspace** | **Engaged, satisfied.** A terminal's end never removes its Panel; a reload during an end gives the Panel a fresh terminal (FR-004). |
| **XII. Responsive UI (NON-NEGOTIABLE)** | **Engaged — this feature is its daemon-side counterpart.** The renderer waits on the daemon for every keystroke echo; FR-021 measures it. |

*Post-design re-check (after Phase 1)*: unchanged. The contracts add no UI, no setting and no persistence; the
escalation path is the only new process-killing code and it is integration-tested against real processes.

### Development Workflow & Quality Gates

- Test-first per task; lowest layer per R11. `npm run gate` on CI is the done-ness check.
- Integration and contract layers run single-fork (`osSerial`) — node-pty's AttachConsole failures under concurrency.
- `docs/architecture.md`'s terminal-service section gains one paragraph on the end lifecycle and the lint ban
  (throng-docs owns the wording). No new binding, setting or `THRONG_*` variable, so the docs-currency test is unaffected.

## Project Structure

### Documentation (this feature)

```text
specs/051-nonblocking-process-calls/
├── plan.md              # This file
├── research.md          # Phase 0 — R1–R14
├── data-model.md        # Phase 1 — session end state, outcomes
├── quickstart.md        # Phase 1 — how to see it working
├── contracts/
│   ├── pty-host.md          # IPtyHost changes
│   ├── terminal-rpc.md      # terminal.kill / killAll / shutdown semantics
│   └── pty-agent-protocol.md # agent end + batch ops
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/
├── abstractions/pty-host.ts          # end(), forceEnd(), probeChildPids required, listChildPids removed
├── config/terminal-limits.ts         # TERMINAL_END_TIMEOUT_MS (new)
└── terminal/
    ├── conhost-assignment.ts         # pure: newest-N unclaimed → pending, in spawn order (new, moved from host)
    └── escalation-targets.ts         # pure: descendant tree by ppid + conhost (new)

packages/platform-windows/src/
├── node-pty-host.ts                  # async taskkill, async attribution, end/forceEnd, async dispose
├── windows-directory-lock.ts         # async acquire/release, no Atomics.wait
├── windows-process-cwd.ts            # koffi .async
└── windows-elevation.ts              # FR-017 marker only

packages/daemon/src/
├── terminal-service.ts               # ending state, outcomes, killAll {killed, failed}, async shutdown
├── terminal-lock-manager.ts          # async acquire/release
├── pty-agent-host.ts / pty-agent-entry.ts / pty-agent-protocol.ts   # end with reply, forceEnd, async shutdown
├── reap-orphans.ts                   # FR-017 marker only
├── composition-root.ts               # inject endTimeoutMs
└── main.ts                           # await shutdown

packages/ui/src/
├── main/terminal-ipc.ts              # killAll result + escalate flag
├── main/main.ts                      # Terminate all → killAll {escalate}, killAll timeout
└── renderer/sidebar/unload-project.ts # failed ends in the one notice

eslint.config.js                      # FR-020 ban

tests (new):
packages/core/tests/unit/conhost-assignment.test.ts
packages/core/tests/unit/escalation-targets.test.ts
packages/platform-windows/tests/unit/node-pty-host-end.test.ts
packages/platform-windows/tests/unit/directory-lock-async.test.ts
packages/platform-windows/tests/unit/process-cwd-async.test.ts
packages/daemon/tests/unit/terminal-end-outcomes.test.ts
packages/daemon/tests/unit/blocking-process-ban.test.ts
packages/daemon/tests/integration/terminal-responsiveness.integration.test.ts   # FR-021
packages/daemon/tests/integration/unload-then-switch.integration.test.ts        # FR-022 (#468)
packages/daemon/tests/integration/terminal-shutdown-escalation.integration.test.ts
packages/ui/tests/component/unload-failed-ends.test.ts
```

**Structure Decision**: the existing monorepo layout; no new package. The two new core files hold the only new
decisions (which conhost is whose, which pids to force-end) so they are unit-testable without Windows.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| End time limit is a constant, not a user setting (Principle X) | FR-013a, by clarification: one place to change it, not a preference | A user setting adds a descriptor, docs and an inert-settings guard entry for a value no user should tune; it is still injected, so tests substitute it |
