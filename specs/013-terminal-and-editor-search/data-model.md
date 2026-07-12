# Phase 1 Data Model: Terminal & Editor Search

Search state is **ephemeral and per-view** — nothing here is persisted (no SQLite, no config schema change
beyond the pure keybinding/theme additions). These are renderer in-memory shapes. Persisted config
additions (action-ids, theme tokens) are specified in `contracts/`.

## Entities

### SearchSession

One live search over the active panel's content. Belongs to exactly one panel **view** (a mirrored panel's
other views hold their own sessions — FR / edge case "mirrored terminal").

| Field | Type | Notes |
|-------|------|-------|
| `term` | `string` | The search term (single-line, D9). Empty ⇒ no active search. |
| `modes` | `MatchModes` | `{ caseSensitive: boolean; wholeWord: boolean }`. Default `{ false, false }` (D9). Regex not included (deferred). |
| `matches` | `Match[]` | Ordered set of matches over the current content (recomputed incrementally / on buffer change). |
| `currentIndex` | `number \| null` | Index into `matches` of the current match; `null` when `matches` is empty. |
| `replacement` | `string` | Editor only; the replace text (Phase C). Ignored for terminals. |
| `panelKind` | `'editor' \| 'terminal'` | Which adapter backs this session (selected by active panel type). |

State transitions:
- `term`/`modes` change → `matches` recomputed (debounced, D7); `currentIndex` reset to the nearest match
  from the cursor/viewport (editor: from caret; terminal: nearest to current viewport), or `null`.
- find-next / find-previous → `currentIndex` advances / retreats with **wrap** (FR-006/FR-011).
- close → session discarded, highlights cleared, focus returns to panel content (FR-004).

### MatchModes

`{ caseSensitive: boolean; wholeWord: boolean }` — the resolved, **visible**, session-persistent toggle
state (FR-007). Regex intentionally absent (out of scope).

### Match

One occurrence of `term` in the panel's searchable text.

| Field | Type | Notes |
|-------|------|-------|
| `from` | position | Editor: CodeMirror document offset. Terminal: `{ row, col }` in the retained scrollback. |
| `to` | position | End of the match (same coordinate space). |
| `isCurrent` | derived | `index === currentIndex`; drives the current-match highlight token. |

Matches are **derived from content**, never stored across sessions. Matches trimmed out of the terminal's
retained scrollback simply disappear from the set on the next recompute (FR-012, no error).

### MatchHighlight (presentation)

The visible marking of a match. Two visual roles, each coloured from a **theme token** (FR-019,
contracts/theme-tokens.md):
- ordinary match → `search.match.background`
- current match → `search.match.current.background` (+ `search.match.current.border`)

Realised as CodeMirror decorations (editor) and xterm decorations (terminal); no DOM colour is hardcoded.

### SearchController (interface — see contracts/search-controller.md)

The dependency-inversion seam the find bar depends on. Two implementations: `EditorSearchController`
(CodeMirror `@codemirror/search`) and `TerminalSearchController` (`@xterm/addon-search` + scroll APIs).
The find bar never imports an engine directly.

### FindBarState (UI)

| Field | Type | Notes |
|-------|------|-------|
| `open` | `boolean` | Whether the shared find bar is shown for the active panel. |
| `panelKind` | `'editor' \| 'terminal' \| null` | Drives which controls render (replace only for editor). |
| `count` | `{ current: number; total: number } \| null` | Rendered as e.g. "3 of 12"; `null`/0 → no-results state (FR-009). |
| `controller` | `SearchController` | The controller for the active panel; swapped when the active panel changes (FR / edge "switch active panel"). |

### TerminalScrollView (navigation + freeze)

| Field | Type | Notes |
|-------|------|-------|
| `autoFollow` | `boolean` | Whether the viewport tracks the live bottom. **Suspended** while find is open on a match (FR-012a); resumes on close / jump-to-bottom. |
| `atLiveBottom` | derived | True when the viewport shows the newest output; gates pass-through typing (FR-016). |

Navigation commands (page/line/top/bottom, next/prev match) mutate the viewport only via xterm scroll APIs;
none is delivered to the pty (FR-014/016).

## Relationships

```
FindBarState 1──1 SearchController 1──1 SearchSession
SearchSession 1──* Match ──(role)── MatchHighlight ──(colour)── ThemeToken
TerminalScrollView 1──1 (terminal) SearchController   # freeze + nav coordination
```

## Validation rules (from requirements)

- Terminal `SearchController` MUST expose **no mutation** of pty/grid (FR-010/013); its `replace*` methods
  do not exist (type-level: replace is on the editor controller only).
- `replaceAll` (editor) MUST commit as **one undoable transaction** (FR-008) and preserve encoding/line
  endings via the existing editor save/fidelity path (006).
- Opening/seeding MUST NOT mutate content (FR-003) — seed reads selection only.
- Every action-id and theme token introduced MUST have exactly one editor descriptor (completeness tests).
