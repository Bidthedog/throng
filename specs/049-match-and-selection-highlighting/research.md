# Research: Match and Selection Highlighting

Every decision below was taken by reading the code at `423a1959`. Paths are repository-relative; `ui/` is
`packages/ui/src/`, `core/` is `packages/core/src/`.

## R1 — A registering search engine re-applies its panel's open session (#456, FR-001–FR-003)

**Finding**: `ui/renderer/search/search-store.ts` holds `FindSession`s in a module `Map` that survives a
remount, but `registerPanelSearch` (`search-controller.ts:65`) only stores the controller. The editor
(`use-editor.ts:1858-1867`), terminal (`use-terminal.ts:1115`) and preview (`preview-panel.tsx:647`) all register
a **new** engine with an empty term on mount. `applyQuery` (`search-store.ts:146`) runs only from `openFind`,
`setTerm` and `toggleMode`; `followActivePanel` moves `showingFor` and touches no engine. So after a tab
switch the bar shows the stored `2 of 5`, the view has no highlights, and Next on an engine with no term reports
no results — #456 exactly, in editors as well as previews.

**Decision**: replace the three bare `registerPanelSearch` calls with `attachPanelSearch(panelId, controller)`
in `search-store.ts`, which registers and, when an open session exists with a non-empty term, calls a new
controller method `restore(term, modes, anchor)`:

- `anchor` is the session's current match **text offset** (stored on the session as `currentFrom`, updated on
  every count change), not its index — the preview's `refresh()` (`preview-search.ts:319-327`) already anchors
  this way and for the same reason (FR-003: content may have changed).
- `restore` runs the query, sets `current = indexFrom(matches, anchor)` (nearest following, wrapping), paints,
  and does **not** scroll or reveal — returning to a tab must not move the user's view; the scroll position is
  restored by the panel's own view state.
- The store writes the returned count back, so the bar always describes the displayed document (FR-002).

A preview attaches its engine before its body has drawn; its existing `onDrawn → refresh()` path then re-runs
against real content, so `restore` on an empty body is harmless and corrected one draw later.

**Alternatives rejected**: re-running `applyQuery` on `followActivePanel` — panels on a hidden tab never
become active, and a visible-but-inactive split would stay blank. Keeping the engine alive across unmount —
an engine holds a `view`/DOM that the unmount destroys.

## R2 — Preview highlights compose per panel (#456, FR-014b)

**Finding**: `createCssHighlightPainter` (`preview-search.ts:56`) calls `CSS.highlights.set(name, new
Highlight(...ranges))` with two **document-global** names (`:28-29`). Two previews in one window share the
registry; the second to paint replaces the first's ranges, and a closing preview's `clear` deletes the other's.

**Decision**: a small `ui/renderer/preview/highlight-registry.ts`: `setPanelRanges(name, panelId, ranges)`
and `clearPanel(panelId)` keep a `Map<name, Map<panelId, Range[]>>` and rebuild the one `Highlight` per name
from the union. Every preview highlight in this feature goes through it: search match, current match,
occurrence, inactive occurrence, retained selection. Ranges belong to each panel's own DOM, so a union is
exact.

**Alternatives rejected**: per-panel highlight names (`throng-preview-match-<id>`) — `::highlight()` names
must appear in the stylesheet, so dynamic names need runtime CSS injection per panel.

## R3 — A main-side, in-memory panel-state hand-off (FR-000, FR-000a)

**Finding**: a tear-off is a **copy**: `core/workspace/sub-workspace.ts:31-61` `detachPanel` keeps the panel
in the main layout and gives the sub-workspace one with the same id. The destination window
(`ui/renderer/subworkspace-app.tsx:89-102`) remounts its `WorkspaceProvider` on a `changed` push; the source
never unmounts. Every renderer-side map (`editor-view-state.ts`, `terminal-view-state.ts`, `search-store.ts`)
is per renderer, so the destination starts empty. Routes that send a panel to another window:
`detach-context.tsx` `detachToNew` (124-172) and `syncToExisting` (174-214), reached from menus and from
`tab-group.tsx:1255-1273` `dropToSubWorkspace`. `core` `reattachPanel` exists but no UI route calls it.

