# Data Model: Markdown Preview Enhancements (047)

Pure shapes live in `packages/core`; renderer and main state is described where it lives. Nothing here
is persisted except the three settings in *Settings*. `LAYOUT_SCHEMA_VERSION` and the SQLite schema
are untouched.

## DocumentSymbol (core, `outline/document-symbol.ts`)

The heading model shared by the preview outline, fold points and — later — #375's editor outline
(FR-048, R2).

| Field | Type | Rule |
|---|---|---|
| `name` | string | The heading's rendered text (inline markup stripped). |
| `level` | 1–6 | ATX `#` count, or 1 / 2 for setext `===` / `---`. |
| `line` | number | 0-based source line of the heading (setext: its text line), the same numbering as `data-source-line`. |
| `slug` | string | `headingSlug(name, taken)` in document order with one de-dup set per document — the identity used by folding. Unique within a document. |
| `children` | DocumentSymbol[] | Headings of a greater level up to the next heading of the same or lower level. |

- **Flat form** `HeadingRecord = { level, text, slug, line }` is what the pipeline emits;
  `buildSymbolTree(records)` nests it. A heading deeper than its predecessor by more than one level
  (an `h1` then an `h4`) is still its child.
- **Excluded**: `#` inside front matter, fenced or indented code, and HTML blocks; raw-HTML
  `<hN>` elements (the pipeline records only markdown-it heading tokens; FR-041).

## Section (derived, not stored)

`{ slug, level, startLine, endLine }` for the editor; `{ slug, headingEl, blocks[] }` for the preview.
A section runs from its heading to just before the next heading of the same or a higher level
(FR-030). Derived from `DocumentSymbol` every time the document or render changes.

## FoldState (core, `outline/fold-state.ts`)

```ts
interface FoldState {
  base: 'expanded' | 'collapsed';
  flipped: readonly string[]; // slugs whose state differs from base; sorted, unique
}
```

| Operation | Result |
|---|---|
| `initialFold(pref)` | `{ base: pref, flipped: [] }` |
| `isCollapsed(s, slug)` | `(s.base === 'collapsed') !== s.flipped.includes(slug)` |
| `setSection(s, slug, collapsed)` | adds/removes `slug` in `flipped` so `isCollapsed` equals `collapsed`; other slugs untouched (FR-030a) |
| `toggleSection(s, slug)` | `setSection(s, slug, !isCollapsed(s, slug))` |
| `collapseAll(s)` / `expandAll(s)` | `{ base: 'collapsed'|'expanded', flipped: [] }` (FR-037a) |
| `toggleAll(s, slugs)` | `collapseAll` when any of `slugs` is expanded, else `expandAll` |
| `prune(s, slugs)` | drops `flipped` entries not in `slugs` (removed headings) |
| `revealing(s, symbolTree, slug)` | expands `slug`'s section's ancestors and the section itself (FR-040) |
| `visibleSections(s, tree)` | the set of sections actually shown: a section is hidden when any ancestor is collapsed; its own content is hidden when it is collapsed |

Invariants: `flipped` holds no duplicates and is sorted (so equal states compare equal and a no-op
update relays nothing); every function is pure.

**Where it lives.**

| Holder | Key | Lifetime |
|---|---|---|
| `EditorCoordinator` fold map (UI main) | `wrapKey(doc)` = `file:<lowercased path>` | while any editor panel or parented preview shows the document (R3) |
| Same map, standalone preview | `panel:<id>` | while the panel is standalone; one entry however many windows view it |
| History snapshot (`PreviewService`, UI main) | panel id → history entry index (+ file path check) | the panel's lifetime; never persisted (FR-041d) |

## PreviewOpenTarget (core wire type, extends `PreviewOpenRequest`)

```ts
interface PreviewOpenTarget {
  mode: 'lastActive' | 'new';
  reusePanelId: string | null; // the last active preview in the requesting window's visible tab
}
```

New answer variant: `{ kind: 'navigated'; panelId: string }` — the file was shown in place in
`reusePanelId`. Contract: [contracts/preview-ipc-047.md](./contracts/preview-ipc-047.md).

## Navigation intent (core, extends the existing preview navigate intents)

