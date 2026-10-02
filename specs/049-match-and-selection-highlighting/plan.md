# Implementation Plan: Match and Selection Highlighting

**Branch**: `feature/S049-I455-I456-I457-I324-I325-match-and-selection-highlighting` | **Date**: 2026-10-01 |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/049-match-and-selection-highlighting/spec.md` (6 user stories,
FR-000–FR-028, SC-001–SC-007, one clarification session of 12 answers). Refs #455, #456, #457, #324, #325.

## Summary

Six changes, all about a panel's *view* of its document rather than the document:

- **Find survives every move** (R1, #456): the search store re-applies an open session — term, modes and
  current index — the moment a panel's search engine registers, so a rebuilt editor or preview view shows the
  same highlights and count. The preview's global `CSS.highlights` names become a per-panel composed registry
  (R2), so two previews in one window stop overwriting each other's matches.
- **Panel state crosses windows** (R3, FR-000/FR-000a): a tear-off copies a panel into another renderer, whose
  module maps start empty. A new main-side, in-memory **panel-state hand-off** carries a snapshot — find session,
  editor view state, terminal view state, retained preview selection — from the window that sends a panel to
  the window that receives it. Stashed before the sub-workspace is opened or notified; claimed before the
  destination mounts its panels.
- **Find reveals folded matches** (R4–R6, #455): the preview reveal path is diagnosed from a failing component
  test first; the editor gains the same fold-aware reveal through main's fold authority (`revealing` →
  `setDocumentFoldState` → `syncFoldRanges`), never a bare `unfoldEffect`. Replace All with folded matches asks
  through the existing `useChoose` dialog (three choices).
- **One match vocabulary** (R7, #325): `searchHighlights` gains two occurrence surfaces derived on the same
  neutral ray as the ordinary match; the three shipped search surfaces are pinned byte-identical.
- **Selection occurrences** (R8–R10, #324): one core function decides what an occurrence is (FR-015) and one
  decides precedence against search matches (FR-013); an editor `ViewPlugin` tints visible ranges beneath the
  syntax layer, a preview painter tints the rendered text model. One setting, `editor.highlightOccurrences`.
- **Inactive selection** (R11–R12, #457): a derived `editorSelectionInactive` token; the editor uses CSS on
  `.cm-editor:not(.cm-focused)`; the preview retains its DOM selection as text-model offsets, paints it with a
  highlight while unfocused and restores it as the live selection when focus returns.

## Technical Context

**Language/Version**: TypeScript (repo toolchain, ES2022), Node 24, Electron 44

**Primary Dependencies**: React 18, CodeMirror 6 (`@codemirror/state`, `view`, `search`, `language`), xterm.js
6, the CSS Custom Highlight API (Chromium), Vitest, Playwright. **No new dependency.**

**Storage**: none persisted. The hand-off store lives in main's memory only (FR-000 assumption: transient).
Theme gains three colour tokens (shipped-defaults version bump with an additive upgrade); settings gain one
boolean.

**Testing**: core unit (derivation, occurrence rule, precedence), ui unit (stores, CSS pins, docs currency),
component/jsdom (find re-apply, reveal, prompt, preview selection, hand-off seeding), integration (main
hand-off service over IPC), E2E `@extended` for the cross-window cases only. See research R13.

**Target Platform**: Windows 11 desktop (Electron); nothing forecloses macOS/Linux.

**Project Type**: desktop application, npm-workspaces monorepo.

**Performance Goals**: SC-005 — occurrence tints on screen within 100 ms of a selection change in a
10,000-line document; typing latency unchanged with tinting on. The editor computes only the visible ranges;
the preview computes once per selection change, deferred one animation frame, against a text model cached per
draw.

**Constraints**: Principle XII (no work on the keystroke path; measured on a large input); FR-013 precedence
asserted once; FR-009 shipped values byte-identical; no hand-off over the navigation-history `viewState`
channel (preview-only, 1 KB, per history entry — R3).

**Scale/Scope**: `packages/core` (theme derivation, tokens, copy, metadata, shipped defaults, settings, the
occurrence model), `packages/ui` (main hand-off service + IPC, preload, renderer search/editor/preview/terminal/
workspace), docs, tests. No daemon change.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1. Constitution v5.9.0.*

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, satisfied.** The hand-off is keyed by panel id and claimed only by the window that mounts that panel; nothing crosses projects that the tear-off itself does not already carry. |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** The occurrence rule, the precedence rule and the colour derivation are pure core. The hand-off store is main-process Electron code behind an IPC contract. |
| **III. Detached, Tagged & Persistent Terminals** | **Engaged, satisfied.** A terminal's viewport and selection join the hand-off; its session, scrollback and output are untouched (edge case: output during a move is never lost — the destination's attach already replays scrollback). |
| **IV. Native Terminal Support** | **Not engaged** — no binding, no terminal input path. |
| **V. Test-First (NON-NEGOTIABLE)** | **Engaged, satisfied.** #455 and #456 start from failing reproductions (replicating-bugs); every task is test-first at the lowest layer (R13). |
| **VI. Simple, Modern, Discoverable UX** | **Engaged.** The setting is in Preferences; the Replace All prompt is the existing modal, keyboard-operable. No new panel action, so no menu item obligation. |
| **VII. Change Review & Approval** | **Not engaged.** |
| **VIII. SOLID, DRY & YAGNI** | **Engaged, decided three shapes.** One occurrence model for editor and preview (R8); one derivation for every match surface (R7); one hand-off for every kind of panel state rather than one channel per kind (R3). |
| **IX. DI & Composition Root** | **Engaged, satisfied.** The main-side hand-off store is constructed in `main.ts` beside the other services and handed to its IPC registrar. |
| **X. Externalised Configuration** | **Engaged.** One new setting; three new themeable tokens. FR-015's rules and the 2-character minimum are fixed by clarification (Complexity Tracking). |
| **XI. Dockable Workspace** | **Engaged — the high-risk row.** "A loaded Panel keeps its state" (v5.9.0) lists six known violations, all owned by this spec; R1, R3 and R12 discharge every one. "One document, one state" is untouched: nothing here is content state. "Focus follows the active Panel" decides active vs inactive selection. |
| **XII. Responsive UI (NON-NEGOTIABLE)** | **Engaged.** Occurrence tinting is new work on the selection path: viewport-bounded in the editor, frame-deferred in the preview, and measured on a 10,000-line input in tests (R10). |

### Development Workflow & Quality Gates

| Gate | Assessment |
|---|---|
| **Configuration-editor completeness** | Engaged: one setting descriptor; three theme tokens with label, description and area. |
| **Documentation currency** | Engaged: `docs/preferences.md` gains the setting row and the three tokens (FR-028); `docs-currency.test.ts` enforces the setting. |
| **Particular-scrutiny review** | Engaged: a new IPC surface carrying renderer-supplied JSON (size-capped, shape-checked in main). |
| **Constitution amendment** | None needed — v5.9.0 already carries the rule this spec delivers. |

**Result: PASS**, with two Principle X constants recorded below.

### Re-evaluation after Phase 1

Re-checked against research, data model and contracts. Two refinements, verdict unchanged:

- **XI**: a tear-off is a *copy*, not a move (`core/src/workspace/sub-workspace.ts:31-61`); the source window
  keeps its panel mounted. The hand-off therefore snapshots the live panel at the moment of sending (R3), not
  at an unmount that never happens. The comments in `search-store.ts:24-26, 299-304` and
  `use-editor.ts:2306-2309` claiming a session "travels with" a detached panel are wrong and are corrected.
- **XI**: `reattachPanel` exists in core but no UI route calls it; US6 scenario 3 is met by the hand-off being
  symmetric (any window stashes, any window claims), and is tested on the route that exists.

## Project Structure

### Documentation (this feature)

```text
specs/049-match-and-selection-highlighting/
├── spec.md
├── plan.md
├── research.md          # R1–R13
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── panel-state-handoff.md     # IPC + snapshot shape
│   └── surfaces-tokens-setting.md # match surfaces, CSS, setting, Replace All prompt
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── search/occurrence-model.ts          # NEW occurrenceQuery, occurrenceMatches, withoutSearchMatches
├── search/index / package index        # exports
├── config/default-themes/index.ts      # searchHighlights → occurrence, occurrenceInactive; selectionInactive
├── config/theme.ts                     # 3 tokens on THRONG_THEME (hand-measured)
├── config/theme-copy.ts, theme-metadata.ts, theme-quality.ts
├── config/shipped-defaults.ts          # version 18 → 19, additive upgrade
└── config/app-settings.ts, settings-metadata.ts   # editor.highlightOccurrences
packages/core/tests/unit/

