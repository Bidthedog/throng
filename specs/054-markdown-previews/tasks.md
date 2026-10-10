# Tasks: 054 Markdown Previews — Restored Reuse, Outlining, Task Lists, Mermaid, Search Results, Maximise

**Input**: `specs/054-markdown-previews/` — spec.md, plan.md, research.md (R1–R10), data-model.md,
contracts/.

**Tests**: required — Principle V (test-first, NON-NEGOTIABLE). Every behaviour task is preceded by a
failing test at the layer research R10 names. Test paths follow the repo's projects: `tests/unit`,
`tests/component`, `tests/integration`, `tests/contract`, `tests/e2e` under each package.

**Ownership** (for parallel work): **core** = `packages/core/**`; **main** = `packages/ui/src/main/**`,
`packages/ui/src/preload/**`; **preview** = `packages/ui/src/renderer/preview/**`,
`packages/ui/src/renderer/find-in-files/**`; **workspace** = `packages/ui/src/renderer/workspace/**`,
`renderer/keybindings/**`, `renderer/preferences/**`, `renderer/editor/**`, `renderer/links/**`,
`renderer/common/**`, `renderer/explorer/**`, `theme.css`. Shared files with one owner: `vite.config.ts`
and `packages/ui/package.json` (preview), `package-lock.json` (preview), `docs/**` + `README.md` +
`CHANGELOG.md` (main orchestrator).

## Phase 1: Setup

- [ ] T001 Add `mermaid` 12.1.0 to `packages/ui/package.json` dependencies and install (lockfile updated); route `mermaid` and its transitive packages into a lazy `diagram` chunk in `packages/ui/vite.config.ts` and extend the `fail-on-eager-preview` plugin so an eager import of the chunk fails the build
- [x] T002 [P] Add five icon tokens `panelMaximise`, `panelRestore`, `diagramFit`, `diagramFullSize`, `diagramFullPane` to `packages/core/src/config/theme.ts` and their copy to `packages/core/src/config/theme-copy.ts`; bump `SHIPPED_DEFAULTS_VERSION` 20 → 21 in `packages/core/src/config/shipped-defaults.ts`, test first in `packages/core/tests/unit/default-themes.test.ts` (every token present in every shipped theme)

## Phase 2: Foundational