The only main-side per-panel store, `throng:history:setViewState`, is unusable here: preview-only
(`navigation-history-service.ts:161`), stored per **history entry**, 1 KB, persisted into the layout and merged
by FR-115.

**Decision**: a new `ui/main/panel-state-handoff.ts` service (in-memory `Map<panelId, PanelSnapshot>`), two
invoke channels (`throng:panelState:stash`, `throng:panelState:claim`), exposed as `window.throng.panelState`.

- **Capture (renderer, sending window)**: `ui/renderer/workspace/panel-state-capture.ts` keeps a registry of
  live capture functions by panel id — the editor registers `selection.toJSON()` + its last scroll anchor, the
  terminal `offsetFromBottom` + `getSelectionPosition()`, the preview its retained selection (R12). For a panel
  not mounted (hidden tab) it **peeks** the panel's saved entry in the existing maps (new non-consuming
  `peek*` functions). The find session comes from `search-store` (`snapshotFindSession`).
- **Order**: `detachToNew` / `syncToExisting` call `stashPanelState(panelIds)` and **await** it before
  `persistSubWorkspaces`, so the snapshot is in main before the destination is opened or notified.
- **Claim (receiving window)**: `subworkspace-app.tsx` awaits `panelState.claim(panelIds)` for its layout's
  panels before (re)rendering the `WorkspaceProvider`, and seeds each map **only where it has no entry of its
  own** (a remount of a panel already in this window keeps its local, newer state). `claim` deletes what it
  returns.
- **Lifetime**: transient (FR-000 assumption). An unclaimed snapshot is overwritten by the next stash and
  dropped when the panel is destroyed (main already learns of destroy through the panel IPC) or the app quits.
- **Safety**: main checks the shape (`kind` per section, finite numbers) and drops a snapshot over 64 KB.
- **Symmetric**: any window may stash and any may claim, so a future reattach route (US6 scenario 3) needs only
  the same `stashPanelState` call.

**Alternatives rejected**: relaying through `throng:panel:draft` (main does not store, so a window that has not
mounted yet misses it); persisting into the layout (FR-000 says transient); widening history's `viewState`
(above).

## R4 — Preview find across folds: diagnose from a failing test first (#455, FR-004, FR-006)

**Finding**: the mechanism 047 built exists — `revealAndScroll` (`preview-search.ts:270-279`) calls
`revealBeforeScroll(node)`, wired to `preview-panel.tsx:989-998`, which finds the section with
`sectionAtPoint`, checks `visibleSections`, records `pendingReveal` and calls `revealRef.current(slug)`; the
effect at `:1000-1013` finishes the scroll when `foldState` changes. The defect is reported against it, so the
cause is not visible from reading. Hypotheses, each with what would confirm it:

1. `isFoldableProvider` or `revealRef.current` is unset at the time of the first `setQuery` (typed query) —
   confirmed by a component test that types a query matching only folded text and asserts the reveal call.
2. `sectionAtPoint` resolves the **match's own nearest heading**, and `revealing` is given a slug that is
   already visible while an ancestor is collapsed — confirmed by the nested-fold case (US2 scenario 2).
3. The body redraw caused by the fold change runs `onDrawn → refresh()`, which re-paints without
   `revealAndScroll`, and the `pendingReveal` scroll targets a node replaced by the redraw — confirmed by
   asserting the scrolled element is still connected.

**Decision**: write the failing component tests for US2 scenarios 1–3 against `preview-panel.tsx` with a
foldable Markdown body (jsdom; the painter and frames faked as the existing `preview-find.test.ts` does), run
them, and fix what they show. `pendingReveal` keeps the **match offset** rather than a node, re-located after
the redraw.

## R5 — The editor reveals a folded match through the fold authority (FR-005–FR-007)

**Finding**: the editor's search `reveal()` (`editor-search.ts:105-109`) only scrolls. Editor folds are
Markdown section folds whose authority is main (`main/editor-coordinator.ts:1392-1431`), cached by
`fold-state-store.ts` and applied by `markdown-fold.ts` `syncFoldRanges` (110-135). A bare `unfoldEffect`
would be refolded by the next `syncFoldRanges` and never reach main. CodeMirror's `foldState` field also drops
a fold when the selection head lands inside it (to be pinned by a test: if so, a caret move into a fold
desynchronises CodeMirror and main today).

