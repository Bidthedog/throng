# Feature Specification: Terminal & Editor Search

**Feature Branch**: `013-terminal-and-editor-search`

**Created**: 2026-07-11

**Status**: Clarified — ready for `/speckit-plan` (see Clarifications)

**Depends on**: feature 012 (focus-contexts-and-zoom), which establishes the single **active panel** / focus context that a search acts on and the routing that lets terminal- and editor-specific commands reach the right panel. Builds on the existing terminal panels (feature 005) and inline editor panels (feature 006). **Relates to** feature 016 (advanced-editor): 016 owns language detection, syntax highlighting and editing essentials and defers *semantic* "Find References" to a future language-server increment; it does **not** own plain-text in-file find/replace — that is this feature (see Out of Scope).

**Input**: Reconstructed feature. Feature 008 (terminal-session-integrity) explicitly deferred "Terminal search and scrollback navigation" and the "terminal-specific key bindings" those commands need to a later feature; the branch name broadens that to editor search as well. This feature adds three in-panel search capabilities — find within a terminal's scrollback, keyboard navigation through that scrollback, and find/replace within an editor — each routed to the active panel established by feature 012.

---

## Clarifications

### Session 2026-07-11 (provenance)

- Q: Is there a verbatim original prompt for this feature? → A: **No.** The `013-terminal-and-editor-search` branch was created on 2026-07-10 as a bare placeholder during the decomposition of the workspace/editor family into features 008–015; specs were authored only for 008–011. This specification was reconstructed from feature 008's *Out of Scope* lines — "Terminal search and scrollback navigation." and "Per-panel text zoom, keyboard focus scoping, and terminal-specific key bindings." — plus the branch name (which extends the scope to editor search) and the boundary with feature 016 (which does not own plain-text editor find). The three headline capabilities are fixed by that source; the finer decisions were surfaced as questions and resolved in the Session 2026-07-11 clarifications below.

### Session 2026-07-11

- Q: Is there one **shared** find affordance that adapts to the active panel's type, or a **separate** find affordance per panel type? → A: **Single adaptive bar** — one `find` command and one find bar that adapts to whichever panel is active (terminal → read-only find over scrollback; editor → find/replace), routed to the active panel by feature 012.
- Q: Does editor search include **replace**, or find-only, in the first version? → A: **Find and replace in v1** — replace-current and replace-all ship now (replace-all a single undoable step, preserving encoding & line endings). Terminal search remains read-only regardless.
- Q: Which **match modes** ship in the first version? → A: **Case-sensitive and whole-word toggles in v1; regex deferred** to a later increment (tracked in ROADMAP.md).
- Q: Do matches update as-you-type or only on submit? → A: **Incremental (as-you-type)** — highlights, current-match indicator and total count refresh live on every keystroke and on match-mode changes, for both editor and terminal find.
- Q: When find opens with a non-empty selection in the active panel, is the input pre-filled from it? → A: **Seed from selection** — a single-line, non-empty selection (editor or terminal) pre-fills the search input (selected so typing replaces it); otherwise find opens empty or with the last term. Seeding never alters panel content.
- Q: What concrete performance target replaces SC-007's "small fraction of a second"? → A: **Within 1 second** — find results render within **1000 ms** of the last keystroke on representative content (a typical file and a typical terminal scrollback).
- Q: Where do search results show — inline highlights plus the in-bar count only, or also a separate results-list panel? → A: **In-content highlights + in-bar count only** — every match is highlighted in the editor/terminal content (current match distinctly marked and scrolled into view) and the find bar shows the current/total count; there is **no separate results-list panel** (a "list all matches" view is future scope). Highlight colours are already themed (FR-019, SC-005).
- Q: While terminal find is open on a match, does the viewport keep auto-following new output to the live bottom? → A: **Freeze on the match** — opening find (or navigating to a match) suspends terminal auto-follow so the viewport stays on the current match as new output streams in; auto-follow resumes when find closes or the user jumps to the live bottom. Matches still re-evaluate against the growing buffer (FR-012).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find text in the active editor (Priority: P1)

