# Contract: Match Surfaces, CSS, Setting and the Replace All Prompt

## Theme tokens (Themes editor)

| Token | Area | Label | Description |
|---|---|---|---|
| `searchMatchOccurrence` | Search | Selection Occurrence Highlight | Tint on other instances of the text selected in the focused editor or preview. |
| `searchMatchOccurrenceInactive` | Search | Inactive Selection Occurrence Highlight | Weaker tint on other instances of a selection kept in a panel that does not have focus. |
| `editorSelectionInactive` | Editor | Editor Inactive Selection | A selection kept in an editor or preview that does not have focus. |

Labels follow `theme-copy.ts` vocabulary (no abbreviations; "<Context> <Property>"); exact wording is checked by
the existing copy tests. CSS variables: `--throng-colour-<token>`.

## CSS classes and highlight names

| Surface | Editor (CodeMirror, `Prec.low`) | Preview (`::highlight`, via registry) |
|---|---|---|
| ordinary match | `.throng-search-match` (unchanged) | `throng-preview-match` (unchanged) |
| current match | `.throng-search-match--current` (unchanged) | `throng-preview-match-current` (unchanged) |
| occurrence, focused | `.cm-editor.cm-focused .throng-occurrence` → `searchMatchOccurrence` | `throng-preview-occurrence` |
| occurrence, unfocused | `.cm-editor:not(.cm-focused) .throng-occurrence` → `searchMatchOccurrenceInactive` | `throng-preview-occurrence-inactive` |
| inactive selection | `.cm-editor:not(.cm-focused) .cm-selectionBackground` → `editorSelectionInactive` | `throng-preview-selection-inactive` |

Occurrences carry no outline. A range that is a search match carries no occurrence class (FR-013).

## Setting

| Setting | Key | Default | Values | What it does |
|---|---|---|---|---|
| Highlight other occurrences of the selection | `editor.highlightOccurrences` | on | on · off | Softly tints every other instance of the text selected in an editor or Markdown preview. |

Preferences group: Editor, control: toggle. Applies to every open editor and preview without reload.

## Replace All prompt (FR-007a)

Shown only when at least one match lies inside a collapsed section. Modal, `useChoose`, `data-testid`
`replace-all-folded-dialog`.

| | |
|---|---|
| Title | Replace in folded sections |
| Message | `N of M matches are inside folded sections.` (digit-grouped) |
| Choices (left → right) | **Cancel** (`cancel`) · **Replace and keep folded** (`keep`) · **Replace and unfold** (`unfold`, initial focus) |
| Escape / dismiss | same as Cancel |

| Choice | Effect |
|---|---|
| `cancel` | nothing replaced, nothing unfolded |
| `keep` | every match replaced in one transaction; fold state unchanged |
| `unfold` | every section containing a replaced match revealed (one fold-state write), then every match replaced in one transaction |
