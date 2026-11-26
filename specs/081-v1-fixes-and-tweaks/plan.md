# Implementation Plan: v1.0.0 fixes and tweaks

**Branch**: `feature/S081-v1-fixes-and-tweaks` | **Date**: 2026-11-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/081-v1-fixes-and-tweaks/spec.md`

## Summary

Ten issues on existing surfaces; no new subsystem except a small git ignore oracle for #729. Each story's approach,
with file:line evidence, is in [research.md](research.md) (R1–R13):

- **US1 (#723)**: two test/harness timing defects fixed at their cause (R1, R2), plus a clamp so the PTY agent's
  connect lapse fires at its budget.
- **US2 (#728)**: a structured refusal reason reaches the tab-open scan; history stand-ins and Focus-Mode-hidden
  panels are held back; a 500 ms settle window defers external-delete reports in the editor coordinator and the
  standalone preview path (R3–R5).
- **US3/US4 (#730, #733)**: tables re-measure when a box-less preview gets a width; the sync mark draws without
  disturbing table layout, maps every table line to its row, and resolves blank lines to the next non-blank (R6, R7).
- **US5–US7 (#725, #731, #724)**: title-bar accelerators over the panel menu rows; one shared Open In builder for the
  File Explorer and the link menu; a Follow the active preview setting (R8–R10).
- **US8 (#729)**: an `IgnoreOracle` over `git check-ignore`, a per-listing IPC, and a themeable fade (R11).
- **US9 (#732)**: a view-only entry row after the last CSV record (R12).
- **US10 (#727)**: the terminal status bar takes the shared Focus Mode strip (R13).

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node 24, Electron (main + React 19 renderer)

**Primary Dependencies**: none new. `git` is invoked as an external program when present (#729); its absence is a
normal state.

**Storage**: one new setting key (`explorer.autoRevealActivePreview`) and one new theme token (ignored-entry
opacity). Absent keys fill from defaults on read; no migration.

**Testing**: Vitest projects `unit`, `component` (jsdom), `integration`, `contract`; Playwright E2E on CI only. Layer
per story is in the tasks; E2E only where a real window's layout is the observable (#733 row geometry) or an existing
spec asserts a changed label.

**Target Platform**: Windows, Linux, macOS. No per-OS code except the git invocation, which is the same on all three.

**Project Type**: desktop app (npm-workspaces monorepo)

**Performance Goals**: table re-measure only on a 0 → W width change (XII); `git check-ignore` batched per listing,
off the main loop; no work on the scroll path beyond one line lookup.

**Constraints**: core stays OS-free (II); main never blocks on git (XII); failures logged (XIII).

**Scale/Scope**: ~10 production modules per story at most; the largest is #731's menu refactor.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Verdict |
|---|---|
| II Platform-abstracted core | ✅ `IgnoreOracle` is a core interface; the git process lives in platform-node. |
| V Test-first | ✅ Every bug story starts from a failing test (FR-100); tweaks get component/unit tests first. |
| VI Simple, discoverable UX | ✅ Title-bar buttons and CSV row ops draw disabled with a reason, never hidden. |
| VIII SOLID/DRY/YAGNI | ✅ One Open In builder (#731); one Focus Mode strip style (#727); one settle constant (#728). |
| IX DI & composition root | ✅ The oracle is constructed in main's composition root and injected into the files service. |
| X Externalised configuration | ✅ New setting and theme token are in the registries with editor metadata. |
| XI One document, one state | ✅ The settle window sits in the coordinator, so every panel presenting the document sees one decision. |
| XII Responsive UI | ✅ Re-measure only on a real width change; git off-loop; measurement recorded in the PR (#730). |
| XIII Every failure leaves a trace | ✅ git failure logged once; settle-window outcomes logged at debug. |
| Configuration-editor completeness | ✅ Setting and token go through metadata; completeness tests updated. |
| Themeable icon controls | ✅ Two new icon keys with hover titles (#725). |
| Documentation currency | ✅ `docs/preferences.md`, `docs/key-bindings.md` (none), user guide pages touched per FR-101. |
| Supersession | ✅ 073 FR-033e, 046's menu label, 045's top-level link rows, 073 FR-038 noted in place (FR-102). |

No violations; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/081-v1-fixes-and-tweaks/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ignore-oracle.md
│   ├── open-in-rows.md
│   └── settle-window.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/
├── abstractions/ignore-oracle.ts          # new (US8)
├── config/{app-settings,settings-metadata,theme,theme-metadata,theme-copy,theme-quality}.ts   # US7, US8
├── csv/csv-edit.ts                        # US9 width padding
├── editor/sync-line.ts                    # new: nonBlankSyncLine (US4)
├── icons/icon-keys.ts                     # US5
└── links/menu.ts                          # US6
packages/platform-node/src/git-ignore-oracle.ts   # new (US8)
packages/daemon/src/pty-agent-host.ts             # US1 clamp
packages/ui/src/main/
├── external-delete-settle.ts              # new (US2)
├── editor-coordinator.ts, preview-service.ts     # US2
└── files-ipc.ts, files-service.ts, main.ts       # US8
packages/ui/src/renderer/
├── editor/{editor-state,use-editor,missing-file-watcher,editor-scroll-store}.ts(x)   # US2, US4
├── preview/{table-layout.ts, preview-panel.tsx, providers/markdown/*}               # US3, US4
├── preview/providers/csv/csv-body.tsx, grid/{data-grid,grid-selection}.ts(x)        # US9
├── workspace/{panel-placeholder,panel-header-fit,panel-header-menu,panel-header-file-icons}.ts(x)  # US5
├── explorer/{context-menu-items,open-in-rows,file-tree,tree-node,use-explorer-data,explorer.css}  # US6–US8
├── links/link-menu.ts                     # US6
└── terminal/{terminal-status-bar.tsx,terminal.css}, editor/editor.css              # US10
packages/ui/tests/e2e/harness.ts           # US1
packages/daemon/tests/integration/pty-agent-launch-timeout.integration.test.ts       # US1
```

**Structure Decision**: existing monorepo layout; two new modules in core, one in platform-node, two in ui.

## Complexity Tracking

None.
