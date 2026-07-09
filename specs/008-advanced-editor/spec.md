# Feature Specification: Advanced Editor — Rich Code Editing (Part 1): Syntax Highlighting, Language Detection & Editing Essentials

**Feature Branch**: `008-advanced-editor`

**Created**: 2026-07-08

**Status**: Draft

**Input**: User description: "Enhancements to the code editor: right-click context menu (copy/cut/paste),
Ctrl+X = cut line, syntax highlighting for all common languages (detect the language first, then apply the
appropriate highlighter, abstracted so highlighters are pluggable), tab-or-space indentation per file type,
and (later) IntelliSense, go-to-definition, find-references and symbol rename. If complex, do one at a
time — syntax highlighting first." *(Detection was subsequently narrowed to **file extension only** — see
Clarifications, Session 2026-07-09.)*

## Overview

This feature begins **"Rich code editors"** (ROADMAP → *Files & editors*) — layering real code-editing
capability onto the plain-text **Editor Panel** delivered in feature 006. Feature 006 deliberately shipped
the cross-platform editing fundamentals (encoding/line-ending fidelity, confined save, one-buffer-per-file,
recovery, cross-window sync) with **syntax highlighting and language features explicitly deferred**
(006 FR-004). This feature delivers the **first** of those deferred capabilities.

Scope is set by the 2026-07-08 clarification: **Part 1 = syntax highlighting + language detection, plus the
low-cost editing essentials that make the editor feel finished — a content-area right-click menu
(cut/copy/paste), Ctrl+X "cut line", and per-language tab/space indentation.** The heavier
language-intelligence features the user also listed — **IntelliSense, Go to Definition, Find References, and
Symbol Rename** — require language-server integration and are a **separate, larger undertaking**; they are
**out of scope here** and tracked as a following increment (see [Out of Scope](#out-of-scope) and
Dependencies).

The headline of Part 1 is **language-aware syntax highlighting** for the common languages the user works in.
Critically, highlighting is driven by a **language-detection step that runs first**: the editor decides
*what language a document is* — from the file's **extension** — and only then selects the matching
**highlighter**. Detection and highlighter selection are structured as an **extensible language registry**
(one descriptor per language) so new languages can be added without reworking the editor. This is the
"detect first, then render" pattern the user asked for. Detection **does not inspect document content**
(2026-07-09 clarification); where an extension is absent or wrong, the user applies a **manual language
override**.

The editor being enhanced is the existing Editor Panel component; this feature adds capability to it and does
**not** introduce a second editor. All of Part 1 is renderer-side editor behaviour plus a small amount of
per-language configuration; it introduces **no new daemon RPC and no data-schema change**.

## Clarifications

### Session 2026-07-08

- Q: The user listed seven editor enhancements and said "if complex, do one at a time — syntax highlighting
  first." What is the scope of this feature? → A: **Part 1** = **syntax highlighting + language detection**
  **plus** the three low-cost editing essentials (**content right-click menu with cut/copy/paste**,
  **Ctrl+X = cut current line**, **per-language tab/space indentation**). The language-server-dependent
  features (**IntelliSense, Go to Definition, Find References, Symbol Rename**) are **deferred** to a later
  feature — they are a much larger undertaking (running/bundling language servers, a language-client
  protocol per language) and are recorded on the roadmap, not built here.
- Q: How is a document's language chosen? → A: *(Superseded by the 2026-07-09 clarification below —
  detection is now **file extension only**.)*
- Q: Should users be able to correct a wrong guess? → A: **Yes** — the user can **manually set/override the
  language** for the active editor; the override applies immediately and persists for that editor.
- Q: Do syntax colours become per-theme, per-token editable in this feature? → A: **No.** Part 1 ships a
  **built-in, theme-aware highlight style** that is legible on every bundled theme (light and dark). Making
  each syntax category an individually theme-editable colour token is a **later enhancement** (it would
  expand the Themes editor and the theme-token set) — out of scope for Part 1.
- Q: How is a Jupyter Notebook (`.ipynb`) handled by a *code* editor? → A: **Highlighted as its raw JSON
  document.** A rich per-cell notebook view (rendering/execution) is **out of scope**; the file opens as the
  JSON it is on disk, with JSON highlighting.
- Q: The context menu the user wants — is it the same as 006's panel menu? → A: **No, it is separate.**
  006 already provides a **panel-header** right-click menu (Save / Revert / etc.). This feature adds a menu
  on the **editor content area** offering **text-editing** actions (Cut / Copy / Paste / Select All /
  Undo / Redo). The two menus MUST NOT be merged or collide.

### Session 2026-07-09

