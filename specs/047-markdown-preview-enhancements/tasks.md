---

description: "Task list for 047 Markdown Preview Enhancements"
---

# Tasks: Markdown Preview Enhancements

**Input**: Design documents from `specs/047-markdown-preview-enhancements/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R14), data-model.md, contracts/

**Tests**: Mandatory — constitution Principle V (test-first, lowest layer). Every implementation task is
preceded by its failing test task; run the test, read why it fails, then implement. No E2E is added
(research R14).

**Organization**: Grouped by user story (spec.md). Paths are repository-relative. `core` =
`packages/core`, `ui` = `packages/ui`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task
- **[Story]**: US1–US7 as in spec.md

---

## Phase 1: Setup

- [x] T001 Confirm the baseline before any change: `npm run lint`, `npm run build`, `npm run test:unit`, `npm run test:component` green at the branch base (recorded in the autopilot ledger); no code change

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: the shared heading model, fold reducer, command/setting/token declarations and the chord
engine every story leans on.

### Heading model (R2)

- [x] T002 [P] Write failing unit tests for `DocumentSymbol`, `HeadingRecord` and `buildSymbolTree` (nesting by level, h1→h4 still a child, empty list, document order) in `core/tests/unit/document-symbol.test.ts`
- [x] T003 Implement `DocumentSymbol` `{name, level, line, slug, children}`, `HeadingRecord` `{level, text, slug, line}` and `buildSymbolTree` in `core/src/outline/document-symbol.ts`; export from the core barrel
- [x] T004 Write failing unit tests that the Markdown pipeline's `render()` returns `{fragment, headings}` with one `HeadingRecord` per heading token — ATX, setext at its level, duplicate text with distinct slugs, none for `#` in front matter, fenced or indented code, none for raw-HTML `<h2 data-heading-slug="spoof">` — in `ui/tests/unit/markdown-pipeline-headings.test.ts`
- [x] T005 Make `createMarkdownPipeline.render()` return `{fragment, headings}`, collecting `{level, text: headingText(inline), slug, line}` alongside the existing `RenderState.headingSlugs`, in `ui/src/renderer/preview/providers/markdown/pipeline.ts`; update every caller of `render()` (`markdown-renderer.ts`, `markdown-body.tsx`) to take `.fragment`
- [x] T006 Write a failing parity test: one fixture (setext, duplicates, inline markup, front matter, fences) produces identical slug lists from the pipeline and from the editor-side extractor, in `ui/tests/unit/heading-slug-parity.test.ts`
- [x] T007 Implement the editor-side extractor `markdownHeadingRecords(state)` over the Lezer tree (`ATXHeading1–6`, `SetextHeading1–2`) using core `markdownInlineText` + `headingSlug` with one de-dup set, in `ui/src/renderer/editor/markdown-headings.ts`

### Fold state (R3)

- [x] T008 [P] Write failing unit tests for the `FoldState` reducer — `initialFold`, `isCollapsed`, `setSection`/`toggleSection` leave other slugs untouched (FR-030a), `collapseAll`/`expandAll` reset `flipped` (FR-037a), `toggleAll`, `prune`, `revealing` (FR-040), `visibleSections` (collapsed ancestor hides descendants; re-expanding restores them), `flipped` always sorted and unique — in `core/tests/unit/fold-state.test.ts`
- [x] T009 Implement the reducer, `FoldState = { base: 'expanded' | 'collapsed'; flipped: readonly string[] }`, in `core/src/outline/fold-state.ts`; export from the barrel

### Declarations: commands, scopes, settings, tokens

