# Implementation Plan: Failure-Path Integrity

**Branch**: `feature/S029-failure-path-replications` | **Date**: 2026-08-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/029-failure-path-integrity/spec.md`

## Summary

Four v1.0.0 bugs are one defect: a failure deep in the stack reaches the user as whatever raw string
was thrown, and on one path it deletes their panel configuration on the way out.

The approach is a single **`FailureCause`** concept in `@throng/core`, derived from a raw error and
never replacing it. One classifier serves all four bugs, because they are the same shape: a terminal
that cannot start needs the cause to decide whether to keep its panel type (FR-003), a blocked rename
needs it to say what is holding the file (FR-011), a missing project root needs it to name the folder
(FR-015), and a dead daemon needs it to be reported once rather than as a series of unrelated errors
(FR-007). The cause also owns the message wording (FR-019e) and supplies the suppression key
(FR-019), so the same object solves the copy and the de-duplication.

Daemon liveness rides on a connection that **already exists** — `DaemonEvents` holds one long-lived
subscribed socket and already handles its `close`. Today that close silently retries forever, which is
exactly why the app looks alive while being dead. Making that loop observable is the whole of #182.

## Technical Context

**Language/Version**: TypeScript 5.x, ES2022 modules, Node 22 / Electron 43

**Primary Dependencies**: Electron, React 19, InversifyJS (DI), better-sqlite3, node-pty, xterm.js

**Storage**: SQLite via `@throng/persistence` (daemon is the single writer); JSON config under the
instance config root

**Testing**: vitest projects `unit` / `integration` / `contract`; Playwright for E2E.
**No component-test stack** — no task may assume one.

**Target Platform**: Windows 11 primary; the platform seam admits others and must not break their build

**Project Type**: Desktop application — Electron main + renderer, plus a detached daemon process

**Performance Goals**: Daemon loss surfaced within **2 seconds** (SC-002). No polling introduced —
the detection is event-driven, so steady-state cost is zero.

**Constraints**: No native addons and no FFI (`windows-directory-lock.ts:18` states this as a design
property). Notice surface must not gain new controls (FR-018a). Third-party holder identification is
therefore out of initial scope — see Complexity Tracking.

**Scale/Scope**: 43 functional requirements, 4 user stories, 5 packages touched, 4 existing E2E specs
that must go green without weakening.

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1.*

| Principle | Gate | Status |
|---|---|---|
| **I. Project-First Context Isolation** | No change to project scoping. The overlap guard (no nested roots) is *relied on* by R6 — it is why the daemon's own directory lock can never be the #196 repro | ✅ |
| **II. Platform-Abstracted Core (OS-Agnostic)** | `classifyFailure` is pure and OS-agnostic; errno strings are data, not platform calls. Holder identification sits behind the existing `packages/platform-windows` seam and returns "unidentified" elsewhere (FR-014) | ✅ |
| **III. Detached, Tagged & Persistent Terminals** | FR-002 preserves revert-on-exit unchanged. Surfacing an *unexpected* exit with its code is unchanged; only a **launch** failure is re-routed | ✅ |
| **IV. Native Terminal Support & Auto-Detection** | Untouched. FR-003's second arm explicitly preserves revert-on-missing-flavour | ✅ |
| **V. Test-First Quality Discipline (NON-NEGOTIABLE)** | The four E2E specs were written **before** this spec and are red. Unit tests precede each pure function. SC-007 forbids declaring a fix by weakening a test | ✅ |
| **VI. Simple, Modern, Discoverable UX** | Every new control is an icon with a hover title (FR-004b, FR-009b). No new notice surface (FR-018a). **Every new panel action gets its menu item in this increment** — FR-004d, required because FR-004a makes clearing a panel user-invoked for the first time (constitution line 1075). The items attach to the panel-root context menu, whose `onContextMenu` sits on a div rendered in EVERY state (`terminal-panel.tsx:539`) — the start-failure overlay renders *alongside* it, not instead of it, so the menu is reachable exactly when Retry and Clear are needed. **Daemon restart is reachable only from the status bar** — deliberate (FR-009a), and safe only because the status bar renders unconditionally with no global hide toggle (`editor.showStatusBar` / `terminals.showStatusBar` are per-panel and unrelated). The panel-menu rule at `:1060` is scoped to commands acting on a Panel, so it does not literally reach an app-level restart — the no-global-hide fact is belt-and-braces, not the load-bearing argument | ✅ |
| **VII. Change Review & Approval** | Untouched. This feature adds no file mutation and no review surface; the project-scoped edit list is not read or written | ✅ |
| **VIII. SOLID / DRY / YAGNI** | One cause concept for four bugs rather than four classifiers. Third-party holder lookup deferred rather than speculatively built | ✅ |
| **IX. Dependency Injection & Composition Root** | Daemon-state supervision and holder resolution are registered in the composition root, injected, never imported ad hoc | ✅ |
| **X. Externalised Configuration** | No new config keys and no preference surface. `DAEMON_GRACE_MS` is a hardcoded timeout, which Principle X names explicitly — see Complexity Tracking for the exemption | ⚠️ justified |
| **XI. Dockable Workspace** | FR-013a reads the sub-workspace window title; it does not change docking behaviour | ✅ |
| **UI changes ship with E2E** | All four journeys are covered by existing red specs | ✅ |
| **Artifacts & temp files cleaned up** | Tests self-clean via `cleanupTemp`; the holder fixture kills its process in `finally` | ✅ |

One principle passes with a justified exemption (X) and one deliberate scope reduction is recorded.
Both are in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/029-failure-path-integrity/
├── plan.md              # This file
├── spec.md              # 43 requirements, 13 clarifications
├── research.md          # Phase 0 — the four seams, resolved against the code
├── data-model.md        # FailureCause, Holder, DaemonState
├── quickstart.md        # How to validate, fastest signal first
├── contracts/
│   └── failure-cause.md # Core API, IPC channels, changed surfaces
├── checklists/
│   └── requirements.md  # 16/16
└── tasks.md             # /speckit-tasks output — not created here
```