- Q: Is the indentation configuration keyed by file extension or by the detected language? → A: **By
  **detected language id**.** File extensions map to a language through the language registry (the single
  source of truth), so the *effective* language — including one set by a manual override — selects the
  indentation profile. A **single global default applies to every language unless that
  language overrides it: 2 spaces per indent.** Per-language overrides ship only where the language's
  community convention differs (e.g. tabs for Go, 4 spaces for Python). Files with no detected language
  (plain text) use the global default.
- Q: How long, and how widely, does a manual language override apply? → A: **Per panel, persisted.** The
  override is a property of the Editor Panel (stored alongside the panel's existing editor config in the
  persisted layout, so **no data-schema change**). It **survives app restart**, and because a cross-window
  synced editor shares one panel identity, it **applies to every mirrored view of that panel**. A *different*
  panel opening the same file runs detection independently.
- Q: When is language detection re-evaluated, and does it inspect document content? → A: **Detection is
  **file-extension only** and runs **once per document identity**.** Content sniffing (shebangs, `<?php`,
  doctypes, keyword heuristics) is **removed from scope** — it is a performance and correctness risk for
  large documents and adds no value given the manual override exists. Detection therefore runs when a
  document is opened and again only when its **identity or on-disk content is replaced** (rename, Save-As,
  revert, external reload) — **never while typing**. A file whose extension is unknown, absent, or wrong
  opens as **plain text**; the **manual override (FR-010) is the sole correction path**.
- Q: Where is the manual language override surfaced? → A: **Both** a **persistent language indicator** on
  the Editor Panel (always showing the document's effective language, clickable to open a searchable language
  picker) **and** a **"Set Language…" item in the editor content context menu** that opens the same picker.
  Accepted cost: the indicator is new UI chrome, so this feature also introduces its **theme tokens** (with
  the theme-metadata descriptors + completeness test the constitution requires).
- Q: What happens when a line cut with Ctrl+X (no selection) is pasted? → A: **Line-aware paste.** A
  no-selection cut marks the clipboard as holding a **full line**; pasting it inserts that line **above the
  caret's line** as a whole line, without splitting the caret's own text. Content copied from any other
  source (or from a selection-cut) pastes normally at the caret. The full-line marker is **view-local state
  that is invalidated whenever the clipboard changes from another source**, so pasting into or out of another
  application degrades cleanly to plain text plus a trailing newline.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Language-aware syntax highlighting with automatic detection (Priority: P1)

A user opens a source file in an Editor Panel and its code is **syntax-highlighted** according to the file's
language — keywords, strings, comments, numbers, and other tokens are visually distinguished. The language
is **detected automatically from the file extension** (`.rs` → Rust, `.py` → Python, `.tsx` → TypeScript,
and so on across all supported languages). Highlighting updates **live** as the user types. If the extension
is unknown or absent, the file simply shows as **plain text** — never an error — and the user can set the
language manually (US5).

