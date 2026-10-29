# Research: Find in Files Polish

Each entry: **Decision**, **Rationale**, **Alternatives rejected**. File references are to the tree at
the branch point (`4de6ffe6` + the G1 fix).

## R1 — Folder structure is a third `groupRows` shape, in core

**Decision**: Add `'folderTree'` to `Grouping` (`core/src/search/file-search.ts:57`) and a branch in
`groupRows` that builds nested folder groups from each row's directory segments, below the scope root.
Folder groups have `kind: 'folder'`, key = root-relative directory (the same key form `fileAndFolder`
already uses), `rows: []`, `matchCount` = everything beneath, and file groups as leaves.

**Rationale**: `groupRows` is already "a pure function of the rows" — the substance of "switching never
re-runs" (043 FR-033). A third shape there keeps that property for free, and `markStale` and
`flattenGroups` already recurse through `children`, so staleness (FR-019) and the list need no new
traversal.

**Alternatives rejected**: building the tree in the renderer (two places would then own grouping);
reusing the explorer's live tree (it holds only expanded folders, and a result set spans unexpanded
ones).

## R2 — Folder structure orders as the explorer does; the other two shapes are untouched

**Decision**: Order the folder tree with `sortNodes` (`core/src/explorer/node.ts:72`) — folders before
files, the user's `explorer.sortOrder` (`natural` | `characters`). `orderGroups` keeps 043's FR-035
comparator for `file` and `fileAndFolder`.

**Rationale**: FR-014 says "as the File Explorer orders them"; FR-024 forbids changing the existing
groupings' order. 043's FR-035 puts files *before* sub-directories — the opposite of the explorer —
so one comparator cannot serve both. `sortNodes` is generic over `{kind, name}`, so headings adapt to
it without a copy.

**Alternatives rejected**: one comparator for all three (breaks FR-024 or FR-014); hard-coding
`natural` (the explorer follows a preference, so a mirror must too).

## R3 — The tree is rooted at the search scope

**Decision**: `groupRows(rows, 'folderTree', { scopeRel })` strips the scope's root-relative prefix
before building levels, so a search scoped to `packages/ui` starts its tree at `packages/ui`'s children.
The scope prefix comes from the panel's scope state, which already resolves to a root-relative path for
the missing-scope notice (043 FR-092).

**Rationale**: The spec's edge case and assumption: no empty ancestor levels above a scoped search.

**Alternatives rejected**: always rooting at the project (every scoped search would open three empty
levels deep).

## R4 — Selection is the item's key, not its index

**Decision**: `ResultsList` stores `selectedKey: string | null` (the flattened item's key:
`g:<groupKey>` or `<relPath>:<from>`). The index is derived each render by lookup. A regroup that
removes the selected heading falls back to its first descendant row (FR-015a). A new generation clears
it (unchanged).

**Rationale**: Today `current` is an index (`results-list.tsx:253`). Three requirements break an index:
rows arriving mid-scan shift every later index (FR-003), a regroup reorders everything (FR-015a), and a
click must name an item rather than a slot (FR-020). A key survives all three.

**Alternatives rejected**: re-deriving the index after each change (must find the old item anyway, so
the key is needed regardless).

## R5 — Single click selects; headings select too