A developer editing a file wants to jump to occurrences of a string — a variable name, a TODO, an error message. They open find, type the term, and step through matches, each highlighted, with the editor scrolling the current match into view. The file's content is never altered by searching.

**Why this priority**: In-file find is the single most-expected editor affordance; without it the editor panels feel incomplete. It is independently valuable and testable on its own.

**Independent Test**: Open a file with several occurrences of a term, invoke find, type the term, and step forward and backward through the matches; assert every occurrence is highlighted, the current match is scrolled into view and distinctly marked, the count is shown, and the file content is unchanged.

**Acceptance Scenarios**:

1. **Given** an editor panel is the active panel, **When** the user invokes find and types a term, **Then** all matches in the file are highlighted incrementally as they type, the first match from the cursor is marked as current and scrolled into view, and a match count (e.g. "3 of 12") is shown.
2. **Given** a word is selected in the editor, **When** the user invokes find, **Then** the search input is pre-filled with that selection (selected so typing replaces it) and its matches are shown immediately, without altering the file.
3. **Given** matches are shown, **When** the user issues find-next / find-previous, **Then** the current match advances / retreats, wrapping at the ends, without changing the file.
4. **Given** the find affordance is open, **When** the user closes it, **Then** the highlights clear and keyboard focus returns to the editor content at the current match.
5. **Given** a search term with no matches, **When** the user searches, **Then** a clear "no results" state is shown and nothing in the file changes.

---

### User Story 2 - Find text in a terminal's scrollback (Priority: P1)

A developer scrolls back through a terminal's output looking for a specific line — a build error, a printed URL, a hash. They open find on the active terminal, type the term, and step through matches in the retained scrollback, each highlighted, with the terminal scrolling to show the current match. Searching never types into or disturbs the running program.

**Why this priority**: Terminals accumulate long output that is painful to eyeball; find-in-scrollback is the capability feature 008 explicitly deferred and is the terminal counterpart to US1. It is independently valuable and testable.

**Independent Test**: Produce a terminal with a long scrollback containing a known term several times, invoke find, type the term, and step through matches; assert each is highlighted, the terminal scrolls the current match into view, wrap works, and no input is sent to the running program.

**Acceptance Scenarios**:

1. **Given** a terminal panel is the active panel with scrollback containing the term, **When** the user invokes find and types it, **Then** matches in the retained scrollback are highlighted, the nearest match is marked current and scrolled into view, and a match count is shown.
2. **Given** terminal matches are shown, **When** the user issues find-next / find-previous, **Then** the current match advances / retreats and wraps, and no keystroke is delivered to the running program.
3. **Given** find is open over a terminal and the user is positioned on a match, **When** new output arrives at the live bottom, **Then** auto-follow is suspended so the viewport stays on the current match, the search does not steal focus into the program, and the highlighted matches remain coherent (re-evaluated against the updated buffer).
4. **Given** terminal find is closed, **When** the user resumes typing, **Then** input goes to the program as normal and the highlights are cleared.

---

### User Story 3 - Navigate terminal scrollback from the keyboard (Priority: P2)

A developer wants to move through a terminal's scrollback without the mouse — page up/down, line up/down, jump to the top or bottom, and jump between search matches — so they can read long output hands-on-keyboard.

