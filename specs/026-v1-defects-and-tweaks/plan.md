# Implementation Plan: v1.0.0 Defects & Tweaks

**Branch**: `feature/S026-v1-defects-and-tweaks` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/026-v1-defects-and-tweaks/spec.md`

## Summary

Six independent v1.0.0 defects, each already replicated by a committed test. The work is six small,
separable changes — no shared abstraction, no migration, no new subsystem. Two carry real
data-integrity weight (#161's stale-buffer-over-unreadable-path, #186's tree that lies while the
machine is busy); the rest are correctness and polish.

The technical approach is unusually well-constrained because the tests came first: **29 committed
tests are the acceptance surface**, 16 red and 13 green. Phase 0 measurement then removed the largest
piece of anticipated work — #194 needs no two-step NTFS rename, only a corrected guard (see
[research.md](./research.md) R1/R2).

## Technical Context

**Language/Version**: TypeScript 5.9, ES2022 modules, Node (Electron-bundled) in main; React 18 in renderer

**Primary Dependencies**: Electron 40+, React 18, CodeMirror 6 (editor), xterm 6 (terminal),
react-arborist (file tree), better-sqlite3 (daemon store)

**Storage**: SQLite via the daemon for projects/layout/documents; per-project renderer `localStorage`
for explorer expansion + selection; JSON config files under the config root

**Testing**: Vitest projects `unit` / `integration` / `contract`; Playwright + Electron for E2E. No
component-test stack exists and none is introduced.

**Target Platform**: Windows 11 (the only shipped platform); OS specifics stay behind the existing
platform seam

**Project Type**: Desktop application, npm-workspaces monorepo (`packages/core`, `ui`, `daemon`,
`persistence`, `platform-windows`, `ipc-contract`)

**Performance Goals**: A filesystem change is reported within **1 second** under continuous churn
(FR-006/SC-002), while a 40-change burst still produces **fewer than 10** refreshes (FR-007/SC-003)

**Constraints**: No change to terminal link routing (FR-032, #198 deferred); Revert keeps its FR-075
semantics; the 13 green fence tests must stay green

**Scale/Scope**: 6 issues · 38 functional requirements · ~8 source files · 9 test files already written

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1. Both passes below.*

| Principle | Assessment |
|---|---|
| **II. Platform-Abstracted Core** | **Pass, and improved.** R1 removes the anticipated platform-specific rename. The one new OS-facing behaviour (watch retry) stays inside `NodeFileWatcher`, behind the existing `IFileWatcher` seam. `packages/core` gains no OS knowledge. |
| **V. Test-First (NON-NEGOTIABLE)** | **Pass, unusually strongly.** All 16 failing tests exist and were observed failing *for the reported reason* before any implementation. Red is already established and recorded per file. New behaviour discovered during Phase 1 (delete rollback, diagnostics) gets its own Red step first. |
| **V. E2E for every user-facing change** | **Pass.** #161, #166, #197 and the #186 delete path are renderer changes and all have committed E2E. |
| **VI. Every panel action has a menu item** | **Pass, and binding.** `Reload from disk` is a new discrete panel command, so FR-018 puts it in the panel header menu beside Save/Revert **in the same increment** — exactly the rule's requirement for new work. |
| **VI. Hiding a bar must not remove the last route** | **Pass.** #166 removes only text the title bar already shows; it removes no command. The status bar carries no actions. |
| **VIII. SOLID / DRY / YAGNI** | **Pass.** #197's open-state migration reuses `drop`'s existing prefix logic rather than a second implementation. No speculative generality: the watcher gains a max-wait and a retry, not a scheduling framework. |
| **IX. Dependency Injection** | **Pass.** The new watcher failure signal is an injected callback on the existing seam, not a singleton or a global bus. |
| **X. Externalised Configuration** | **Pass.** The 1-second ceiling and retry policy are constructor parameters with defaults, consistent with `NodeFileWatcher`'s existing `debounceMs`. |

**No violations. No complexity deviations to justify.**

## Project Structure

### Documentation (this feature)

```text
specs/026-v1-defects-and-tweaks/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0 — 7 questions, all settled by measurement
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── file-watcher.md      # IFileWatcher gains an optional failure signal
│   └── editor-unloadable.md # document unloadable state + Reload from disk
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks output
```

### Source code (files this feature touches)

```text
packages/core/src/
├── explorer/naming.ts              # #194 — validateRename must not collide an item with itself
└── config/keybindings.ts           # #165 — WINDOWS_BINDINGS pane toggles

packages/ui/src/main/
├── files-service.ts                # #194 — self-rename guard before the exists probe
├── node-file-watcher.ts            # #186 — max wait, retry with backoff, failure signal, diagnostics
├── explorer-watcher.ts             # #186 — pass the failure signal through
├── main.ts                         # #186 — wire failure to a notice; #161 — recovery trigger
└── editor-coordinator.ts           # #161 — unloadable state, reloadFromDisk, retryUnloadable