**Why this priority**: Syntax highlighting is the feature the user explicitly prioritised ("syntax highlight
first") and the headline of "Rich code editors". Every other Part-1 story is a small editing-nicety that the
editor is usable without; highlighting is the reason for the feature.

**Independent Test**: Open one file per supported language (correct extension) and confirm each is highlighted
in a way distinct from plain text and appropriate to that language. Type new code into a highlighted file and
confirm the new text is highlighted live. Open a file with an unrecognised or absent extension and confirm it
renders as readable plain text with no error. Type a `#!` shebang into it and confirm nothing re-highlights
(detection does not read content).

**Acceptance Scenarios**:

1. **Given** a file with a recognised extension for any supported language, **When** it is opened in an
   Editor Panel, **Then** its content is highlighted using the highlighter for that language.
2. **Given** a file whose extension is **unrecognised or absent**, **When** it is opened, **Then** it renders
   as readable plain text with no error and no broken highlighting.
3. **Given** an open document, **When** its **content** changes (including gaining a shebang, `<?php`, or a
   doctype), **Then** the detected language does **not** change — detection never inspects content.
4. **Given** a highlighted document, **When** the user types additional code, **Then** the new text is
   highlighted live without reopening the file.
5. **Given** an open document, **When** its **identity or on-disk content is replaced** (rename, Save-As,
   revert, external reload), **Then** detection re-runs against the (possibly new) extension.
6. **Given** any bundled theme (light or dark), **When** a highlighted file is shown, **Then** the
   highlighting is legible against that theme's editor colours.

---

### User Story 2 - Right-click editing menu in the editor (Priority: P2)

A user right-clicks inside the editor's text area and gets a **context menu** of the standard text-editing
actions — **Cut**, **Copy**, **Paste**, **Select All**, **Undo**, **Redo** — plus **Set Language…**, and can
perform copy/cut/paste entirely with the mouse, without touching the keyboard. This menu is on the **editor
content** and is distinct from the existing 006 **panel-header** menu (Save / Revert), which is unchanged.

**Why this priority**: A missing right-click menu on the text area is an obvious usability gap the user
called out, and it is cheap to provide. It is not required for the highlighting MVP, so it is P2.

**Independent Test**: Select some text, right-click, and confirm Cut/Copy/Paste/Select All/Undo/Redo are
offered. Using only the mouse: copy a selection and paste it elsewhere; cut a selection and paste it; Select
All then Copy. Confirm the actions honour the OS clipboard and interoperate with other applications. Confirm
right-clicking the panel **header** still shows the 006 Save/Revert menu (not the editing menu) and vice
versa.

**Acceptance Scenarios**:

1. **Given** the editor content area, **When** the user right-clicks, **Then** a context menu appears
   offering at least Cut, Copy, Paste, Select All, Undo, Redo, and **Set Language…**.
2. **Given** a text selection, **When** the user chooses Copy then Paste at another location (mouse only),
   **Then** the text is duplicated at the new location via the OS clipboard.
3. **Given** a text selection, **When** the user chooses Cut then Paste elsewhere, **Then** the selection is
   removed from its origin and inserted at the paste point.
4. **Given** clipboard content copied from another application, **When** the user chooses Paste, **Then**
   that content is inserted at the cursor / over the current selection.
5. **Given** the editor content menu and the 006 panel-header menu, **When** each is opened, **Then** they
   show their own distinct action sets and do not collide or duplicate each other.

---

### User Story 3 - Ctrl+X cuts the current line (Priority: P2)

Following the familiar behaviour of well-known code editors, when the user presses **Ctrl+X** with **no text
selected**, the editor **cuts the entire current line**. Pasting it back inserts it as a **whole line above
the caret's line** — the caret's own line is never split — matching the muscle memory of moving a line
around with cut/paste. With a selection active, Ctrl+X cuts the selection as usual and paste behaves
normally.

**Why this priority**: A specific, small productivity behaviour the user asked for; valuable muscle-memory
parity with other editors, but independent of and secondary to highlighting.

**Independent Test**: Place the cursor on a line without selecting anything and press Ctrl+X; confirm the
whole line (including its line break) is removed and the surrounding lines close up. Put the caret in the
**middle** of another line and paste; confirm the cut line reappears as a whole line **above** that line and
that line is not split. Copy some text from another application, then paste; confirm it inserts at the caret
(the full-line behaviour did not persist). Make a selection and press Ctrl+X; confirm only the selection is
cut and pasting inserts at the caret. Test on the last line of a file with no trailing newline. Paste a cut
line into another application and confirm it arrives as text with a trailing newline.

**Acceptance Scenarios**:

1. **Given** the cursor is on a line with **no selection**, **When** the user presses Ctrl+X, **Then** the
   entire current line is removed and copied to the clipboard, and the lines below shift up.
2. **Given** a line was cut with Ctrl+X, **When** the user places the caret **mid-line** elsewhere and
   pastes, **Then** the cut line is inserted as a **complete line above the caret's line** and the caret's
   line is left unsplit.
3. **Given** an **active selection**, **When** the user presses Ctrl+X, **Then** only the selection is cut
   (the cut-line behaviour applies only when nothing is selected), and a subsequent paste inserts at the
   caret rather than as a whole line.
4. **Given** a line was cut with Ctrl+X, **When** the clipboard is then replaced from **another source**
   (another application, or a selection-copy), **When** the user pastes, **Then** the content is inserted
   verbatim at the caret (the full-line marker was invalidated).
5. **Given** a line was cut with Ctrl+X, **When** the user pastes into **another application**, **Then** it
   receives the line's text with a trailing line break.
6. **Given** the cursor is on the **last line** with no trailing newline, **When** the user presses Ctrl+X,
   **Then** the line is cut cleanly without leaving a stray blank line or error.

---

### User Story 4 - Per-language tab/space indentation (Priority: P2)

Indentation follows a **per-language** convention, resolved from the language the editor detected (which the
file's extension normally determines). Every language uses the **global default of 2 spaces** unless it
ships an override for its established convention (e.g. tabs for Go, 4 spaces for Python), and the user can
change both the global default and any per-language override. Pressing **Tab** inserts the configured
indentation for the current document's language, and automatic indentation (e.g. on a new line) follows the
same setting.

**Why this priority**: Correct per-language indentation is expected of a real code editor and is
low-cost given the editor already exists; but the editor is usable without it, so P2.

**Independent Test**: Open a Go file and press Tab; confirm a tab character is inserted. Open a Python file
and press Tab; confirm 4 spaces are inserted. Open a language with no override (e.g. TypeScript) and confirm
2 spaces are inserted. Change the setting for a language and confirm open editors of that language reflect
the change. Add a new line inside an indented block and confirm the auto-indent uses the same tabs-or-spaces
style.

**Acceptance Scenarios**:

1. **Given** a language whose override is tabs (e.g. Go), **When** the user presses Tab, **Then** a tab
   character is inserted at the cursor.
2. **Given** a language whose override is N-space indentation (e.g. Python, 4), **When** the user presses
   Tab, **Then** N spaces are inserted.
3. **Given** a language with **no** override, **When** the user presses Tab, **Then** the global default of
   **2 spaces** is inserted.
4. **Given** the user changes a language's indentation style/width (or the global default), **When** the
   change is applied, **Then** subsequent indentation in open editors of that language uses the new setting
   (without reopening).
5. **Given** the user starts a new line inside an indented block, **When** the editor auto-indents, **Then**
   it uses the language's configured tabs-or-spaces style consistently.
6. **Given** a file whose language came from a **manual override** rather than its extension, **When** the
   user presses Tab, **Then** the **overridden language's** indentation profile is used.

---

### User Story 5 - Correct a wrong language guess (Priority: P3)

The Editor Panel always shows the document's **effective language** in a **persistent indicator**. When
detection picks the wrong language — or the file has no usable extension, or the user simply wants a
different highlighter — the user **clicks the indicator** (or chooses **"Set Language…"** from the editor's
right-click menu) and picks a language from a **searchable list**. The chosen language applies
**immediately** (re-highlighting the document, and switching its indentation profile) and stays in effect
for that panel — remembered across restarts and reflected in every mirrored view of that panel.

**Why this priority**: With detection reduced to file extensions (2026-07-09), the override is the **only**
correction path for extension-less or misnamed files — but it is only reachable once detection +
highlighting (US1) exist, so P3.

**Independent Test**: Open a file and confirm the indicator shows its language. Open an extension-less file,
confirm the indicator reads "Plain Text", click it, filter the list, choose a language, and confirm the
document is re-highlighted immediately, the indicator updates, and Tab now indents in that language's style.
Repeat via the right-click menu's "Set Language…" and confirm it opens the same picker. Restart the app and
confirm the panel reopens in the overridden language. Tear the panel into a sub-workspace window and confirm
the mirrored view shows the same indicator and language. Open the same file in a second, independent panel
and confirm it detects normally.

**Acceptance Scenarios**:

1. **Given** an open editor, **When** the user manually selects a language (from the indicator or from the
   content menu's "Set Language…"), **Then** the document is re-highlighted using that language's
   highlighter immediately and the indicator updates to match.
2. **Given** a manual language override is in effect, **When** the user continues editing, **Then** the
   override persists (automatic detection does not silently revert it).
3. **Given** a manual override, **When** the user selects "plain text" / "no language", **Then**
   highlighting is removed and the document shows as plain text, and that choice is itself remembered.
4. **Given** a panel with a manual override, **When** the application is restarted, **Then** the panel
   reopens with the overridden language still applied.
5. **Given** a panel with a manual override that is mirrored in a sub-workspace window, **When** either view
   is shown, **Then** both use the overridden language and both indicators show it.
6. **Given** a manual override, **When** the user presses Tab, **Then** the **overridden** language's
   indentation profile is used.
7. **Given** any open editor, **When** the user looks at the panel, **Then** the indicator shows the
   document's effective language ("Plain Text" when none is detected), and clicking it opens the searchable
   picker with the current language marked.
8. **Given** the language picker is open, **When** the user types a filter, **Then** the list narrows to
   matching languages.
9. **Given** any bundled theme (light or dark), **When** the indicator is shown, **Then** it is legible
   against that theme.

---

### Edge Cases

- **Unsupported / undetectable language**: A file whose extension matches no supported highlighter MUST show
  as readable plain text (US1 AS2) — never an error, blank view, or broken partial highlighting.
- **Misleading or absent extension**: The extension is authoritative; a shell script named `deploy.txt` opens
  as plain text. The user corrects it with a **manual override**, which is then remembered for that panel.
- **Document identity changes (rename / Save-As)**: Detection re-runs against the new extension (US1 AS5) —
  **unless a manual override is in effect**, which continues to win (FR-010a).
- **New / untitled document (no path, no extension)**: Shows as plain text until it is saved with a
  recognised extension or a manual override is set.
- **Very large file (at the 006 open threshold)**: A file at or below the editor's large-file threshold
  (006 FR-062) MUST open and highlight responsively; highlighting MUST NOT hang the UI or add perceptible
  typing latency. (Files above the threshold are already refused by 006.)
- **Binary / non-text file**: Already blocked by 006 ("cannot open as text"); highlighting does not apply.
- **Mixed-language files (e.g. Vue single-file components, HTML with embedded script/style)**: Embedded
  regions SHOULD be highlighted where the language definition supports it; where it does not, the outer
  language's highlighting is acceptable (best-effort, no error).
- **Jupyter Notebook (`.ipynb`)**: Highlighted as raw JSON (its on-disk form); a rich cell view is out of
  scope.
- **Ctrl+X on the last line without a trailing newline**: The line MUST be cut cleanly (US3 AS6) without a
  stray blank line or error.
- **Full-line clipboard marker vs external clipboard changes**: The marker is view-local; if the clipboard is
  replaced by another application (or by a selection copy/cut), the next paste MUST be a verbatim caret
  paste, not a whole-line paste (US3 AS4).
- **Ctrl+X on a document's only line**: The line is cut cleanly, leaving an empty document, without error.
- **Right-click menus not colliding**: The editor **content** menu (editing actions) and the 006 **panel
  header** menu (Save/Revert) MUST remain separate (US2 AS5).
- **Indentation setting changed while editors are open**: Editors of the affected language MUST pick up the
  new indentation style without needing to be reopened (US4 AS4).
- **Indentation for an undetected / plain-text document**: Falls back to the global default (2 spaces) — no
  language profile is required for a document to be indentable.
- **Cross-window synced editor (006 mirror)**: Highlighting, the content menu, the language indicator,
  cut-line, and indentation MUST work in every mirrored view; they are per-view editing behaviours and MUST
  NOT disturb the single shared buffer or its dirty state (006 FR-034).
- **Language indicator in a narrow panel**: The indicator MUST remain usable (e.g. truncate its label) rather
  than overflow or disappear when the Editor Panel is very narrow.

## Requirements *(mandatory)*

### Functional Requirements

#### Language detection & the language registry

- **FR-001**: The editor MUST provide **syntax highlighting** for each of these languages: **C#, C, C++,
  Rust, Go, Python, JavaScript, TypeScript, Java, Kotlin, Swift, Dart, PHP, Ruby, Lua, PowerShell, Shell
  (POSIX/Bash), HTML, CSS, SASS/SCSS, LESS, Vue (single-file components), and Jupyter Notebook (as JSON)** —
  23 language targets in total.
- **FR-002**: The system MUST determine a document's **language before selecting a highlighter** (detect
  first, then render). Detection MUST be based **solely on the file's extension** (case-insensitively
  matched, and supporting compound extensions such as `.d.ts` where a language declares them). Detection
  MUST **NOT inspect document content** — no shebang, tag, doctype, or keyword heuristics.
- **FR-002a**: Detection MUST run **once per document identity**: when a document is opened, and again only
  when its identity or on-disk content is replaced (**rename, Save-As, revert, external reload**). Detection
  MUST **NOT** run while the user types, and MUST NOT change a document's language in response to content
  edits.
- **FR-003**: A file whose extension is **unrecognised or absent** MUST open as **plain text**. The **manual
  language override (FR-010) is the sole correction path** for a missing or misleading extension.
- **FR-004**: Detection and highlighter selection MUST be structured as an **extensible language registry** —
  a single authoritative source with **one descriptor per supported language** (its identity/display name,
  its associated file extensions, its indentation profile, and the highlighter to apply) — so **new
  languages can be added by adding a descriptor**, without modifying the editor's core logic (open/closed;
  reuse of the existing editor component's language ecosystem is expected — see Assumptions).
- **FR-005**: The editor MUST apply the highlighter matched to the detected language, and MUST **fall back to
  plain, unhighlighted text** — never an error or corrupted rendering — when no language is detected or no
  highlighter exists for the detected language.
- **FR-006**: Syntax highlighting MUST update **live** as the user edits (newly entered code is highlighted
  without reopening the document).
- **FR-007**: Highlighting MUST be **legible against every bundled theme** in both light and dark
  presentations, using a built-in theme-aware highlight style. *(Per-syntax-category theme-editable colour
  tokens are out of scope — see [Out of Scope](#out-of-scope) and Assumptions.)*
- **FR-008**: A file **at or below** the editor's large-file open threshold (006 FR-062) MUST open and
  highlight **responsively**; highlighting MUST NOT hang the UI thread or introduce perceptible typing
  latency. Where necessary for very large but permitted files, highlighting MAY degrade gracefully (e.g.
  viewport-based) but MUST NOT block editing.
- **FR-009**: A **Jupyter Notebook (`.ipynb`)** MUST be highlighted as its raw **JSON** document; a rich
  per-cell notebook view is out of scope.

#### Manual language override

- **FR-010**: The user MUST be able to **manually set/override the language** of the active editor. The
  chosen language MUST apply **immediately** (the document is re-highlighted) and automatic detection MUST
  NOT silently revert it.
- **FR-010a**: A manual override MUST be scoped to the **Editor Panel** and **persisted with that panel's
  existing editor configuration in the saved layout** (no data-schema change). It MUST therefore **survive an
  application restart** (the panel reopens in the overridden language) and MUST apply to **every mirrored
  view of that panel** in a cross-window synced editor (006 FR-034). A **different** panel opening the same
  file MUST run detection independently and MUST NOT inherit the override.
- **FR-010b**: A manual override MUST also govern the document's **indentation profile** (FR-018) — the
  overridden language, not the extension, selects the indentation to apply.
- **FR-010c**: The Editor Panel MUST show a **persistent language indicator** displaying the document's
  **effective language** (detected, overridden, or "Plain Text"). The indicator MUST be **clickable** and
  MUST open the language picker. It MUST appear in **every mirrored view** of a synced panel and MUST update
  immediately when the effective language changes.
- **FR-010d**: The **editor content context menu** MUST additionally offer a **"Set Language…"** item that
  opens the **same** language picker as the indicator (one picker, two entry points).
- **FR-010e**: The language **picker** MUST be **searchable/filterable** across all supported languages,
  MUST indicate the **currently effective language**, and MUST apply the chosen language immediately on
  selection.
- **FR-010f**: The language indicator introduces new UI chrome; its **theme tokens MUST be added to the
  theme-token set**, exposed in the visual **Themes editor**, and covered by the **theme-metadata registry +
  completeness test** required by the constitution (Configuration-editor completeness rule). The indicator
  MUST be legible on every bundled theme.
- **FR-011**: The manual selector MUST offer **plain text / no language** as a choice, which removes
  highlighting for that editor; this choice is itself a persisted override (it MUST NOT be re-detected away)
  and MUST be reflected by the indicator as "Plain Text".

#### Editor content context menu

- **FR-012**: Right-clicking within the **editor content area** MUST present a context menu offering the
  standard text-editing actions: **Cut, Copy, Paste, Select All, Undo, Redo** (at minimum), plus **"Set
  Language…"** (FR-010d). The user MUST be able to complete **cut, copy, and paste entirely via this menu**
  (no keyboard required).
- **FR-013**: The content menu's actions MUST use the **OS clipboard** (so cut/copy/paste interoperate with
  other applications) and MUST act on the current selection/cursor as expected (Paste inserts at the
  cursor/over the selection).
- **FR-014**: The editor **content** context menu MUST be **distinct from** the existing 006 **panel-header**
  right-click menu (Save / Revert / panel actions). The two menus MUST NOT be merged, and neither MUST
  suppress or duplicate the other; right-clicking the content shows editing actions, right-clicking the
  header shows panel actions.

#### Cut line (Ctrl+X)

- **FR-015**: Pressing **Ctrl+X with no active selection** MUST **cut the entire current line** — removing it
  (including its line break) and placing it on the **OS clipboard** as the line's text with a trailing line
  break — with the lines below shifting up.
- **FR-015a**: A line cut per FR-015 MUST additionally be marked as a **full-line clipboard entry**.
  **Pasting** a full-line entry MUST insert it as a **whole line immediately above the caret's line**,
  leaving the text of the caret's line unsplit and intact.
- **FR-015b**: The full-line marker MUST be **invalidated whenever the clipboard content changes from any
  other source** (another application, a selection-copy, or a selection-cut). Content that is not marked
  full-line MUST paste **verbatim at the caret** (over any selection). Pasting a cut line **into another
  application** MUST yield the line's text with a trailing line break.
- **FR-016**: Pressing **Ctrl+X with an active selection** MUST cut **the selection** (the cut-line behaviour
  applies **only** when nothing is selected), and MUST NOT mark the clipboard as a full-line entry.
- **FR-017**: Cut-line MUST behave correctly on the **last line of a file with no trailing newline** — the
  line is cut cleanly without leaving a stray blank line or raising an error.

#### Per-language indentation

- **FR-018**: Indentation MUST be configurable **per language**, keyed by the document's **effective
  language** (file extensions resolve to a language through the language registry of FR-004 — the single
  source of truth — and a manual override replaces that result, per FR-010b). Each profile carries an
  **indentation style** (**tabs** or **spaces**) and, for spaces, an **indent width**.
- **FR-018a**: A **single global indentation default MUST apply to every language unless that language
  overrides it: spaces, width 2.** Documents with **no detected language** (plain text) MUST use the global
  default. **Per-language overrides MUST ship only where the language's established convention differs** from
  the global default (e.g. tabs for Go, 4 spaces for Python).
- **FR-019**: Pressing **Tab** to indent MUST insert the **indentation configured for the current document's
  detected language** — a tab character, or the configured number of spaces.
- **FR-020**: **Automatic indentation** (e.g. the indentation applied when starting a new line inside an
  indented block) MUST follow the **same** per-language tabs-or-spaces style, consistently with FR-019.
- **FR-021**: Changing a language's indentation setting (or the global default) MUST take effect for open
  editors of that language **without reopening** them.
- **FR-022**: The indentation configuration (global default + per-language overrides, and any other new
  configurable options this feature introduces, such as language-detection overrides) MUST be **exposed and
  editable through the application's visual settings editor**, not solely by hand-editing JSON, and MUST be
  covered by the editor-metadata **completeness** discipline required by the constitution
  (Configuration-editor completeness rule). *(See Dependencies.)*

#### Fidelity & isolation (inherited constraints)

- **FR-023**: None of these behaviours (highlighting, content menu, language indicator/picker, cut-line,
  indentation) may compromise the 006 guarantees: text **encoding and line-ending fidelity on save** MUST be
  preserved (highlighting/indentation MUST NOT rewrite untouched lines or change encodings; a line-cut and
  its paste MUST use the document's existing line ending), and per-view editing MUST NOT disturb the
  **single shared buffer** of a cross-window **synced** editor (006 FR-034) or its dirty state.
- **FR-024**: All Part-1 behaviour MUST work identically for **project-owned** and **sub-workspace-owned**
  editors and in **sub-workspace windows**, honouring the active-pane focus model (006) — e.g. Ctrl+X and
  Tab-indent act on the editor only when a Panel (not the file tree) is the active shortcut target.

### Key Entities

- **Language descriptor**: One entry in the extensible language registry — a language's identity/display
  name, its associated file extensions, its indentation profile (where it overrides the global default), and
  the highlighter to apply. Adding a language = adding a descriptor.
- **Language-detection result**: The language chosen for a document, together with how it was decided
  (extension vs content vs manual override), used to select the highlighter **and the indentation profile**
  and to reflect the active language to the user.
- **Manual language override**: A user-chosen language (or "plain text") attached to an **Editor Panel**,
  persisted with that panel's existing editor configuration in the saved layout, outranking detection for
  the lifetime of the panel.
- **Indentation profile**: An indentation configuration — style (tabs/spaces) and, for spaces, width. One
  **global default** (spaces, width 2) applies to every language and to undetected/plain-text documents; a
  profile keyed by **language id** overrides it where a language's convention differs. Both the default and
  the overrides are user-editable.
- **Editor content action set**: The standard text-editing actions surfaced in the content context menu
  (Cut, Copy, Paste, Select All, Undo, Redo) plus **Set Language…**, distinct from the 006 panel-header
  action set.
- **Language indicator**: A persistent, clickable element on the Editor Panel showing the document's
  effective language and opening the language picker. Introduces its own theme tokens.
- **Full-line clipboard entry**: Clipboard content produced by a no-selection Ctrl+X, marked (view-locally)
  as a whole line so that pasting it inserts a line above the caret's line. The marker is invalidated by any
  clipboard change from another source.
- **Language picker**: The searchable list of all supported languages (plus "Plain Text"), marking the
  current language, opened from either the indicator or "Set Language…", and applying the selection
  immediately as a persisted per-panel override.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: **100% of the 23 named language targets** are recognised and highlighted — verified by opening
  a representative fixture file per language and confirming language-appropriate, non-plain-text
  highlighting.
- **SC-002**: A file whose **extension is missing, unrecognised, or misleading** opens as plain text with no
  error, and **one** manual-override action puts it into the correct language — measured as: no document's
  content is ever read to guess its language, and typing content signatures never changes the language.
- **SC-003**: Opening a supported file **at or below** the editor's large-file threshold shows highlighting
  effectively instantly (target: within ~200 ms for typical source files) and typing remains responsive
  (no perceptible added latency), with the UI never hanging.
- **SC-004**: A user can **cut, copy, and paste using only the right-click menu** (no keyboard), and pasted
  content interoperates with other applications via the OS clipboard.
- **SC-004a**: The document's **effective language is visible at all times** on the Editor Panel without
  opening any menu, and the language can be changed from **two** entry points (the indicator and the content
  menu's "Set Language…"), both opening the same searchable picker — reachable in **at most two clicks**.
- **SC-005**: **Ctrl+X with no selection removes the whole current line** in 100% of cases (including the
  last line without a trailing newline); pasting it — **from any caret position, including mid-line** —
  reinserts a complete line above the caret's line without splitting it. **Ctrl+X with a selection cuts only
  the selection**, and clipboard content from any other source pastes verbatim at the caret.
- **SC-006**: Indentation inserted by **Tab matches the detected language's configured style** (tabs vs the
  configured number of spaces) for **100% of the supported languages** — the global default of **2 spaces**
  where a language declares no override — and auto-indentation uses the same style.
- **SC-007**: Syntax highlighting **and the language indicator** are **legible on every bundled theme**
  (light and dark) — no highlight colour is illegible against its theme's editor background — and the
  indicator's theme tokens pass the theme-editor **completeness test** (every token exposed in the Themes
  editor).
- **SC-008**: A file whose language cannot be detected, or that has no supported highlighter, opens as
  **readable plain text with no error** in 100% of cases.
- **SC-009**: A **manual language override** re-highlights the active document immediately, and persists
  across further edits, **across an application restart**, and **across every mirrored view of that panel**,
  until the user changes it — while a separate panel opening the same file still detects independently.

## Assumptions

- **Reuse the existing editor and its language ecosystem.** This feature enhances the **existing Editor
  Panel** (feature 006) rather than introducing a new editor, and is expected to **reuse the editor
  component's own language/highlighting packages and standard editing commands** wherever they exist for the
  listed languages, rather than hand-writing highlighters. The specific packages and the detection
  mechanism are a **planning decision** (the user asked for a suggested approach — see the note to the plan
  phase); the spec requires only the capabilities and the "detect-first, pluggable-highlighter" structure.
- **Extension-only detection**, with the **manual override** as the sole correction path, is the chosen
  detection model (2026-07-09 clarification). Content sniffing was considered and **rejected**: reading and
  pattern-matching document content to guess a language is a performance and correctness risk (especially
  near the 006 large-file threshold) and buys little once a persisted per-panel override exists. Content
  signatures may be revisited as a later enhancement if extension-only detection proves insufficient.
- **Built-in theme-aware highlight style.** Part 1 ships one highlight style that adapts to the active
  theme's light/dark editor colours and is legible on all bundled themes. **Per-syntax-category,
  per-theme-editable colour tokens** (which would extend the Themes editor with ~10–15 new tokens) are a
  **later enhancement**, deliberately deferred to keep Part 1 focused.
- **New theme tokens are limited to the language indicator.** The indicator (FR-010c) is new chrome and
  therefore adds a **small** set of theme tokens (e.g. background / foreground / hover), which — per the
  Configuration-editor completeness rule — must ship with theme-metadata descriptors, Themes-editor exposure,
  and completeness-test coverage. This is the single accepted chrome/theming cost of Part 1.
- **Jupyter `.ipynb` = JSON highlighting**; a rich notebook cell view is out of scope.
- **Mixed-language files** (Vue SFC, HTML with embedded script/style) are **best-effort** — embedded-region
  highlighting where the language definition supports it, otherwise the outer language's highlighting, never
  an error.
- **Indentation defaults**: the **global default is 2 spaces** for every language and for plain text.
  Per-language overrides ship **only** where the language's established community convention differs
  (e.g. tabs for Go, 4 spaces for Python); the concrete override list is a planning decision. Everything is
  user-overridable.
- **No data-schema or daemon change.** Part 1 is renderer-side editor behaviour plus per-language
  configuration; it introduces no new daemon RPC and no SQLite migration.

## Dependencies

- **Feature 006 — Editor Panel** (the editor this feature enhances). The CodeMirror-based Editor Panel, its
  cross-window sync, save/confinement, and large-file open guard are the substrate; Part 1 must preserve
  those guarantees (FR-023/FR-024).
- **Feature 007 — Preferences Editor** (the preferences window, the editor-metadata registry and its
  completeness test). The Configuration-editor completeness rule (constitution v3.11.0) requires this
  feature's new configurable options (the global indentation default, per-language indentation overrides,
  and any detection overrides) to be **exposed through the visual settings editor** and covered by the
  **editor-metadata registry + completeness test**. New settings MUST NOT be shipped as JSON-only.

## Out of Scope

The following editor capabilities the user mentioned are **explicitly deferred** to a later feature — they
depend on **language-server integration** (bundling/running language servers per language and a
language-client protocol) and are a substantially larger undertaking than Part 1:

- **IntelliSense** (code completion / suggestions).
- **Go to Definition.**
- **Find References.**
- **Symbol Rename across the solution.**

Also out of scope for Part 1:

- **Content-based language detection** (shebang / `<?php` / doctype / keyword heuristics). Detection is
  **extension-only**; the manual override covers the gap. Deliberately rejected on performance and
  correctness grounds (2026-07-09 clarification) — revisitable later.
- **Per-syntax-category theme-editable colour tokens** (a Themes-editor extension).
- A **rich Jupyter notebook cell view**.

These are tracked on `ROADMAP.md` under "Rich code editors — language features" so their delivery is
sequenced, not dropped.