**Why this priority**: It complements terminal find and makes long output navigable without reaching for the scrollbar, but the terminal is still usable with find and the mouse alone, so it ranks below the two P1 finds. It is also a down-payment on full keyboard-only accessibility (issue #26).

**Independent Test**: With a long terminal scrollback, use only the keyboard to page and line-scroll, jump to top and bottom, and jump between matches while find is active; assert the viewport moves as intended and no navigation keystroke is sent to the running program.

**Acceptance Scenarios**:

1. **Given** an active terminal with scrollback, **When** the user issues page-up/down or line-up/down navigation, **Then** the viewport scrolls accordingly and no navigation keystroke reaches the running program.
2. **Given** an active terminal, **When** the user issues jump-to-top / jump-to-bottom, **Then** the viewport moves to the start / live end of the scrollback.
3. **Given** find is active with matches, **When** the user issues jump-to-next-match / previous-match, **Then** the viewport moves to that match consistent with US2.
4. **Given** the user is at the live bottom and types, **Then** navigation mode does not intercept the keystrokes and input reaches the program normally.

---

### User Story 4 - Replace text in the active editor (Priority: P2)

A developer wants to change every occurrence of a string in the open file — rename a local symbol, fix a repeated typo — via replace-current and replace-all, with the file's encoding and line endings preserved.

**Why this priority**: Replace is a natural extension of editor find and is not owned by any other feature, but find alone already delivers the headline value, so replace ranks after the P1 finds. Replace is **in scope for v1** (Clarifications, Session 2026-07-11).

**Independent Test**: Open a file with several occurrences of a term, replace one and then all, and confirm the intended text changed, the untouched text did not, and the file's encoding and line endings are unchanged; undo restores the prior state.

**Acceptance Scenarios**:

1. **Given** editor find is open with matches, **When** the user enters a replacement and issues replace-current, **Then** only the current match is replaced and the selection advances to the next match.
2. **Given** matches are shown, **When** the user issues replace-all, **Then** every match is replaced in one undoable step and the match count updates to zero.
3. **Given** a completed replace, **When** the user inspects the file, **Then** its encoding and line endings are unchanged and only the intended text differs.
4. **Given** a replace-all, **When** the user issues undo, **Then** the file returns to its pre-replace state in a single step.

---

### Edge Cases

- What happens when find is invoked while no panel is active, or the active panel is a type with no search (if any such type exists)? Find is a no-op (or is unavailable) with a clear, non-error indication; nothing is searched.
- What happens when a terminal's scrollback is trimmed (ring-buffer limit) while find is open? The search operates over the currently retained scrollback; matches that have scrolled out of the retained buffer are simply not found, with no error.
- What happens when the search term matches across a soft-wrapped line or an ANSI-styled terminal cell? Matching is on the visible text content; a match is highlighted wherever its characters appear contiguously in the rendered text, regardless of colour/styling.
- What happens when the editor file is very large (beyond the representative size in SC-007)? Find remains responsive within the SC-007 budget for representative content. **No hard match/size cap is imposed in v1**; should profiling later show one is needed, it will be a *defined* limit surfaced to the user (never a silent truncation), added as a future increment — not a v1 behaviour.
- What happens to replace when the file is read-only or the editor is in a non-editable state? Replace is unavailable or clearly disabled; find still works.
- What happens when the same term is searched in a panel shown in two windows (a mirrored terminal)? Each view runs its own find state; searching in one does not move the other's viewport.
- What happens when find is open and the user switches the active panel? The find affordance follows the focus model of feature 012 — it applies to the active panel; switching panels does not leave a stray find bar acting on the wrong panel.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Search routing & affordance

- **FR-001**: Search MUST act on the **active panel** (the focus context established by feature 012). Terminal search searches that terminal's scrollback; editor search searches that editor's file.
- **FR-002**: There MUST be a **single shared find affordance** that adapts to the active panel's type — one `find` command and one find bar, presenting a read-only scrollback find for a terminal and find/replace for an editor. It MUST present, for the active search, the search term input, a **current-match indicator and total count**, and next / previous / close controls; editor-only controls (replace inputs, replace-current/all) MUST appear only when the active panel is an editor. Match results MUST be presented as **in-content highlights** (FR-005 / FR-010) **plus the current/total count in this find bar**; there MUST NOT be a separate results-list panel.
- **FR-002a**: Search MUST update **incrementally (as-you-type)**: as the user edits the search term, and whenever a match-mode toggle (FR-007) changes, the match highlights, the current-match indicator, and the total count MUST refresh live — not only on submit. This applies to both editor find (FR-005) and terminal find (FR-010).
- **FR-002b**: When find is opened while the active panel has a **non-empty, single-line selection** (an editor text selection or a terminal selection), the search input MUST be **pre-filled** with that selection and its text selected so typing replaces it; when there is no such selection, find MUST open with an empty input or the last search term. Seeding the input MUST NOT alter panel content (consistent with FR-003).
- **FR-003**: Opening find MUST NOT alter panel content: opening find on a terminal MUST NOT send any keystroke to the running program, and opening find on an editor MUST NOT modify the file.
- **FR-004**: Closing find MUST clear its match highlights and return keyboard focus to the panel content (for a terminal, to its input; for an editor, to the current match position).

#### Editor search

- **FR-005**: A user MUST be able to **find** text within the active editor's file, with every match highlighted, the current match distinctly marked and scrolled into view, and a match count shown.
- **FR-006**: Find-next and find-previous MUST move the current match forward / backward and MUST **wrap** at the ends of the file.
- **FR-007**: Editor find MUST support **case-sensitive** and **whole-word** match-mode toggles (regular-expression matching is deferred to a later increment). The active modes MUST be visible and MUST persist within a find session.
- **FR-008**: Editor **replace** MUST support replace-current and replace-all; replace-all MUST be a **single undoable step**; and replace MUST preserve the file's encoding and line endings (never rewriting them), consistent with feature 006's fidelity guarantees.
- **FR-009**: A "no results" state MUST be clearly indicated, and MUST leave the file unchanged.

#### Terminal search

- **FR-010**: A user MUST be able to **find** text within the active terminal's retained scrollback, with matches highlighted, the current match scrolled into view, and a match count shown. Terminal search is **read-only**: it MUST NOT deliver any keystroke to the running program.
- **FR-011**: Terminal find-next / find-previous MUST move the current match and MUST wrap across the retained scrollback.
- **FR-012**: Terminal search MUST operate on the **rendered text content** of the scrollback, independent of colour/style attributes, and MUST remain coherent when new output arrives (matches re-evaluated against the updated buffer). Matches that have been trimmed from the retained scrollback are simply not found, with no error.
- **FR-012a**: While terminal find is open and positioned on a match, the terminal's **auto-follow (auto-scroll to the live bottom) MUST be suspended** so incoming output does not pull the viewport off the current match. Auto-follow MUST resume when find is closed or the user jumps to the live bottom (FR-014). Suspending auto-follow MUST NOT deliver any keystroke to the running program (FR-010).
- **FR-013**: Terminal search MUST NOT, by itself, resize the terminal or alter its character grid (consistent with feature 008 FR-013 / FR-009–012 grid model).

#### Scrollback navigation

- **FR-014**: A user MUST be able to navigate a terminal's scrollback from the keyboard: page up/down, line up/down, jump to top, and jump to the live bottom. These navigation commands MUST NOT be delivered as keystrokes to the running program.
- **FR-015**: A user MUST be able to jump to the next / previous **search match** in the scrollback while find is active, consistent with FR-011. This is the **same command** as find-next / find-previous (FR-006/FR-011) acting in the terminal-scrollback context — **not** a distinct action-id.
- **FR-016**: When the terminal is at its live bottom and the user is typing to the program, navigation MUST NOT intercept ordinary input; input MUST reach the program normally.

#### Commands & configuration

- **FR-017**: All search and scrollback-navigation commands (open find, find-next, find-previous, close find, replace-current, replace-all, page/line/top/bottom navigation, next/previous match) MUST be registered as **configurable, rebindable key bindings** that appear in the visual Key Bindings editor (constitution v3.11.0 configuration-editor completeness), shipping with sensible defaults.
- **FR-018**: Any interactive **action control** in the find affordance (next, previous, close, and any match-mode toggles) MUST be a **themeable icon carrying a hover title**, taking its icon and colours from theme tokens, per constitution v3.12.0 — not text labels or inline SVGs.
- **FR-019**: **Match-highlight** colours (ordinary match and current match) MUST be drawn from **theme tokens**; any new token MUST be exposed in the Themes editor per the configuration-editor-completeness rule, so highlights are legible on every bundled theme.
- **FR-020**: These search commands are the **terminal- and editor-specific bindings** deferred by feature 008 and enabled by feature 012's focus-context routing; they MUST be scoped to the panel type they apply to (a terminal-only navigation command is inert in an editor, and vice versa) via that routing.

### Key Entities

- **Search session**: a term, its resolved match modes, the set of matches over the active panel's content, and the current-match index. Belongs to one panel view; a mirrored panel's other views hold their own sessions.
- **Match**: one occurrence of the term in the panel's searchable text (an editor file, or a terminal's retained scrollback), with a position used to highlight it and scroll it into view.
- **Match highlight**: the visible marking of matches (ordinary vs current), coloured from theme tokens exposed in the Themes editor.
- **Search / navigation commands**: the rebindable key bindings (find, find-next/prev, close, replace-current/all, scrollback page/line/top/bottom, next/prev match) shown in the Key Bindings editor and routed to the active panel by feature 012.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In an active editor, a user can find a term, step through all its matches (with wrap), and close find, with the file content unchanged in 100% of trials.
- **SC-002**: In an active terminal, a user can find a term in scrollback and step through matches with zero keystrokes delivered to the running program in 100% of trials.
- **SC-003**: A user can navigate a terminal's scrollback (page/line/top/bottom and jump-to-match) using the keyboard alone.
- **SC-004**: Editor replace-all changes exactly the matched text, preserves the file's encoding and line endings in 100% of trials, and is reversible in a single undo.
- **SC-005**: Match highlights (ordinary and current) meet the project's contrast bar and are legible on all bundled themes.
- **SC-006**: Every search and navigation command is discoverable and rebindable in the Key Bindings editor (completeness test passes).
- **SC-007**: Find returns and renders results — including the incremental as-you-type update — **within 1 second (≤ 1000 ms) of the last keystroke** on **representative content, defined as a text file of up to ~10,000 lines and a terminal scrollback filled to its retained-buffer limit (~5,000 lines, feature 005 default)**. Timing assertions use fixtures of these sizes so the target is deterministic.