**Decision**: `onClick` on a row and on a heading's label selects it (moves the reading position) and
publishes `onCurrentChange`. The heading's chevron keeps its own toggle and stops propagation so a
chevron click does not also select (the explorer's `tree-node.tsx:130` precedent). Double-click and
`Enter` are unchanged.

**Rationale**: FR-020/020a, and the explorer pairing 043 FR-071 already cites. 043's comment at
`results-list.tsx:462` ("the heading is not a selectable row here") is superseded and must be rewritten.

## R6 — The row lock goes; the replace lock widens

**Decision**: Delete `locked` from `ResultsList` (rows and keyboard live while running). In the panel,
`running` disables Replace All (already), and the menu's `commit.replaceInFile` / `replaceMatch`
handlers are withheld while running, which `content-menu.ts` already draws as disabled.

**Rationale**: FR-003 supersedes 043 FR-095's row lock; the reason #391 gave for it — rows replaced
while the list fills in — is answered by the replace lock alone.

## R7 — Cancel keeps rows; one partial notice for two causes

**Decision**: `cancelFindInFiles` (`find-in-files-store.ts:851`) keeps `rows`, `staleFiles` and counts,
sets `status: 'cancelled'`, and keeps `dropThrough: Infinity` so nothing arriving after the cancel is
folded (FR-003d). The notice bar shows one partial notice when `capped || (status === 'cancelled' &&
rows.length > 0)`, with the cap's wording adapted to name either cause. A new run clears it because a
new generation resets `results`.

**Rationale**: `dropThrough` already exists to make a cancel final in this window; keeping rows changes
what the cancel leaves, not how it stops. "One condition, one notice" (CLAUDE.md) — a cancel that also
hit the cap is one partial list.

**Alternatives rejected**: a second notice for the cancel case (two notices for one condition).

## R8 — Match style: widen the find bar's rule, don't copy it

**Decision**: The results list's `<mark>` carries `throng-search-match`; `find-bar.css`'s rule changes
from `.cm-editor .throng-search-match` to `:where(.cm-editor, .fif-results) .throng-search-match`.
`.fif-match`'s background is deleted; `.fif-match--struck` keeps its fade, composed on top.

**Rationale**: FR-009's "one shared definition". The find bar's rule frames every match with
`searchMatchBorder` (047 FR-074), which is the legibility the results lack.

**Alternatives rejected**: duplicating the declarations into `find-in-files.css` (two definitions that
drift); dropping the `.cm-editor` scope entirely (the class would then match anywhere).

## R9 — Icons from `fileIconToken`, open/closed folder like the explorer

**Decision**: File headings use `fileIconToken(name)` (`explorer/tree-icons.ts:28`); folder headings use
`folderOpen` when expanded and `folder` when collapsed, as `tree-node.tsx:41` does. Each `<Icon>` stays a
literal where the token set is closed (folder open/closed), and the computed file token is the same
computed call the explorer already makes — `icon-tokens-exist` covers `BY_EXTENSION`'s values through
the existing tree-icons test.

## R10 — `busy` icon token, animated by CSS

**Decision**: New token `busy` in `core/src/config/theme.ts` (glyph `◌`, with a fallback to `refresh`
in `TOKEN_PARENT` so an older icon pack still draws something). While running, the cancel button shows
`busy` rotating; on hover or focus it shows `dismiss`, so what a click does is visible. `@media
(prefers-reduced-motion: reduce)` stops the rotation. The results list gets `aria-busy="true"`; the
button keeps `title="Cancel search"`.

**Rationale**: FR-001/002, themeable icon controls. No busy-like token exists today (`theme.ts` has
`refresh ⟳`, which means "re-read now").

**Alternatives rejected**: a CSS border spinner (not a themeable icon); reusing `refresh` (wrong
meaning, and the constitution separates roles by token).

The Folder structure toolbar control likewise gets its own token, `groupFolderTree` (`🗂`, parent
`folderOpen`): the two existing grouping controls already use `file` and `folderOpen`, and `theme.ts`
states that a new action takes a new token rather than reusing a glyph.

## R11 — Headings: name, muted folder, tooltip

**Decision**: File heading label = base name. Under `file` grouping a second span carries the
directory, muted (`--throng-colour-textMuted`, `0.85em`, normal weight), truncating first. Every
heading's `title` is its full root-relative path (`/` for the root folder). Rows keep their existing
`title`.

## R12 — Row layout and indentation

**Decision**: Row = snippet, then `(line:character)` in `fif-row__pos` after it. Indent per depth grows
from 14 px to one icon width plus a gap (`calc(var(--throng-size-icon) + 6px)`), and a row sits one
extra step past its heading's label start, so it aligns under the heading's text rather than its
chevron. Row weight is the Pane Text role (043 FR-064), never bold.

**Rationale**: FR-006/007/008. The indent derives from the icon size so it scales with the theme and
the panel's zoom (043 FR-062); the row height stays one line, so the windowing maths is untouched.

## R13 — Left-truncated replace labels

**Decision**: New pure `leftTruncatePath(relPath, maxChars = 40)` in `core/src/search/path-label.ts`:
whole path when it fits; otherwise `…/` + the longest suffix of whole segments that fits; the bare name
(itself truncated from the left) when even that does not fit. `content-menu.ts` uses it for both
narrow labels.

**Rationale**: FR-023 / SC-005 — a character bound gives a width bound in a menu whose font is fixed;
whole segments keep the label readable.

## R14 — The menu after v6.0.0

**Decision**: Remove the `Run search` / `Cancel search` rows and the `Change scope` row (and the
`focusScope` action it was the only caller of) from `findInFilesContentMenu`; add `Group by folder
structure` (checked when active) after `Group by folder and file`. Update the file's header comment,
which cites the old Principle VI wording.

## R15 — Tests that assert superseded behaviour

**Decision**: Each task that supersedes a behaviour updates the tests asserting the old one in the
same commit: `find-in-files-cancel.test.ts` (cancel clears), `find-in-files-menu.test.ts` (menu rows),
any component or E2E asserting `aria-disabled` rows while running. The task list names the files after
a `git grep` of `fif-cancel`, `Run search`, `Change scope`, `aria-disabled`.

## R16 — One busy glyph, turning around its centre (FR-001a, FR-001b)

**Decision**: `busy` defaults to ◜. The glyph sits in a SQUARE box sized from the icon size
(`width` = `height` = `--throng-size-icon`, `line-height: 1`, flex-centred, `transform-origin: 50% 50%`)
and the box, not the line, rotates. One shared component, `BusyGlyph` in `ui/src/renderer/common/`,
carries the box, the animation and the reduced-motion rule; the Find in Files cancel control, the
shared `Spinner` (app loading, diagram drawing) and the app-closing overlay all render it. The CSS ring
spinners (`.throng-spinner__ring`, `.app-closing__spinner`) are deleted (FR-010's rule applied to the
whole app).

**Rationale**: the off-centre turn is the glyph's inline box: its height is the font's line box, its
width the advance, and the ink is not centred in either. A square box of a known size makes the box's
centre the ink's centre for a symmetric glyph, and one component means the three surfaces cannot drift.

**Alternatives**: keep the rings and only swap the Find in Files glyph — rejected by FR-001b.

## R17 — Plain glyphs for the shared icon tokens (FR-011a, FR-011b)

**Decision** *(derived — the maintainer chose "plain, app-wide"; the glyphs are chosen here)*: every
default below is a Basic Multilingual Plane symbol with neither `Extended_Pictographic` nor
`Emoji_Presentation`, so no platform draws it as colour emoji.

| Token | Was | Now |
|---|---|---|
| `search` | 🔍 | ⌕ |
| `quickOpen` | 🔎 | ⊳ |
| `findInFiles` | 📚 | ⧈ |
| `file` | 📄 | ▯ |
| `fileText` | 📄 | ≡ |
| `fileCode` | 🗎 | ⟨⟩ |
| `fileJson` | 🗎 | {} |
| `fileMarkdown` | 📝 | ¶ |
| `fileImage` | 🖼 | ◩ |
| `folder` | 📁 | ▰ |
| `folderOpen` | 📂 | ▱ |
| `newFolder` | 📁 | ▰⁺ |
| `groupFolderTree` | 🗂 | ⋔ |
| `busy` | ◌ | ◜ |

None collides with another token's glyph (▭ `tab`, ⧉ `detach`, ▤ `editVisual`, ▣ `terminal` and ⊕ `zoomIn` were avoided). `quickOpen` and `newFolder` are FR-011c's: the File Explorer toolbar goes plain with `findInFiles`, superseding 043 FR-065.

A unit test asserts the property over this token list for `THRONG_THEME` and every bundled theme, so a
later re-skin cannot reintroduce an emoji.

**Upgrade**: shipped themes are written to disk at first run, so existing installs hold the old glyphs.
`SHIPPED_DEFAULTS_VERSION` 25 → 26 with a guarded value rewrite: `V25_MOVED_ICONS` records each old
glyph, and `planThemeValueUpgrade` moves `icons.<token>` in a reserved theme ONLY where the file still
holds exactly that value — a user's own glyph is kept. 26 rather than editing 25 because the
maintainer's hand-testing install already holds a 25 marker.

**Alternatives**: Find-in-Files-only tokens — rejected by the maintainer (app-wide).

## R18 — The clipped match box (FR-009 defect)

**Decision**: the row stays one line high (the windowing arithmetic depends on it). The match box is made to FIT inside it rather than the row made to stop clipping: the mark is vertically centred in the row and its vertical padding is reduced so border + padding + glyph height is no more than the row height. Horizontal clipping of long snippets is unchanged. A component test pins the rule; MT-04 is the visual check.

**Rationale**: the find bar's mark carries a border and padding; inside a row exactly one line high with
`overflow: hidden`, its top and bottom borders fall outside the box and are cut.

## R19 — Where search's exclusions come from (#532, FR-025–FR-032)

**Decision**: one core module, `core/src/search/search-exclude.ts`, owns the shape:

- `DEFAULT_SEARCH_EXCLUDE_GLOBS` — `DEFAULT_EXCLUDE_GLOBS` (the explorer's shipped list, spread, so a
  later addition there does NOT silently join search: it is copied at definition and pinned by a
  test) followed by the 2026-10-29 additions, in that order.
- `parseExcludeBox(text)` → `{ globs, invalid }` — split on `;`, trim, drop empties, and report every
  entry `compileExcluder` cannot compile (FR-029, edge case).
- `searchExcludeGlobs({ global, useGlobal, project, extra })` → the one glob list a scan compiles:
  `project` and `extra` always, `global` only when `useGlobal` (FR-027, FR-029, FR-030).

`FileSearchService` stops taking `explorer.excludeGlobs` and the hidden paths (FR-025). It takes
`() => settings.search.inFiles.excludeGlobs` and `(root) => project.searchExcludeGlobs`, and each
`StartScanRequest` carries the panel's `useExcludeGlobs` and `extraExcludes`. A run records them, so
`adoptQuery` (043 FR-078b) hands a following window the whole query, exclusions included. The
explicit-file-scope rule (043 FR-092) carries over unchanged: the scope itself is never tested.

**Rationale**: a pure, unit-tested composition keeps the service's change to wiring; the explorer's
list being COPIED rather than referenced is what FR-025 means by "not linked".

## R20 — Settings (FR-026, FR-028, FR-039)

`search.inFiles.excludeGlobs: string[]` (default `DEFAULT_SEARCH_EXCLUDE_GLOBS`; an explicit empty
list honoured, as `explorer.excludeGlobs`) and `search.inFiles.useExcludeGlobs: boolean` (default
`true`, the toggle's state for new panels). Descriptors in `settings-metadata.ts` under Search · Find
in Files — the first as `control: 'array'` with `itemControl: 'text'`, exactly the explorer list's
editor. No shipped-defaults bump for them: `parseSettingsGuarded` fills an absent key with its default
on every read (044's 7 → 8 reasoning). `structuredCloneSettings` copies the new array.

## R21 — Per-project list (FR-030, FR-033, FR-034, FR-040)

`Project.searchExcludeGlobs: string[]` beside `hiddenPaths`, sanitised the same way (trim, drop
empty, de-duplicate). Persistence migration **v10** adds `projects.search_exclude_globs` (JSON array,
`'[]'` default) through `schema-guard.ts`, as v6 did for `hidden_paths`. Daemon RPC
`projects.setSearchExcludes` (REPLACES the list, as `projects.setHidden` does), in `ipc-contract`, the
DTO, `projects-client.ts` and `projects-store.tsx`. Main's `projectsByRoot` carries the field from the
same `projects.list` call that already carries `hiddenPaths`.

"Exclude from Find in Files in this project" adds the entry's project-relative POSIX path. A path is
compiled as `p` and `p/**` (`hiddenPathGlobs`'s rule), so a folder excludes its subtree.

## R22 — The panel (FR-027, FR-029, FR-031, FR-032, FR-038)

`panel.config` gains `useExcludeGlobs` and `extraExcludes`, read once when the panel mounts like
`term` and `replaceShown`; a new panel takes `useExcludeGlobs` from the preference and `''`. The
toggle is an `IconButton` with `aria-pressed`, beside the match-mode toggles, token `searchExclusions`;
the menu gains the same toggle row. The box sits on the scope row, placeholder
`Exclude, e.g. **/fixtures;*.snap`; one inline notice under it names the invalid entries (CLAUDE.md
*One condition, one notice*). Both feed the existing as-you-type settle path (043 FR-043b).

## R23 — The project settings dialog (FR-035, FR-036, FR-037)

Same title, two `<section>`s, each a heading, a list in its own scroll container
(`max-height` and `overflow-y: auto`), an add row (text box + add icon button) and the global-list
note. The dialog itself is capped to the viewport so Close never scrolls away. The control's token
becomes `projectSettings`, default ⌂.

## R24 — Icon tokens

Two new tokens: `projectSettings` ⌂ and `searchExclusions` ⊝ (no `Extended_Pictographic`, no
`Emoji_Presentation`; neither glyph is used by another token — ⊘ was, by `cancel` and `hide`). Additive, so `SHIPPED_DEFAULTS_VERSION`
26 → 27 with copy in `theme-copy.ts` and SVG pack shapes. 055 (PR #496) also takes 27 — whichever
merges later renumbers.