- [x] T010 Write failing core tests: `FIND_SURFACES = {editor, terminal, preview}` carries `search.find`, `search.findNext`, `search.findPrevious`, `search.close`, while `search.replace`, `search.replaceCurrent`, `search.replaceAll` stay on `PANELS`; `MARKDOWN_SURFACES = {editor, preview}` carries the six `markdown.*` actions; `preview.goToHeading` is `{preview}` with default `Ctrl+G`; defaults `Ctrl+M,M` toggleSection, `Ctrl+M,L` toggleAll, `Ctrl+M,S` collapseSection, `Ctrl+M,E` expandSection, `Ctrl+M,A` collapseAll, `Ctrl+M,X` expandAll; no chord collision; no terminal two-stroke violation — in `core/tests/unit/keybindings-scope.test.ts` and `core/tests/unit/keybindings-047.test.ts`
- [x] T011 Add the seven action ids, `FIND_SURFACES`, `MARKDOWN_SURFACES`, the `COMMAND_SCOPES` entries and `WINDOWS_BINDINGS` defaults in `core/src/config/keybindings.ts`; move the four find actions to `FIND_SURFACES`; update the comments at `:190-195` and `:499-501` that say a preview has no find bar
- [x] T012 Add metadata rows (group, label, description) for the seven actions in `core/src/config/keybindings-metadata.ts` without separating `editor.toggleWordWrap` from `preview.toggleSyncScroll` (ordering pin); extend `ACTION_TIER` and replace the hard-coded two-stroke exemption with a named list in `core/tests/unit/keybindings-tiers.test.ts`, and the `NEW_COMMANDS` pin in `core/tests/unit/keybindings-scope.test.ts`
- [x] T013 Write failing tests for the four settings — `editor.previews.openTarget` (`'lastActive' | 'new'`, default `'lastActive'`, Editor → Previews, description "Last Active reuses the most recently used preview in the tab you are looking at; otherwise a new preview opens." — FR-015a), `editor.previews.providers.markdown.gutter` (boolean, default `true`, label "Markdown: Preview gutter"), `editor.previews.providers.markdown.headingJumpMs` (number 0–2000, default `200`), `editor.markdownSectionsOpen` (`'expanded' | 'collapsed'`, default `'expanded'`, group Editor, no subgroup, label "Markdown sections open") — parse, defaults, descriptors, completeness — in `core/tests/unit/preview-settings.test.ts` and `core/tests/unit/settings-047.test.ts`
- [x] T014 Implement `openTarget` in `core/src/preview/settings-types.ts` and `core/src/config/preview-settings.ts`; the `gutter` and `headingJumpMs` provider leaves in `core/src/preview/providers/markdown.ts` (no leaf name in comments — inertness guard); `markdownSectionsOpen` in `core/src/config/app-settings.ts` (interface, default, tolerant parse, the hand-listed return literal) and its descriptor in `core/src/config/settings-metadata.ts`
- [x] T015 [P] Write a failing test that the four icon tokens `foldSectionExpanded` '−', `foldSectionCollapsed` '+', `foldPreviewExpanded` '▾', `foldPreviewCollapsed` '▸' exist in `THRONG_THEME` and every bundled theme, with copy, and that `SHIPPED_DEFAULTS_VERSION` is 17, in `core/tests/unit/theme-icons-047.test.ts`
- [x] T016 Add the four tokens in `core/src/config/theme.ts`, their label/description in `core/src/config/theme-copy.ts`, and bump `SHIPPED_DEFAULTS_VERSION` 16 → 17 in `core/src/config/shipped-defaults.ts`; optional `SVG_SHAPES` in `ui/src/main/icon-pack-service.ts`
- [x] T017 Write the inertness guard `core/tests/unit/settings-inertness-047.test.ts` listing the four new keys (it fails until each has a reader — expected to go green only as US2/US3/US4 land)

### Chord engine (R5)

- [x] T018 Write failing unit tests for an extracted chord engine — first stroke arms, matching second stroke fires once, unbound second stroke reports and resets, Escape/blur/modifier-release/4 s timeout reset, pending-indicator events — in `ui/tests/unit/chord-engine.test.ts`
- [x] T019 Extract the two-stroke state machine from `multiStrokeChords` (`ui/src/renderer/editor/commands.ts:671-800`) into `ui/src/renderer/keybindings/chord-engine.ts`; make the CodeMirror plugin a thin host over it; existing editor chord tests (`Ctrl+E,W`) stay green

**Checkpoint**: heading model, fold reducer, declarations and chord engine exist; stories can start.

---

## Phase 3: User Story 1 — Find in a preview (P1) 🎯 MVP

**Goal**: the editor's find bar works in a Markdown preview, find only (FR-001 – FR-008).
**Independent test**: preview a document, Ctrl+F, type, step through matches; Ctrl+H does nothing.

- [x] T020 [US1] Update the tests that pin today's inertness to the superseded rule (044 FR-021 → FR-004): `Ctrl+F`/`F3`/`Shift+F3`/`Escape` resolve in scope `preview`, `Ctrl+H`/`Alt+Enter`/`Ctrl+Alt+Enter` still do not, in `ui/tests/unit/scope.test.ts:161-205` and `ui/tests/component/preview-read-only.test.ts:153-166`
- [x] T021 [P] [US1] Write failing unit tests for the preview text model and matcher — TreeWalker text, offset→(node, offset) map, `**bold**` found as `bold`, match case / whole word via core `editorMatches`, fold toggles and `aria-hidden` excluded, collapsed sections included, hidden front matter absent — in `ui/tests/unit/preview-search-model.test.ts`
- [x] T022 [US1] Implement `PreviewSearchController` (`panelKind: 'preview'`; `seedFromSelection`, `setQuery`, `findNext`, `findPrevious`, `close`) and the `HighlightPainter` seam (CSS Custom Highlight API: `throng-preview-match`, `throng-preview-match-current`) in `ui/src/renderer/preview/preview-search.ts`; widen the `SearchController` union in `ui/src/renderer/search/search-controller.ts`
- [x] T023 [US1] Widen `FindPanelKind` to include `'preview'` in `ui/src/renderer/search/search-store.ts` and map the preview kind in `ui/src/renderer/search/search-keybindings.tsx:109-111` (replace stays editor-only)
- [x] T024 [US1] Write failing component tests with the recording painter: Ctrl+F opens the bar in a focused preview with focus in the query; typing paints all matches and a current one and shows the editor's count format; next/previous wrap and scroll the current into view; no replace disclosure or row; re-render recomputes and keeps the nearest match (FR-005); closing clears; current match inside a collapsed section reveals it (FR-040) — in `ui/tests/component/preview-find.test.ts`
- [x] T025 [US1] Mount `<FindBar panelId>` in the preview root and register/unregister the controller; re-run the active query from the body's `onDrawn`, in `ui/src/renderer/preview/preview-panel.tsx`
- [x] T026 [P] [US1] Add `::highlight(throng-preview-match)` / `::highlight(throng-preview-match-current)` rules from the `--throng-colour-searchMatch*` tokens (FR-006) in `ui/src/renderer/search/find-bar.css`; extend any preview-CSS token guard that scans it
- [x] T027 [P] [US1] Write a failing test that the find bar's `N of M` is digit-grouped for 1,234 matches in `ui/tests/unit/find-count-label.test.ts`, then group it through the shared quantity formatter in `ui/src/renderer/search/find-bar.tsx`
- [x] T028 [US1] Write a failing component test that the preview body menu and header menu offer **Find…** with its chord (FR-007), then add the items in `ui/src/renderer/preview/content-menu.ts` and `ui/src/renderer/workspace/panel-header-menu.ts`

