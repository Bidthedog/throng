# Implementation Plan: Markdown Previews — Restored Reuse, Outlining, Task Lists, Mermaid, Search Results, Maximise

**Branch**: `feature/S054-I474-I469-I462-I392-I478-I467-markdown-previews` | **Date**: 2026-10-10 |
**Spec**: [spec.md](./spec.md)

**Input**: `specs/054-markdown-previews/spec.md` — 8 user stories, two clarification sessions (13
answers). Refs #474, #469, #462, #392, #478, #467.

## Summary

Six pieces of work on 044/047's preview, plus a workspace mechanism they share:

- **Restored reuse** (#474): per-tab preview recency is persisted on the `Tab` and seeded at restore;
  reuse is filtered by provider (R1).
- **Preview panel types**: the provider is the panel type's identity on the single `preview` kind —
  labels, reuse and link-follow become per type (R2).
- **Outlining** (#469): two pure fold ops, two unbound commands, one shared submenu builder (R3).
- **Task lists** (#462): the pipeline tags each checkbox with its source line; a core locator computes
  the edit; a main `TaskToggleService` applies it through the shared document or the 043 direct-write
  path, saving when the document was clean (R4).
- **Mermaid** (#392): `mermaid` 12.1 in strict mode behind a lazy chunk, a generic fence
  **block-renderer seam**, a standalone `.mmd`/`.mermaid` provider, a second DOMPurify SVG profile, and
  a `DiagramFrame` with fixed top-left view controls (R5, R6).
- **Find in Files** (#478): the result opener honours the default open action and reveals the match in
  the preview, falling back to the editor (R8).
- **Maximise** (#467): a per-tab stack in a renderer store; panels maximised in place by CSS, sections
  through a portal layer; one hook enforces the modal rules; `Alt+Shift+Enter` (R7).
- **Settings**: Open previews in becomes per provider with a value-carrying migration; a third
  Preferences level (`subsection`) holds Markdown and Mermaid (R9).

## Technical Context

**Language/Version**: TypeScript (repo toolchain, ES2022), Node 24, Electron 44.

**Primary Dependencies**: React 18, markdown-it ^15, DOMPurify ^3, CodeMirror 6, InversifyJS, Vitest,
Playwright. **New runtime dependency: `mermaid` 12.1.0 (MIT)** in `packages/ui`, lazy-loaded (R5).

**Storage**: Layout — optional `Tab.previewRecency` (no schema bump). Settings — per-provider
`openTarget`, Markdown `renderMermaid`, Mermaid provider leaves; top-level `editor.previews.openTarget`
retired by migration. `SHIPPED_DEFAULTS_VERSION` 20 → 21 for five icon tokens. Maximised state and
diagram view state are never stored.

**Testing**: unit, component (jsdom; a fake mermaid module), integration
(`tests/integration/helpers/preview-harness.ts`, the replace-commit pattern), contract
(`preview-ipc.contract.test.ts`). **Two new E2E specs** (`@extended`), justified in R10.

**Target Platform**: Windows 11 desktop (Electron).

**Project Type**: Desktop application, npm-workspaces monorepo.

**Performance Goals**: SC-003 — a toggle reflected within 500 ms (one IPC round trip and a re-render).
SC-006 — no mermaid bytes loaded at startup or for diagram-free previews (bundle guard). Diagram render
bounded at 5 s (FR-048).

**Constraints**: Untrusted content — diagram SVG is sanitised by its own profile and inserted after the
document sanitiser; strict mermaid; no network (044 FR-093). Terminals and editors must not remount on
maximise. Shift+Enter and Ctrl+Enter must keep reaching terminals and editors.

**Scale/Scope**: `packages/core` and `packages/ui` (renderer, main, preload). `persistence`, `daemon`,
`ipc-contract` and `platform-windows` untouched apart from the layout carrying one optional field.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.* Constitution v5.9.0.

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, satisfied.** The toggle is confined by `resolveSaveConfinement` in main (FR-028). Reuse stays within the visible tab (047 FR-015). Find in Files reveal uses the run's project. Diagrams load nothing. |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** Task locating, fold-within, recency fallback, settings migration are pure core. File I/O stays in UI main behind `IFileSystem`. |
| **III. Detached, Tagged & Persistent Terminals** | **Engaged lightly.** Maximise never remounts a terminal panel (R7); no daemon change. |
| **IV. Native Terminal Support** | **Engaged.** Alt+Shift+Enter becomes window-handled in terminals — a deliberate, documented reservation (FR-071a); `chordCollisions` and `twoStrokeTerminalViolations` stay empty; Shift+Enter / Ctrl+Enter pass through (asserted). |
| **V. Test-First (NON-NEGOTIABLE)** | **Engaged, satisfied.** Every task test-first at the lowest layer (R10). Tests that change by supersession: `editor-open-router.test.ts:235-257` (044 FR-054), `preview-read-only.test.ts` checkbox cases (044 FR-020), `markdown-pipeline-gfm.test.ts` disabled checkbox (044 FR-080), `preview-highlight.test.ts` mermaid-as-code (044 FR-086), the fold-row assertions in the two content-menu tests (047 FR-036). Two E2E specs, with the budget re-seeded. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged; see the rules table.** |
| **VII. Change Review & Approval** | **Engaged.** A preview now writes a file (the toggle): through the shared document, undoable in the editor, one marker only (FR-022, FR-024). |
| **VIII. SOLID, DRY & YAGNI** | **Engaged.** DRY: one outlining builder, one diagram renderer for both uses, one direct-write helper shared with replace, one maximise mechanism for panels and sections. YAGNI: no pan/zoom library, no diagram export, no per-kind panel split. |
| **IX. DI & Composition Root** | **Engaged.** `TaskToggleService` is constructed in `main.ts` with `EditorCoordinator`, `IFileSystem` and the confinement resolver injected. |
| **X. Externalised Configuration** | **Engaged.** New settings have descriptors; `DIAGRAM_RENDER_TIMEOUT_MS`, `MIN_READABLE_SCALE` and the zoom step/bounds are recorded in Complexity Tracking as limits/layout constants, not tunables. |
| **XI. Dockable Workspace** | **Engaged — high-risk row.** Maximise is view state per tab, not layout (never persisted, never in another window). The toggle goes through the one document authority. Per-type reuse never crosses tabs. |
| **XII. Responsive UI (NON-NEGOTIABLE)** | **Engaged.** Mermaid renders asynchronously and is bounded (FR-048); the toggle is one async IPC; the PNG rasterise for copy runs only on a copy. |

### Principle VI — its named rules

| Rule | Assessment |
|---|---|
| **Every panel action has a menu item** | Maximise/Restore Panel on the title menu; outlining rows in the Outlining submenu; diagram controls are accelerators over the same view state (Full Pane = the maximise mechanism). |
| **Disabled when unavailable, absent when meaningless** | Split / "+" / drop **disabled** while maximised; hidden panels **absent** from Open In; All Inside rows absent before the first heading; Outlining absent for non-Markdown. |
| **Themeable icon controls (NON-NEGOTIABLE)** | Five new tokens: `panelMaximise`, `panelRestore`, `diagramFit`, `diagramFullSize`, `diagramFullPane` (diagram zoom reuses `zoomIn`/`zoomOut`); each with copy in `theme-copy.ts`. |
| **One condition, one notice** | A refused toggle raises one notice owned by the preview; a diagram parse error one inline notice per diagram. |

### Development Workflow & Quality Gates

| Gate | Assessment |
|---|---|
| **Incremental delivery** | Not engaged — nothing deferred. #479 (folding Preferences) and #319 remain their own issues. |
| **Static analysis** | Standing; `npm run gate` on the hosted runner is the evidence. |
| **Particular-scrutiny review** | Engaged: persisted state (Tab recency, settings migration), a document edited from a second surface (toggle). |
| **Documentation currency** | Engaged: `docs/key-bindings.md` (3 actions), `docs/preferences.md` (moved/new leaves, Previews → Markdown / Mermaid), `docs/quick-start.md` (task lists, diagrams, maximise), `README.md` (one Highlights line for diagrams), `CHANGELOG.md` (unreleased). |
| **Configuration-editor completeness** | Engaged: new leaves and tokens each with one descriptor; new `settings-inertness-054.test.ts`. |
| **Displayed quantities digit-grouped** | Not engaged — no new displayed counts. |

**Result: PASS.**

### Re-evaluation after Phase 1

Re-checked against data model and contracts; verdict unchanged. One refinement: the diagram SVG's own
sanitiser profile is a **second** sanitiser in the path, so FR-045's "a test asserts the sanitiser is
in the path" is satisfied by two tests — the document sanitiser (existing) and the diagram profile
(new), for both embedded and standalone.

## Project Structure

### Documentation (this feature)

```text
specs/054-markdown-previews/
├── spec.md
├── plan.md
├── research.md          # R1–R10
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── preview-ipc-054.md
│   └── menus-commands-controls-054.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── outline/fold-state.ts                 # + collapseWithin, expandWithin
├── preview/task-toggle.ts                # NEW locateTaskToggle
├── preview/providers/mermaid.ts          # NEW mermaid descriptor
├── preview/providers/index.ts            # + mermaid
├── preview/panel-type.ts                 # + previewPanelTypeLabel
├── preview/settings-types.ts             # openTarget per provider
├── preview/wire-types.ts                 # + TaskToggleRequest/Response
├── config/preview-settings.ts            # per-provider openTarget, migration, subsections
├── config/metadata.ts                    # FieldDescriptor.subsection
├── config/settings-metadata.ts           # markdownSectionsOpen placement
├── config/keybindings.ts                 # 3 actions, WINDOW_HANDLED_ACTIONS
├── config/keybindings-metadata.ts
├── config/theme.ts, theme-copy.ts        # 5 icon tokens
├── config/shipped-defaults.ts            # version 21
└── workspace/model.ts                    # Tab.previewRecency?, PreviewPanelConfig.providerId?

packages/ui/src/main/
├── task-toggle-service.ts                # NEW
├── text-file-rewrite.ts                  # NEW, extracted from replace-commit-service
├── editor-coordinator.ts                 # + applyExternalEdit
├── preview-service.ts                    # navigate: cross-provider → open
├── preview-ipc.ts                        # + throng:preview:toggleTask
└── main.ts                               # composition

packages/ui/src/preload/preload.cts       # + preview.toggleTask

packages/ui/src/renderer/
├── preview/last-active-preview.ts        # provider filter, seed/persist
├── preview/open-preview.ts               # provider-aware candidate, pendingReveal
├── preview/preview-panel.tsx             # task toggle wiring, reveal, type label
├── preview/content-menu.ts               # Outlining submenu
├── preview/copy.ts                       # diagram substitution
├── preview/blocks/block-renderers.ts     # NEW seam
├── preview/diagram/                      # NEW mermaid-renderer.ts, diagram-block.tsx, diagram-frame.tsx, svg-sanitise.ts
├── preview/providers/markdown/           # pipeline task-line, sanitise profile, body block pass, renderMermaid
├── preview/providers/mermaid/            # NEW view.ts, mermaid-body.tsx
├── editor/content-menu.ts                # Outlining submenu
├── common/outlining-menu.ts              # NEW shared builder
├── find-in-files/find-in-files-chrome.tsx# route by default open action
├── workspace/maximise-store.ts           # NEW
├── workspace/maximise-layer.tsx          # NEW portal host + Esc
├── workspace/tab-group.tsx, split-tree.tsx, panel-placeholder.tsx, panel-header-menu.ts  # modal rules, controls
├── editor/open-in-targets.ts, links/link-open-in.ts  # omit hidden panels
├── keybindings/window-dispatcher.tsx, scope.ts       # panel.toggleMaximise
├── preferences/group-descriptors.ts, subsection.tsx  # third level
└── theme.css                             # maximise + diagram styles

packages/ui/vite.config.ts                # diagram lazy chunk + eager guard
docs/                                     # key-bindings, preferences, quick-start; README; CHANGELOG
```

**Structure Decision**: the existing two-package layout; no new package.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| New dependency `mermaid` (~large, lazy) | FR-040/042 require rendering every Mermaid diagram type; maintainer asked for an existing library | Writing a renderer is out of the question; the bundle cost is confined to a lazy chunk with a build guard |
| Constants not settings: `DIAGRAM_RENDER_TIMEOUT_MS = 5000`, `MIN_READABLE_SCALE = 0.5`, zoom ×1.25 in [0.1, 8] | A safety bound and layout constants | Exposing them as settings would be tunables nobody asked for (Principle X allows limits; 047's `8ch` precedent) |
| Two E2E specs | jsdom cannot lay out SVG; terminal key capture needs a real window | Component tests cover everything else |
