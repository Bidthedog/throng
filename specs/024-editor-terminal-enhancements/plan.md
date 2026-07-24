# Implementation Plan: Editor & Terminal Enhancements

**Branch**: `feature/S024-editor-terminal-enhancements` | **Date**: 2026-07-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/024-editor-terminal-enhancements/spec.md`

## Summary

Seven independently-shippable v1.0.0 stories across the editor, terminal, file explorer, context
menus and the Electron main process. The spec is fully clarified (five clarify sessions, 21 recorded
decisions) and compliant with constitution v4.3.0. This plan sequences the work by **risk tier**
grounded in a codebase survey (see [research.md](./research.md)), because several stories are almost
entirely reuse of shipped infrastructure while two are substantial new work.

The stories, with the survey's verdict on each:

| Story | Tier | Verdict from the survey |
|-------|------|-------------------------|
| **US5** editor auto-naming (#97) | 1 — small | View-only: extend the `effectiveTitle` resolver that already auto-titles terminals. |
| **US6** sub-menu fix + keyboard nav + `menu.open` (#157) | 1–2 | The parent-click "bug" is a *toggle*; fix = idempotent open (2 lines). Keyboard nav largely exists (018); gaps are ArrowLeft-exits-submenu and the `menu.open` command. |
| **US1** editor word-wrap + terminal status bar + prefs (#152) | 2 — medium | 3 booleans (fully generic settings pipeline), a per-document wrap flag, a new terminal status-bar surface, `Ctrl+Alt+W` + a content-menu item. Terminal wrap itself is **descoped** (FR-003e → #169). |
| **US2** drag file/folder → terminal path (#155) | 2 — medium | New tree-drag→panel seam (the tree drag carries nothing readable today) + a terminal drop handler writing to the PTY via the existing `bridge.write` paste seam. |
| **US7** terminal URLs → system browser (#159) | 2 — medium | Override xterm `linkHandler`; add `@xterm/addon-web-links`; a main-process `setWindowOpenHandler` deny helper (none exists); widen `isSafeExternalUrl` to `https?`; link-aware menu. |
| **US4** tree file → empty panel + ownership conversion (#114) | 3 — larger | Reuses the OS-drop→untyped-panel path, but needs **one genuinely new core op** to rewrite `originProjectId` past INV-4, plus the US2 drag seam. |
| **US3** undo/redo tree move/rename/delete, persisted (#85) | 3 — largest, platform risk | New per-project SQLite table (migration v8) + undo engine, reuses the existing editor re-point machinery — **but recycle-bin *restore* has no OS API** and needs a new platform-seam method with a Windows native/PowerShell impl. The spec flags this for a focused validation pass. |

**Delivery shape.** Tiers 1–2 (US5, US6, US1, US2, US7) are the core of this PR. US4 follows if the
ownership-conversion op validates cleanly. **US3 is planned in full here but is a candidate to land on
its own branch** — the spec explicitly permits the large stories to split (Assumptions), and the
recycle-bin-restore seam is exactly the "focused validation pass" the spec calls for. Each story is
independently shippable, so partial delivery never leaves a half-feature: a story is either complete
with its tests and its menu affordance, or it is not started.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), ES2022 modules, npm workspaces monorepo.

**Primary Dependencies**: Electron 40+, React 18, xterm.js 6 (`@xterm/xterm` + `addon-fit`,
`addon-search`; **US7 adds `@xterm/addon-web-links`**), CodeMirror 6 (the editor), `node-pty`
(ConPTY), `better-sqlite3` (persistence), react-arborist (file tree), @dnd-kit (panel drags).

**Storage**: `packages/persistence` — better-sqlite3 with a versioned migration chain
(`LATEST_VERSION = 7`; **US3 adds v8**). Per-`(owner_user, project_id)` repositories. App settings via
the `IConfigStore` seam (atomic JSON). No settings-schema version bump needed (tolerant merge-over-defaults).

**Testing**: Vitest projects `unit` / `integration` / `contract`; Playwright `e2e` (Electron via
`packages/ui/tests/e2e/harness.ts`). Platform seams are exercised by shared **contract suites**
(`packages/core/src/testing/*-contract.ts`) run against real temp dirs (Principle II/V).

**Target Platform**: Windows 11 primary (CI runs elevated); macOS/Linux behind the platform seams.

**Project Type**: Desktop application (Electron main + preload + React renderer + a detached daemon
for terminals; the daemon is **not** on the file-op or menu paths).

**Performance Goals**: No new hard latency budgets are set by the spec (a deliberate
plan-phase omission — see research.md §Deferred). Interactive operations (wrap reflow, link
detection, path insert, menu open) must feel immediate; the undo stack is bounded at 50/project so
its cost is O(1) per op. Where a natural budget exists it is stated in the story's tasks, not invented here.

**Constraints**: Every user-facing story ships passing E2E (Principle V); the two bugs (US6, US7)
land a regression test that fails before the fix. OS-specific behaviour (US3 restore, US4 confinement,
US7 open-external) goes through a platform seam with contract tests (Principle II). Every panel-level
action added gets a menu item (Principle VI / v4.3.0). No application chord may take a reserved
terminal key (Principle IV / v4.2.0).

**Scale/Scope**: 7 stories, 45 functional requirements (this spec's own; FR-048/079/081 are cross-refs to specs 018/006), ~15 subsystems touched. Baseline at plan time:
1764 unit/integration/contract tests green, typecheck + lint clean.

## Constitution Check

*GATE: re-checked after design below. Result: PASS, with the touchpoints each story must honour.*

> **Constitution version note.** This branch carries the constitution at **v4.3.0** — the v4.2.0
> (terminal keyboard contract, Principle IV) and v4.3.0 (every-panel-action-has-a-menu-item,
> Principle VI) amendments were ratified here in commits `1f1c60b` and `0604eed` and merge with this
> feature. The **main checkout** is still v4.1.0, so a tool that resolves the constitution off the main
> repo's branch (e.g. `check-prerequisites`) will misreport the version and flag these citations as
> unratified — that is a path-resolution artifact of the worktree, not a real gate failure. Read
> `.specify/memory/constitution.md` **in this worktree** (footer: v4.3.0) to confirm.

- **I. Project-First Isolation** — US4's ownership conversion touches `originProjectId`/INV-4; the
  conversion must keep the main layout single-project (INV-4 enforced in `invariants.ts`). US3's undo
  stack is per-project and never acts across projects. ✅ addressed in design.
- **II. Platform-Abstracted Core** — US3 recycle-bin restore, US4 project-confined open, US7
  open-external all route through seams (`IFileSystem`, `resolveSaveConfinement`, the `openExternal`
  IPC). US3 **adds** `IFileSystem.restoreFromTrash` with a contract-test case and a Windows impl; the
  spec's "degrade cleanly where the seam is unimplemented" edge case is honoured. ✅
- **V. Test-First (NON-NEGOTIABLE)** — every task is written test-first; the two bug stories get a
  red-first regression test. E2E per story. ✅
- **IV. Native Terminal keyboard contract (v4.2.0)** — `Ctrl+Alt+W` (US1) and `Shift+F10`/`ContextMenu`
  (US6) are all audited clear of the reserved tier; US2's path-paste writes to the PTY like a paste and
  takes no chord. ✅ (audit in research.md)
- **VI. Discoverable UX / every panel action has a menu item (v4.3.0)** — US1's wrap toggle gets an
  editor content-menu item (FR-003d); US7's link actions are menu items; US6 *is* the menu work. ✅
- **X. Externalised Configuration** — the three US1 preferences are ordinary settings, auto-surfaced
  in the visual Preferences UI, grouped by surface (Editor/Terminal). ✅
- **XI. One document, one state** — US1 editor wrap is per **document** (owned by the authority, not
  the panel); US3 reuses the existing single-authority re-point (`markMoved`/`markDeleted`) so an open
  editor follows a reversed op without a second state. ✅

No violation requires a Complexity-Tracking entry. The one new model capability (US4 `originProjectId`
rewrite) is a spec-sanctioned, invariant-preserving op, not a shortcut around a principle.

## Project Structure

### Documentation (this feature)

```text
specs/024-editor-terminal-enhancements/
├── plan.md              # this file
├── research.md          # codebase survey + decisions (Phase 0)
├── data-model.md        # entities: wrap state, undo entry, drag payload, ownership (Phase 1)
├── quickstart.md        # manual + automated validation guide (Phase 1)
├── contracts/
│   └── seams.md         # all eight seams (settings, keybindings, filesystem restoreFromTrash,
│                        # fileop-undo engine, undo persistence v8, tree-drag payload,
│                        # external-url + window-open denial, panel-ownership op)
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (real directories touched)

```text
packages/core/src/
├── config/            app-settings.ts, settings-metadata.ts, keybindings.ts,
│                      keybindings-metadata.ts        (US1 prefs+chord, US6 menu.open)
├── workspace/         model.ts, operations.ts, invariants.ts, assignment.ts   (US4 ownership, US5)
├── editor/            path-display.ts                (US5 basename)
├── abstractions/      file-system.ts                 (US3 restoreFromTrash seam)
├── testing/           file-system-contract.ts        (US3 contract case)
└── (new) fileop-undo/ undo-stack.ts                  (US3 pure engine: record/undo/redo/validate/bound-50)

packages/persistence/src/
├── migrations/        (new) v8-fileop-undo.ts + register in migration-runner.ts
├── (new) fileop-undo-repository.ts
└── index.ts           (export the repo)

packages/platform-windows/   (US3 Windows restoreFromTrash impl, if this package is the seam home)

packages/ui/src/
├── main/              main.ts (window-open deny helper, US3 wiring), external-url.ts (widen),
│                      node-file-system.ts (restoreFromTrash), files-service.ts (undo recording)
├── preload/           preload.cts (hoist openExternal; expose terminal write for path-drop)
├── main/editor-coordinator.ts   (US1 per-document wrap AUTHORITY — CoordDoc.wordWrap)
├── renderer/editor/   status-strip.tsx (wrap toggle), content-menu.ts (Word Wrap item),
│                      use-editor.ts (per-doc wrap wiring to CodeMirror), editor-open.tsx
├── renderer/terminal/ terminal-panel.tsx (status bar, drop handler, link menu),
│                      use-terminal.ts (linkHandler, web-links addon), (new) terminal-status-bar.tsx
├── renderer/workspace/ panel-placeholder.tsx (US5 effectiveTitle), panel-body.tsx (US4 drop)
├── renderer/explorer/ file-tree.tsx, tree-node.tsx (US2/US4 drag payload), use-explorer-data.ts (undo)
└── renderer/          context-menu.tsx (US6 fix + keyboard), app.tsx (menu.open dispatch + Shift fix)
```

**Structure Decision**: Follow the existing layering exactly — pure logic in `@throng/core` and
`@throng/persistence` (unit/contract tested), Electron/OS specifics in `packages/ui/src/main` and the
platform package (contract tested), React in the renderer (e2e tested). No new package; one new
`core/fileop-undo` module and one persistence migration+repo. This keeps each story testable at the
layer the constitution expects and matches how 016 (editor), 018 (menus) and the persistence
migrations were each built.

## Complexity Tracking

> No constitutional violation requires justification. Table intentionally empty.

The single new model operation (US4 `originProjectId` conversion) is recorded here for visibility, not
as a violation: it is required by FR-012, preserves INV-4 (the converted panel becomes project-owned,
so the main layout stays single-project), and gets a focused unit-tested validation pass per the spec.