**Checkpoint**: US1 complete and independently testable.

---

## Phase 4: User Story 2 — Open previews in place (P1)

**Goal**: Open previews in = Last Active reuses the last preview in the visible tab (FR-010 – FR-016).
**Independent test**: default open action Preview, click two `.md` files → one panel, Back works.

- [x] T029 [P] [US2] Write failing unit tests for `last-active-preview.ts` — per-tab most-recent-first list, pointerdown and focus both record, closed panels skipped at read, another tab never returned — in `ui/tests/unit/last-active-preview.test.ts`
- [x] T030 [P] [US2] Implement `ui/src/renderer/preview/last-active-preview.ts` and record on the preview panel's pointerdown and focus in `ui/src/renderer/preview/preview-panel.tsx`
- [x] T031 [P] [US2] Extend the wire types: `PreviewOpenRequest.target?: { mode: 'lastActive' | 'new'; reusePanelId: string | null }`, answer `{ kind: 'navigated'; panelId }`, navigate intents `{kind:'open'}` and `{kind:'drop'}`, in `core/src/preview/wire-types.ts`
- [x] T032 [US2] Write failing integration tests on `PreviewService.open`: Last Active + live `reusePanelId` in the requesting window → run moved, history appended (FR-103), `navigated`; file already previewed → `focused` first (FR-013); `reusePanelId` in another window or dead → new placement; `mode:'new'` → placement; a parented reuse unbinds and Back re-derives the pairing while the editor is open and standalone once it closed (FR-016/016a); parented placement branches unchanged (FR-012) — in `ui/tests/integration/preview-service-open-target.integration.test.ts`
- [x] T033 [US2] Implement the standalone-branch reuse and the `open` intent in `ui/src/main/preview-service.ts` (`open` :283-361, `navigate`/`moveRun`), and pass `target` through `ui/src/main/preview-ipc.ts`
- [x] T034 [US2] Add the `target` field and `navigated` answer to `ui/tests/contract/preview-ipc.contract.test.ts`
- [x] T035 [US2] Write failing component tests: `openPreview` sends the setting's mode and the visible tab's candidate; `navigated` focuses the reused panel; Quick Open and the default-open router pass the target — in `ui/tests/component/open-preview.test.ts`
- [x] T036 [US2] Send `target` from `ui/src/renderer/preview/open-preview.ts` (`openPreview`, `requestPreviewOpen`), `ui/src/renderer/editor/open-router.ts` and `ui/src/renderer/navigate/quick-open.tsx`, reading `editor.previews.openTarget`; handle `navigated`
- [x] T037 [US2] Write failing component tests for the Open In rows **Last Preview Panel** and **New Preview Panel** — present for provider files, disabled while provider off / file previewed / (Last) no preview in the visible tab — in `ui/tests/component/explorer-open-in-preview.test.ts`, then add them in `ui/src/renderer/explorer/context-menu-items.ts` and wire them in `ui/src/renderer/explorer/file-tree.tsx`

**Checkpoint**: US2 complete.

---

## Phase 5: User Story 3 — Section folding in editor and preview (P2)

**Goal**: linked folding, gutter, context-sensitive menus, chords, preference (FR-030 – FR-041d).
**Independent test**: fold in the editor, see it in the preview, and back.

### Main: one fold state per document

- [x] T038 [US3] Write failing integration tests on the coordinator's fold map: `foldState` seeds `initialFold(seed)` once per document key; `setFoldState` from an editor reaches every other view on the key and a parented preview on the same file, not the sender; the relay is delivered in the same tick as the set (SC-003); a standalone preview id maps to `panel:<id>`, one entry however many windows view it; becoming parented drops the `panel:` entry and becoming standalone seeds it from the document's current state; an invalid state (bad `base`, >2,000 slugs, slug >256 chars) is dropped; the entry is forgotten when no panel shows the document — in `ui/tests/integration/editor-fold-state.integration.test.ts`
- [x] T039 [US3] Implement the fold map beside word wrap in `ui/src/main/editor-coordinator.ts` (keyed by `wrapKey`, relayed as `{type:'foldState', key, state}` on `EditorSyncMsg`), the two channels `throng:editor:setFoldState` / `throng:editor:foldState` in `ui/src/main/editor-ipc.ts` (mapping an editor or parented preview to `file:<path>` and a standalone preview to `panel:<id>`, re-keying on parented changes from `PreviewService`), `ui/src/preload/preload.cts` and `ui/src/renderer/global.d.ts`; contract rows in `ui/tests/contract/preview-ipc.contract.test.ts`
- [x] T040 [US3] Implement the renderer cache `ui/src/renderer/editor/fold-state-store.ts` (the `word-wrap-store.ts` pattern: seed/fetch, apply-from-sync without echo, `useDocumentFoldState(key)`), with unit tests in `ui/tests/unit/fold-state-store.test.ts` first