**Decision**: `ui/renderer/editor/editor-fold-reveal.ts`
`revealOffset(view, pos, deps): boolean` — builds the tree from `markdownHeadingRecords(view.state)`, finds the
section with `sectionAtLine`, and when it is not in `visibleSections`, computes `revealing(state, tree, slug)`
(core `outline/fold-state.ts:84`, which opens ancestors), calls `setDocumentFoldState(docKey, next, panelId)`
and `syncFoldRanges(view, liveSections(view), next)` synchronously, then lets the caller scroll. The editor
search controller takes it as an optional `revealBeforeScroll(pos)` dependency, mirroring the preview's.
`replaceCurrent` reveals before replacing (FR-007). Find never collapses (FR-006): only `revealing` is used.

## R6 — Replace All with folded matches asks first (FR-007a)

**Finding**: `ui/renderer/confirm-dialog.tsx` already offers `useChoose()` → `Promise<string | null>` with any
number of choices, focus-trapped, Escape = dismissed; `editor/dirty-close-dialog.tsx` is the three-choice
precedent. `search-store.ts:277-281` `replaceAll` calls `controller.replaceAll` synchronously.

**Decision**: the editor controller gains `foldedMatchCount(): number` (matches inside a collapsed section).
`search-store.replaceAll` becomes async: if zero, unchanged. Otherwise it calls an injected chooser
(`search/replace-all-prompt.tsx`, registered by a component mounted beside `ConfirmProvider` that owns a
`useChoose`) with **Cancel / Replace and keep folded / Replace and unfold**, initial focus on *Replace and
unfold*. `cancel` or dismissal does nothing; *keep folded* replaces in one transaction and leaves `FoldState`
alone; *unfold* computes one `FoldState` revealing every folded match's section, sets it, then replaces — one
fold-state write and one undo step. No `confirmations.*` setting (spec Assumptions).

**Alternatives rejected**: `window.confirm`-style two choices — FR-007a needs three.

## R7 — Two occurrence surfaces on the existing neutral ray; one derived inactive selection (FR-008–FR-012, FR-016, FR-018a, FR-025)

**Finding**: `core/config/default-themes/index.ts:165-249` `searchHighlights` derives `current` (accent ray),
`match` (neutral ray, maximising distance from both page and current while readable), `border` and `outline`.
14 themes go through `makeTheme`; `throng` is hand-written in `config/theme.ts` with hand-measured values.
`editorSelection` is `p.selection ?? p.surfaceActive ?? p.surface` (`:448`). Guards:
`theme-syntax.test.ts:105-112` (FR-007a, syntax ≥4.5 on match surfaces), `theme-match-distinctness.test.ts`,
`theme-quality.test.ts` (`SYNTAX_ON_MATCH`), `default-themes.test.ts` (`EXPECTED_COLOUR_TOKEN_COUNT = 75`,
`ADDED_SINCE_FIXTURE`, a fixture of pre-refactor colours).

**Decision**: `searchHighlights` returns two more values, computed **after** the existing four so those are
byte-identical (FR-009, SC-003):

- `occurrence` = `match` (the same soft tint: *another instance*, FR-010). It is a separate token so a user can
  override it, but its derived value is the ordinary-match background; the ordinary match keeps its outline,
  the occurrence has none.
- `occurrenceInactive` = the first neutral-ray step **nearer the page** than `occurrence` that stays readable
  (every syntax colour and `editorFg` ≥4.5:1) and perceptibly tinted (ΔE00 against `editorBg` ≥ the existing
  `MATCH_DISTINCTNESS_THRESHOLD`); weaker than `occurrence` by both ΔE and contrast (FR-018a).

