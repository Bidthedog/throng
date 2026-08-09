# Phase 0 Research: Failure-Path Integrity

**Feature**: 029 | **Date**: 2026-08-07

Every unknown here was resolved by reading the code, not by reasoning about it. Where a finding
contradicts what the spec assumed, that is called out — the spec wins on *what* must happen, the code
wins on *what is there to work with*.

---

## R1 — Is there a connection whose loss signals a dead daemon? (FR-006a)

**Decision**: Yes. `DaemonEvents` (`packages/ui/src/main/daemon-events.ts:22`) holds ONE long-lived
socket, subscribed to `terminal.subscribe`, for the life of the app. FR-006a is implementable exactly
as specified, with no polling.

**Rationale**: This was the riskiest assumption in the spec, because the obvious candidate does not
work. `DaemonClient` (`daemon-client.ts:46`) opens a **fresh socket per call** — `connect()` inside
both `call()` and `getStatus()` — so there is no persistent RPC connection to watch. Had that been
the only channel, FR-006a would have been unimplementable and the spec would have needed reopening.

`DaemonEvents` is the channel that matters, and it already has the exact hook: `socket.on('close')`
at `:57`, which today schedules a silent reconnect 500ms later and loops forever. **That silent loop
is precisely why the application looks alive while being dead** — the mechanism for noticing already
exists and its only observer is a `setTimeout`.

**Alternatives considered**:

- *Poll `health.ping` on an interval* — rejected by clarification Q8. Costs a round trip forever to
  detect something rare, and the interval is a number that needs re-guessing on slower machines.
- *Watch the daemon's OS process by pid* — rejected. The pid is knowable (`health.ping` returns it),
  but a process handle says nothing about whether the pipe still serves, and it would not survive the
  daemon being replaced by a legitimate restart.

**Consequence for the design**: a close event alone is NOT sufficient evidence of death, because the
socket also closes on a legitimate daemon restart. The state machine must distinguish them — see
`data-model.md` § Daemon state.

---

## R2 — Where does the raw errno enter the user-facing path? (FR-011)

**Decision**: One function, `message()` at `packages/ui/src/main/files-service.ts:403`, reached from
seven `catch` blocks (`:110`, `:166`, `:215`, `:241`, `:344`, `:360`, `:375`). It returns
`e instanceof Error ? e.message : String(e)` — the unmodified Node message.

**Rationale**: A single choke point is the best possible finding here. Classification can be
introduced at one seam rather than seven, and every call site keeps its existing shape.

**Also found**: `within()` (`files-service.ts:395`) calls `this.fs.realpath(this.root)`, which is the
source of #181's measured `ENOENT: no such file or directory, realpath '<root>'`. It runs on `list()`
before anything else, so a missing project root fails there first — confirming the trace posted to
#181 and refuting that issue's claim about `projects.setActive`.

**Alternatives considered**: classifying inside each `catch` — rejected as seven places to keep in
step, which is how the second errno gets missed.

---

## R3 — What does a terminal start failure look like at the seam? (FR-001, FR-003)

**Decision**: `terminal-panel.tsx:489` — `const onError = useCallback((message: string) => end(message, null, true), [end])`.
`end()` finishes with `ws.clearPanelType(panel.id)` (`:465`). That one line is the whole of #204.

`onError` is fired from two places in `use-terminal.ts`: `:998` (`res.error.message` — a structured
failure from the attach RPC) and `:1088` (a thrown attach error). Both currently collapse to a bare
string, which is why the panel cannot tell a missing folder from a missing flavour.

**Rationale**: FR-003 requires distinguishing *transient environmental* from *configuration that can
no longer be satisfied*. That distinction has to survive the trip from the daemon to the panel, and a
`string` cannot carry it — so the failure needs a cause, which is the same cause abstraction FR-011a
defines for file operations. **One concept serves both**, which is the strongest argument for putting
it in `@throng/core` rather than in either consumer.

**Also found**: `clearPanelType` (`packages/core/src/panel-type/assignment.ts:92`) deliberately
preserves `terminalMemory` while dropping `kind` and `config` — confirming the measurement that the
configuration survives and only the type is lost.

**Also found — the reconciliation FR-003 demands is already asserted**:
`packages/ui/tests/e2e/terminal-persistence.e2e.ts:81` requires a panel restored with a missing
flavour to revert. That is the "configuration that can no longer be satisfied" arm, and it must stay
green.

---

## R4 — Can a notice carry a cause, a subject and a demoted raw error? (FR-016 → FR-019e)