### Source Code

```text
packages/core/src/
├── failure/                        # NEW — the shared concept
│   ├── cause.ts                    #   classifyFailure, causeMessage, causeKey
│   ├── daemon-state.ts             #   nextDaemonState, DAEMON_GRACE_MS
│   └── index.ts
└── index.ts                        # re-exports

packages/platform-windows/src/
└── holder-lookup.ts                # NEW — seam; returns "unidentified" initially (FR-012/014)

packages/daemon/src/
└── terminal-service.ts             # expose known terminal cwds for throng-holder resolution

packages/ui/src/main/
├── daemon-events.ts                # observe close/reconnect → drive DaemonState
├── daemon-supervisor.ts            # NEW — owns DaemonState, broadcasts it, handles restart
├── files-service.ts                # message() → classified cause (ONE seam; 7 of the 10 catch
│                                   #   blocks reach it — the other 3 already handle their own)
├── panel-identity.ts               # NEW — panel id → title/window, published by the renderer (contract §2b)
└── main.ts                         # register the new IPC channels

packages/ui/src/preload/preload.cts       # expose the two new daemon channels
packages/ui/src/renderer/global.d.ts      # …and their renderer types

packages/ui/src/renderer/
├── common/notification.tsx         # raises the suppression rule (FR-019, FR-019c)
├── common/notice-suppression.ts    # NEW — the rule itself, pure so it unit-tests without a DOM
├── statusbar/status-bar.tsx        # daemon indicator that IS the restart control
├── state/projects-store.tsx        # attribute a failed project action to the daemon (FR-010)
├── explorer/file-tree.tsx          # …and the explorer's own failures, same rule
└── terminal/
    ├── use-terminal.ts             # carry a cause, not a bare string
    └── terminal-panel.tsx          # FR-003 split; failure state with retry + clear; menu items (FR-004d)

packages/*/tests/{unit,integration,contract}/   # per research.md R5
packages/ui/tests/e2e/                          # four replication specs (written, red) + two NEW
                                                #   new-UI specs (T021a, T031a)
```

**Structure Decision**: The existing monorepo layout is used unchanged. The one new directory is
`packages/core/src/failure/`, placed there because three packages consume it — the daemon classifies,
main classifies and reports, the renderer renders. Putting it in either consumer would force the
other two to import across a boundary the architecture does not have.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **`DAEMON_GRACE_MS` is a hardcoded timeout** — Principle X names timeouts among the values that "MUST NOT be hardcoded in business logic" | It is an **internal protocol constant, not a machine-specific setting**. Its value is derived from another constant in the same subsystem — the 500ms reconnect at `daemon-events.ts:59` — so exposing it would let a user set a grace shorter than one reconnect attempt and manufacture the very false alarm the `reconnecting` state exists to prevent. Precedent: `AUTO_DISMISS_MS` in `notification.tsx` is a stated, tested constant governing internal timing, deliberately not a preference | Injecting it through the typed settings abstraction was considered and rejected. Principle X exists so a user can change what is *theirs* to change; this value is not — it is a consequence of the reconnect interval, and the two must move together or the state machine is wrong. A settings key would imply an independence that does not exist |
| **FR-012 ships in reduced form** — third-party holders are reported as "could not identify which" rather than named | Naming them needs the Windows Restart Manager or handle enumeration, both requiring a native addon or FFI. `windows-directory-lock.ts:18` states "Pure Node (no native addon / no FFI)" as a design property, and breaking it for a *message improvement* would be the largest architectural change in the feature and the least valuable | Shelling out to Sysinternals `handle.exe` (not installed by default), `openfiles` (needs a system-wide flag and a reboot) and `tasklist /m` (reports loaded modules, not directory handles) were all considered and none answers the question. **The valuable half ships anyway**: throng's own holders resolve from throng's own state with no OS call at all, and that is both the cheaper case and the commoner one — which inverts what #196 assumes |

**Tracked deferral**: filed as #210, referencing #133 — it records why the seam returns "not identified" rather than being absent, and what implementing it involves
(the in-app lock manager), which needs the same machinery and can justify the addon on its own merits.
