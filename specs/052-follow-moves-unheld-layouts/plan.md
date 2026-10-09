# Implementation Plan: Follow Moves Into Unheld Layouts

**Branch**: `feature/S051-S052-I468-I190-I193-I397-I111-nonblocking-calls-follow-moves` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/052-follow-moves-unheld-layouts/spec.md` (3 user stories, FR-001 –
FR-013, SC-001 – SC-005, one clarification session). Refs #397, #111. Shares a branch and PR (#475) with spec 051.

## Summary

Every in-app move now reaches every layout, held or not, and a Replace onto an open file leaves one document per
path.

- **One trigger** (R1): the unheld-layout rewrite hangs off the in-app move callbacks' `moved`, the single point
  every route — rename, `files.move`, transfer, undo, redo, roll-back — already passes through. The
  `TransferService.afterMoves` hook goes.
- **An atomic rewrite** (R2, R3): a daemon RPC, `workspace.followMoves`, rewrites every unheld record in one
  synchronous transaction. Sub-workspace writers stop replacing the whole set and write per record, so neither
  side can put back a stale copy of the other's record (FR-005).
- **Held windows follow every panel** (R5): the renderer applies the same per-panel rule to every editor in its
  layout on `throng:files:moved`, mounted or not (FR-007).
- **Preview collision** (R6): 044 FR-012's rule is applied inside a saved layout.
- **#111** (R7): a clean replaced editor becomes a linked panel on the mover's document. A dirty one becomes a
  replaced document: buffer kept, Save As only. Undo returns both.

## Technical Context

**Language/Version**: TypeScript (repo toolchain), Node 24, Electron 44

**Primary Dependencies**: better-sqlite3 (synchronous transactions), React 19 renderer, Vitest. **No new
dependency.**

**Storage**: SQLite `workspace_layouts` and `sub_workspaces`. No migration: the one new field (`linkedTo`) is an
optional member of panel config JSON.

**Testing**:
- unit (core rule);
- integration in the daemon with real SQLite (atomicity, per-record writes, 50-record timing);
- integration in the UI with the real `createInAppMoveCallbacks` and coordinator (wiring, linked and replaced
  documents);
- component (`MovedPathSync`, the replaced notice);
- one E2E, `@extended @persistence`.

**Target Platform**: Windows 11. Nothing platform-specific.

**Project Type**: desktop application, npm-workspaces monorepo.

**Performance Goals**: `workspace.followMoves` over 50 records completes inside 051 FR-021's 100 ms service bound
(SC-005). A rename's explorer response is unchanged, because main does not await the walk.

**Constraints**:
- 006 FR-011a: one buffer per path.
- 019 FR-001 – FR-009.
- 024 FR-006 – FR-010a.
- 044 FR-012, FR-013c, FR-109.
- 050 FR-016, FR-017 – FR-018b, FR-035.
- One condition, one notice.

**Scale/Scope**:
- `packages/core`: `moved-paths.ts` collision rule; panel config `linkedTo`.
- `packages/persistence`: per-record sub-workspace upsert and delete.
- `packages/ipc-contract` and `packages/daemon`: the three RPCs.
- `packages/ui` main: `in-app-moves.ts`, `moved-layout-walk.ts`, `transfer-service.ts`, `preview-purge.ts`,
  `editor-coordinator.ts`, `main.ts`.
- `packages/ui` renderer: `MovedPathSync`, `subworkspace-window-client.ts`, `detach-context.tsx`, the editor mount
  and its notice.
- Tests.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.*

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, satisfied.** A move crossing projects keeps 050 FR-035's moved-out mark in saved layouts too; no project reads another's layout except through the daemon walk, which already owns them all. |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** The rewrite and collision rules are pure core; the daemon applies them; nothing touches the OS. |
| **III. Detached, Tagged & Persistent Terminals** | **Not engaged.** |
| **IV. Native Terminal Support** | **Not engaged.** No binding. |
| **V. Test-First (NON-NEGOTIABLE)** | **Engaged.** #111 and #397 each start with a failing test at the lowest layer that shows them (R9); one E2E only, for the restart a lower layer cannot show. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged, satisfied.** Moves are silent, as 019 FR-003 requires; the replaced state is one inline notice carrying its two actions. |
| **VII. Change Review & Approval** | **Not engaged.** |
| **VIII. SOLID, DRY & YAGNI** | **Engaged.** One trigger replaces two; one per-panel rule serves the daemon walk and the renderer; per-record writes replace five copies of load-all/persist-all. |
| **IX. DI & Composition Root** | **Engaged, satisfied.** The walk's `held` and daemon call are injected into the in-app move callbacks in `main.ts`, as today. |
| **X. Externalised Configuration** | **Not engaged.** No setting. |
| **XI. Dockable Workspace** | **Engaged, satisfied.** A linked panel is an ordinary panel showing a shared document; closing either never closes the other. |
| **XII. Responsive UI (NON-NEGOTIABLE)** | **Engaged, satisfied.** The walk is not awaited by the move; its daemon cost is bounded and measured (SC-005). |

*Post-design re-check (after Phase 1)*: unchanged. The linked panel is the one new concept; it adds no binding,
no setting and no second notice.

### Development Workflow & Quality Gates

- Test-first per task, lowest layer per R9. `npm run gate` on CI is the done-ness check.
- `docs/architecture.md`'s persistence section gains a sentence on the follow-moves walk and per-record
  sub-workspace writes (throng-docs owns the wording). No binding, setting or `THRONG_*` variable is added.
- The new E2E counts against `e2e-budget.json` (`@extended`), re-seeded in the same commit.

## Project Structure

### Documentation (this feature)

```text
specs/052-follow-moves-unheld-layouts/
├── plan.md              # This file
├── research.md          # Phase 0 — R1–R9
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── workspace-rpc.md     # followMoves, saveSubWorkspace, deleteSubWorkspaces
│   └── editor-replace.md    # linked and replaced documents (#111)
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/core/src/workspace/moved-paths.ts         # R6 collision rule in moveLayoutTabs
packages/core/src/workspace/<panel config types>   # linkedTo
packages/persistence/src/workspace-repository.ts   # saveSubWorkspace, deleteSubWorkspaces, transaction helper
packages/ipc-contract/src/workspace.ts             # three method constants + shapes
packages/daemon/src/workspace-service.ts           # followMoves, saveSubWorkspace, deleteSubWorkspaces
packages/ui/src/main/in-app-moves.ts               # layouts.followMoves as the last consumer
packages/ui/src/main/moved-layout-walk.ts          # held + one RPC
packages/ui/src/main/transfer-service.ts           # afterMoves removed
packages/ui/src/main/preview-purge.ts              # per-record writes
packages/ui/src/main/editor-coordinator.ts         # links, replaced state, fan-out, destroy hand-over
packages/ui/src/main/main.ts                       # wiring
packages/ui/src/renderer/editor/moved-path-sync.tsx        # every editor panel follows; linkedTo
packages/ui/src/renderer/editor/<editor mount + notice>    # linked attach, replaced notice
packages/ui/src/renderer/state/subworkspace-window-client.ts
packages/ui/src/renderer/workspace/detach-context.tsx

tests (new or extended):
packages/core/tests/unit/moved-paths.test.ts
packages/daemon/tests/integration/workspace-follow-moves.integration.test.ts
packages/ui/tests/integration/in-app-moves-follow-layouts.integration.test.ts
packages/ui/tests/integration/editor-one-buffer.integration.test.ts
packages/ui/tests/component/editor-moved-path.test.ts
packages/ui/tests/component/editor-replaced-notice.test.tsx
packages/ui/tests/e2e/subworkspace-rename-follow.e2e.ts
```

**Structure Decision**: the existing monorepo layout; no new package.

## Complexity Tracking

None. The project-switch race (R4) is closed by a scoped follow after an in-flight save, not accepted.
