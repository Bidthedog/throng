# Contract: menus, commands and controls for 047

Section vocabulary is `packages/core/src/workspace/menu-sections.ts`. Every item below is a
`MenuAction` with a required `section`; chords are shown from `firstBinding`.

## Preview body menu (`preview/content-menu.ts`)

| Item | Section | Availability | Action |
|---|---|---|---|
| Find… | navigate | always (FR-007) | `search.find` |
| Go to Heading… | navigate | always; the pop-down says "No headings" when empty | `preview.goToHeading` |
| Collapse This H*n* | viewState | opened inside a section whose content is shown | `markdown.collapseSection` at the clicked section |
| Expand This H*n* | viewState | opened inside a collapsed section (on its heading) | `markdown.expandSection` at the clicked section |
| Collapse All / Expand All | viewState | a document with headings | `markdown.collapseAll` / `markdown.expandAll` |

The fold rows are `viewState`, not `contextual`: `contextual` is reserved for an interactive object
under the pointer (a link, `core/src/links/menu.ts:89`); a section is document structure, and folding
changes the view.

*n* is the level of the innermost section containing the point the menu was opened at; opened on a
heading line, that heading's section. Before the first heading the section items are **absent**
(FR-036). Collapse/Expand All are **disabled** when the document has no headings.

## Preview header menu (`workspace/panel-header-menu.ts`)

Find… (navigate) and Go to Heading… (navigate) beside Back/Forward. Principle VI: every command
reachable by chord is on a menu.

## Editor body menu (`editor/content-menu.ts`), Markdown documents only

The same four fold rows as the preview body menu, in viewState, computed at the clicked position;
absent for any other language.

## Files & Folders → Open In (`explorer/context-menu-items.ts`)

| Item | Availability | Action |
|---|---|---|
| Preview | as 044 FR-003 | the setting decides (FR-011) |
| **Last Preview Panel** (NEW) | a file with an enabled provider; disabled while the provider is disabled, the file already has a preview, or the visible tab has no preview panel (FR-014) | `open` with `{mode:'lastActive'}` |
| **New Preview Panel** (NEW) | as Preview | `open` with `{mode:'new'}` |

## Status bar (`preview/preview-status-bar.tsx`)

A Markdown preview's controls group gains one `IconButton`, left of the scroll-sync toggle:
token `collapseAll` while any section is expanded, `expandAll` otherwise; title "Collapse All" /
"Expand All" with the chord; `aria-pressed` false; invokes `markdown.toggleAll` (FR-038). Never
hidden by width. Absent for a non-Markdown provider.

## Gutter controls (`providers/markdown/fold-gutter.ts`)

`button.preview-fold-toggle` per heading when the gutter is enabled: `Icon` token
`foldPreviewExpanded` / `foldPreviewCollapsed`, `aria-expanded`, `aria-label` "Collapse section
*heading*" / "Expand section *heading*", `title` the same. Not focusable by Tab (links keep 044
FR-096b's Tab order); keyboard folding is the chords and the menu.

## Editor gutter (`editor/markdown-fold.ts`)

A CodeMirror `gutter()` marker on each heading line: token `foldSectionExpanded` (−) /
`foldSectionCollapsed` (+), title "Collapse section" / "Expand section". Click = `markdown.toggleSection`
for that heading. Shown only when the editor gutter is shown (`editor.showGutter`) — the markers live
in the gutter, and hiding the gutter hides them; folding stays available by chord and menu.

## Go to Heading pop-down (`preview/heading-outline.tsx`)

- `role="dialog"` with `aria-label="Go to heading"`; search `input` (`aria-label` "Filter headings");
  list `role="tree"`, entries `role="treeitem"` with `aria-level` and `aria-expanded` for nodes with
  children; the current entry carries `aria-current="location"`.
- Keys: see research R7 / FR-043a. Esc closes and returns focus to the preview body.
- Colours from theme tokens only (FR-049); surface roles follow the existing floating-surface guard.

## Commands

| Action id | Chord | Scope | Menu label |
|---|---|---|---|
| `markdown.toggleSection` | Ctrl+M,M | editor(Markdown), preview | — (gutter click, chord) |
| `markdown.toggleAll` | Ctrl+M,L | editor(Markdown), preview | status-bar toggle |
| `markdown.collapseSection` | Ctrl+M,S | editor(Markdown), preview | Collapse This H*n* |
| `markdown.expandSection` | *(unbound)* | editor(Markdown), preview | Expand This H*n* |
| `markdown.collapseAll` | Ctrl+M,A | editor(Markdown), preview | Collapse All |
| `markdown.expandAll` | *(unbound)* | editor(Markdown), preview | Expand All |
| `preview.goToHeading` | Ctrl+G | preview | Go to Heading… |

Toggle This Section and Toggle All are reachable from a menu through their Collapse/Expand
equivalents, which is what Principle VI's rule asks (the action, not the toggle wording).

In a preview, *This Section* at chord time means the innermost section containing the block at the
top of the view (FR-037).