packages/ui/src/main/
├── panel-state-handoff.ts              # NEW in-memory store
├── panel-state-handoff-ipc.ts          # NEW throng:panelState:stash / :claim
└── main.ts                             # composition
packages/ui/src/preload/preload.cts, renderer/global.d.ts   # window.throng.panelState
packages/ui/src/renderer/
├── search/search-store.ts              # attachPanelSearch re-apply; snapshot/seed; comments corrected
├── search/search-controller.ts         # restore(term, modes, anchor); currentFrom()
├── search/editor-search.ts             # restore; fold-aware reveal dependency; foldedSectionSlugs
├── search/find-bar.css                 # occurrence + inactive rules
├── search/replace-all-prompt.tsx       # NEW useChoose host (FR-007a)
├── editor/occurrence-highlight.ts      # NEW ViewPlugin, Prec.low
├── editor/editor-fold-reveal.ts        # NEW reveal via fold authority
├── editor/editor-view-state.ts         # peek for capture
├── editor/use-editor.ts, editor.css    # wiring; inactive selection CSS
├── terminal/terminal-view-state.ts, use-terminal.ts   # peek + capture
├── preview/highlight-registry.ts       # NEW per-panel composition of CSS.highlights
├── preview/preview-search.ts           # painter via registry; restore; matchRanges(); #455 fix
├── preview/preview-occurrences.ts      # NEW
├── preview/preview-selection.ts        # NEW retained selection (offsets, paint, restore)
├── preview/preview-panel.tsx           # wiring
├── workspace/panel-state-capture.ts    # NEW capture registry + snapshot/seed
├── workspace/detach-context.tsx        # stash before persist/open/notify
└── subworkspace-app.tsx                # claim + seed before mount
packages/ui/tests/{unit,component,integration,e2e}/

docs/preferences.md
```

**Structure Decision**: the existing layout. Rules and colours in core; the hand-off store in main; painting,
capture and seeding in the renderer. No new package.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **Principle X: FR-015's match rules and the 2-character minimum are constants** | Fixed by clarification and stated as fixed in the spec's Assumptions | A setting would contradict the clarified requirement |
| **Principle X: the hand-off's per-panel size cap (64 KB) is a constant** | Bounds renderer-supplied JSON held in main | A setting for an IPC safety limit is a preference nobody asked for (YAGNI) |
| **A second main-side per-panel store beside navigation history** | History's `viewState` is preview-only, per history entry, 1 KB and merges entries (R3) | Widening it would change Back/Forward semantics and persist transient state, which FR-000's assumption forbids |

## Iterate round 1 (2026-10-02)

FR-000b (a dropped panel takes focus) lands in the drop handler (`renderer/workspace/tab-group.tsx` `onDragEnd`):
after the move, the target tab is made active, the dropped panel its active panel, and focus is parked in
`panel-focus.ts` for the remounted view to take on registration (the outgoing view must not consume it). No new
module, IPC or setting. The four defects found in MT-01/MT-02 are fixes inside the existing renderer search and
preview files (tasks T053–T056); none changes this plan's design.