A sibling function `inactiveSelection(editorBg, editorFg, selection, matchSurfaces, overlaid)` blends the
selection toward the page until it is distinct (ΔE00 ≥ threshold) from the selection and from every match
surface and stays readable (FR-025). Tokens: `searchMatchOccurrence`, `searchMatchOccurrenceInactive` (Search
area by prefix), `editorSelectionInactive` (Editor area by prefix). `THRONG_THEME` gets hand-measured values
from the same functions; `SHIPPED_DEFAULTS_VERSION` 18 → 19 with an additive upgrade so a user's theme copy
gains the tokens; `EXPECTED_COLOUR_TOKEN_COUNT` 75 → 78 and `ADDED_SINCE_FIXTURE` lists them. Guard tests
extend: syntax ≥4.5 on all three; occurrence weaker than selection (FR-016); inactive occurrence weaker than
occurrence; inactive selection distinct from selection and every match surface.

## R8 — One occurrence model in core (FR-015, FR-013)

**Decision**: `core/search/occurrence-model.ts`, beside `match-model.ts`:

- `occurrenceQuery(lineText, from, to): { term, wholeWord } | null` — `null` for a selection that is empty,
  whitespace-only, multi-line, or shorter than 2 characters. `wholeWord` when the characters just outside the
  selection are boundaries (or line ends) and its first and last characters are word characters.
- `isWordChar(ch)` = `/[\p{L}\p{N}_]/u` — FR-015's definition stated once. CodeMirror's own `wholeWord` uses
  the state's categoriser, so it is **not** reused for the boundary test.
- `occurrenceMatches(doc: Text, query, selection, within?: {from, to}[]): Match[]` — literal, case-sensitive
  substring matches, filtered by the boundary rule when `wholeWord`, optionally bounded to visible ranges.
  *Implementation note (T035)*: first built on `editorMatches`, whose `SearchCursor` walks character by
  character for case folding; it measured 46.9 ms on 10,000 lines. A literal case-sensitive match is exactly
  a substring search, so it is `indexOf` over the text: 2.2 ms. The find bar's model (043 FR-039) is
  unaffected — occurrence matching has no modes to share with it.
- `withoutSearchMatches(occurrences, searchMatches): Match[]` — FR-013 stated once: an occurrence overlapping
  any search match is dropped. Both editor and preview call it; one unit test asserts it.

The selection itself is excluded from its own occurrences.

## R9 — The editor tints through a viewport-bounded ViewPlugin beneath syntax (FR-014, FR-017, FR-018, FR-019)

*(Superseded in part by R14: the scan is over the whole document and is not repeated on a viewport change.)*

**Decision**: `ui/renderer/editor/occurrence-highlight.ts` exports `occurrenceHighlight(enabled: () =>
boolean)`: a `ViewPlugin` under `Prec.low` (same layer as `editor-search.ts:79-84`, beneath syntax, FR-011)
producing `Decoration.mark({class: 'throng-occurrence'})` for `view.visibleRanges` only. It recomputes on
selection change, document change and viewport change, and reads the search highlight field's current matches
to apply `withoutSearchMatches`. Decorations are marks only: no selection, no command, no keymap (FR-017). The
setting is a `Compartment` reconfigured from `useAppSettings()` (the `gutterCompartment` precedent,
`use-editor.ts:943-959`), so it changes without reload (FR-019). Focus state is CSS:
`.cm-editor:not(.cm-focused) .throng-occurrence` uses the inactive token (FR-018a).

## R10 — The preview tints its rendered text model, deferred a frame (FR-014, FR-014a, FR-020)

**Decision**: `ui/renderer/preview/preview-occurrences.ts`: on `selectionchange` inside the body (and on focus
change), schedule one `requestAnimationFrame`; in it, map the DOM selection to text-model offsets (the inverse
of `locate`), build the query with `occurrenceQuery`, match against the same model `buildPreviewTextModel`
produces (FR-014a — formatting boundaries are already transparent there, `preview-search-model.ts:7`), drop
search-match overlaps, build ranges and paint through the registry (R2) under `throng-preview-occurrence` or
`throng-preview-occurrence-inactive` depending on whether the panel's body has focus. The model is cached per
draw and invalidated by `onDrawn`.