**Decision**: Yes, without extending the notification model. `Notice`
(`packages/ui/src/renderer/common/notification.tsx`) already carries `severity`, `title`, `message`,
`testId` and an action, and `useErrorNotice(error, testId, clearError, errorAction)` is the shared
raiser used by the explorer (`file-tree.tsx:131`), the projects panel (`projects-panel.tsx:133`) and
sub-workspaces (`subworkspaces-panel.tsx:52`).

**Rationale**: `title` is the natural home for the cause's sentence and `message` for the subject
detail, which means FR-018's copy payload (already proven by `notice-stacking.e2e.ts:62`) picks up
both plus the demoted raw text with no new control — satisfying FR-018a's "no new surface".

**Consequence**: FR-019's suppression belongs in the notification model itself, not in each raiser.
Three call sites raise these notices today; putting the rule in one of them would leave the other two
free to double-report.

---

## R5 — Which test layers exist? (constitutional Principle V)

**Decision**: Four — `unit`, `integration` and `contract` vitest projects (`vitest.config.ts`), plus
Playwright E2E. **There is no component-test stack**, so no task may call for one.

**Rationale**: Tasks written against a layer the repo does not have are discovered as lies at
implementation time. Measured baseline for this branch: unit 207 files / 1688 tests, integration 70 /
371, contract 17 / 62.

**Consequence for task shaping**:

| Concern | Layer |
|---|---|
| Errno → cause mapping, cause → message | **unit** (pure, in `@throng/core`) |
| Suppression while a notice is live | **unit** (pure reducer over notice state) |
| Holder identification against a real held folder | **integration** (spawns a real holder) |
| Daemon-state transitions on socket close/reopen | **integration** (real daemon, real pipe) |
| The four user-visible journeys | **E2E** — already written, red, and must not be weakened (SC-007) |

---

## R6 — Is holder identification viable on Windows? (FR-012, the deferred spike)

**Decision**: **Deliver classification (FR-011) first and treat holder identification as a separate,
later deliverable.** Ship FR-012's "could not identify which" branch as the initial behaviour, with
one exception that needs no OS work at all — see below.

**Rationale**: Naming a third-party holder needs the Restart Manager (`RmStartSession` / `RmGetList`)
or `NtQuerySystemInformation` handle enumeration. Neither is reachable from Node without a native
addon or FFI, and the repo has deliberately avoided both — `WindowsDirectoryLock`'s docblock
(`windows-directory-lock.ts:18`) states "Pure Node (no native addon / no FFI)" as a design property.
Introducing one for a *message improvement* would be the largest architectural change in this feature
and the least valuable.

**The exception that makes FR-013 shippable anyway**: throng does not need the OS to identify its
OWN holders. The daemon already knows every terminal it launched and keys them by panel id
(`terminal-service.ts:422`), and it knows each one's working directory (`lastCwd` is tracked
continuously for FR-027). So "is a throng terminal sitting in this folder?" is answerable from
throng's own state, by prefix-matching the failed path against the known cwds — no OS API, no addon.

**This inverts the issue's assumption.** #196 treats naming throng as the harder case and a
third-party as the achievable one. It is the other way round: **the throng case is free and the
third-party case is expensive** — and the throng case is also the one a user hits most, since their
own terminal is usually what is holding the folder.

**Alternatives considered**:

- *Native addon for Restart Manager* — rejected for this feature; it contradicts a stated design
  property for a message improvement.
- *Shell out to `handle.exe` / `openfiles`* — rejected. Sysinternals is not installed by default and
  `openfiles` needs a system-wide flag and a reboot.
- *`tasklist /m` heuristics* — rejected; it reports loaded modules, not directory handles.

---

## R7 — What already guards the behaviour this feature changes?

Read before writing anything, so no fix is declared by breaking a neighbour:

| Spec | Asserts | Effect on 029 |
|---|---|---|
| `terminal-revert.e2e.ts` | a shell that runs then EXITS reverts to the form | FR-002 — must stay green |
| `terminal-slow-start.e2e.ts:32` | a slow start shows "still starting" + retry, does NOT revert | the surface FR-004 reuses |
| `terminal-persistence.e2e.ts:81` | a missing FLAVOUR reverts, deliberately | FR-003's second arm — must stay green |
| `terminal-de-elevation-hang.e2e.ts` | an elevated→non-elevated start fails visibly | `@admin`, CI-only |
| `notice-stacking.e2e.ts` | two DIFFERENT failures are two notices | FR-019 must not collapse unrelated causes |

The last is the sharpest constraint: FR-019 suppresses failures **sharing a cause**, and
`notice-stacking` proves two *different* failures must still stack. FR-019b already says so; this is
the test that will catch it if the implementation keys on the wrong thing.