### Editor folding

- [x] T041 [US3] Write failing component tests for a Markdown editor: a − marker on each heading line (none on code blocks/quotes/tables); clicking collapses that section; state published through the store; an incoming state folds/unfolds to match; collapsing an H1 and re-expanding restores H2 folds (FR-030a); markers hidden with `editor.showGutter` off; a newly opened document seeds from `editor.markdownSectionsOpen` (FR-039); folding never marks the document dirty, changes its text or adds a history entry (FR-035); nothing for a non-Markdown language — in `ui/tests/component/editor-markdown-fold.test.ts`
- [x] T042 [US3] Implement `ui/src/renderer/editor/markdown-fold.ts`: `codeFolding()` + heading-only `gutter()` with icon tokens `foldSectionExpanded`/`foldSectionCollapsed`, fold derivation from `FoldState` + sections, the six command handlers, seeding via `throng:editor:foldState` with `editor.markdownSectionsOpen` as the seed; install through a `foldCompartment` reconfigured with the language in `ui/src/renderer/editor/use-editor.ts` and `ui/src/renderer/editor/editor-language.ts`; register handlers in `commandsFor()` (`use-editor.ts:254-275`), Markdown editors only, so `Ctrl-m` keeps `toggleTabFocusMode` elsewhere
- [x] T043 [US3] Write failing component tests for the editor body menu's context-sensitive items — "Collapse This H2" inside an H2, "Expand This H3" on a collapsed H3 heading, Collapse All / Expand All, absent before the first heading and in non-Markdown editors, chords shown — then implement in `ui/src/renderer/editor/content-menu.ts` and the menu-open builder in `ui/src/renderer/editor/use-editor.ts:1435-1525`

### Preview folding and the soft gutter

- [x] T044 [US3] Write failing component tests for the Markdown body: gutter on → document shifted and one `button.preview-fold-toggle` per heading with `aria-expanded`, accessible name and icon token; clicking hides the section's top-level blocks; a collapsed H1 hides its H2 sections, re-expanding restores their own state; gutter off → no toggles, no shift, chords still fold (FR-032b); toggles excluded from copy and rich-copy export; folding records no history entry and sends no navigate (FR-035) — in `ui/tests/component/preview-fold.test.ts`
- [x] T045 [US3] Implement `ui/src/renderer/preview/providers/markdown/fold-gutter.ts` (insert toggles after sanitising, compute sections over top-level blocks, apply `hidden`) and call it from `markdown-body.tsx` after each render; gutter CSS (fixed `padding-inline-start`, toggle position, tokens only) in `markdown.css`; exclude `.preview-fold-toggle` in `ui/src/renderer/preview/copy.ts`
- [x] T046 [US3] Write failing component tests for linking: a parented preview reads and writes the document's fold state (editor fold → preview hides; preview toggle → store publishes); a standalone preview reads and writes its own `panel:<id>` state through the same store, seeded from `editor.markdownSectionsOpen`; becoming parented adopts the document's; becoming standalone keeps what it showed (FR-034) — in `ui/tests/component/preview-fold-link.test.ts`, then wire it in `ui/src/renderer/preview/preview-panel.tsx` (the panel never holds a fold state of its own)
- [x] T047 [US3] Write failing integration tests for the per-entry snapshot (FR-041d): a standalone run leaves an entry folded, navigates, Back restores its `panel:` fold state; the snapshot is purged with the panel and absent from `Panel.config.history`; a run that re-pairs on Back takes the document's state — in `ui/tests/integration/preview-fold-history.integration.test.ts`, then implement `Map<panelId, Map<entryIndex, {filePath, fold}>>` in `ui/src/main/preview-service.ts` (written on leaving an entry, applied on history steps, purged on destroy)
- [x] T048 [US3] Write failing component tests for the preview body menu's context-sensitive fold items and the status-bar Collapse All / Expand All toggle (`collapseAll`/`expandAll` tokens, chord in title, never hidden by width, absent for non-Markdown) — then implement in `ui/src/renderer/preview/content-menu.ts`, `ui/src/renderer/preview/preview-panel.tsx` and `ui/src/renderer/preview/preview-status-bar.tsx`
- [x] T049 [US3] Write failing component tests that `Ctrl+M,S` / `Ctrl+M,E` / `Ctrl+M,M` act on the section at the top of a focused preview's view and `Ctrl+M,A` / `Ctrl+M,X` / `Ctrl+M,L` on the whole document, through the chord engine — then host the engine on the preview root in `ui/src/renderer/preview/preview-commands.tsx` (or the panel's keydown) with the pending indicator
- [x] T050 [US3] Write a failing component test that following a `#heading` link into a collapsed section, and the find bar's current match inside one, expand it and its ancestors (FR-040), then call `revealing` from the link and search paths in `ui/src/renderer/preview/preview-panel.tsx` and `ui/src/renderer/preview/preview-search.ts`
- [x] T051 [US3] Write a failing unit test that scroll-anchor measurement and `blockAtTop` skip `hidden` blocks so scroll sync keeps mapping the top block to its line with sections folded (FR-041a), then adjust `ui/src/renderer/preview/providers/markdown/scroll-anchor.ts`