**Measurement (XII)**: a unit test builds a 10,000-line text model and a matching `Text`, times
`occurrenceMatches` + `withoutSearchMatches` for a common word, and asserts under a budget well inside 100 ms
(the editor path is viewport-bounded and timed the same way). The PR quotes the measured numbers.

## R11 — Editor inactive selection is CSS (FR-021, FR-023, FR-024)

**Finding**: `drawSelection()` paints `.cm-selectionBackground` whether or not the editor is focused, and
`editor.css:61-68` gives both states the same colour. CodeMirror keeps its selection on blur and restores it as
active on refocus; Copy copies it.

**Decision**: one rule, `.editor-panel .cm-editor:not(.cm-focused) .cm-selectionBackground { background:
var(--throng-colour-editorSelectionInactive) !important; }`, pinned by a CSS unit test. A tab switch already
round-trips the selection through `editor-view-state.ts`; across windows R3 carries it.

## R12 — The preview retains its selection as text-model offsets (FR-021–FR-024, FR-026)

**Finding**: a document has one DOM selection; clicking into another panel replaces it, and there is no
`::selection` rule for previews. Preview selection is never saved on unmount (constitution XI, known
violation).

**Decision**: `ui/renderer/preview/preview-selection.ts`:

- While the body has focus, track the selection as `{from, to, text}` in text-model offsets.
- On focus leaving the panel: keep it and paint it under `throng-preview-selection-inactive`
  (`editorSelectionInactive` token) through the registry.
- On focus returning **without** a pointer-down inside the body: re-create the DOM selection from the offsets
  (`Selection.addRange`), clear the inactive paint — active again, Copy copies it (FR-023). A pointer-down
  inside the body discards it (US5 scenario 4).
- On unmount: save it in a module map (as `editor-view-state.ts` does); on the first draw after mount, take it
  and restore it only if the model's text at those offsets still equals `text` (FR-026), shown inactive until the
  panel takes focus (US5 scenario 7).
- The capture registry (R3) reports it for a cross-window hand-off.

Its occurrences follow it (R10): inactive strength while unfocused.

## R13 — Test layers

| Layer | Covers |
|---|---|
| core unit | `occurrenceQuery`/`occurrenceMatches`/`withoutSearchMatches` (FR-013, FR-015); derivation byte-identity of shipped surfaces (SC-003); new-token guards (FR-011, FR-016, FR-018a, FR-025); settings parse/default/metadata; shipped-defaults upgrade; performance budget (SC-005) |
| ui unit | search-store attach/restore and snapshot/seed; highlight registry union; CSS pins (`find-bar.css`, `editor.css`); hand-off service in main (shape, cap, claim deletes); docs currency; settings inertness `-049` |
| component (jsdom) | #456 editor and preview re-apply after remount; #455 preview reveal (typed, Next, nested) and editor reveal; Replace All prompt three outcomes; editor occurrence plugin; preview occurrences; preview retained selection; `subworkspace-app` seeding before mount; `detach-context` stash-before-persist order |
| integration | the hand-off IPC round-trip through preload against the real main service |
| E2E `@extended @window` | US6: editor and terminal torn off into a sub-workspace keep place and selection; US1 scenario 5: a preview's find bar after a tear-off. Budget re-seeded in the same commit. |

No E2E for what a component test can prove (Principle V). Manual tests cover visual judgement: tint strengths
per theme, the inactive selection, the 100 ms feel on a large file.

## R14 — Scrolling does no highlight work (FR-029, FR-030, SC-008; supersedes R9's viewport rebuild and FR-020's on-screen-only scan)

**The report.** Scrolling an editor or a preview felt laggy, and highlighted text trailed behind.

**Root causes, confirmed by reading the paths the scroll takes.**

- *Preview.* The match-frame layer was a sibling of the scrolling body, so the frames did not scroll with the text;
  `preview-panel.tsx` therefore repainted them on every body `scroll` event. Each repaint (one per animation
  frame) called `Range.getClientRects` on **every** match range of the document (forcing layout) and replaced every
  frame element. The cost grew with the number of matches, and because the scroll event is delivered after the
  compositor has already moved the content, a frame always showed at least one frame late: the trailing the
  maintainer saw. It is structural, so a same-frame probe cannot show it (see the method note).
