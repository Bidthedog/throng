# Implementation Plan: Cross-Project Clipboard

**Branch**: `feature/S050-I448-I7-cross-project-clipboard` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/050-cross-project-clipboard/spec.md` (5 user stories, FR-001–FR-039,
SC-001–SC-014, seven clarification sessions). Refs #7, #448.

## Summary

The File Explorer clipboard moves out of one explorer's React state into the application, and every paste and drag
runs through one engine that can see more than one project root:

- **An application clipboard** (R1): main holds `{ mode, items[] }` by absolute path and project, pushes it to every
  window, follows in-app moves and deletes, and empties itself when its project goes or is re-rooted.
- **One transfer engine in main** (R2–R5): pastes and drags become queued jobs over absolute paths, confined to "some
  project root" for sources and the active root for the target, run one at a time inside `FilesService`'s existing
  queue and move bracket. A rename where it can, copy-then-remove across volumes, a cancellable streamed copy, and
  a folder merge that asks about each clash at any depth.
- **The user decides every clash and every cancel** (R6, R7, R9): a Replace / Skip / Keep both prompt on the existing
  dialog; a journal per run that Keep finished and Roll back act on; a `explorer.replaceMode` setting for what
  Replace does with the item it overwrites.
- **Progress as one notice** (R8): a run still going after 1 s shows progress with Cancel in the window's notice
  area; queued runs show and cancel; the same notice becomes the failure report. The notification model gains
  `update(id, patch)`.
- **Undo across projects** (R10): undo entries gain an `id`, an optional `projects` pair and a `paste` kind for
  pastes that replaced something; a cross-project entry sits in both stacks and is applied by main.
- **Quit, label, reveal** (R11, R12): quitting mid-paste asks first; the Paste item names what will land and from
  where; the placed items are revealed and selected.
- **#448** (FR-030) is already fixed on this branch (`0fc44e5f`, component test included).

**Iteration 2** (Session 2026-10-03, fifth — after manual testing):

- **Progress only when it is worth it** (R14, FR-031): main sizes the paste and runs a work clock that pauses while a
  question is open; the progress event's new `display` flag tells the renderer when to raise the card.
- **A clearer clash prompt** (R15, FR-032): a box per side, an arrow the way the copy goes, the newer box highlighted,
  styled in `theme.css`.
- **Structure kept across folders** (R16, FR-033): a core `landingPlan` rule; the engine creates and journals
  intermediate folders, and undo entries carry `createdDirs`, applied by main.
- **No-entry cursor** (R17, FR-034): the two window `dragover` handlers stop promising a copy over nothing.

**Iteration 3** (Session 2026-10-04 — after manual testing):

- **Moved out of its project** (R18, FR-035, FR-036): main marks a document or preview whose file a move takes out of
  its owner project as moved out — read-only, no registry claim, no watch, Save refused, Save As allowed into the
  destination project; a move back restores it.
- **Layouts no window holds** (R19, FR-016, FR-035): main rewrites moved paths in unheld project layouts, the
  `preview-purge.ts` walk, and persists `movedOut` in the panel config.
- **Copy reproduces what is shown** (R20, FR-037): the shown parts first, then `Details` with what is never shown.
- **A file dropped on +** (R21, FR-038): native drop handling on the new-tab button.

**Iteration 4** (Session 2026-10-04, second — after manual testing):

- **Progress by bytes, and a cancel icon** (R23, R24, FR-039): main reports bytes; the card draws a progress bar and
  a dedicated cancel icon on the right.
- **+ drop fills the new tab's panel** (R25, FR-038 as amended): the empty-panel drop rule, shared.
- **A moved-out preview wins over remembered state** (R26, FR-035), its editor route refused.
- **Two defects to reproduce first** (R27): the undo error and cut structure.

## Technical Context

**Language/Version**: TypeScript (repo toolchain, ES2022), Node 24, Electron 44

**Primary Dependencies**: React 18, react-arborist 3, Node `fs/promises` + `stream/promises`, Vitest, Playwright.
**No new dependency.**

**Storage**: the clipboard and transfer jobs live in main's memory (FR-007). The file-operation undo blob (daemon,
migration v8) widens its JSON shape only — no schema change, no migration. One new setting.

**Testing**: core unit, ui unit, integration against a real temp filesystem (main services), component (jsdom),
E2E `@extended` for the cross-project round trips only — research R13.

**Target Platform**: Windows 11 desktop (Electron); nothing forecloses macOS/Linux (EXDEV and streamed copy are
portable; Recycle-Bin restore stays behind its existing seam).

**Project Type**: desktop application, npm-workspaces monorepo.

**Performance Goals**: SC-008, narrowed by SC-009 — progress visible within 1 s of work on a paste over 5 MB, never for a smaller one; Cancel takes effect before the
next item and inside a large file's copy. Nothing new on the keystroke, scroll or render path; the progress body
re-renders only on a progress push.

**Constraints**: Principle I (a target never leaves the active root; sources only from project roots, real paths);
019's move bracket must enclose every move a job makes; one file operation at a time (FR-019e); no OS-clipboard
involvement (FR-008).

**Scale/Scope**: `packages/core` (transfer-plan rules, undo entry kinds, settings + descriptor, an `IFileSystem`
method), `packages/ui` main (clipboard service, transfer service, `FilesService.exclusive`, IPC, close flow,
composition), preload + `global.d.ts`, renderer (explorer data hook, tree greying, context menu, clash prompt,
progress notice, quit prompt, notification `update`), `docs/preferences.md`, tests. No daemon change.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1. Constitution v5.9.0.*

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged — the high-risk row.** A paste reads from another project's root, which 004 FR-022 forbade; the spec supersedes it narrowly (sources only) and every target stays inside the active root. Both checks are made on real paths in main against main's own daemon-fed project cache, never renderer-supplied roots (R2). Root exclusivity is what makes "inside some project" unambiguous. Nothing of another project becomes visible: the explorer still shows only the active project. |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** The clash, naming and undo rules are pure core; the cancellable copy is a new `IFileSystem` method with its Node implementation in main. |
| **III. Detached, Tagged & Persistent Terminals** | **Not engaged.** The quit prompt runs before the existing terminals prompt and leaves it unchanged. |
| **IV. Native Terminal Support** | **Not engaged.** |
| **V. Test-First (NON-NEGOTIABLE)** | **Engaged, satisfied.** Every task starts from a failing test at the lowest layer (R13); the engine is integration-tested on a real filesystem, the prompt and notice in jsdom; E2E only for the cross-project round trips. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged.** No new command or binding (FR-026). The clash, cancel and quit questions use the existing dialog — keyboard-operable, text-labelled decision buttons. The Paste label is the one discoverability cue (FR-025a). |
| **VII. Change Review & Approval** | **Not engaged.** |
| **VIII. SOLID, DRY & YAGNI** | **Engaged, decided three shapes.** One engine for paste and drag rather than two (R2); one queue shared with `FilesService` rather than a second lock; the existing undo kinds keep their root-relative path rather than being re-plumbed (R10). |
| **IX. DI & Composition Root** | **Engaged, satisfied.** `FileClipboardService` and `TransferService` are constructed in `main.ts` beside `FilesService` and handed their collaborators (filesystem seam, project cache reader, holder resolver, bracket callbacks, window sender). |
| **X. Externalised Configuration** | **Engaged.** One setting, `explorer.replaceMode`, with its descriptor. The 1-second progress threshold is a constant fixed by the spec (Complexity Tracking). |
| **XI. Dockable Workspace** | **Engaged, satisfied.** "One document, one state": a moved file's open editors and previews follow through the existing bracket, in every window (FR-016). No panel gains state. *Iteration 3:* across projects a panel the move takes out of its project is DETACHED (FR-035) — read-only, Save refused, no registry claim — so it is not a second authority on the file: the destination's editor is the one document, and the detached panel only shows what it held. |
| **XII. Responsive UI (NON-NEGOTIABLE)** | **Engaged, satisfied.** All file work is in main, off the renderer thread; progress pushes are per item, not per byte, and only the notice body re-renders. |

### Development Workflow & Quality Gates

| Gate | Assessment |
|---|---|
| **Configuration-editor completeness** | Engaged: one descriptor for `explorer.replaceMode`; the completeness test enforces it. |
| **Documentation currency** | Engaged: `docs/preferences.md` gains the setting; `docs/key-bindings.md` is unchanged (no binding); the File Explorer section of the user docs gains cross-project paste, clashes and progress (throng-docs audit). |
| **Displayed quantities** | Engaged: `done of total`, item counts, sizes in the clash prompt and `Paste N items` all go through `number-format.ts`. |
| **Action controls** | Engaged: the progress notice's Cancel is a themed icon with a hover title; the dialogs' buttons are decision buttons (text, the stated exception). |
| **Particular-scrutiny review** | Engaged: a new IPC surface accepting renderer paths and undo entries — shape-checked, and every path confined in main. |
| **Constitution amendment** | None needed. |

**Result: PASS**, with one Principle X constant recorded below.

### Re-evaluation after Phase 1

Re-checked against research, data model and contracts. Two refinements, verdict unchanged:

- **I**: `applyUndo` takes a whole entry from the renderer. Main confines **every** path in it to a project root
  before touching anything, so a forged or stale entry cannot reach outside the projects (contracts/transfer-ipc
  §3.1) — the same posture as `restoreDeleted`.
- **VIII**: undo application stays split — existing kinds through the root-relative bridge, cross-project and
  `paste` entries through main. Moving every kind to main would re-plumb 024's tested path for no requirement; the
  split is by what the entry needs (one root or several), stated once in R10.

## Project Structure

### Documentation (this feature)

```text
specs/050-cross-project-clipboard/
├── spec.md
├── plan.md
├── research.md          # R1–R27
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── transfer-ipc.md  # fileClipboard + transfer bridge, main's rules
│   └── ui-surfaces.md   # clash prompt, progress notice, cancel/quit prompts, Paste label, setting
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── explorer/transfer-plan.ts            # NEW classifyTopLevel, clashKind, keepBothName, newerOf
├── explorer/index.ts, index.ts          # exports
├── fileop-undo/undo-stack.ts            # id, projects, 'paste' kind; plannedMoves/validate/parse
├── abstractions/file-system.ts          # copyFileCancellable
└── config/app-settings.ts, settings-metadata.ts   # explorer.replaceMode
packages/core/tests/unit/

