---

description: "Task list for 049 Match and Selection Highlighting"
---

# Tasks: Match and Selection Highlighting

**Input**: Design documents from `specs/049-match-and-selection-highlighting/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R13), data-model.md, contracts/panel-state-handoff.md,
contracts/surfaces-tokens-setting.md

**Tests**: Mandatory — constitution Principle V (test-first, lowest layer). Every implementation task is
preceded by its failing test task; run it, read why it fails, then implement. The two defects (#455, #456)
start from failing reproductions (`replicating-bugs`). The one new E2E spec is `@extended @window` and names
its Principle V reserve entry (a real second window); the commit that adds it re-seeds
`ui/tests/e2e/e2e-budget.json`. Everything else is asserted at core unit, ui unit or component (jsdom) layer.

**Organization**: grouped by user story (spec.md), in priority order US1, US2 (P1), US3, US4, US6 (P2), US5
(P3). Paths are repository-relative. `core` = `packages/core`, `ui` = `packages/ui`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task
- **[Story]**: US1–US6 as in spec.md

---

## Phase 1: Setup

- [x] T001 Confirm the baseline before any change: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:unit` green at the branch base (recorded in the autopilot ledger); no code change

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: the per-panel preview highlight registry (R2) and the cross-window panel-state hand-off (R3)
that US1, US5 and US6 all lean on.

### Preview highlight registry (R2)

- [x] T002 [P] Write failing unit tests in `ui/tests/unit/preview-highlight-registry.test.ts`: `setPanelRanges(name, panelId, ranges)` from two panels leaves ONE `Highlight` under `name` holding the union; a second call for the same panel replaces only that panel's ranges; `clearPanel(panelId)` removes that panel's ranges under every name and keeps the other panel's; a name with no ranges left is deleted from `CSS.highlights`; with no `CSS.highlights` (jsdom) every call is a no-op
- [x] T003 Implement `ui/src/renderer/preview/highlight-registry.ts`; give `createCssHighlightPainter` in `ui/src/renderer/preview/preview-search.ts` a `panelId` and route its paint/clear through the registry; pass the id from `ui/src/renderer/preview/preview-panel.tsx`; existing `ui/tests/component/preview-find.test.ts` stays green

### Panel snapshot shape (R3, data-model *PanelSnapshot*)

- [x] T004 [P] Write failing unit tests in `core/tests/unit/panel-snapshot.test.ts` for `isPanelSnapshot(value)` and `panelSnapshotBytes(value)`: accepts `{panelId}` with any subset of `find`, `editor` (`{selection: {ranges: {anchor, head}[], main}, scrollAnchor}`), `terminal` (`{offsetFromBottom, selection?: {start: {x, y}, end: {x, y}}}`), `previewSelection` (`{from, to, text}`); rejects a non-object, a missing `panelId`, a non-finite number in any section, a section of the wrong shape; the byte measure is the JSON length
- [x] T005 Implement `core/src/workspace/panel-snapshot.ts` (`PanelSnapshot` type, `isPanelSnapshot`, `panelSnapshotBytes`, `MAX_PANEL_SNAPSHOT_BYTES = 65536`); export from `core/src/index.ts`

### Main-side hand-off store (R3, contracts/panel-state-handoff.md)

- [x] T006 [P] Write failing unit tests in `ui/tests/unit/panel-state-handoff.test.ts` for `PanelStateHandoff`: `stash` stores one entry per panel id and a second stash overwrites; `claim(ids)` returns the entries it has and deletes them, ids with none are absent; an invalid snapshot or one over `MAX_PANEL_SNAPSHOT_BYTES` is dropped without throwing; `forget(panelId)` deletes an entry
- [x] T007 Write the failing integration test of T008 first, then implement `ui/src/main/panel-state-handoff.ts` and `ui/src/main/panel-state-handoff-ipc.ts` (invoke channels `throng:panelState:stash` `{snapshots}` → `void`, `throng:panelState:claim` `{panelIds}` → `Record<string, PanelSnapshot>`); construct and register in `ui/src/main/main.ts` beside the other services; call `forget(id)` from the existing `throng:panel:destroy` handler (`main.ts` ~2150)
- [x] T008 (written first, inside T007) Contract test in `ui/tests/contract/panel-state-ipc.contract.test.ts` [derived: the repo drives IPC registrars on a fake `ipcMain` at the contract layer, as `history-ipc.contract.test.ts` does]: a snapshot stashed through the IPC registrar is returned once by `claim` and absent on a second `claim`; destroy forgets it
- [x] T009 Expose `window.throng.panelState { stash, claim }` in `ui/src/preload/preload.cts` and type it in `ui/src/renderer/global.d.ts`

