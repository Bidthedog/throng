# Research: Markdown Preview Enhancements (047)

Every decision below was taken against the code as it stands at `962544f4` (master after
1.0.0-alpha7). Paths are repository-relative. "R" numbers are cited from `plan.md`, the contracts and
`tasks.md`.

## R1 — Find in a preview: a third search controller, not a second UI

**Decision.** Add `PreviewSearchController` (`panelKind: 'preview'`) beside the editor and terminal
controllers in `packages/ui/src/renderer/search/search-controller.ts`, implemented in
`packages/ui/src/renderer/preview/preview-search.ts`. The preview panel mounts `<FindBar panelId>` in
its positioned root exactly as `editor-panel.tsx:73` does, and registers its controller with
`registerPanelSearch` on mount.

- **Match semantics** come from core's `editorMatches` (`packages/core/src/search/match-model.ts`), run
  over a **text model** of the rendered body: a `TreeWalker(SHOW_TEXT)` over `.preview-markdown`,
  concatenated, with a parallel offset → `(Text node, offset)` map. The same matcher the editor uses
  gives identical match-case / whole-word behaviour (FR-001) and rendered-text matching (FR-002)
  falls out: `**bold**` is the text node `bold`.
- **Excluded from the text model**: the fold toggles and gutter (R6), and anything `aria-hidden`.
  Collapsed sections are **included** (edge case *Find across a fold*); the current match reveals its
  section (FR-040) through the fold API before it is scrolled into view.
- **Highlighting** uses the **CSS Custom Highlight API** (`CSS.highlights`, `::highlight()`), which
  Chromium ships: two named highlights, `throng-preview-match` and `throng-preview-match-current`,
  built from `Range`s. It paints without touching the sanitised DOM, so scroll anchors, copy, link
  wiring and the sanitiser's invariants are undisturbed. Colours are the existing
  `--throng-colour-searchMatch*` tokens (FR-006, 013 FR-019). jsdom has no `CSS.highlights`, so the
  painter is an injected seam (`HighlightPainter`) with a recording double in component tests.
- **Re-render** (FR-005): the body's existing `onDrawn` callback re-runs `setQuery` with the session's
  term; the current index is re-seated on the match nearest the old current match's text offset.
- **Replace** is excluded by construction: the store and bar gate replace on `panelKind === 'editor'`
  (`search-store.ts:183,239,254`, `find-bar.tsx:79`), so a `'preview'` kind is find-only with no new
  flag.

**Scope change (FR-004).** `COMMAND_SCOPES` maps the seven `search.*` bar commands to `PANELS`
(`{editor, terminal}`, `keybindings.ts:332-338`). A new set `FIND_SURFACES = {editor, terminal,
preview}` takes `search.find`, `search.findNext`, `search.findPrevious` and `search.close`;
`search.replace`, `search.replaceCurrent` and `search.replaceAll` stay on `PANELS`, which keeps
`Alt+Enter` / `Ctrl+Alt+Enter` clear of the preview's chords (`keybindings.ts:499-501`).
`search-keybindings.tsx:109-111` maps `'preview'` to the new find kind. Tests that pin today's
inertness change with it: `packages/ui/tests/unit/scope.test.ts:161-205` and
`packages/ui/tests/component/preview-read-only.test.ts:153-166`.

**Displayed quantity.** The constitution lists `find-bar.tsx`'s `N of M` counter as a known ungrouped
quantity and binds any change that *adds a surface displaying a quantity*. Putting the bar on a
preview does exactly that, so the counter is digit-grouped through the shared formatter in this
feature.

**Alternatives rejected.** Wrapping matches in `<mark>` (mutates the sanitised DOM, breaks
`data-source-line` measurement and copy); `window.find` (no count, no whole word, moves the
selection); a second find UI (the issue forbids it).

## R2 — Heading symbols: one model, emitted by the pipeline