**Checkpoint**: US3 complete.

---

## Phase 6: User Story 4 — Go to Heading pop-down (P2)

**Goal**: Ctrl+G pop-down with typeahead, current entry, smooth jump (FR-042 – FR-049).
**Independent test**: Ctrl+G in a preview, type, Enter, Back.

- [x] T052 [US4] Write failing component tests for `heading-outline.tsx`: opens on `preview.goToHeading` with the search box focused and the list scrolled to the current entry (`aria-current="location"`); fixed height and own scrolling (scrolling it leaves the body's `scrollTop`); typing narrows with ancestors, scrolls to and highlights the first match, expands collapsed tree nodes holding a match; Down from the search box lands on the current entry; Up from the first entry and Ctrl+G return to the search box; Enter/click jumps and closes; Esc closes without jumping and refocuses the body; tree-node collapse does not fold the document and vice versa; "No headings" for an empty document; roles and labels per contract — in `ui/tests/component/heading-outline.test.ts`
- [x] T053 [US4] Implement `ui/src/renderer/preview/heading-outline.tsx` and `heading-outline.css` (tokens only; surface role per the floating-surface guard), fed the `DocumentSymbol` tree from the last render
- [x] T054 [US4] Write a failing unit test for the scroll tween — duration from `headingJumpMs`, `0` sets `scrollTop` once, a new jump cancels the previous — in `ui/tests/unit/scroll-tween.test.ts`, then implement `ui/src/renderer/preview/scroll-tween.ts`
- [x] T055 [US4] Write a failing component test that a jump reveals a collapsed target (FR-040), records history exactly as a same-document heading link (044 FR-115) and, when parented with sync on, drives the editor — then wire the pop-down's jump through `jumpToHeading` + the tween in `ui/src/renderer/preview/preview-panel.tsx`, register `preview.goToHeading` in `ui/src/renderer/preview/preview-commands.tsx`, and add **Go to Heading…** to the body and header menus (`content-menu.ts`, `panel-header-menu.ts`)

**Checkpoint**: US4 complete.

---

## Phase 7: User Story 5 — Drop Markdown files onto a preview (P2)

**Goal**: file drops navigate the preview (FR-020 – FR-025).
**Independent test**: drag a `.md` onto a preview; Back returns.

- [x] T056 [US5] Write failing integration tests for the `drop` navigate intent: history appended, parented run unbound, already-previewed target → `focusedOther` — in `ui/tests/integration/preview-service-navigate.integration.test.ts`, then implement the intent in `ui/src/main/preview-service.ts`
- [x] T057 [US5] Write failing component tests on a preview panel via the `throng:tree-drop` and `throng:os-drop` seams: an accepted `.md` navigates; `.ts` shows the refused affordance and changes nothing; a confinement refusal raises the editor's notice (project-owned vs sub-workspace); three OS files → first navigates, two `open` requests with `mode:'new'` (FR-024); text/HTML drops still refused and no file written — in `ui/tests/component/preview-drop.test.ts`
- [x] T058 [US5] Mount `TreeDropTarget` and `PanelDropTarget` on the preview body with a provider-accept predicate (reuse the confinement context built in `ui/src/renderer/workspace/panel-body.tsx:64-77`), narrow `onDrop={refuse}` so only non-file drops reach it, in `ui/src/renderer/preview/preview-panel.tsx`; add the predicate parameter to `ui/src/renderer/editor/drop-target.tsx` and `ui/src/renderer/editor/tree-drop-target.tsx` without changing editor behaviour

**Checkpoint**: US5 complete.

---

## Phase 8: User Story 6 — Wikilinks (P3)

**Goal**: `[[…]]` renders and follows as an ordinary link, resolved as a path (FR-050 – FR-057).
**Independent test**: a note with every wikilink form; each follows correctly; `[[Missing]]` broken.

- [x] T059 [P] [US6] Write failing core tests for `parseWikilink` (`[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`, `[[#Heading]]`, `[[Note#^block]]` drops the block, `[[/docs/README]]` rooted, `[[../README]]`, malformed → null) and `wikiCandidates` (`.md`, `.markdown`, exact; explicit extension → exact only; rooted with no project root → `[]`) in `core/tests/unit/wiki-links.test.ts`
- [x] T060 [P] [US6] Implement `core/src/preview/wiki-links.ts`; add the wiki case to `classifyPreviewLink` in `core/src/preview/links.ts` with tests in `core/tests/unit/preview-links.test.ts` first (relative to the document's folder, rooted from the project root, escaping → `outside`)
- [x] T061 [US6] Write failing pipeline tests: the four forms render as links with alias or name text; `[[…]]` in inline code and fences stays literal; `![[…]]` literal — in `ui/tests/unit/markdown-pipeline-wikilinks.test.ts`, then implement the markdown-it inline rule in `ui/src/renderer/preview/providers/markdown/wikilinks.ts` and register it in `pipeline.ts`
- [x] T062 [US6] Write failing integration tests for `resolveWikiTargets` (root from the run's project, candidates in order, sub-workspace rooted → null, >500 targets capped) and for following a wiki link through `navigate`, in `ui/tests/integration/preview-wiki-links.integration.test.ts`; implement in `ui/src/main/preview-service.ts`, `ui/src/main/preview-ipc.ts`, preload and `global.d.ts`; contract rows in `ui/tests/contract/preview-ipc.contract.test.ts`
- [x] T063 [US6] Write a failing component test that unresolved wikilinks get `preview-link--unresolved` and following one shows the 044 FR-090e notice, and that find matches the displayed text (FR-057) — then batch the resolve call after render in `ui/src/renderer/preview/providers/markdown/markdown-body.tsx` and style the class from tokens in `markdown.css`

**Checkpoint**: US6 complete.

---

## Phase 9: User Story 7 — Tables that fit (P3)

**Goal**: fair column widths and drag-resize (FR-060 – FR-068).
**Independent test**: a table with a long cell in a narrow preview; no scrollbar; drag a border.

- [x] T064 [P] [US7] Write failing core tests for `fairColumnWidths(available, cols, minLegible)` — all fit at max-content; one runaway column capped at its share with surplus redistributed; no column below `min(max, max(minLegible, min))`; overflow when minimums exceed `available` — in `core/tests/unit/table-widths.test.ts`, then implement `core/src/preview/table-widths.ts`
- [x] T065 [US7] Write failing component tests with a stubbed measurer: a `<colgroup>` is applied with `table-layout: fixed; width: 100%`; an overflowing table keeps horizontal scroll; a drag on a border handle changes that column live with `col-resize` cursor; hand-set widths survive a re-render of the same file and are dropped on navigation; the front-matter table is laid out too; handles excluded from copy and find — in `ui/tests/component/preview-table-layout.test.ts`
- [x] T066 [US7] Implement `ui/src/renderer/preview/table-layout.ts` (measure, apply, handles, per-panel hand-set map, resize observer debounced to a frame), call it from the Markdown body after render, and replace the table rules at `markdown.css:234-276` (`display:block; overflow-x:auto` → wrapper scroll only on overflow; `overflow-wrap:anywhere`; front-matter key column no longer `nowrap` beyond its minimum); keep within the `preview-css-tokens` allowlist
- [x] T067 [US7] Write the dev-only SC-006a survey `scripts/dev/table-fit-survey.mjs` (renders every `.md` under `docs/` and `specs/` at half width in the running dev app and prints `fitting / total`); not wired into the gate

**Checkpoint**: all stories complete.

---

## Phase 10: Polish & Cross-Cutting

- [x] T068 [P] Document the seven actions in `docs/key-bindings.md` and the four settings in `docs/preferences.md` (docs-currency test must pass)
- [x] T069 [P] Update `docs/quick-start.md` (reading a preview: find, Go to Heading, folding, wikilinks, drops, Open previews in) and add one Highlights line to `README.md`; unreleased entry in `CHANGELOG.md`
- [x] T070 Confirm `settings-inertness-047.test.ts` (T017) is green — every new key has a reader
- [x] T071 Run the fast gates once: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:component`, `npm run test:integration`, `npm run test:contract`; fix anything red
- [x] T072 Run `scripts/dev/table-fit-survey.mjs` once against a dev build and record the percentage (SC-006a ≥ 95%) in the PR body

---

## Dependencies & Execution Order

- **Phase 2** blocks everything. Inside it: T002→T003; T004→T005; T003+T005→T006→T007; T008→T009; T010→T011→T012; T013→T014; T015→T016; T018→T019.
- **US1** needs T011 (scopes). **US2** needs T014 (openTarget), T031. **US3** needs T003, T005, T007, T009, T011, T014, T016, T019. **US4** needs T003, T005, T011, T014 and US3's `revealing` wiring (T050) for FR-040. **US5** needs T031 and US2's `open` target (T036). **US6** is independent after Phase 2. **US7** is independent after Phase 2.
- `preview-panel.tsx` is touched by US1, US2, US3, US4, US5 — those tasks run **sequentially** in one owner's hands, never in parallel.

## Parallel Opportunities

- Phase 2: T002, T008, T015, T018 in parallel (distinct files).
- After Phase 2: US6 (core + pipeline + main) and US7 (core + table-layout) can proceed beside US1–US5, owned by different agents; they share only `markdown.css`, `markdown-body.tsx` and `preview-ipc.contract.test.ts` — edits there are serialised through the orchestrator.

## Implementation Strategy

MVP = Phase 2 + US1 (find). Then US2 (the other named ask), US3, US4, US5, US6, US7, Polish.

## Phase 11: Convergence

- [x] T073 [US4] Close the Go to Heading pop-down without jumping on a pointer-down outside it, in `packages/ui/src/renderer/preview/heading-outline.tsx` (test first in `packages/ui/tests/component/heading-outline.test.ts`) per FR-042c (missing)

## Phase 12: Manual-test round 2 (Session 2026-09-29, FR-072 – FR-079)

Each task is test-first at the layer named: the failing test, run and read, then the fix. Research R15 – R20.

- [x] T074 [US7] **Defect (FR-060, FR-061):** measure each table's columns with the off-screen clone appended inside the table's own host, not `document.body`, so the preview's cell padding and fonts apply, in `packages/ui/src/renderer/preview/table-layout.ts` (test first in `packages/ui/tests/component/preview-table-layout.test.ts`: the clone is measured under the host's styles) per R15
- [x] T075 [US7] No mid-word breaks: cells `overflow-wrap: break-word` in `packages/ui/src/renderer/preview/providers/markdown/markdown.css`, and hyphenated tokens narrower than 40% of the table's available width (the panel's content width) wrapped in a `nowrap` span by `packages/ui/src/renderer/preview/table-layout.ts` — text nodes only; a token split across inline elements is left alone. Copy and find see the same text with or without the span (test first in `packages/ui/tests/component/preview-table-layout.test.ts`, including a token inside a link and inside a code span, and `packages/ui/tests/component/preview-copy.test.ts`) per FR-072, FR-073, R15
- [x] T076 [US1] `searchMatchBorder` theme token — type, descriptor, derivation beside `searchHighlights`, the shipped-defaults record and its version/upgrade path, and theme copy — in `packages/core/src/config/theme.ts`, `packages/core/src/config/default-themes/index.ts`, `packages/core/src/config/shipped-defaults.ts`, `packages/core/src/config/theme-copy.ts` (test first in `packages/core/tests/unit/theme-quality.test.ts`: ≥ 3:1 against `editorBg` and the preview body's background, and distinct from `searchMatchCurrentBorder`, on every shipped theme; then update `default-themes.test.ts`, `search-config.test.ts`, the shipped-defaults record/upgrade tests, `fixtures/pre-refactor-theme-colours.json` and `packages/ui/tests/integration/shipped-defaults-seed-upgrade.test.ts` as the record changes) per FR-074, R16
- [x] T077 [US1] Outline every editor find match with `searchMatchBorder` in `packages/ui/src/renderer/search/find-bar.css` (test first in `packages/ui/tests/unit/find-bar-highlight-css.test.ts`, new, reading the stylesheet as the existing CSS-token unit tests do) per FR-074, R16
- [x] T078 [US1] Preview match-frame layer: 1px frames around each visible match's client rects, current match in `searchMatchCurrentBorder`, repainted on scroll/resize/redraw via rAF, `aria-hidden` and outside the sanitised content, in `packages/ui/src/renderer/preview/preview-search.ts` and `packages/ui/src/renderer/preview/preview-panel.tsx` (test first in `packages/ui/tests/component/preview-find.test.ts` with a recording frame painter) per FR-074, R16
- [x] T079 [US2] Remove Files & Folders → Open In → **Preview**, and label **Last Preview Panel (&lt;panel title&gt;)** from the Last Active candidate in the visible tab, in `packages/ui/src/renderer/explorer/context-menu-items.ts`, `packages/ui/src/renderer/explorer/file-tree.tsx` and, if the candidate's title is not already exposed, `packages/ui/src/renderer/preview/last-active-preview.ts` (test first in `packages/ui/tests/component/explorer-open-in-preview.test.ts` and `packages/ui/tests/unit/menu-sections.test.ts`) per FR-075, FR-076, R17
- [x] T080 [US5] A file dropped onto an empty panel opens in the view its provider's default open action names, in `packages/ui/src/renderer/workspace/panel-body.tsx` (test first in `packages/ui/tests/component/panel-body-drop-open-action.test.ts`, new) per FR-077, R18
- [x] T081 [US3] When a standalone preview becomes parented and the document has no `file:` fold entry — at registration none exists, since an editor's fold key resolves only once its document is loaded (pinned by the test) — copy the preview's `panel:<id>` state into it and relay it, and update `reparentFold`'s docstring, in `packages/ui/src/main/editor-coordinator.ts` (`preview-service.ts`'s call site is unchanged) (test first in `packages/ui/tests/integration/editor-fold-state.integration.test.ts`) per FR-078, R19
- [x] T082 [US4] Go to Heading pop-down: first measure `surface`/`sidebarBg` against `scrollbarThumb`/`border` on every shipped theme and choose the first pair clearing 1.5:1 everywhere (the 1.5:1 is derived), then apply it in `packages/ui/src/renderer/preview/heading-outline.css` (test first in `packages/ui/tests/unit/heading-outline-scrollbar.test.ts`, new) per FR-079, R20
- [x] T083 Documentation: `docs/quick-start.md` (Open In's two preview items, outlined find matches), `CHANGELOG.md` (unreleased), and `docs/preferences.md`'s theme token list if it names the search-match tokens, per FR-071 and the `throng-docs` audit
- [x] T084 [US7] Re-run `scripts/dev/table-fit-survey.mjs` after T074/T075 and record the SC-006a result in the PR body per SC-006a
- [x] T085 Update the manual test plan's MT-01 – MT-05 and MT-07 groups for FR-072 – FR-079 (planning-manual-tests), then the short gates; the heavy gate waits on sign-off

## Phase 13: Convergence

- [x] T086 [US7] Cap each column's measured minimum at 40% of the table's available width before water-filling, so a single word wider than that breaks inside its cell rather than widening the table past the panel, in `packages/ui/src/renderer/preview/table-layout.ts` (test first in `packages/ui/tests/component/preview-table-layout.test.ts`) per FR-073 (partial)

## Phase 14: Manual-test round 3 (2026-09-29)

- [x] T087 [US7] **Defect (Constitution XII, MT-07):** a preview resize re-measured every table (a clone per table, `8ch` per table, a span per hyphenated token — each a forced layout), ~176ms blocked per resize on `docs/preferences.md` and the 045/046 specs unresponsive. Measure once per draw in batched phases, deferred and debounced after the draw; a resize re-shares the cached measurements (`relayoutTables`) after a debounce and only when the width changed, in `packages/ui/src/renderer/preview/table-layout.ts` and `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx` (test first in `packages/ui/tests/component/markdown-body-table-layout.test.ts` and `packages/ui/tests/component/preview-table-layout.test.ts`) per FR-060, FR-073
- [x] T088 [US2] **Defect (FR-076, MT-02):** Last Preview Panel named the panel untruncated; name it as its header does, at `tabs.maxNameLength`, in `packages/ui/src/renderer/explorer/file-tree.tsx` (test first in `packages/ui/tests/component/explorer-open-in-preview.test.ts`) per FR-076
- [x] T089 [US2] Last Preview Panel's name cut to 32 characters the header's way, in `packages/ui/src/renderer/explorer/file-tree.tsx` (test first in `packages/ui/tests/component/explorer-open-in-preview.test.ts`) per FR-080
- [x] T090 [US2] A file activated in Files & Folders opens its preview without taking the keyboard: `keepFocus` on the tree's `preview.open` intent, honoured by placement, reuse and focus-existing, in `packages/ui/src/renderer/editor/open-router.ts` and `packages/ui/src/renderer/preview/open-preview.ts` (test first in `packages/ui/tests/component/explorer-open-keeps-focus.test.ts`) per FR-081

## Phase 15: Manual-test round 4 (2026-09-29)

- [x] T091 [US2] Last Preview Panel names the panel without " - Preview", cut to 16 characters with an ellipsis when cut, in `packages/ui/src/renderer/explorer/file-tree.tsx` (test first in `packages/ui/tests/component/explorer-open-in-preview.test.ts`) per FR-082
- [x] T092 [US2] **Defect (FR-081, MT-02):** a tree open of a file whose preview already exists still moved the keyboard, because main's `focus` (and `place`) message was honoured without `keepFocus`. Carry `keepFocus: true` on `PreviewOpenRequest`, through `asOpen`, echoed by `PreviewService.open` on `focus`/`place`, and honoured by `handlePreviewFocus`/`handlePreviewPlace`, in `packages/core/src/preview/wire-types.ts`, `packages/ui/src/main/preview-ipc.ts`, `packages/ui/src/main/preview-service.ts` and `packages/ui/src/renderer/preview/open-preview.ts` (test first in `packages/ui/tests/component/explorer-open-keeps-focus.test.ts`, `packages/ui/tests/integration/preview-service-open.integration.test.ts` and `packages/ui/tests/contract/preview-ipc.contract.test.ts`) per FR-081, contracts/preview-ipc-047.md §1
- [x] T093 [US2] Flash the border of the panel a File Explorer open lands in: a `requestPanelFlash` registry that parks a request until its panel mounts (`packages/ui/src/renderer/workspace/panel-flash.ts`), an opacity-only overlay in `panel-placeholder.tsx` and `theme.css`, raised by `openFileInTab`'s landing branches, `openPreview`'s placed/reused/focused answers, and the tree's click/Enter and Open In items (test first in `packages/ui/tests/component/panel-flash.test.ts`, `explorer-open-keeps-focus.test.ts`, `editor-open-routing.test.ts` and `editor-open-router.test.ts`) per FR-083
- [x] T094 [US2] **Defect (FR-015, MT-02):** with Last Active set, every File Explorer click opened a NEW preview: the Last Active preview was recorded only on a preview's pointerdown/focus, and since FR-081 a tree-placed preview never takes focus. Record it whenever an open places, reuses or brings a preview forward, in `packages/ui/src/renderer/preview/open-preview.ts` (test first in `packages/ui/tests/component/preview-open-target.test.ts`) per FR-015, FR-081
- [x] T095 [US2] In single-click mode a double click on a file opened it three times (click, click, dblclick); ignore repeat clicks on the same file for 400ms, per tree, in `packages/ui/src/renderer/explorer/file-tree.tsx`, `tree-node.tsx` and `explorer-context.ts` (test first in `packages/ui/tests/component/file-tree.test.ts`) per FR-084
- [x] T096 [US2] **Defect (T095, gate run 36588275220):** the 400ms window swallowed a deliberate re-click of the same file — `editor-open.e2e.ts:161` cancels the unsaved-changes prompt and clicks the file again. Open on the first click of a multi-click only (`MouseEvent.detail`), with no timer, in `packages/ui/src/renderer/explorer/tree-node.tsx` (test first in `packages/ui/tests/component/file-tree.test.ts`) per FR-084