### Renderer capture and seeding (R3)

- [x] T010 Write failing component tests in `ui/tests/component/panel-state-capture.test.ts`: `registerPanelStateCapture(panelId, section, fn)` + `stashPanelState(ids)` sends one snapshot per id composed from every registered section, preferring a live capture over the peeked saved entry of an unmounted panel (`peekEditorViewState`, `peekTerminalViewState`); `seedPanelState(record)` writes each section into its map only where that map has no entry for the panel; unregistering removes the live capture
- [x] T011 Implement `ui/src/renderer/workspace/panel-state-capture.ts`; add non-consuming `peekEditorViewState` to `ui/src/renderer/editor/editor-view-state.ts` and `peekTerminalViewState` to `ui/src/renderer/terminal/terminal-view-state.ts`, plus a `seed*` that writes only when absent in each
- [x] T012 Write failing component tests in `ui/tests/component/detach-handoff-order.test.ts`: `detachToNew` and `syncToExisting` in `ui/src/renderer/workspace/detach-context.tsx` await `panelState.stash` for the moved panel (or every panel of a moved tab) BEFORE `workspace.persistSubWorkspaces`, `open` or `notifyChanged`; `ui/src/renderer/subworkspace-app.tsx` awaits `panelState.claim` for its layout's panel ids and seeds before rendering `WorkspaceProvider`, on first mount and on every `reloadKey` remount; the hand-off is symmetric — `stashPanelState` and the claim-and-seed helper take no window kind, and a snapshot stashed from a sub-workspace window's stores round-trips into another window's stores the same way (US6 scenario 3; no reattach UI route exists today: `reattachPanel` has no caller)
- [x] T013 Implement the stash calls in `ui/src/renderer/workspace/detach-context.tsx` and the claim-and-seed gate in `ui/src/renderer/subworkspace-app.tsx`

**Checkpoint**: the hand-off moves an empty-sectioned snapshot end to end; no user-facing change yet.

---

## Phase 3: User Story 1 — Find survives a tab switch (P1) 🎯 MVP