---

## Assumptions

- **No verbatim original prompt existed for feature 013.** This specification was reconstructed from feature 008's explicit deferral of terminal search / scrollback navigation / terminal-specific bindings, the branch name (extending scope to editor search), and the feature 016 boundary. See Clarifications → provenance.
- Feature **012** (focus contexts) provides the single active-panel routing that search acts on; 013 does not re-specify focus. If 012 is not yet merged, 013's routing requirement stands as a dependency, not a re-implementation.
- Terminals already retain a bounded **scrollback** (feature 005); terminal search operates over that retained buffer, not over output already trimmed from it. No new persistence of terminal output is introduced.
- Editors already guarantee **encoding and line-ending fidelity** (feature 006); replace preserves those guarantees and reuses the existing single-buffer / undo model.
- **Feature 016 does not own plain-text editor find/replace.** 016 covers language detection, syntax highlighting and editing essentials, and its only "find" is *semantic* Find References, which 016 itself defers to a future language-server increment. Therefore 013 owns editor plain-text in-file find (and replace); 013 defers only semantic Find References to that future 016/LSP work.
- Default key-binding chords for the new commands ship as sensible defaults and are fully rebindable in the Key Bindings editor, so exact defaults are low-lock-in.
- Terminal search is inherently **read-only**; only editor search may modify content (via replace, if in scope).

## Out of Scope

- The **focus-context model** and per-panel zoom (feature 012) — consumed here, not built.
- **Project-wide / cross-file search** (searching across files in the project) — a separate concern belonging to the enhanced-file-explorer / project-search family on the roadmap, not this in-panel find.
- The **file-explorer** tree search.
- A separate **results-list / match-list panel** (a scrollable list of matches with line/context to click through). Results surface as in-content highlights plus the find-bar count only; a "list all matches" view is future scope.
- **Semantic code search** — "Find References" and other language-server-driven navigation — which feature 016 defers to a future language-server increment. This feature is plain-text find/replace only.
- **Regular-expression matching** — deferred to a later increment (v1 ships case-sensitive and whole-word toggles only); tracked in ROADMAP.md.
- **Full app-wide keyboard-only accessibility** (issue #26). This feature's keyboard scrollback navigation is a down-payment on it but does not make every control in throng keyboard-operable.
- Any change to terminal scrollback retention limits, terminal grid sizing (feature 008), or editor file-handling semantics (feature 006).