Adds `{ kind: 'open' }` (Last Active reuse) and `{ kind: 'drop' }` (a file dropped on the panel). Both
behave as `link` does for history (FR-103: truncate forward entries, append) and for parenting
(FR-090a: the run is re-bound to the new file).

## WikiTarget (core, `preview/wiki-links.ts`)

```ts
interface WikiTarget {
  path: string;          // as written, '' for [[#Heading]]
  rooted: boolean;       // written with a leading '/'
  fragment: string|null; // heading, or null; a '^block' fragment is dropped (FR-056)
  alias: string|null;
}
```

- `parseWikilink(inner)` → `WikiTarget | null` (null → leave the text literal).
- `wikiCandidates(target, docDir, projectRoot)` → ordered absolute candidates: `+.md`, `+.markdown`,
  exact; `[]` when the target has an extension other than none (then exact only); `rooted` with no
  project root → `[]` (unresolved, FR-052b).
- Classification after resolution is `classifyPreviewLink` unchanged (FR-051).

## ColumnProfile / fair widths (core, `preview/table-widths.ts`)

```ts
interface ColumnProfile { min: number; max: number } // measured min-content / max-content px
fairColumnWidths(available: number, cols: ColumnProfile[], minLegible: number):
  { widths: number[]; overflow: boolean }
```

Water-filling (R13): widths never below `min(max, max(minLegible, min))` — a narrow column is never
padded past its own content — never above `max`; surplus redistributed; `overflow` when the minimums
alone exceed `available` (FR-060–FR-062). Hand-set widths (renderer, per panel, per table index)
override the result for their column only and are cleared on navigation/close (FR-064).

## HeadingOutline view state (renderer, `heading-outline.tsx`)

`{ open, query, focus: 'search' | { slug }, collapsedNodes: Set<slug> }` — component-local, reset each
time the pop-down opens except `collapsedNodes`, which lives for the panel's lifetime and is never
tied to document folding (FR-045).

## LastActivePreview (renderer, `last-active-preview.ts`)

`Map<tabId, panelId[]>` per window, most recent first; written on a preview's pointerdown and focus,
pruned of closed panels at read time. `candidateFor(tabId)` returns the first live preview panel in
that tab, or null (FR-015).

## Settings

| Key | Type | Default | Descriptor |
|---|---|---|---|
| `editor.previews.openTarget` | `'lastActive' \| 'new'` | `'lastActive'` | Editor → Previews, select, "Open previews in"; description per FR-015a |
| `editor.previews.providers.markdown.gutter` | boolean | `true` | generated from the Markdown provider, toggle, "Markdown: Preview gutter" — the maintainer's "Markdown Preview Gutter: Enabled / Disabled"; the generated leaf label carries the "Markdown:" prefix and a toggle is the editor's Enabled/Disabled control (FR-032b) |
| `editor.previews.providers.markdown.headingJumpMs` | number (0–2000) | `200` | generated from the Markdown provider, number, "Markdown: Heading jump scroll duration (ms)" (FR-042d) |
| `editor.markdownSectionsOpen` | `'expanded' \| 'collapsed'` | `'expanded'` | Editor, select, "Markdown sections open" (FR-039) |

## Theme icon tokens

`foldSectionExpanded` '−', `foldSectionCollapsed` '+', `foldPreviewExpanded` '▾',
`foldPreviewCollapsed` '▸' — each with copy in `theme-copy.ts`; `SHIPPED_DEFAULTS_VERSION` 16 → 17.
Reused: `collapseAll`, `expandAll`.

## Key bindings

| Action | Default | Scope |
|---|---|---|
| `markdown.toggleSection` | `Ctrl+M,M` | editor (Markdown), preview |
| `markdown.toggleAll` | `Ctrl+M,L` | editor (Markdown), preview |
| `markdown.collapseSection` | `Ctrl+M,S` | editor (Markdown), preview |
| `markdown.expandSection` | *(unbound)* | editor (Markdown), preview |
| `markdown.collapseAll` | `Ctrl+M,A` | editor (Markdown), preview |
| `markdown.expandAll` | *(unbound)* | editor (Markdown), preview |
| `preview.goToHeading` | `Ctrl+G` | preview |
| `search.find`, `search.findNext`, `search.findPrevious`, `search.close` | unchanged | editor, terminal, **preview** |