**Decision.** A core `DocumentSymbol` shape in `packages/core/src/outline/document-symbol.ts` —
`{ name, level, line, slug, children }` — the shape #375 will consume (FR-048). The Markdown
pipeline (`packages/ui/src/renderer/preview/providers/markdown/pipeline.ts`) already computes, per
heading, the rendered text (`headingText`), the de-duplicated slug (`headingSlug`) and the source line
(`blockAttributes`); today it keeps only `Map<line, slug>`. It now also records
`{level, text, slug, line}` per heading, in order, and `render()` returns `{ fragment, headings }`.
A core `buildSymbolTree(flat)` nests them by level.

The **editor** side derives the same list from the Lezer tree of `@codemirror/lang-markdown`
(`ATXHeading1–6`, `SetextHeading1–2`, which already excludes code blocks and front matter's `#`),
taking each heading's text through core `markdownInlineText` and slugging it with core
`headingSlug` in document order with a fresh de-dup set — **the same two functions the pipeline
uses**, so a heading has the same slug on both sides. A unit test runs one fixture through both and
asserts identical slug lists (setext, duplicates, inline markup, front matter, fences).

**Why the slug is the identity.** It is stable across edits that do not touch the heading's text, is
already unique per render, is what `#links` target, and is what the sanitiser already verifies
(nonce + slug per `data-source-line`), so raw HTML cannot plant one (FR-041).

## R3 — One fold state per document, in main, beside word wrap

**Decision.** Fold state follows the **word-wrap pattern** (`editor-coordinator.ts:1325-1369`): a map
in `EditorCoordinator` keyed by `wrapKey(doc)` (`file:<lowercased path>`), relayed to every view of
the document, forgotten when no panel shows it. Its value is a `FoldState`:

```
{ base: 'expanded' | 'collapsed', flipped: string[] /* slugs whose state differs from base */ }
```

- A section is collapsed iff `(base === 'collapsed') !== flipped.includes(slug)`.
- **Collapse All / Expand All** set `base` and clear `flipped` (FR-037a) — every section individually.
- **Collapse/Expand/Toggle This Section** add or remove one slug — nested sections keep their own
  entries, so re-expanding a parent restores children exactly (FR-030a).
- The initial state of a document is `{ base: <editor.markdownSectionsOpen>, flipped: [] }` (FR-039).
  A heading typed later follows the document's current `base` — for a document never bulk-folded that
  *is* the preference; after Collapse All it is collapsed, which is what the reader just asked for.
- Slugs no longer present are pruned on each update (edge case *headings removed*).

A **parented preview** reads the same state through the same key — its file — so FR-033's single
authority holds with no second copy (Principle XI). Main already derives *parented* from the
coordinator (`preview-service.ts:1196`). A **standalone preview** holds its own `FoldState` (FR-034)
in the **same map in main**, under `wrapKey`'s existing `panel:<id>` form — so a standalone preview
shown in two windows (Sync to) still has one original, never a copy per window (Principle XI). The fold
channels map a panel id to its key in main: an editor or a parented preview → `file:<path>`; a
standalone preview → `panel:<id>`. When a preview becomes parented, main drops its `panel:` entry and
the document's state applies; when it becomes standalone, main copies the document's current state
into a fresh `panel:` entry, so it keeps what it showed.

**Per-history-entry snapshot (FR-041d).** Held in main by `PreviewService`, keyed by panel id and
history entry index (`Map<panelId, Map<entryIndex, {filePath, fold: FoldState}>>`): written when the
run leaves an entry (it reads the run's current fold state), consulted when Back/Forward returns to it,
purged with the panel. It is **not** part of `NavigationHistoryService`'s entries and is never written
to `Panel.config.history`, so it is not persisted (044 FR-109 unchanged, `MAX_VIEW_STATE_BYTES`
unaffected). On return, a run that re-pairs uses the document's state; a standalone one gets the
snapshot as its `panel:` entry.

**Alternatives rejected.** Folding ranges by position (need mapping through every change, and the
preview has no positions); a per-panel copy synchronised peer-to-peer (Principle XI forbids two
originals).

## R4 — Editor folding: CodeMirror `codeFolding`, a heading-only gutter

**Decision.** `@codemirror/language` (direct dependency, ^6.12.4) provides `codeFolding()`,
`foldEffect` / `unfoldEffect` and `foldedRanges`. The editor applies folds **derived from the
`FoldState`**: compute heading sections from the Lezer tree, and dispatch fold/unfold effects so the
editor's folded set equals the derivation (a collapsed parent hides its children's folds; expanding
it re-applies the children's). CodeMirror's own nesting behaviour is therefore never relied on.

The gutter is a **custom `gutter()`** that draws a marker only on heading lines — not
`foldGutter()`, because lang-markdown's `foldNodeProp` would also put markers on code blocks, block
quotes and tables. Markers are the theme icon tokens `foldSectionExpanded` (−) and
`foldSectionCollapsed` (+) (R10). Clicking a marker issues the same command as Toggle This Section.

A fold placeholder widget is drawn from theme tokens only. Folding is added to the editor through a
compartment (`foldCompartment`) that is populated only when the document's language is Markdown, the
same way `languageCompartment` is reconfigured (`editor-language.ts:165`).

The editor's body context menu (`editor/content-menu.ts`) gains the context-sensitive items (FR-036),
computed at menu-open time from the section containing the clicked position.

## R5 — Chords: Ctrl+M two-stroke, in the editor and the preview

**Decision.** Six actions — `markdown.toggleSection` (`Ctrl+M,M`), `markdown.toggleAll`
(`Ctrl+M,L`), `markdown.collapseSection` (`Ctrl+M,S`), `markdown.expandSection` (`Ctrl+M,E`),
`markdown.collapseAll` (`Ctrl+M,A`), `markdown.expandAll` (`Ctrl+M,X`) — scoped to a new set
`MARKDOWN_SURFACES = {editor, preview}`. One more, `preview.goToHeading`, bound to `Ctrl+G`, scoped
`{preview}`.

- **Editor.** Multi-stroke chords already work in CodeMirror through the per-view `ChordEngine`
  (`commands.ts:671-800`) at `Prec.highest`. Handlers join `commandsFor()` (`use-editor.ts:254-275`).
  The fold chords are contributed **only in Markdown editors** (via the fold compartment), so
  CodeMirror's `Ctrl-m` → `toggleTabFocusMode` (`@codemirror/commands` defaultKeymap) keeps working in
  every other language and is displaced only where Ctrl+M now means folding — the 044 FR-105
  precedent for an editor-only displacement.
- **Preview.** The preview has no multi-stroke dispatch today (`preview-commands.tsx:135-175` is
  single-stroke). The chord state machine is extracted from the CodeMirror plugin into
  `packages/ui/src/renderer/keybindings/chord-engine.ts` — pure over key events, timeout, Escape, blur
  and modifier release, and the pending indicator — and used by both the editor plugin and a preview
  keydown handler on the preview root. One engine, two hosts (Principle VIII).
- **Guards.** `chordCollisions` (`keybindings.ts:1057-1093`) passes: no action binds `Ctrl+M` whole,
  and siblings sharing a prefix are not a clash. `twoStrokeTerminalViolations` passes: no fold command
  is scoped to `terminal`. 046 FR-021: `Ctrl+M` is a carriage return to a shell, but these commands are
  never live in a terminal, so the check passes by scope, exactly as `Ctrl+G` does. The tier test's
  hard-coded two-stroke exemption (`keybindings-tiers.test.ts:189`) becomes a named list including the
  six. `Ctrl+G` is `navigate.gotoLine`, `EDITOR_ONLY` — free in a preview.
- **Menus** show two-stroke chords as their raw token (`Ctrl+M,S`), the existing `firstBinding`
  rendering.

## R6 — Preview folding and the soft gutter

**Decision.** After each render the Markdown body computes sections over the **top-level blocks** of
`.preview-markdown` from the heading list (R2): a section runs from its heading element to the next
top-level heading of the same or higher level. Collapsing a section sets `hidden` on the blocks
between; a collapsed parent hides its children's blocks regardless of their own state, and expanding
it re-applies the children's (R3's derivation, same as the editor).

**The gutter (FR-032a/b).** When `providers.markdown.gutter` is on, `.preview-markdown` gains a class
that adds a fixed `padding-inline-start` (the gutter width), shifting the whole document right. For
each heading the body inserts, **after sanitising**, a `button.preview-fold-toggle` as the heading's
first child, absolutely positioned into the gutter. It is created by throng, never by the document,
carries `aria-expanded`, an accessible name ("Collapse section *heading*"), `user-select: none`, and
its glyph comes from the theme icon tokens `foldPreviewExpanded` (▾) / `foldPreviewCollapsed` (▸)
through the shared `Icon` component. It is excluded from: copy and rich-copy export (`copy.ts`
filters it), the find text model (R1), and scroll-anchor measurement (it is inside the heading, which
is already the block). The gutter is a generic slot: the class and the per-line insertion point are
named for the gutter, not for folding, so later icons join it (FR-032a).

With the gutter off, no toggle is inserted and no padding added; folding remains available from the
menu and the chords (FR-032b).

**Why not a React overlay measured against the DOM.** An overlay would need a layout pass on every
render, zoom and resize to align, and would drift during scroll sync; a child of the heading moves
with it for free.

## R7 — Go to Heading pop-down

**Decision.** A renderer component `packages/ui/src/renderer/preview/heading-outline.tsx`, mounted in
the preview root, opened by `preview.goToHeading`. Fixed height (a theme-independent constant in CSS,
recorded in Complexity Tracking as a layout value, not a tunable), `overflow-y: auto`, over the top of
the body, not moving it. Its data is the `DocumentSymbol[]` from the last render (R2), so it follows
edits live (FR-047).

- **Current entry**: the heading whose section contains the block at the top of the view, computed
  with the existing `blockAtTop` (`scroll-anchor.ts`). On open, the list is scrolled to it.
- **Search** (FR-043): case-insensitive substring on the heading text; matches shown with their
  ancestors; the list scrolls to the first match; collapsed tree nodes containing a match are expanded.
- **Keyboard** (FR-043a): search box focused on open; Down → the current entry; Up/Down walk visible
  entries; Up from the first entry → search box; Ctrl+G while open → search box; Enter → jump; Esc →
  close.
- **Jump** (FR-042c/d): reuses the existing heading navigation (`jumpToHeading`,
  `preview-panel.tsx:629`) so history is recorded exactly as FR-115, after revealing the section
  (FR-040). Scrolling is animated by a small `requestAnimationFrame` tween over
  `providers.markdown.headingJumpMs` milliseconds (native `behavior: 'smooth'` has no duration);
  `0` jumps instantly. The tween drives `scrollTop`, so scroll sync sees an ordinary preview scroll
  (044 FR-121f).
- Tree-node collapse state lives in the component only (FR-045).

## R8 — Open previews in the last active preview panel

**Decision.** Renderer: `packages/ui/src/renderer/preview/last-active-preview.ts`, a per-window
`Map<tabId, panelId>` modelled on `last-active-editor.ts`, written on preview pointerdown **and focus**
(the editor store's keyboard gap is not copied). Reuse is limited to the **visible tab**
(`ws.layout.activeTabId`) — FR-015.

Main keeps the decision (FR-012 first). `PreviewOpenRequest` gains
`target?: { mode: 'lastActive' | 'new'; reusePanelId: string | null }`. The renderer sends the mode
(the setting, or the explicit Open In item) and the candidate (the last active preview in the visible
tab, falling back to the most recently active remaining one there, or null). In
`PreviewService.open`, the **standalone** branch (today `placeLocally` with `besidePanelId: null`,
`preview-service.ts:358-360`) becomes: if `mode === 'lastActive'` and `reusePanelId` names a live
preview run in the requesting window, **navigate that run** to the file with `moveRun` and an
`open` intent — recorded in history as FR-103 requires, unbinding a parented preview as FR-090a does
(FR-016) — and answer `navigated`; otherwise place a new panel as today. The already-open check
(`runForPath`, :302) still runs first (FR-013). The parented branches (:319-356) are untouched
(FR-012).

`packages/ui/src/renderer/preview/open-preview.ts` handles the new `navigated` answer by focusing the
reused panel. Every entry point that opens a standalone preview passes the target: the router's
default-open path (`open-router.ts:75`), Quick Open, Files & Folders Open In → Preview, and the new
**Last Preview Panel** / **New Preview Panel** items (`context-menu-items.ts:168-177`), whose
availability comes from `previewAffordance()` plus "a preview exists in the visible tab".

## R9 — Dropping files on a preview

**Decision.** Mount the existing drop components on the preview body: `TreeDropTarget` (internal drags,
single file, `tree-drop-target.tsx`) and `PanelDropTarget` (OS drags, `drop-target.tsx`), with an
**accept predicate** of "an enabled provider accepts this extension" (`registry.ts` matching) — a
refused file shows `dropEffect: 'none'` / the refused class. Confinement reuses main's
`throng:editor:resolveDrop` unchanged (FR-022: same notices). An accepted drop calls
`bridge.navigate` with a new `drop` intent (history-recorded, like `link`). The first accepted file
goes to the dropped-on panel; each further one is opened with `requestPreviewOpen` and
`target.mode = 'new'` (FR-024). A dropped file already previewed elsewhere gets main's existing
`focusedOther` answer (FR-023, 044 FR-090c).

The body's `onDrop={refuse}` (`preview-panel.tsx:1349`) is narrowed: the drop components handle file
drags first; everything else still reaches `refuse` (FR-021 of this spec).

## R10 — Theme icon tokens

Four new icon tokens: `foldSectionExpanded` ('−'), `foldSectionCollapsed` ('+'),
`foldPreviewExpanded` ('▾'), `foldPreviewCollapsed` ('▸'), each with copy in `theme-copy.ts`.
The status-bar Collapse/Expand All toggle reuses the existing `collapseAll` / `expandAll` tokens.
`SHIPPED_DEFAULTS_VERSION` 16 → 17 so installed theme files receive the new tokens
(`shipped-defaults.ts:150-161`).

## R11 — Settings

| Key | Values / default | Where | Reader |
|---|---|---|---|
| `editor.previews.openTarget` | `lastActive` \| `new`, `lastActive` | Editor → Previews (fixed) | open-preview target (R8) |
| `editor.previews.providers.markdown.gutter` | toggle, on | Editor → Previews (Markdown leaf) | Markdown body (R6) |
| `editor.previews.providers.markdown.headingJumpMs` | number ≥ 0, 200 | Editor → Previews (Markdown leaf) | heading outline (R7) |
| `editor.markdownSectionsOpen` | `expanded` \| `collapsed`, `expanded` | Editor (no subgroup) | fold-state seeding (R3) |

The two Markdown leaves are declared on the provider (`core/src/preview/providers/markdown.ts`), so
they are generated, drawn disabled while Markdown previews are off, and need no preferences-editor
edit (044 FR-070). `editor.markdownSectionsOpen` is an Editor setting, not a provider leaf, because it
governs the editor as well — it must not be disabled when previews are. Its label is "Markdown
sections open". The `openTarget` description carries FR-015a's sentence. A new
`settings-inertness-047.test.ts` lists the four keys.

## R12 — Wikilinks

**Decision.** A markdown-it **inline rule** (`throng_wikilinks`) in the pipeline recognises
`[[target]]`, `[[target|alias]]`, `[[target#heading]]`, `[[#heading]]` and `[[target#^block]]` outside
code (markdown-it never runs inline rules inside code spans or fences, so FR-050's literal case is
free). It emits `link_open`/`text`/`link_close` tokens whose href is a **wiki target** —
`{ path, fragment }` encoded as `throng-wiki:<path>#<fragment>` — and the text is the alias or the
target's last path segment without extension. `![[…]]` is left literal (FR-056).

Core `classifyPreviewLink` (`links.ts:137`) gains the wiki case: a leading `/` resolves from the
project root, anything else relative to the document's folder (FR-052a/b), both through the same
normalisation ordinary relative links use (FR-053); a path escaping the project is `outside`
(FR-054). The extension candidates (`.md`, `.markdown`, exact — FR-052c) need the filesystem, so
**main** resolves them: at follow time inside `PreviewService.navigate`, and at render time through a
new batched call `preview.resolveWikiTargets(panelId, targets[])` that returns which exist, so the body
can add `preview-link--unresolved` to the rest (FR-055). A sub-workspace preview has no project root:
a `/` target is unresolved.

Everything after resolution is the ordinary link path — the sanitiser's `onLink` wiring, the menu,
Ctrl+click, notices, history (FR-051).

## R13 — Tables that fit

**Decision.** A small renderer module `packages/ui/src/renderer/preview/table-layout.ts`, provider
agnostic (FR-068), run after each render and on panel resize:

1. Measure each column's **min-content** and **max-content** width (one off-screen measurement pass
   per table: `table-layout: auto` with `width: min-content`, then `max-content`).
2. Pure core function `fairColumnWidths(available, cols[], minLegible)` — water-filling: every column
   gets `min(max-content, fair share)`, the surplus from columns that need less than their share is
   redistributed to the rest, and no column goes below `max(minLegible, its min-content when that is
   below the minimum)`. If the sum of minimums exceeds `available`, the table keeps its minimums and
   scrolls horizontally (FR-062).
3. Apply as a `<colgroup>` with `table-layout: fixed; width: 100%`; cells wrap with
   `overflow-wrap: anywhere`.

The minimum legible width is `8ch` — a layout constant, recorded in Complexity Tracking.

**Resize (FR-063/064).** A pointer handle on each column border (a throng-created element, like R6's
toggle, excluded from copy and find) drags the column's `<col>` width live; hand-set widths are kept
in a per-panel, per-table-index map that survives re-render of the same file and is dropped on
navigation, close or restart. Cursor `col-resize`; the handle is drawn from the `border` / `accent`
tokens (FR-067), within the `preview-css-tokens` allowlist.

**SC-006a.** Proven in two parts: the pure water-filling function is unit-tested against measured
column profiles; the "≥95% of `docs/` and `specs/` tables" claim needs real layout and is recorded in
`quickstart.md` as a scripted check the implementer runs once in the running app (a dev-only harness
that renders each table at half width and counts overflow), not a gating E2E — the E2E budget does
not rise (R14).

## R14 — Test layers and the E2E budget

No new E2E declarations. Every requirement is provable below E2E:

| Behaviour | Layer |
|---|---|
| Scope sets, chord guards, settings descriptors, fold-state reducer, symbol tree, fair widths, wiki classification, slug parity editor↔pipeline | unit (core / ui) |
| Find bar in a preview, highlights (painter seam), gutter toggles, fold hiding, context menus, pop-down keyboard, drop acceptance, Last Active candidate choice | component (jsdom, `mount-preview-panel.ts`) |
| `PreviewService.open` reuse/navigate, drop intent, wiki resolution, fold relay across views | integration (`preview-harness.ts`) |
| New IPC channels | contract (`preview-ipc.contract.test.ts`) |

`e2e-budget.json` is unchanged. Real OS drag-and-drop and real chord dispatch are reserve entries,
but the existing drop and chord E2E already cover the shared machinery; this feature adds only
predicates and handlers on top, which the lower layers prove.

## R15 — Table measurement and word breaking (defect against FR-060/061; FR-072, FR-073)

**Defect.** `measureColumns` appends its off-screen clone to `document.body`, outside
`.preview-markdown`, so the cell padding, `th` weight and preview font never apply: every measured
width is short of what the cell draws, and the columns with the least room — the short ones — wrap
first. **Decision:** append the clone beside the table, inside its own host, so every rule that styles
the real table styles the clone.

**No mid-word breaks (FR-073).** Cells move from `overflow-wrap: anywhere` to `overflow-wrap:
break-word`: a word breaks only when it cannot fit a line, and — unlike `anywhere` — it does not lower
min-content, so a column's minimum becomes its widest word. Greedy line breaking still splits at a
hyphen (`MT-` / `01`) when the line has room for the first half, and CSS has no property to forbid it,
so `table-layout.ts` wraps each hyphenated token in a `nowrap` span at layout time (a throng-made
element, like R6's toggle: not in copy, not in find's text model beyond its text). A token wider than
40% of the panel is left unwrapped and breakable (the user's chosen last resort). The 40% is measured
against the table's available width — the panel's content width, which is what FR-073 calls "the
panel". Only text nodes are wrapped; a token split across inline elements (part in a link) is left
alone. Copy and find see the same text with or without the span.

**Precedence of minimums:** a column's floor is `max(8ch, widest word)` with the widest word capped at
40% of the available width (a longer word breaks); when the floors together still exceed the width,
FR-062's scroll wrapper applies as before.

**FR-072** then follows from correct measurement: water-filling (R13) already gives every column whose
max-content fits its share exactly its max-content, so a short column is drawn on one line.

**Alternatives rejected:** a non-breaking hyphen (U+2011) substituted into the text — changes what copy
and find see; `word-break: keep-all` — it does not stop hyphen breaks.

## R16 — Outlining every find match (FR-074)

A fourth derived token, **`searchMatchBorder`**, beside `searchMatch`, `searchMatchCurrent` and
`searchMatchCurrentBorder`: the neutral ray `blend(editorBg, editorFg, t)` walked upward until it
clears **3:1** against `editorBg` and the preview body's background (the non-text floor), so it reads on every theme without competing
with the current match's accent outline. `theme-quality` asserts ≥ 3:1 on all shipped themes, and that
it stays distinguishable from `searchMatchCurrentBorder` (ΔE00 floor, the gate's existing instrument).

- **Editor:** `.cm-editor .throng-search-match { outline: 1px solid var(--throng-colour-searchMatchBorder) }`.
- **Preview:** `::highlight()` accepts no `outline`. A **match-frame layer** — an absolutely positioned,
  `pointer-events: none`, `aria-hidden` element inside the preview's scroll host — draws one 1px frame
  per client rect of each match range **inside the viewport**, repainted on scroll, resize and redraw
  through one rAF. It never enters the sanitised content, copy or find's text model. The current match
  keeps its highlight fill and gets a frame in `searchMatchCurrentBorder`.

**Alternatives rejected:** wrapping matches in elements (mutates content the sanitiser and scroll
anchors depend on — R1); `text-decoration` underline (an underline is not an outline).

## R17 — Open In menu (FR-075, FR-076)

`context-menu-items.ts` stops emitting the plain **Preview** item; **Last Preview Panel** reads
**Last Preview Panel (&lt;title&gt;)**, where the title is the header title of the panel Last Active would
reuse (`last-active-preview.ts`'s candidate for the visible tab), resolved when the menu opens. With no
candidate it stays disabled and unnamed. Tests: the menu-items unit/component tests that pin the item
list.

## R18 — Drop onto an empty panel (FR-077)

`panel-body.tsx`'s empty-panel drop calls `openFileInPanel` unconditionally. It now asks the same
question the default open action asks (044 FR-052, `enabledProviderFor` + the provider's
`defaultOpenAction`): **Preview** types the panel as a preview of the file (the placement path
`open-preview.ts` already uses for a new panel, targeted at this panel); anything else keeps
`openFileInPanel`.

## R19 — First editor adopts the preview's fold state (FR-078)

`PreviewService.makeParented` calls `foldRekey.reparent(panelId, fileKey, true)`, which today drops
`panel:<id>`. Now, when the fold map has **no** `file:` entry for the document, `reparentFold` first
copies the `panel:` state into it and relays it (`setFoldState`'s relay, no sender excluded), so the new
editor's view — whose own seed request may already have been answered with the default — applies it.
When a `file:` entry exists (an editor already showed the document), FR-034 stands unchanged.
Integration test in `editor-fold-state.integration.test.ts`; the renderer half is the existing relay
path (`relayedKeyMatches`).

## R20 — Pop-down scrollbar (FR-079)

The pop-down paints `surfaceActive` (`heading-outline.css:26`), and the global scrollbar thumb is
`scrollbarThumb` — on the default theme `#222c3d` against `#2a3344`, nearly one colour. Decision: pick
the pop-down's surface and its scrollbar thumb from existing tokens so the pair clears a **1.5:1**
separation on every shipped theme (measure `surface`/`sidebarBg` against `scrollbarThumb`/`border` and
take the first pair that passes everywhere), set by a dedicated scrollbar rule on the pop-down's list;
a `theme-quality` assertion pins the chosen pair on every shipped theme. *(The 1.5:1 floor is derived,
not confirmed by the user.)*
