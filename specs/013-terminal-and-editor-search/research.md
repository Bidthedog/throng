# Phase 0 Research: Terminal & Editor Search

All spec clarifications are resolved (8 recorded, spec §Clarifications). No `NEEDS CLARIFICATION` remain;
the research below records the engineering decisions that back the plan.

## D1 — Editor find/replace engine: `@codemirror/search`

- **Decision**: Use CodeMirror 6's first-party `@codemirror/search` package (`SearchQuery`,
  `search()` extension, `SearchCursor`/`RegExpCursor`, `findNext`/`findPrevious`/`replaceNext`/`replaceAll`
  commands, and `getSearchQuery`/`setSearchQuery` state effects). Drive it from a **custom React find bar**;
  do **not** mount CodeMirror's built-in search panel.
- **Rationale**: The editor already runs CodeMirror 6 (`@codemirror/state`/`view`/`commands`, per 006).
  `@codemirror/search` is the same maintained family, bundles under Vite with no worker/CDN (satisfies the
  sandboxed-offline renderer), and gives match highlighting, current-match tracking, wrap, case/whole-word
  query flags, and a single-transaction `replaceAll` (→ one undo step, FR-008). A custom bar is required so
  the controls are **themeable icons with hover titles** (FR-018) and so the *same* bar serves the terminal.
- **Alternatives considered**: (a) CodeMirror's built-in `search` panel — rejected: its DOM/labels are not
  theme-token/icon compliant and cannot be shared with the terminal. (b) Hand-rolled buffer scan — rejected:
  re-implements cursor/wrap/replace-undo that the package already gets right (DRY/YAGNI).
- **Highlight colours**: apply via CodeMirror decoration classes bound to the **Phase-A theme tokens**, not
  the library's default theme, so highlights honour FR-019/SC-005 on every bundled theme.

## D2 — Terminal find engine: `@xterm/addon-search`

- **Decision**: Add `@xterm/addon-search` (`SearchAddon`) loaded onto the existing xterm terminal;
  use `findNext`/`findPrevious` with `{ caseSensitive, wholeWord, decorations }` and subscribe to
  `onDidChangeResults` for the **current/total count**.
- **Rationale**: The terminal already runs `@xterm/xterm` + `@xterm/addon-fit`; the search addon is the same
  family, reads the **retained scrollback** (not the PTY), highlights matches via xterm **decorations**
  (colours we supply from theme tokens), and never writes to the pty — satisfying read-only (FR-010) and
  "operate on rendered text content" (FR-012). `onDidChangeResults` yields `{ resultIndex, resultCount }`
  for the count and current-match indicator. Bundles offline under Vite.
- **Alternatives considered**: (a) Scan the xterm buffer manually via the `buffer` API — rejected: the addon
  already does line-joining across soft-wraps and decoration highlighting (DRY). (b) A daemon-side grep over
  scrollback — rejected: violates the renderer-only boundary and the read-only view model, and the daemon
  does not retain rendered text.
- **Count caveat**: older addon versions computed `resultCount` lazily; pin a version whose
  `onDidChangeResults` reports a stable total, and assert the count in the Phase-D E2E.

## D3 — One shared find affordance (not per-panel bars)

- **Decision**: A single `renderer/search/find-bar.tsx` + `use-find-bar.ts` that opens on the **active
  panel** (012 active-pane context) and binds to a `SearchController` chosen by panel type (editor → D1
  adapter, terminal → D2 adapter). Editor-only controls (replace inputs, replace-current/all) render only
  when the active panel is an editor (FR-002).
- **Rationale**: Matches the clarified single-adaptive-bar model; one `find` action-id, one component to
  theme and test (DRY/VIII). The `SearchController` interface (find/replace/navigate/seed/count/dispose)
  is the dependency-inversion seam (contracts/search-controller.md).
- **Alternatives considered**: distinct terminal-find and editor-find bars — rejected by clarification
  (duplicate surface, two command sets).

## D4 — Match-highlight theming (new tokens)

- **Decision**: Add theme tokens for **ordinary match** and **current match** (background, and a current-
  match outline/foreground as needed), each with a Themes-editor descriptor (contracts/theme-tokens.md).
  CodeMirror decorations and xterm decorations both read these tokens.