packages/ui/src/renderer/
├── explorer/use-explorer-data.ts   # #186 delete reconcile+rollback; #197 open-state migration,
│                                   #   non-reporting restore reads, diagnostics
├── editor/editor-panel.tsx         # #161 — the unloadable banner
├── editor/editor-panel.css         # #161 — banner styling (themed tokens only)
├── editor/use-editor.ts            # #161 — reloadFromDisk action, save guard
├── workspace/panel-placeholder.tsx # #161 — "Reload from disk" menu item beside Revert
└── statusbar/status-bar.tsx        # #166 — strip the duplicated identity
```

### Tests (already committed; this feature turns 16 red → green)

```text
packages/core/tests/unit/pane-toggle-defaults.test.ts                    4 red
packages/ui/tests/unit/file-watcher-error-recovery.test.ts               1 red / 1 green
packages/ui/tests/integration/rename-case-only.integration.test.ts       3 red / 2 green
packages/ui/tests/integration/file-watcher-liveness.integration.test.ts  1 red / 1 green
packages/ui/tests/e2e/status-bar-deduped.e2e.ts                          2 red
packages/ui/tests/e2e/explorer-rename-reentry.e2e.ts                     3 red
packages/ui/tests/e2e/editor-stranded-recovery.e2e.ts                    2 red / 1 green
packages/ui/tests/e2e/explorer-live-sync.e2e.ts                          4 green (fences)
packages/ui/tests/e2e/terminal-link-once.e2e.ts                          4 green (fences, #198 deferred)
```

New tests this feature adds (behaviour discovered in Phase 1, not covered by the above):

```text
packages/ui/tests/e2e/explorer-delete-rollback.e2e.ts   # FR-009a, SC-012
packages/ui/tests/e2e/editor-unloadable-save.e2e.ts     # FR-013a save guard
packages/ui/tests/unit/watcher-diagnostics.test.ts      # FR-010b, FR-021, SC-013
```

## Implementation approach, per issue

Ordered by the spec's priorities; they are independent, so this is presentation order, not a dependency
chain.

### #194 — case-only rename (P1)

`renameInBracket` compares the requested leaf with the current leaf **case-insensitively**; when they
match, the destination *is* this item, so the `exists(dest)` collision probe is skipped and the rename
proceeds. The byte-identical no-op guard above it is untouched, so FR-002 still short-circuits first
and the bracket still does not open for a true no-op. A genuinely different sibling still fails the
probe (FR-003).

`validateRename` gains an optional current-name parameter so an item is never a collision with itself.
It has no callers, so this is a safe API extension rather than a breaking change — and FR-005 is
satisfied by making the two rules agree rather than by deleting an export.

### #186 — file tree liveness (P1)

`NodeFileWatcher` gains `maxWaitMs` (default 1000): the burst's start time is recorded, and once
`maxWaitMs` has elapsed since it, the next event fires immediately instead of rescheduling. Its
`'error'` handler closes the dead handle and re-establishes on a bounded backoff; exhaustion calls a
new optional failure callback. `dispose()` cancels the timer, the retry, and closes the handle.

`ExplorerWatcher` forwards the failure callback; `main.ts` turns it into a notice. Every failure,
retry and escalation writes a diagnostic (FR-010b).

In the renderer, `remove()` drops the node optimistically and — on failure — restores it and reports
(FR-009/FR-009a).

### #161 — stranded editor (P1)

The document gains an `unloadable` flag, set when a load fails and cleared on a successful read, and
carried to the renderer on the existing sync message. `editor-panel.tsx` renders a banner above the
content when set, naming the path and offering **Reload from disk**; the remembered text stays visible
(FR-013). Saving while unloadable asks first (FR-013a). `reloadFromDisk` re-reads on demand and warns
about unsaved edits (FR-015/FR-016). The existing file-change broadcast retries unloadable documents,
which is auto-recovery (FR-014, research R5). Revert is untouched (FR-017).

### #197 — project re-entry (P2)

`onRename` mirrors `drop`: every open path at or under the renamed folder migrates by prefix into
`pendingOpen`, and persists when it applies. Restore reads go through a non-reporting variant of
`fetchChildren`, so an unresolvable persisted path is discarded silently and logged, while a
user-initiated listing still reports (FR-021/FR-022).

### #166 — status bar (P3)

Delete the dot, name, context and ADMIN pill from `status-bar.tsx`; keep the footer, its height,
theming, testid and the root path. Amend the superseded requirement text in the owning spec (FR-027).

### #165 — pane toggle defaults (P3)

`WINDOWS_BINDINGS` moves the two toggles to `Ctrl+Alt+B` / `Ctrl+Alt+N`. User configs are untouched
(FR-030). Existing tests and docs that cite the old chords are updated (FR-031) — four test files
assert them today.

## Risks

| Risk | Mitigation |
|---|---|
| The max-wait change makes the tree refresh far more often under load, costing CPU | SC-003's coalescing fence is already a committed test and bounds this; the refresh re-reads only *loaded* directories |
| The unloadable flag races the existing `fileMissing` / `movePending` flags and force-dirties a clean document | New flag is additive and read-only in the renderer; the existing E2E for delete/move/recovery are fences |
| Migrating open state on rename resurrects #120 (open-but-unloaded folders) | Reuses `drop`'s path, which already carries #120's reconciliation and its "Finding 2" pruning |
| Updating four test files for #165 masks a real regression | The chords are asserted positively in the new unit test as well, so a wrong value fails somewhere that was not edited |