- [ ] T003 [P] Test: `FieldDescriptor.subsection` — `auditRegistry` rejects a `subsection` without `subgroup`; `groupDescriptors` nests subsection items under their subgroup, ungrouped-first order preserved, an all-filtered subsection disappears — in `packages/core/tests/unit/metadata-subgroup.test.ts` and `packages/ui/tests/unit/group-descriptors.test.ts`
- [ ] T004 Implement `subsection?: string` in `packages/core/src/config/metadata.ts` and the third bucket in `packages/ui/src/renderer/preferences/group-descriptors.ts`; `Subsection` gains a `level` prop (h4 / h5) and test id `settings-subsection-<group>-<subgroup>-<subsection>` in `packages/ui/src/renderer/preferences/subsection.tsx`; render it in `settings-tab.tsx`
- [ ] T005 [P] Test: preview panel type label and provider identity — `previewPanelTypeLabel(markdownProvider) === 'Markdown Preview'`; a config without `providerId` derives it from its file (FR-009); deriving twice gives the same answer and writes nothing new; a file with no enabled provider derives `undefined` (044's restore filter then applies, unchanged); title fallback uses it — in `packages/core/tests/unit/preview-panel-type.test.ts` and `preview-panel-title.test.ts`
- [ ] T006 Implement `previewPanelTypeLabel`, `PreviewPanelConfig.providerId?` (`packages/core/src/workspace/model.ts`), derivation helper `previewProviderIdOf(config, registry)` in `packages/core/src/preview/panel-type.ts`, and the title fallback in `packages/core/src/workspace/panel-title.ts` — the provider is the panel type's identity on the single `preview` kind (research R2)

## Phase 3: User Story 1 — restored preview reused by Last Active (P1)

**Goal**: FR-001 – FR-004, FR-007 (reuse half). **Independent test**: seeded layout with one preview; open another `.md`; still one preview panel.

- [ ] T007 [P] [US1] Test: recency fallback `initialPreviewRecency(tab, isPreview)` — uses `previewRecency` when present; else `[activePanelId]` if a preview; else previews in layout order — in `packages/core/tests/unit/preview-recency.test.ts`
- [ ] T008 [US1] Implement `Tab.previewRecency?: string[]` in `packages/core/src/workspace/model.ts` and `initialPreviewRecency` in `packages/core/src/workspace/preview-recency.ts`; export from `packages/core/src/index.ts`
- [ ] T009 [P] [US1] Test: `candidateFor(tabId, isLive, providerId)` returns only a same-provider live candidate; seeding from layout; `recordLastActivePreview` reports the new order to a persist callback — in `packages/ui/tests/unit/last-active-preview.test.ts`
- [ ] T010 [US1] Implement provider filter, `seedLastActivePreview(tabId, ids)` and a persist subscriber in `packages/ui/src/renderer/preview/last-active-preview.ts`; workspace-store op `setPreviewRecency` (debounced save) and seeding in the load effect in `packages/ui/src/renderer/state/workspace-store.tsx`
- [ ] T011 [P] [US1] Component test: a restored layout with one preview + Last Active → `openPreview` for another `.md` sends `reusePanelId` = the restored panel; with two restored previews the persisted most-recent wins; New Preview Panel unaffected; a preview in a background tab is never reused — in `packages/ui/tests/component/open-preview-restored.test.ts`
- [ ] T012 [US1] Pass the opened file's provider id through `openPreview` (`packages/ui/src/renderer/preview/open-preview.ts`) and the Explorer's Last Preview Panel row (`packages/ui/src/renderer/explorer/file-tree.tsx`); write `providerId` on place
- [ ] T013 [P] [US1] Integration test: layout with `previewRecency` round-trips through the repository and an old layout without it loads — in `packages/ui/tests/integration/preview-persistence.integration.test.ts`

## Phase 4: User Story 2 — tick task lists (P1)

**Goal**: FR-020 – FR-029. **Independent test**: every list shape toggles the right line only.

- [ ] T014 [P] [US2] Test: `locateTaskToggle(text, line, expectChecked, itemText)` — `-`/`*`/`+`/`1.`/`1)` markers, nested and block-quoted items, `[x]`/`[X]` → `[ ]`, `[ ]` → `[x]`; moved item relocated by unique text; duplicate text → `ambiguous`; state mismatch → `changed`; missing → `not-found`; CRLF text preserved around the edit — in `packages/core/tests/unit/task-toggle.test.ts`
- [ ] T015 [US2] Implement `locateTaskToggle` in `packages/core/src/preview/task-toggle.ts`; add `TaskToggleRequest`/`TaskToggleResponse` to `packages/core/src/preview/wire-types.ts` exactly as `contracts/preview-ipc-054.md`
- [x] T016 [P] [US2] Test: pipeline emits `data-task-line` = item's source line (front-matter offset applied) on each checkbox, no `disabled`; sanitiser keeps checkboxes, allows only numeric `data-task-line`, still removes non-checkbox inputs — update `packages/ui/tests/unit/markdown-pipeline-gfm.test.ts` (044 FR-080 supersession) and `packages/ui/tests/component/preview-sanitise.test.ts`
- [x] T017 [US2] Implement in `packages/ui/src/renderer/preview/providers/markdown/pipeline.ts` (task rule + renderer rule) and `sanitise.ts` (stop forcing `disabled`; allow `data-task-line` matching `^\d+$`)
- [ ] T018 [P] [US2] Test: `EditorCoordinator.applyExternalEdit` applies one change as one undo entry, relays to all views, marks dirty; `textFileRewrite` preserves encoding, BOM, CRLF and mixed endings, refuses binary/non-UTF-8, maps EACCES/EPERM/EROFS→readOnly, EBUSY→locked, ENOENT→missing — in `packages/ui/tests/integration/text-file-rewrite.integration.test.ts` and `editor-external-edit.integration.test.ts`
- [ ] T019 [US2] Extract `textFileRewrite` from `ReplaceCommitService.writeDirect` into `packages/ui/src/main/text-file-rewrite.ts` (replace keeps its behaviour, its tests stay green) and add `applyExternalEdit` to `packages/ui/src/main/editor-coordinator.ts`
- [ ] T020 [P] [US2] Integration test: `TaskToggleService` — open clean document → edited and saved, `savedToDisk:true`, and undo then removes the toggle and leaves the document unsaved; open dirty document → edited, unsaved edits kept, `savedToDisk:false`, undo removes only the toggle; not open → file rewritten one marker; read-only → `readOnly`, file unchanged; out of project → `outOfTree` — in `packages/ui/tests/integration/task-toggle.integration.test.ts`
- [ ] T021 [US2] Implement `TaskToggleService` in `packages/ui/src/main/task-toggle-service.ts`, IPC `throng:preview:toggleTask` (validation per contract) in `packages/ui/src/main/preview-ipc.ts`, preload `preview.toggleTask` in `packages/ui/src/preload/preload.cts`, composition in `packages/ui/src/main/main.ts`
- [ ] T022 [P] [US2] Contract test: `throng:preview:toggleTask` request/response shape and rejection of malformed input — in `packages/ui/tests/contract/preview-ipc.contract.test.ts`
- [x] T023 [P] [US2] Component test: clicking or pressing Space on a checkbox calls `toggleTask` with line, expected state and item text, prevents the native toggle; a refusal raises one notice and the box keeps its state; after a successful toggle re-render the scroll position is unchanged (FR-026); typing/paste/drop still change nothing (044 FR-020 rest intact) — in `packages/ui/tests/component/preview-task-toggle.test.ts` and update `preview-read-only.test.ts`
- [x] T024 [US2] Implement the click/Space handler in `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx` (new `onToggleTask` body prop in `provider-view.ts`) and the panel wiring + refusal notice in `packages/ui/src/renderer/preview/preview-panel.tsx`, worded via the existing failure wording

## Phase 5: User Story 3 — search results open the preview (P1)

**Goal**: FR-030 – FR-034, FR-004. **Independent test**: Preview default + result double-click → preview with match highlighted.

- [ ] T025 [P] [US3] Component test: with Markdown default open action Preview, a result opens through `openPreview` (Last Active reuse / New Preview Panel / already-previewed → focus incl. tab switch) with a pending reveal; a file already open in an editor with a parented preview → that preview is focused and reveals the match, the editor's caret untouched (US3 scenario 5, via FR-004); Editor default → `openResultRow` unchanged; Open In menu unchanged — update `packages/ui/tests/component/editor-open-router.test.ts:235-257` (044 FR-054 supersession) and add `packages/ui/tests/component/find-in-files-open-preview.test.ts`
- [ ] T026 [US3] Route the opener in `packages/ui/src/renderer/find-in-files/find-in-files-chrome.tsx` by `defaultOpenActionFor`; add `pendingReveal` to `packages/ui/src/renderer/preview/preview-panel-handles.ts` and pass `reveal` through `open-preview.ts`
- [ ] T027 [P] [US3] Component test: a pending reveal scrolls the match's block into view, expands a folded section, paints the match with the find highlight; a match not in rendered text (hidden front matter, inside a diagram) falls back to opening the editor at the range — in `packages/ui/tests/component/preview-reveal-match.test.ts`
- [ ] T028 [US3] Implement reveal-on-draw in `packages/ui/src/renderer/preview/preview-panel.tsx` using `blockLineFor`, `findPreviewMatches`, `revealBeforeScroll` and the CSS highlight painter; fallback through `openResultRow`
- [ ] T029 [US3] Update the default-open-action description in `packages/core/src/config/preview-settings.ts:216` (test in `packages/core/tests/unit/preview-settings.test.ts`) to say Find in Files results follow it

## Phase 6: User Story 4 — Mermaid in Markdown previews (P2)

**Goal**: FR-040 – FR-049a, FR-046a – FR-046h. **Independent test**: flowchart + sequence + invalid + code block fixture.

- [ ] T030 [P] [US4] Test: `DIAGRAM_SVG_PROFILE` sanitiser strips `script`, `foreignObject`, `on*` attributes, external `href`/`xlink:href`, `javascript:`; keeps shapes, text, local `#` refs — in `packages/ui/tests/unit/diagram-svg-sanitise.test.ts`
- [ ] T031 [US4] Implement `sanitiseDiagramSvg` in `packages/ui/src/renderer/preview/diagram/svg-sanitise.ts`
- [ ] T032 [P] [US4] Test: block-renderer registry — a fence whose language has a renderer is handed to it after the document sanitiser; others stay highlighted code; a test-only renderer registers without touching the body — in `packages/ui/tests/unit/block-renderers.test.ts`
- [ ] T033 [US4] Implement `packages/ui/src/renderer/preview/blocks/block-renderers.ts` (registry keyed by fence language, lazy `load()`), the post-insert pass in `markdown-body.tsx` beside `highlightCodeBlocks`, and exclude claimed blocks from highlighting in `highlight.ts`; update `packages/ui/tests/component/preview-highlight.test.ts`'s mermaid-stays-code case (044 FR-086 supersession: it stays code only with Render Mermaid diagrams off)
- [ ] T034 [P] [US4] Test: `mermaid-renderer` initialises with `securityLevel:'strict'`, `startOnLoad:false`, `htmlLabels:false`, theme variables from the active theme tokens; output always passes `sanitiseDiagramSvg`; a render exceeding `DIAGRAM_RENDER_TIMEOUT_MS = 5000` rejects as a timeout — with a fake mermaid module, in `packages/ui/tests/unit/mermaid-renderer.test.ts`
- [ ] T035 [US4] Implement `packages/ui/src/renderer/preview/diagram/mermaid-renderer.ts` (dynamic `import('mermaid')`, theme-variable mapping, timeout race) and register `mermaid` in the block registry
- [ ] T036 [P] [US4] Component test: `DiagramBlock` — renders sanitised SVG; parse error with no earlier render → one inline notice naming the error; error after a good render → last good SVG dimmed + notice above; next valid render clears both; state kept by ordinal across edits elsewhere; a render timeout shows the same inline notice (FR-048); theme change re-renders; Render Mermaid diagrams off → code block again; a diagram-free preview never imports the renderer — in `packages/ui/tests/component/preview-diagram-block.test.ts`
- [ ] T037 [US4] Implement `packages/ui/src/renderer/preview/diagram/diagram-block.tsx` and the `renderMermaid` Markdown own setting (`packages/core/src/preview/providers/markdown.ts`, test in `packages/core/tests/unit/preview-settings.test.ts`), honoured by the block pass
- [ ] T038 [P] [US4] Component test: `DiagramFrame` — toolbar top-left with Fit / Full Size / Zoom In / Zoom Out / Full Pane in that order, fixed while zoomed and panned; Fit clamps scale to [0.5, 1] by width and scrolls below the floor; zoom ×1.25 in [0.1, 8]; middle-button drag pans and calls `preventDefault`; Full Size adds the panel-filling class and Fit restores; each control focusable with a title; view state reset on remount — in `packages/ui/tests/component/preview-diagram-frame.test.ts`
- [ ] T039 [US4] Implement `packages/ui/src/renderer/preview/diagram/diagram-frame.tsx` and its styles in `packages/ui/src/renderer/preview/diagram/diagram.css` (imported by the component; colours from theme CSS variables only)
- [ ] T040 [P] [US4] Component test: copy with a diagram in the selection — plain text contains a fenced `mermaid` block of the source in place; rich HTML contains one `<img src="data:image/png;base64,…">` in place and the exporter admits only that data-URI shape (jsdom has no canvas: inject the rasteriser as a dependency and fake it with a fixed data URI) — in `packages/ui/tests/component/preview-copy.test.ts`
- [ ] T041 [US4] Implement diagram substitution in `packages/ui/src/renderer/preview/copy.ts` and the PNG rasteriser `packages/ui/src/renderer/preview/diagram/rasterise.ts`; widen `EXPORT_PROFILE` in `sanitise.ts` for `data:image/png;base64` only
- [ ] T042 [P] [US4] Component test: hostile diagram fixture (click directives, script in labels, `javascript:` URL, remote image reference) executes nothing and requests nothing; sanitiser spy called for embedded diagrams — in `packages/ui/tests/component/preview-diagram-hostile.test.ts` with fixture `packages/ui/tests/fixtures/preview/mermaid-hostile.md`

## Phase 7: User Story 5 — standalone Mermaid files (P3)

**Goal**: FR-042, FR-049, FR-005/FR-006 for a second type. **Independent test**: `.mmd` preview follows its buffer.

- [ ] T043 [US5] Test: registry has `mermaid` (`.mmd`, `.mermaid`, text); settings generated for it (enabled, defaultOpenAction) — its `openTarget` leaf and Mermaid subsection are asserted in T055 (US7); disabling it closes its previews (existing FR-063 path) — in `packages/core/tests/unit/preview-registry.test.ts` and `preview-settings.test.ts`
- [ ] T044 [US5] Implement `packages/core/src/preview/providers/mermaid.ts` and register it in `packages/core/src/preview/providers/index.ts`
- [ ] T045 [P] [US5] Component test: a `.mmd` preview renders the whole file through `DiagramBlock`/`DiagramFrame`, follows content updates, shows the parse notice, sanitiser in the path; `provider-views.test.ts` view id equals descriptor id — in `packages/ui/tests/component/preview-mermaid-standalone.test.ts`
- [ ] T046 [US5] Implement `packages/ui/src/renderer/preview/providers/mermaid/view.ts` + `mermaid-body.tsx` and register in `packages/ui/src/renderer/preview/providers/index.ts`; guard Markdown-only assumptions in `preview-panel.tsx` (`isFoldableProvider`, gutter) so they stay off for Mermaid
- [ ] T047 [P] [US5] Integration test: `PreviewService.navigate` to a file of another provider answers `reroute` (FR-008); same provider navigates in place — in `packages/ui/tests/integration/preview-service-open-target.integration.test.ts`
- [ ] T048 [US5] Implement `reroute` in `packages/ui/src/main/preview-service.ts` and handle it in the renderer link-follow path (`packages/ui/src/renderer/preview/preview-panel.tsx`) as an ordinary open

## Phase 8: User Story 6 — Outlining submenu (P3)

**Goal**: FR-010 – FR-014. **Independent test**: nested fixture, Collapse All Inside This H2.

- [ ] T049 [P] [US6] Test: `collapseWithin` / `expandWithin` set the section and every descendant individually, leave others, a leaf acts as its own section — in `packages/core/tests/unit/fold-state.test.ts`
- [ ] T050 [US6] Implement in `packages/core/src/outline/fold-state.ts`
- [x] T051 [P] [US6] Test: actions `markdown.collapseAllInside` / `markdown.expandAllInside` exist, MARKDOWN_SURFACES, unbound, described in metadata; collisions empty — in `packages/core/tests/unit/keybindings-054.test.ts`
- [x] T052 [US6] Implement in `packages/core/src/config/keybindings.ts` and `keybindings-metadata.ts`
- [ ] T053 [P] [US6] Component test: preview and editor body menus show one Outlining submenu with the six rows in contract order, none at top level, All Inside absent before the first heading, no submenu for non-Markdown, shortcuts shown; choosing All Inside folds the right sections in both linked views — update `preview-fold-menu.test.ts`, `editor-markdown-fold-menu.test.ts` (047 FR-036 supersession) and `packages/ui/tests/unit/menu-sections.test.ts`
- [ ] T054 [US6] Implement `packages/ui/src/renderer/common/outlining-menu.ts`; use it in `packages/ui/src/renderer/preview/content-menu.ts` and `packages/ui/src/renderer/editor/content-menu.ts`; resolve the two commands in `preview-panel.tsx` and the editor fold command handler

## Phase 9: User Story 7 — preview settings audit (P3)

**Goal**: FR-050 – FR-055. **Independent test**: seeded New Preview Panel survives under both providers.

- [ ] T055 [US7] Test: `parsePreviewSettings` migrates top-level `openTarget` to every provider's `openTarget` (Markdown and Mermaid) when absent; a provider's own value wins; re-parse is a no-op; the retired top-level leaf is not in the parse output (the section rebuild 019 FR-023 relies on — a write therefore drops it; top-level hand-added keys are a different case, `settings-validity.test.ts:57`); descriptors placed per FR-051 (shared under Previews, provider leaves with `subsection: displayName`, labels `"<displayName>: Open previews in"`); `editor.markdownSectionsOpen` in Previews → Markdown with key unchanged — in `packages/core/tests/unit/preview-settings.test.ts`, `settings-metadata-040.test.ts`, `settings-047.test.ts`
- [ ] T056 [US7] Implement in `packages/core/src/config/preview-settings.ts`, `packages/core/src/preview/settings-types.ts`, `packages/core/src/config/settings-metadata.ts`; switch readers of `previews.openTarget` (`open-preview.ts`, `file-tree.tsx`, links) to the provider's
- [ ] T057 [P] [US7] Component test: Settings tab renders Editor → Previews with shared rows then Markdown and Mermaid subsections in contract order; search "open previews" finds both provider rows; an all-filtered subsection disappears — update `packages/ui/tests/component/settings-tab-previews.test.ts`, `settings-tab-subgroups.test.ts`
- [ ] T058 [US7] Add `packages/core/tests/unit/settings-inertness-054.test.ts` (every new leaf has a descriptor and a production reader) and satisfy it

## Phase 10: User Story 8 — maximise panels and sections (P2)

**Goal**: FR-070 – FR-077, FR-071a, FR-046f. **Independent test**: three split panels, maximise each type, modal rules, restore exact.

- [x] T059 [P] [US8] Test: maximise store transitions per data-model table (maximise, nest section, pop one, close panel, type change, section unmount, open into hidden panel clears) — in `packages/ui/tests/unit/maximise-store.test.ts`
- [x] T060 [US8] Implement `packages/ui/src/renderer/workspace/maximise-store.ts` and hook `useTabMaximise(tabId)`
- [x] T061 [US8] Test: `panel.toggleMaximise` default `Alt+Shift+Enter`, PANELS, in `WINDOW_HANDLED_ACTIONS`, described; `chordCollisions` and `twoStrokeTerminalViolations` empty — in `packages/core/tests/unit/keybindings-054.test.ts`
- [x] T062 [US8] Implement in `packages/core/src/config/keybindings.ts`, `keybindings-metadata.ts`; `isPanelScoped` in `packages/ui/src/renderer/keybindings/scope.ts`; dispatcher case in `window-dispatcher.tsx`; `packages/ui/tests/shared/window-chords.ts` manifest
- [x] T063 [P] [US8] Component test: the window dispatcher consumes Alt+Shift+Enter in a focused terminal and editor, and does **not** consume Shift+Enter or Ctrl+Enter there (they reach xterm's key handler / CodeMirror unchanged) — in `packages/ui/tests/component/maximise-keys.test.ts`
- [ ] T064 [P] [US8] Component test (mount-tab-group): maximising a panel keeps it mounted (same DOM node, no remount of a terminal or editor), marks `.tab-body[data-maximised]`, hides others with `inert`; header + disabled, Split rows disabled, drop zones not shown, Open In / link Open In omit hidden panels; an open into a hidden panel restores first; a maximised preview under Last Active is reused in place without restoring; a maximised panel whose type changes stays maximised; closing the maximised panel restores the tab; maximising and restoring write nothing to the layout (no save scheduled, FR-076); switch tab and back keeps it; restore leaves split sizes unchanged; Esc restores except in `.xterm`/`.cm-editor`/find bar/overlay — in `packages/ui/tests/component/maximise-panel.test.ts`
- [ ] T065 [US8] Implement header control and title-menu row (`panel-placeholder.tsx`, `panel-header-menu.ts`), CSS in `theme.css`, `data-maximised` on `.tab-body` and modal gates in `tab-group.tsx`, `split-tree.tsx`, `split-panel.ts`, `outer-edge-zones.tsx`, `editor/drop-target.tsx`, `editor/tree-drop-target.tsx`, `editor/open-in-targets.ts`, `links/link-open-in.ts`, `editor/editor-open.tsx`, `preview/open-preview.ts` (message preview owner)
- [ ] T066 [P] [US8] Component test: `MaximiseLayer` portal — a section target renders over the tab body (or over the maximised panel when nested), keeps the section's state, Esc steps back one level, the section unmounting restores — in `packages/ui/tests/component/maximise-section.test.ts`
- [ ] T067 [US8] Implement `packages/ui/src/renderer/workspace/maximise-layer.tsx` (portal host in `.tab-body`, Esc capture listener) and wire `DiagramFrame` Full Pane to it (preview owner)

## Phase 11: E2E (real window only)

- [ ] T068 [P] Test E2E `packages/ui/tests/e2e/preview-mermaid.e2e.ts` (`@extended @editor`): a `.md` with a flowchart renders an SVG with themed fill in a dark theme; a `.mmd` standalone preview renders; invalid source shows the notice — own app
- [ ] T069 [P] Test E2E `packages/ui/tests/e2e/maximise-terminal.e2e.ts` (`@extended @window`): three split panels; Alt+Shift+Enter in a terminal maximises it; Shift+Enter still sends `\x1b[13;2u` to a kitty-negotiating program (reuse `terminal-modified-enter` harness); restore leaves the layout unchanged
- [ ] T070 Re-seed `packages/ui/tests/e2e/e2e-budget.json`; add T069's spec to `packages/ui/tests/e2e/parallel-plan.json` serial tier if `tier-plan.test.ts` requires it

## Phase 12: Polish & cross-cutting

- [ ] T071 [P] Docs: `docs/key-bindings.md` (3 actions with ids; Alt+Shift+Enter terminal note), `docs/preferences.md` (every new/moved leaf with key, the Previews → Markdown / Mermaid layout, Open previews in migration), `docs/quick-start.md` (task lists, diagrams and controls, maximise), `README.md` (one Highlights line), `CHANGELOG.md` unreleased — `docs-currency.test.ts` green
- [ ] T072 Run the lint, typecheck, unit, component, integration and contract projects locally; fix anything red
- [ ] T073 Manual test plan `specs/054-markdown-previews/manual-test-plan.md` via planning-manual-tests (groups per user story, Covers FR/SC ids)

## Dependencies

- Setup T001–T002 → everything diagram/maximise-related.
- Foundational T003–T006 → US1 (T006 providerId), US5, US7 (T004 subsection).
- US1 independent of US2–US8 after T006. US2 independent. US3 needs T026's reveal plumbing only. US4 → US5 (DiagramBlock/Frame). US8's section half (T066–T067) needs US4's `DiagramFrame` (T039). US7 needs US5 (Mermaid subsection) for its full layout.
- E2E after US4, US5, US8. Docs after all.

## Parallel examples

- **core** owner: T002, T005–T008, T014–T015, T043–T044, T049–T052, T055–T056, T058, T061–T062 (core half).
- **main** owner: T018–T022, T047–T048 (main half).
- **preview** owner: T001, T016–T017, T023–T028, T030–T042, T045–T046, T048 (renderer half), T067 (frame wiring).
- **workspace** owner: T003–T004 (renderer half), T053–T054, T057, T059–T060, T062 (renderer half), T063–T067.

## Implementation strategy

MVP is US1 + US2 + US3 (the P1 stories, small and independent). Then US4/US5 (Mermaid), US8
(maximise, which US4's Full Pane completes), US6, US7. Each story's tests are written and seen failing
before its implementation.