- **Rationale**: FR-019 + constitution configuration-editor-completeness: a new token without a descriptor
  fails the completeness test. SC-005 requires legibility on every bundled theme, so the bundled themes get
  values that meet the contrast bar.
- **Token set (minimal)**: `search.match.background`, `search.match.current.background`,
  `search.match.current.border` (final names fixed in contracts/theme-tokens.md). Kept minimal (YAGNI).

## D5 — Scrollback keyboard navigation & command scoping

- **Decision**: Navigation uses xterm's `scrollLines(±n)`, `scrollPages(±1)`, `scrollToTop()`,
  `scrollToBottom()`. Commands are **rebindable action-ids** resolved **only when a terminal is the active
  panel** (FR-020), mirroring how `editor.save`/`file.rename` are gated by the active pane (keybindings.ts
  comments; research D7 of 006). Navigation keystrokes are consumed by the handler and never forwarded to
  the pty (FR-014). At the live bottom with no find/nav modifier, ordinary input passes through (FR-016).
- **Rationale**: Reuses the existing active-pane keybinding-scoping pattern; no new routing mechanism.
- **Alternatives considered**: a distinct "scroll mode" toggle — rejected as heavier than needed; the
  bindings + active-pane scoping already give hands-on-keyboard navigation (YAGNI).

## D6 — Terminal auto-follow freeze while searching

- **Decision**: While find is open **and positioned on a match**, suspend auto-follow (auto-scroll to the
  live bottom) by coordinating with the existing `terminal/output-gate.ts`; resume on find-close or
  jump-to-bottom (FR-012a). This is a **view-only scroll state** — no keystroke to the program.
- **Rationale**: `output-gate.ts` already mediates output/scroll behaviour, so the freeze lives with it
  rather than a parallel mechanism (DRY). Matches the clarified "freeze on the match" behaviour and keeps
  matches coherent as the buffer grows (re-run the query on buffer change, FR-012).
- **Alternatives considered**: freezing all rendering — rejected: output must keep accumulating in
  scrollback so the buffer (and match set) stays current; only the *viewport follow* is suspended.

## D7 — Incremental (as-you-type) search within the perf budget

- **Decision**: Re-run the query on each keystroke and on toggle change, **debounced** (injected
  `asYouTypeDebounceMs` setting, sensible default) so results render within **≤ 1000 ms** of the last
  keystroke (SC-007) even on large content. The debounce interval is an externalised setting (Principle X),
  with a descriptor if user-editable.
- **Rationale**: Both engines compute incrementally; debounce bounds worst-case cost on very large
  files/scrollback without a hard match cap. Perf asserted in E2E/integration against representative content.
- **Alternatives considered**: search only on Enter (rejected by clarification); a hard match-count cap
  (rejected — not needed within budget; the large-file edge case allows a defined cap only *if* required).

## D8 — Selection seeding

- **Decision**: On open, if the active panel has a **non-empty single-line selection** (CodeMirror
  `state.selection.main` for the editor; xterm `getSelection()` for the terminal), pre-fill and select the
  find input (FR-002b); else open empty or with the last term. Seeding reads content only — no mutation
  (FR-003).
- **Rationale**: Universal editor convention; both engines expose the current selection cheaply.

## D9 — Match modes & safe defaults (deferred detail, recorded)

- Case-sensitive and whole-word toggles ship (FR-007); **regex is deferred** (out of scope, ROADMAP).
- Safe conventional defaults (settled here, not clarification-worthy): toggles **default off**
  (case-insensitive, whole-word off) on first open; the search term is **single-line**; **replace honours
  the active case/whole-word toggles**; whole-word boundary uses the engine's default word-character
  definition. These are recorded so tasks/tests are unambiguous.

## Dependencies to add

| Package | Purpose | Bundling |
|---------|---------|----------|
| `@codemirror/search` | Editor find/replace (D1) | Pure JS, Vite, offline ✓ |
| `@xterm/addon-search` | Terminal scrollback find (D2) | Pure JS, Vite, offline ✓ |

Both align with the project's dependency ceilings (renderer libs, no native build). No daemon or main-only
dependency changes.
