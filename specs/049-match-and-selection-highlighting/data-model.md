# Data Model: Match and Selection Highlighting

Nothing here is persisted. Every entity lives in a renderer's memory, or in main's memory while a panel is
handed between windows ([research R3](./research.md#r3--a-main-side-in-memory-panel-state-hand-off-fr-000-fr-000a)).

## FindSession (existing, `ui/renderer/search/search-store.ts`)

| Field | Type | Change |
|---|---|---|
| `panelId`, `panelKind`, `replaceShown`, `term`, `replacement`, `modes`, `count`, `seeded`, `openSeq` | existing | unchanged |
| `currentFrom` | `number \| null` | **new** — text offset of the current match, updated with every count; the anchor `restore` re-lands on (FR-003) |

**Lifecycle**: created by `openFind`; survives unmount; re-applied by `attachPanelSearch` (R1); carried across
windows inside a `PanelSnapshot`; deleted by `closeFind` or `destroyPanelSearch`. `openSeq` is not carried
across windows (the destination assigns its own).

## Match surface (theme tokens, `core/config/theme.ts`)

| Token | Meaning | Derived by | New |
|---|---|---|---|
| `searchMatch` | ordinary search match | `searchHighlights` neutral ray | — |
| `searchMatchCurrent` | current search match | `searchHighlights` accent ray | — |
| `searchMatchCurrentBorder` | current-match outline | `searchHighlights` | — |
| `searchMatchBorder` | ordinary-match outline | `searchHighlights` | — |
| `searchMatchOccurrence` | another instance of the selection, focused panel | `searchHighlights` (= `match` value) | ✅ |
| `searchMatchOccurrenceInactive` | another instance of the selection, unfocused panel | `searchHighlights` (neutral ray, nearer the page) | ✅ |
| `editorSelectionInactive` | a retained selection in an unfocused panel | `inactiveSelection` from `editorSelection` | ✅ |

**Rules**: shipped four byte-identical (FR-009); every surface readable under every syntax colour (FR-011);
`searchMatchOccurrence` weaker than `editorSelection` (FR-016); `searchMatchOccurrenceInactive` weaker than
`searchMatchOccurrence` (FR-018a); `editorSelectionInactive` distinct from `editorSelection` and every match
surface (FR-025). All three user-overridable in the Themes editor (FR-012).

**Precedence** (FR-013): search match / current match > occurrence. Never layered.

## OccurrenceQuery (`core/search/occurrence-model.ts`)

| Field | Type | Rule |
|---|---|---|
| `term` | `string` | the selected text; single line, ≥ 2 characters, not whitespace-only — otherwise no query |
| `wholeWord` | `boolean` | first and last characters are word characters and the characters outside the selection are boundaries |

Word character: `/[\p{L}\p{N}_]/u`. Matching is literal and case-sensitive (FR-015).

## RetainedSelection (`ui/renderer/preview/preview-selection.ts`)

| Field | Type | Rule |
|---|---|---|
| `from`, `to` | `number` | offsets into the preview text model |
| `text` | `string` | the selected text when captured; restore only if the model still has it at `from..to` (FR-026) |

**States**: *none* → *active* (selection made with focus) → *inactive* (focus left; painted) → *active* (focus
returned without a pointer-down inside) or *none* (pointer-down/selection change inside, or text changed on
re-render). Unmount saves it; mount takes it (shown inactive until focus).

The editor's retained selection is CodeMirror's own selection (R11); no new entity.

## PanelSnapshot (hand-off payload, [contracts/panel-state-handoff.md](./contracts/panel-state-handoff.md))

| Field | Type | Source |
|---|---|---|
| `panelId` | `string` | — |
| `find?` | `FindSession` minus `openSeq` | `search-store` |
| `editor?` | `EditorViewState` (`{selection: SelectionJson; scrollAnchor}`) | live view, else `peekEditorViewState` |
| `terminal?` | `TerminalViewState` (`{offsetFromBottom; selection?}`) | live terminal, else `peekTerminalViewState` |
| `previewSelection?` | `RetainedSelection` | live preview, else its saved entry |

**Lifecycle**: stashed by the sending window before the sub-workspace is persisted/opened/notified; claimed
(and deleted) by the receiving window before it mounts; each section seeded only where the receiver has no
entry of its own; overwritten by a later stash; dropped on panel destroy or app quit. Max 64 KB.

## Setting

| Key | Type | Default | Governs |
|---|---|---|---|
| `editor.highlightOccurrences` | `boolean` | `true` | occurrence tinting in editors **and** Markdown previews (FR-019) |