- *Editor.* `occurrence-highlight.ts` rebuilt its tints on `viewportChanged`: a scan over `view.visibleRanges`, a
  search-match lookup and a fresh `DecorationSet` on every viewport change while a selection's occurrences were
  tinted.

**The change.** The frame layer is now a zero-size child of the scrolling body (`position: relative`), beside the
rendered content and not in it, so frames scroll with their text on the compositor and need no script. A band of
three viewports each way is framed up front; a scroll reads two numbers (`scrolled()`) and asks for one repaint
only when the viewport leaves the band. Draw, fold and resize still repaint. The editor plugin recomputes on a
selection, document or find-match change and not on a viewport change, over the whole document (about 2 ms per 10,000
lines, core's scan; CodeMirror paints only the marks in view).

**Method.** One temporary Playwright script (deleted after) against the built renderer: a 10,000-line Markdown
document (about 13,000 lines with blank lines and 100 headings; 500 `needle` matches; a word in a fifth of the
lines for the occurrence tint) opened in an editor and in its preview. Each scroll run sets `scrollTop += 50` every
`requestAnimationFrame` for 240 frames; three runs per condition, the median by scripting time reported, all three
listed. Frame time is the gap between rAF callbacks; scripting time is CDP `Performance.getMetrics`
`ScriptDuration` per frame. Conditions: (a) find closed, no selection; (b) find open on `needle` with a selection's
occurrences tinted. This machine was shared, so absolute values are noisy: the runs agree to about 10%
at p50 and 30% at p95. The harness itself accounts for most of the scripting time (it reads and writes `scrollTop`
every frame), so the comparison is between rows, not against zero.

| Panel and condition | Frame p50 | p95 | Longest | Scripting per frame | |
|---|---|---|---|---|---|
| Editor (a) | 23.4 ms | 79.3 | 142.7 | 19.0 ms | before |
| Editor (a) | 24.9 | 92.7 | 136.6 | 20.3 | after |
| Editor (b) | 25.5 | 78.2 | 107.7 | 19.6 | before |
| Editor (b) | 24.8 | 92.2 | 134.7 | 19.8 | after |
| Preview (a) | 18.4 | 89.3 | 126.9 | 15.1 | before |
| Preview (a) | 19.8 | 134.7 | 210.3 | 16.3 | after |
| Preview (b) | 29.2 | 105.3 | 183.4 | 19.7 | before |
| Preview (b) | 23.9 | 103.6 | 158.7 | 16.8 | after |

**What the numbers say, and do not.** Preview (b) is the only row that moved: p50 29.2 to 23.9 ms and scripting 19.7 to
16.8 ms per frame, which puts it level with the no-find case, as SC-008 asks. Every other difference is inside the
run-to-run spread (the three runs of one cell differ by more than the before/after gap). The editor's scan is
cheap enough at this size that the harness cannot see it; the change there is justified by FR-030 and by the code
path, not by a frame-time gain, and the component test pins it (the plugin returns the same decoration sets across a
viewport change). The frame-time cost the first, unpersisted run of this script showed in the preview with find
open (p50 138 ms) was a run under load, not a measurement.

*Range measurements, after.* With find open on 500 matches, the preview made about 3,100 more `getClientRects`
calls than with find closed over 240 scrolled frames (12,000 px), which is the six band rebuilds a 12,000 px scroll
needs (one per three viewports), where the old path made one call per match per frame (500 x 240 = 120,000). The
before count was not instrumented; it follows from the code.

*Frame-to-text offset.* While scrolling, the distance between each visible frame and its match's text: 0.0 px mean,
p95 and longest over 221 samples after; before, 0.4 px mean with a 50 px longest (stale until the next animation frame).
The probe reads positions after the repaint's own animation frame, so it understates the old trailing; the
compositor-scrolled content is a frame ahead of the scroll event, which the new layout removes by construction.

**Alternative rejected.** Framing every match once and never repainting on scroll: simple, but the cost of the
first paint and the number of nodes grow with the match count (a one-letter query on a large document), so the
band bounds both.