packages/ui/src/main/
├── file-clipboard.ts                    # NEW FileClipboardService
├── transfer-service.ts                  # NEW TransferService (jobs, queue, journal, clash, cancel, rollback, applyUndo)
├── transfer-ipc.ts                      # NEW throng:fileClipboard:* / throng:transfer:*
├── files-service.ts                     # bracketed → public exclusive(); bracket callbacks exposed to the engine
├── node-file-system.ts                  # copyFileCancellable
├── in-app-moves.ts                      # + clipboard.followMoves
├── main.ts                              # composition; delete fan-out; projects refresh → retain; close-flow quit check
├── editor-coordinator.ts, editor-service.ts   # iteration 3: moved-out documents, Save As exception (R18)
├── preview-service.ts                   # iteration 3: moved-out preview state (R18)
└── moved-layout-walk.ts                 # NEW iteration 3: moved paths in layouts no window holds (R19)
packages/ui/src/preload/preload.cts, renderer/global.d.ts   # window.throng.fileClipboard / .transfer
packages/ui/src/renderer/
├── explorer/file-clipboard-store.ts     # NEW mirror of main's clipboard
├── explorer/use-explorer-data.ts        # cut/copy/paste/drop via main; undo of cross-project + paste entries; pending reveal
├── explorer/file-tree.tsx               # greying by absolute path
├── explorer/context-menu-items.ts       # Paste label
├── explorer/clash-prompt.tsx            # NEW
├── explorer/paste-runs-store.ts         # NEW
├── explorer/paste-progress-notice.tsx   # NEW
├── explorer/paste-quit-prompt.tsx       # NEW
├── common/notification.tsx              # notify returns id; update(id, patch)
├── app.tsx                              # mount the prompt hosts beside AppClosePrompt
├── editor/**, preview/**                # iteration 3: moved notice, read-only, MissingFileWatcher skip (R18, R19)
├── common/notice-text.ts, panel-failure-banner.tsx   # iteration 3: copy = shown, then Details (R20)
└── workspace/tab-group.tsx              # iteration 3: a file dropped on + (R21)
packages/ui/tests/{unit,component,integration,e2e}/

docs/preferences.md, docs/ (File Explorer section)
```

**Structure Decision**: the existing layout. Rules in core; the clipboard and the engine in UI main beside
`FilesService`; prompts, notices and stores in the renderer. No new package, no daemon change.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **004 FR-022 superseded for sources** (Principle I engaged) | #7 is precisely "files between projects" | Keeping single-root confinement makes the feature impossible; targets stay confined |
| **Principle X: the 1-second progress threshold is a constant** | Fixed by FR-019, SC-008 and FR-031 (`PROGRESS_WORK_MS`, `PROGRESS_MIN_BYTES`) | A setting would contradict the clarified requirement |
| **006 FR-084 narrowed: Save As outside the owner project** (FR-036, Principle I engaged) | The user asked that unsaved text a move strands can be saved into the project the file moved to | Refusing it strands the text; re-owning the panel would put another project's file in this project's layout |
| **A second file-operation service beside `FilesService`** | Jobs, journals, prompts and multi-root confinement outlive one IPC call | Folding them into `FilesService` would make its single-root invariant a special case on every method (R2); the two share one queue, so they cannot interleave |