**Goal**: an open find bar keeps its query, current match and highlights through every FR-000 event (#456).

**Independent test**: search a preview for a word with several matches, switch tabs and back, press Next; the
highlights are present and Next advances.

- [x] T014 [US1] Reproduce #456 for editors: failing component test in `ui/tests/component/find-session-remount.test.ts` — an editor panel with an open find at `2 of 5` is unmounted and remounted: the five matches carry `throng-search-match` (the second `--current`), the session still reads `2 of 5`, Next gives `3 of 5`; with the document changed while hidden, the search re-runs and the current match is the nearest following the old one's offset (FR-003); a closed bar is not re-run (Edge Cases). Run it and confirm it fails for the reason #456 states
- [x] T015 [US1] Reproduce #456 for previews: failing component test in `ui/tests/component/preview-find-remount.test.ts` (painter and frames faked as in `preview-find.test.ts`) — same scenarios on a preview; plus two previews in one window each keep their own painted matches after either remounts (R2)
- [x] T016 [US1] Write failing unit tests in `ui/tests/unit/search-store.test.ts`: `FindSession.currentFrom` follows every count change; `attachPanelSearch(panelId, controller)` registers and, for an open session with a non-empty term, calls `controller.restore(term, modes, currentFrom)` and writes back its count; with no session or an empty term it only registers; `snapshotFindSession(id)` omits `openSeq`; `seedFindSession(snapshot)` creates a session only when none exists
- [x] T017 [US1] Implement `currentFrom`, `attachPanelSearch`, `snapshotFindSession` and `seedFindSession` in `ui/src/renderer/search/search-store.ts`; add `restore(term, modes, anchor: number | null): SearchCount` and `currentFrom(): number | null` to `BaseSearchController` in `ui/src/renderer/search/search-controller.ts`
- [x] T018 [US1] Implement `restore` (run the query, `current = indexFrom(matches, anchor ?? 0)`, paint, never scroll or reveal) and `currentFrom` in `ui/src/renderer/search/editor-search.ts`, `ui/src/renderer/preview/preview-search.ts` and `ui/src/renderer/search/terminal-search.ts` (the terminal's find session is FR-000 state — a loaded panel's find session — though FR-027 keeps terminals out of FR-014–FR-026)
- [x] T019 [US1] Replace the bare `registerPanelSearch` calls with `attachPanelSearch` in `ui/src/renderer/editor/use-editor.ts` (~1858), `ui/src/renderer/terminal/use-terminal.ts` (~1115) and `ui/src/renderer/preview/preview-panel.tsx` (~647); T014 and T015 pass
- [x] T020 [US1] Register the `find` section with the hand-off (capture from `snapshotFindSession`, seed with `seedFindSession`) in `ui/src/renderer/workspace/panel-state-capture.ts`, with a case added to `ui/tests/component/panel-state-capture.test.ts` (US1 scenario 5; end-to-end in T045)
- [x] T021 [US1] Correct the comments that claim a session travels with a detached panel in `ui/src/renderer/search/search-store.ts` (~24-26, ~299-304) and `ui/src/renderer/editor/use-editor.ts` (~2306-2309) to describe the hand-off

**Checkpoint**: #456 fixed in editors and previews; find sessions cross windows.

---

## Phase 4: User Story 2 — Find reveals a match inside a collapsed section (P1)

**Goal**: the current match is always visible, in previews and editors (#455); Replace All asks before acting on
folded matches.

**Independent test**: collapse a section, search a word that occurs only inside it; it expands and the match is
highlighted, in a preview and an editor.

- [x] T022 [US2] Reproduce #455 for previews: failing component tests in `ui/tests/component/preview-find-fold-reveal.test.ts` on a foldable Markdown preview — a typed query matching only collapsed text expands its section and scrolls the match's (still connected) element into view (US2.1); a match two collapsed levels deep expands every ancestor (US2.2); with matches in two collapsed sections, Next expands each only when its match becomes current (US2.3); moving on never collapses (US2.5). Run them and record which R4 hypothesis the failure confirms
- [x] T023 [US2] Fix the preview reveal in `ui/src/renderer/preview/preview-panel.tsx` (`revealBeforeScrollRef`, `pendingReveal`) and `ui/src/renderer/preview/preview-search.ts` per the confirmed cause; `pendingReveal` holds the match's text offset and re-locates it after the redraw; T022 passes
- [x] T024 [US2] Write failing component tests in `ui/tests/component/editor-fold-reveal.test.ts`: `revealOffset(view, pos, deps)` on a Markdown editor with a collapsed section containing `pos` calls `setDocumentFoldState(docKey, revealing(...), panelId)` once (ancestors included) and leaves the range unfolded after a following `syncFoldRanges`; on a visible position returns `false` and writes nothing; never collapses; also pin what CodeMirror does when the selection head moves into a folded range (R5) so a desync is visible
- [x] T025 [US2] Implement `ui/src/renderer/editor/editor-fold-reveal.ts`; add an optional `revealBeforeScroll(pos)` dependency to `createEditorSearchController` in `ui/src/renderer/search/editor-search.ts`, called by `reveal()` for every current-match change (typed, Next, Previous) and by `replaceCurrent` before replacing (FR-007); pass it from `ui/src/renderer/editor/use-editor.ts`; component test in `ui/tests/component/editor-search-controller.test.ts` for US2.4 and FR-007
- [x] T026 [US2] Write failing component tests in `ui/tests/component/replace-all-folded-prompt.test.ts`: with no folded match Replace All runs with no dialog; with folded matches the `replace-all-folded-dialog` shows title "Replace in folded sections", message "N of M matches are inside folded sections." (digit-grouped), choices Cancel · Replace and keep folded · Replace and unfold with initial focus on Replace and unfold; Cancel and Escape replace nothing and unfold nothing; keep folded replaces every match in one undo step and leaves fold state unchanged; unfold makes ONE fold-state write revealing every affected section, then replaces in one undo step; reachable from the button, `search.replaceAll` and the panel menu
- [x] T027 [US2] Add `foldedSectionSlugs(): string[]` (the collapsed sections containing at least one match) and `foldedMatchCount()` to the editor controller in `ui/src/renderer/search/editor-search.ts`, and `revealSections(view, slugs, deps)` (one `revealing` fold over every slug, one `setDocumentFoldState` write, then `syncFoldRanges`) to `ui/src/renderer/editor/editor-fold-reveal.ts`; `replaceAll(replacement)` itself is unchanged; make `replaceAll` in `ui/src/renderer/search/search-store.ts` async through an injected chooser; add `ui/src/renderer/search/replace-all-prompt.tsx` (host component owning `useChoose`, mounted beside `ConfirmProvider` in `ui/src/renderer/composition-root.tsx`); update callers `ui/src/renderer/search/search-keybindings.tsx` and `ui/src/renderer/workspace/panel-placeholder.tsx`

**Checkpoint**: #455 fixed in previews and editors; FR-007a prompt live.

---

## Phase 5: User Story 3 — Shared vocabulary for "this text matches" (P2)

**Goal**: every match surface comes from one derivation; the shipped three are byte-identical (#325).

**Independent test**: on every bundled theme the search-surface colours are identical before and after; the
occurrence tints come from the same derivation.

- [x] T028 [US3] Before any derivation change, record every theme's current `searchMatch`, `searchMatchCurrent`, `searchMatchCurrentBorder` and `searchMatchBorder` (all of `ALL_DEFAULT_THEMES` plus `THRONG_THEME`) in `core/tests/unit/fixtures/search-surfaces-pre-049.json`, generated by a test helper run once, not by hand
- [x] T029 [US3] Write failing unit tests in `core/tests/unit/theme-occurrence-surfaces.test.ts` over every bundled theme: the four existing surfaces — FR-009's three plus `searchMatchBorder` (047 FR-074), pinned too — equal the T028 fixture byte for byte (FR-009, SC-003); `searchMatchOccurrence`, `searchMatchOccurrenceInactive` and `editorSelectionInactive` exist on every theme; `searchMatchOccurrence` equals the derived ordinary-match value; every `SYNTAX_TOKENS` colour and `editorFg` reach ≥4.5:1 on all three new surfaces (FR-011, SC-004); `searchMatchOccurrenceInactive` is weaker than `searchMatchOccurrence` by contrast against `editorBg` and nearer it by ΔE00, yet ≥ `MATCH_DISTINCTNESS_THRESHOLD` from `editorBg` (FR-018a); `searchMatchOccurrence` is weaker than `editorSelection` (FR-016); `editorSelectionInactive` is ≥ `MATCH_DISTINCTNESS_THRESHOLD` (ΔE00) from `editorSelection` and from every match surface (FR-025)
- [x] T030 [US3] Extend `searchHighlights` in `core/src/config/default-themes/index.ts` with `occurrence` and `occurrenceInactive`, computed after the existing four; add `inactiveSelection(editorBg, editorFg, selection, matchSurfaces, overlaid)`; set the three tokens in `makeTheme`; add them to `THRONG_THEME.colours` in `core/src/config/theme.ts` with values produced by the same functions and the re-measure comment; add labels and descriptions per contracts/surfaces-tokens-setting.md to `core/src/config/theme-copy.ts`; add the new pairs to `SYNTAX_ON_MATCH` in `core/src/config/theme-quality.ts`
- [x] T031 [US3] Write failing tests, then bump `SHIPPED_DEFAULTS_VERSION` 18 → 19 with an additive upgrade that gives an existing user theme the three tokens in `core/src/config/shipped-defaults.ts`; update `EXPECTED_COLOUR_TOKEN_COUNT` (75 → 78) and `ADDED_SINCE_FIXTURE` in `core/tests/unit/default-themes.test.ts`; the Themes editor groups (`theme-metadata.ts` `areaForToken`: Search, Search, Editor) pass `assertThemeAreaGroups` — tests in `core/tests/unit/theme-occurrence-upgrade.test.ts`
- [x] T032 [US3] Write failing CSS pins in `ui/tests/unit/find-bar-highlight-css.test.ts` for the occurrence rules of contracts/surfaces-tokens-setting.md (`.cm-editor.cm-focused .throng-occurrence`, `.cm-editor:not(.cm-focused) .throng-occurrence`, `::highlight(throng-preview-occurrence)`, `::highlight(throng-preview-occurrence-inactive)`, no outline on occurrences, existing match rules unchanged); then add them to `ui/src/renderer/search/find-bar.css`

**Checkpoint**: tokens, derivation and CSS exist; nothing paints an occurrence yet.

---

## Phase 6: User Story 4 — See other instances of the selected text (P2)

**Goal**: a selection softly tints its other occurrences in editors and previews (#324).

**Independent test**: select a word occurring four times; the other three are tinted more softly than the
selection, syntax colours show through, and clearing the selection removes the tints.

- [x] T033 [P] [US4] Write failing unit tests in `core/tests/unit/occurrence-model.test.ts`: `occurrenceQuery` returns `null` for an empty, whitespace-only, multi-line or 1-character selection; `wholeWord` true for `id` in `a id b`, false for `idt` inside `width`; `isWordChar` is `/[\p{L}\p{N}_]/u` (letters incl. non-Latin, digits, underscore); `occurrenceMatches` with selected `id` tints `id`, `-id`, `id.`, `some-id-word` and not `width`, `valid`, `id_x`; a non-whole-word selection matches every literal occurrence; case-sensitive; the selection's own range excluded; `within` bounds results; `withoutSearchMatches` drops every occurrence overlapping a search match and keeps the rest (FR-013, US3.2)
- [x] T034 [US4] Implement `core/src/search/occurrence-model.ts` on `editorMatches(doc, term, {caseSensitive: true, wholeWord: false})`; export from `core/src/index.ts`
- [x] T035 [P] [US4] Write a timing test in `core/tests/unit/occurrence-performance.test.ts` (Principle XII): a 10,000-line document, a word with ≥2,000 occurrences, `occurrenceMatches` + `withoutSearchMatches` over the whole document and over a 60-line visible range, each under a budget well inside SC-005's 100 ms; log the measured times for the PR
- [x] T036 [US4] Write failing tests in `core/tests/unit/settings-occurrences-049.test.ts` (`editor.highlightOccurrences` defaults to `true`, parses a boolean, falls back on junk, survives the returned literal, has a Preferences descriptor in group Editor with control toggle and the contract's label) and `core/tests/unit/settings-inertness-049.test.ts` (a renderer reader exists); implement in `core/src/config/app-settings.ts` (field, default, parse, returned literal) and `core/src/config/settings-metadata.ts`; add the row from the contract to the Editor table in `docs/preferences.md` (FR-028; `docs-currency.test.ts` passes)
- [x] T037 [US4] Write failing component tests in `ui/tests/component/editor-occurrence-highlight.test.ts`: selecting a word gives `throng-occurrence` marks on its other visible occurrences and not on the selection; a range that is a search match carries no occurrence mark; changing or clearing the selection replaces or removes the marks at once (FR-018); typing, Delete and Backspace change only the selection (FR-017); off-screen occurrences gain marks when scrolled into view; with `editor.highlightOccurrences` off there are none, and toggling it applies without remount (FR-019); the extension sits at `Prec.low`; two editor panels on the same file each tint only their own selection's occurrences (FR-014b); on a 10,000-line document, the plugin's update for a selection change and for a single-character insert each complete well inside SC-005's 100 ms, and the insert's update time with the plugin on is within the measured noise of the plugin off (Principle XII; timings logged for the PR)
- [x] T038 [US4] Implement `ui/src/renderer/editor/occurrence-highlight.ts` (`ViewPlugin`, `view.visibleRanges`, reads the search highlight field for precedence); export that field's matches from `ui/src/renderer/search/editor-search.ts`; install through a `Compartment` reconfigured from `useAppSettings().editor.highlightOccurrences` in `ui/src/renderer/editor/use-editor.ts` only (`standalone-editor.tsx` is not an editor panel and carries no search extension; FR-014 covers editor panels)
- [x] T039 [US4] Write failing component tests in `ui/tests/component/preview-occurrences.test.ts` (fake `CSS.highlights`, injected `requestFrame`): a selection in the body paints its other occurrences under `throng-preview-occurrence` one frame later; `i` bold + `d` plain counts as `id` (FR-014a); aria-hidden content is not matched; ranges that are search matches are not painted (FR-013); with the body unfocused the name is `throng-preview-occurrence-inactive` (FR-018a); a second preview of the same file paints nothing (FR-014b); clearing or changing the selection replaces or removes the panel's occurrence ranges in the next frame (FR-018); setting off paints nothing, toggled live; on a rendered 10,000-line document with a word of ≥2,000 occurrences, the frame's work (offset mapping, matching, range build, paint) completes well inside SC-005's 100 ms and the `selectionchange` handler itself only schedules (Principle XII; timings logged for the PR)
- [x] T040 [US4] Implement `ui/src/renderer/preview/preview-occurrences.ts` (text model cached per draw, invalidated by `onDrawn`; DOM selection → model offsets); add `matchRanges()` to the preview search controller in `ui/src/renderer/preview/preview-search.ts`; wire into `ui/src/renderer/preview/preview-panel.tsx`

- [x] T051 [US4] [derived] Bring the preview's first occurrence frame after a draw inside SC-005: T039 measured 107 ms cold (text model built on the first selection) against 15.6 ms warm. Core: `occurrenceMatches` accepts a plain string (main, `core/src/search/occurrence-model.ts`), so the preview stops copying its text model into a `Text`; renderer: build the text model in idle time after each draw in `ui/src/renderer/preview/preview-occurrences.ts`, so a selection never pays for it; `ui/tests/component/preview-occurrences.test.ts` asserts the cold frame under 100 ms and logs it

**Checkpoint**: occurrences tinted in editors and previews, governed by the setting.

---

## Phase 7: User Story 6 — A panel moved to another window keeps its place (P2)

**Goal**: editors and terminals keep caret, selection and scroll across windows (FR-000a).

**Independent test**: scroll an editor and a terminal, select in each, move both to a sub-workspace window;
each shows the same position and selection.

- [x] T041 [US6] Write failing component tests in `ui/tests/component/editor-handoff-capture.test.ts`: a mounted editor registers an `editor` capture returning its live `selection.toJSON()` and scroll anchor; an editor mounted with a seeded `editor-view-state` entry restores that selection and scrolls the anchor line to the top (the existing `initialise()` take path)
- [x] T042 [US6] Register the editor capture in `ui/src/renderer/editor/use-editor.ts` (register on mount, unregister on dispose)
- [x] T043 [US6] Write failing tests in `ui/tests/component/terminal-handoff-capture.test.ts`: a mounted terminal registers a `terminal` capture returning `{offsetFromBottom: baseY - viewportY, selection: getSelectionPosition()}`; a seeded entry is restored after scrollback replay; output written after restore does not move a scrolled-back viewport, and output written between the replay and the restore is present in the buffer after it, with the viewport still at the restored offset (Edge Cases: no loss, no pull to the live end)
- [x] T044 [US6] Register the terminal capture in `ui/src/renderer/terminal/use-terminal.ts`
- [x] T045 [US6] [derived: narrowed to ONE editor case carrying a selection and an open find session — the window boundary is one mechanism for every panel kind; terminal and preview capture/restore are pinned at component layer (T043, T047, T020) and by MT-01/MT-07] Add `ui/tests/e2e/panel-state-across-windows.e2e.ts` (`@extended @window`; reserve entry: a real second window): (a) an editor scrolled to line 500 with a selection and a terminal scrolled back with a selection, each sent to a new sub-workspace window, show the same place and selection there (US6.1–6.2, SC-007); (b) a preview with find at `2 of 5` sent to a sub-workspace window reads `2 of 5` with the second match current (US1.5); re-seed `ui/tests/e2e/e2e-budget.json` and update `ui/tests/e2e/parallel-plan.json` if the throng-testing rules require it for a spec that opens a window

**Checkpoint**: FR-000a met on the route that exists; the hand-off is symmetric for any future reattach route (US6.3).

---

## Phase 8: User Story 5 — Keep a selection visible after focus moves away (P3)

**Goal**: an unfocused panel shows its selection in the inactive colour until changed (#457).

**Independent test**: select a word in a preview, click into a terminal; it stays highlighted inactive. Click
back without moving the caret, Copy; the word is on the clipboard.

- [x] T046 [US5] Write a failing CSS pin in `ui/tests/unit/editor-inactive-selection-css.test.ts` for `.editor-panel .cm-editor:not(.cm-focused) .cm-selectionBackground` → `var(--throng-colour-editorSelectionInactive)` with the focused rule unchanged; then add it to `ui/src/renderer/editor/editor.css`. Add component cases in `ui/tests/component/editor-inactive-selection.test.ts`: an editor with a selection loses `cm-focused` when focus moves to another panel or to its own find bar (Edge Cases) and keeps the selection; refocusing without a click keeps the same selection and Copy copies its text (FR-023); after an unmount + remount over unchanged text the same selection is present (US5.7)
- [x] T047 [US5] Write failing component tests in `ui/tests/component/preview-retained-selection.test.ts`: a selection made in a focused preview body is retained as `{from, to, text}`; on focus leaving it is painted under `throng-preview-selection-inactive`; focus returning without a pointer-down inside restores the DOM selection with the same text (Copy source) and clears the paint (FR-023); a pointer-down inside discards it (US5.4); a selection made in another panel leaves it painted (US5.6); unmount + remount over the same text restores it inactive (US5.7); over changed text it is dropped (FR-026); its occurrences follow it at inactive strength; the `previewSelection` hand-off section captures and seeds it
- [x] T048 [US5] Implement `ui/src/renderer/preview/preview-selection.ts` (module map save/take, offset mapping shared with `preview-occurrences.ts`, paint via the registry, capture registration); wire into `ui/src/renderer/preview/preview-panel.tsx`

**Checkpoint**: all six stories delivered.

---

## Phase 9: Polish & Cross-Cutting

- [x] T049 Document the three new theme tokens beside the setting in `docs/preferences.md` (FR-028) and add the feature to `CHANGELOG.md`'s unreleased section; run the `throng-docs` audit
- [x] T050 Run the quickstart automated checks (`specs/049-match-and-selection-highlighting/quickstart.md`) and record the T035 timings for the PR body

---

## Dependencies

- Phase 2 blocks every story. Within it: T002→T003; T004→T005→T006→T007→T008→T009; T010→T011→T012→T013.
- US1 (Phase 3) needs T003 (registry) and T011/T013 (hand-off) for T020.
- US2 needs US1's `editor-search.ts`/`preview-search.ts` changes (T018) to avoid conflicting edits.
- US3 is independent of US1/US2; T028 must precede T030.
- US4 needs US3 (tokens, CSS) and T003.
- US6 needs Phase 2 and T020; T045 needs T020, T042, T044.
- US5 needs US3 (token), US4's offset mapping (T040) and Phase 2.

## Parallel opportunities

- T002, T004, T006 (different packages and files).
- Within US3: T029 alongside T028's fixture capture is not parallel (T029 reads the fixture); T032 runs alongside T030–T031.
- Within US4: T033 and T035 (core) alongside T036 (settings) and T037 (ui).
- US3 can run alongside US1/US2 (core theme files vs renderer search files).

## Implementation strategy

MVP = Phase 2 + US1 (#456). Then US2 (#455), US3 → US4 (#325, #324), US6 (FR-000a), US5 (#457). Each phase ends
at a checkpoint whose tests are green before the next starts.

---

## Phase 10: Iterate round 1 (manual testing 2026-10-02, MT-01 and MT-02 on 511af1f9)

One clarified gap (FR-000b) and four defects. Each defect task is a failing test that reproduces what the maintainer
saw, then the fix; never bend the assertion to the behaviour.

- [x] T052 [US1] Failing test, then fix, per FR-000b: a panel dropped by a drag — onto another tab, onto a panel's
  edge (a split), onto a tab's outer edge, onto the New-Tab button — becomes the shown tab's active panel and takes
  keyboard focus once its view has (re)mounted, for editor, preview, terminal and an untyped panel. The drop handler is
  `onDragEnd` in `packages/ui/src/renderer/workspace/tab-group.tsx`; focus delivery after the remount goes through
  `packages/ui/src/renderer/workspace/panel-focus.ts` (park-then-deliver, so the outgoing registration cannot consume
  the request)
- [x] T053 [US1] Failing test, then fix, per FR-000/FR-001/FR-002: an EDITOR with find at `2 of 5` keeps `2 of 5`, its
  highlights and Next → `3 of 5` after a drag to another position in the SAME tab and after a drag into ANOTHER tab.
  Today it reads "No results" in both. Tab switch already passes, so the defect is in what a drag does that a tab
  switch does not (registration order across the remount, `unregisterPanelSearch` in the outgoing view's cleanup,
  the content arriving after `restore`). `packages/ui/src/renderer/editor/use-editor.ts`,
  `packages/ui/src/renderer/search/search-store.ts`, `packages/ui/src/renderer/search/editor-search.ts`
- [x] T054 [US1] Failing test, then fix, per FR-000/FR-001/FR-002: a PREVIEW with find at `2 of 5` keeps it after a drag
  into ANOTHER tab (a same-tab drag already passes); today the bar reads "No results" though the word is shown.
  `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/preview/preview-search.ts`
- [x] T055 [US2] Failing test, then fix, per FR-004: in a preview, Next / Previous (and F3) onto a match inside a
  collapsed section — itself collapsed, or under a collapsed ancestor — expands it every time, not only for the first
  match the query lands on. `revealBeforeScrollRef` in `preview-panel.tsx`, `revealAndScroll` in `preview-search.ts`,
  the body's `onRevealSection` in `providers/markdown/markdown-body.tsx`. Check the editor equivalent (FR-005) the same
  way
- [x] T056 [US2] Failing test, then fix, per FR-001/FR-002: collapsing or expanding a section while find is open
  repaints the match highlights and outline frames over the text as it now lies; today the frames stay where they were
  (over blank space or unrelated text) until the next search or Next/Previous. `preview-search.ts` (`repaintFrames`
  runs only on body scroll and body resize), `preview-panel.tsx`
- [x] T057 [derived] E2E per Principle V: extend an existing panel-drag E2E spec (no new file) with one case — drag an
  editor with an open find to another tab: that tab shows, the editor is focused, the bar reads `2 of 5`. Re-seed
  `packages/ui/tests/e2e/e2e-budget.json` in the same commit if the declaration count changes

---

## Phase 11: Iterate round 2 (manual testing 2026-10-02 on b6236c3a)

T053–T055 were reported from a stale checkout of the 048 branch, not this one; on 049 their characterisation tests
pass and MT-01/MT-02 were signed off, so they closed without a production change. Round 2: MT-04 failed (current match
not distinct on English Garden, Matrix, Snake, VI-VIM), MT-06 signed off with a visibility note, and a Collapse All
defect against 047 FR-037a.

- [x] T058 [US3] Failing unit test, then the derivation change, per FR-009a / SC-003a: on every theme in
  `ALL_DEFAULT_THEMES`, `searchMatch` ↔ `searchMatchCurrent` ≥ ΔE00 9.0 while 043 FR-067's surface-from-page pairs
  (≥ 3.0) and FR-011's syntax contrast still hold; themes already clearing 9.0 keep their shipped values byte-for-byte.
  `packages/core/src/config/default-themes/index.ts`, `packages/core/src/config/theme-quality.ts` (a named floor for
  the pair), `packages/core/tests/unit/theme-match-distinctness.test.ts`; re-record any measured constant that moves
- [x] T059 [US5] Failing unit test, then the derivation change, per FR-025a: `editorSelectionInactive` ≥ ΔE00 9.0
  from `editorBg` on every bundled theme, FR-025's distinctness still holding. `default-themes/index.ts`
  (`inactiveSelection`), `packages/core/tests/unit/theme-occurrence-surfaces.test.ts`
- [x] T060 Shipped-defaults upgrade for the changed values (T058, T059): bump `SHIPPED_DEFAULTS_VERSION` to 20 and
  move only values the user has not overridden, as the 18→19 upgrade does; re-pin every test asserting 19.
  `packages/core/src/config/shipped-defaults.ts`, `packages/core/tests/unit/theme-occurrence-upgrade.test.ts`
- [x] T061 [US3] Failing test, then fix, per FR-009b: the current match's outline is 2 px in editors
  (`packages/ui/src/renderer/search/find-bar.css`) and in previews (the match-frame layer), and its colour contrasts
  ≥ 3:1 with the page and the current-match fill on every bundled theme (core unit test over `ALL_DEFAULT_THEMES`)
- [x] T062 Failing test, then fix, per 047 FR-037a: Collapse All in a Markdown editor whose document has one H1 shows
  the H1's fold marker as collapsed (`+`), like every other section, and the linked preview agrees

---

## Phase 12: Iterate round 3 (2026-10-02 14:46 — scrolling)

The maintainer found scrolling an editor or a preview laggy, with highlighted text trailing a little. MT-01–MT-07
were signed off at 12dc5f49 before this round.

- [x] T063 [US3] Measure first, per SC-008 and Principle XII: in the real app, a 10,000-line Markdown document in an
  editor and in a preview, scrolled programmatically at a steady rate with (a) find closed and occurrence
  highlighting off and (b) find open and a selection's occurrences tinted; record frame times (p50, p95, longest) and
  scripting time per scroll. One temporary Playwright script, deleted after; numbers into `research.md` (R14)
- [x] T064 [US3] Failing test, then the change, per FR-029: the preview's match-frame layer lives inside the scrolling
  container, positioned against the content, so frames scroll with their text; `repaintFrames` no longer runs on the
  body's `scroll` event, only on a draw, a fold, a resize and a zoom. `preview-panel.tsx`, `preview-search.ts`,
  `match-frames.css`
- [x] T065 [US4] Failing test, then the change, per FR-030: the editor occurrence plugin computes over the whole
  document on a selection, document, find-match or focus change, and does nothing on `viewportChanged` alone.
  `packages/ui/src/renderer/editor/occurrence-highlight.ts`; keep SC-005's keystroke budget (re-run the timing test)
- [x] T066 [US3] Re-measure with T063's script after T064–T065 and record the after numbers beside the before ones
  (SC-008)
