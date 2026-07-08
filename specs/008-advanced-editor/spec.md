# Feature Specification: Advanced Editor — Rich Code Editing (Part 1): Syntax Highlighting, Language Detection & Editing Essentials

**Feature Branch**: `008-advanced-editor`

**Created**: 2026-07-08

**Status**: Draft

**Input**: User description: "Enhancements to the code editor: right-click context menu (copy/cut/paste),
Ctrl+X = cut line, syntax highlighting for all common languages (detect the language first — informed by but
not limited to the file extension — then apply the appropriate highlighter, abstracted so highlighters are
pluggable), tab-or-space indentation per file type, and (later) IntelliSense, go-to-definition,
find-references and symbol rename. If complex, do one at a time — syntax highlighting first."

## Overview

This feature begins **"Rich code editors"** (ROADMAP → *Files & editors*) — layering real code-editing
capability onto the plain-text **Editor Panel** delivered in feature 006. Feature 006 deliberately shipped
the cross-platform editing fundamentals (encoding/line-ending fidelity, confined save, one-buffer-per-file,
recovery, cross-window sync) with **syntax highlighting and language features explicitly deferred**
(006 FR-004). This feature delivers the **first** of those deferred capabilities.

Scope is set by the 2026-07-08 clarification: **Part 1 = syntax highlighting + language detection, plus the
low-cost editing essentials that make the editor feel finished — a content-area right-click menu
(cut/copy/paste), Ctrl+X "cut line", and per-file-type tab/space indentation.** The heavier
language-intelligence features the user also listed — **IntelliSense, Go to Definition, Find References, and
Symbol Rename** — require language-server integration and are a **separate, larger undertaking**; they are
**out of scope here** and tracked as a following increment (see [Out of Scope](#out-of-scope) and
Dependencies).

The headline of Part 1 is **language-aware syntax highlighting** for the common languages the user works in.
Critically, highlighting is driven by a **language-detection step that runs first**: the editor decides
*what language a document is* — informed primarily by the file's **extension** but able to fall back to the
document's **content** — and only then selects the matching **highlighter**. Detection and highlighter
selection are structured as an **extensible language registry** (one descriptor per language) so new
languages can be added without reworking the editor. This is the "detect first, then render" pattern the
user asked for.

The editor being enhanced is the existing Editor Panel component; this feature adds capability to it and does
**not** introduce a second editor. All of Part 1 is renderer-side editor behaviour plus a small amount of
per-file-type configuration; it introduces **no new daemon RPC and no data-schema change**.

## Clarifications

### Session 2026-07-08

- Q: The user listed seven editor enhancements and said "if complex, do one at a time — syntax highlighting
  first." What is the scope of this feature? → A: **Part 1** = **syntax highlighting + language detection**
  **plus** the three low-cost editing essentials (**content right-click menu with cut/copy/paste**,
  **Ctrl+X = cut current line**, **per-file-type tab/space indentation**). The language-server-dependent
  features (**IntelliSense, Go to Definition, Find References, Symbol Rename**) are **deferred** to a later
  feature — they are a much larger undertaking (running/bundling language servers, a language-client
  protocol per language) and are recorded on the roadmap, not built here.
- Q: How is a document's language chosen? → A: **Extension-first with content fallback.** The file
  extension is the primary signal; when the extension is missing, generic, or misleading, a **content
  signature** (e.g. a `#!` shebang, `<?php`, `<!DOCTYPE html>`, distinctive keywords/structure) may be used
  to detect or override the language. A **definitive content signature overrides a mismatched extension**
  (e.g. a shebang'd shell script named `deploy.txt` is treated as Shell).
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

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Language-aware syntax highlighting with automatic detection (Priority: P1)

A user opens a source file in an Editor Panel and its code is **syntax-highlighted** according to the file's
language — keywords, strings, comments, numbers, and other tokens are visually distinguished. The language
is **detected automatically**: the file extension is the primary cue (`.rs` → Rust, `.py` → Python, `.tsx`
→ TypeScript, and so on across all supported languages), and when the extension is absent or misleading the
editor falls back to the document's **content** (a `#!/bin/bash` shebang, a leading `<?php`, an
`<!DOCTYPE html>`, etc.). Highlighting updates **live** as the user types. If no language can be confidently
determined, the file simply shows as **plain text** — never an error.

**Why this priority**: Syntax highlighting is the feature the user explicitly prioritised ("syntax highlight
first") and the headline of "Rich code editors". Every other Part-1 story is a small editing-nicety that the
editor is usable without; highlighting is the reason for the feature.

**Independent Test**: Open one file per supported language (correct extension) and confirm each is highlighted
in a way distinct from plain text and appropriate to that language. Open a file whose extension does not match
its content (e.g. a shell script saved as `.txt`, or an extension-less file with a `#!` shebang) and confirm
the correct language is detected from content. Type new code into a highlighted file and confirm the new text
is highlighted live. Open a file of an unrecognised type and confirm it renders as readable plain text with no
error.

**Acceptance Scenarios**:

1. **Given** a file with a recognised extension for any supported language, **When** it is opened in an
   Editor Panel, **Then** its content is highlighted using the highlighter for that language.
2. **Given** a file whose extension is missing or does not match its content but whose content carries a
   recognised signature (shebang, `<?php`, doctype, etc.), **When** it is opened, **Then** the language is
   detected from content and the correct highlighter is applied.
3. **Given** a file with a definitive content signature that contradicts a generic/misleading extension,
   **When** it is opened, **Then** the content signature wins (the extension does not force a wrong
   language).
4. **Given** a highlighted document, **When** the user types additional code, **Then** the new text is
   highlighted live without reopening the file.
5. **Given** a file whose language cannot be confidently determined (no matching extension or content
   signature), **When** it is opened, **Then** it renders as readable plain text with no error and no broken
   highlighting.
6. **Given** any bundled theme (light or dark), **When** a highlighted file is shown, **Then** the
   highlighting is legible against that theme's editor colours.

---

### User Story 2 - Right-click editing menu in the editor (Priority: P2)

A user right-clicks inside the editor's text area and gets a **context menu** of the standard text-editing
actions — **Cut**, **Copy**, **Paste**, **Select All**, **Undo**, **Redo** — and can perform copy/cut/paste
entirely with the mouse, without touching the keyboard. This menu is on the **editor content** and is
distinct from the existing 006 **panel-header** menu (Save / Revert), which is unchanged.

**Why this priority**: A missing right-click menu on the text area is an obvious usability gap the user
called out, and it is cheap to provide. It is not required for the highlighting MVP, so it is P2.

**Independent Test**: Select some text, right-click, and confirm Cut/Copy/Paste/Select All/Undo/Redo are
offered. Using only the mouse: copy a selection and paste it elsewhere; cut a selection and paste it; Select
All then Copy. Confirm the actions honour the OS clipboard and interoperate with other applications. Confirm
right-clicking the panel **header** still shows the 006 Save/Revert menu (not the editing menu) and vice
versa.

**Acceptance Scenarios**:

1. **Given** the editor content area, **When** the user right-clicks, **Then** a context menu appears
   offering at least Cut, Copy, Paste, Select All, Undo, and Redo.
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
selected**, the editor **cuts the entire current line** (removing it and placing it on the clipboard so a
paste reinserts a whole line). With a selection active, Ctrl+X cuts the selection as usual.

**Why this priority**: A specific, small productivity behaviour the user asked for; valuable muscle-memory
parity with other editors, but independent of and secondary to highlighting.

**Independent Test**: Place the cursor on a line without selecting anything and press Ctrl+X; confirm the
whole line (including its line break) is removed and the surrounding lines close up. Paste and confirm a full
line is reinserted. Make a selection and press Ctrl+X; confirm only the selection is cut (line-cut does not
override selection-cut). Test on the last line of a file with no trailing newline.

**Acceptance Scenarios**:

1. **Given** the cursor is on a line with **no selection**, **When** the user presses Ctrl+X, **Then** the
   entire current line is removed and copied to the clipboard, and the lines below shift up.
2. **Given** a line was cut with Ctrl+X, **When** the user pastes, **Then** a complete line (with its line
   break) is reinserted.
3. **Given** an **active selection**, **When** the user presses Ctrl+X, **Then** only the selection is cut
   (the cut-line behaviour applies only when nothing is selected).
4. **Given** the cursor is on the **last line** with no trailing newline, **When** the user presses Ctrl+X,
   **Then** the line is cut cleanly without leaving a stray blank line or error.

---

### User Story 4 - Per-file-type tab/space indentation (Priority: P2)

Indentation follows a **per-file-type** convention. Each file type (by extension) has a configured
**indentation style** — **tabs** or **spaces** — and, for spaces, a **width**. Sensible defaults ship per
language (e.g. tabs for Go, spaces for Python/JavaScript), and the user can change them. Pressing **Tab**
inserts the configured indentation for the current file's type, and automatic indentation (e.g. on a new
line) follows the same setting.

**Why this priority**: Correct per-language indentation is expected of a real code editor and is
low-cost given the editor already exists; but the editor is usable without it, so P2.

**Independent Test**: Open a Go file and press Tab; confirm a tab character is inserted. Open a Python file
and press Tab; confirm the configured number of spaces is inserted. Change the setting for a file type and
confirm open editors of that type reflect the change. Add a new line inside an indented block and confirm
the auto-indent uses the same tabs-or-spaces style.

**Acceptance Scenarios**:

1. **Given** a file whose type defaults to tabs, **When** the user presses Tab, **Then** a tab character is
   inserted at the cursor.
2. **Given** a file whose type defaults to N-space indentation, **When** the user presses Tab, **Then** N
   spaces are inserted.
3. **Given** the user changes the indentation style/width for a file type, **When** the change is applied,
   **Then** subsequent indentation in editors of that type uses the new setting (open editors reflect it
   without reopening).
4. **Given** the user starts a new line inside an indented block, **When** the editor auto-indents, **Then**
   it uses the file type's configured tabs-or-spaces style consistently.

---

### User Story 5 - Correct a wrong language guess (Priority: P3)

When automatic detection picks the wrong language (or the user simply wants a different highlighter), the
user can **manually set the language** for the active editor. The chosen language applies **immediately**
(re-highlighting the document) and stays in effect for that editor.

**Why this priority**: A safety valve for imperfect detection and ambiguous/extension-less files; genuinely
useful but only reachable once detection + highlighting (US1) exist, so P3.

**Independent Test**: Open an extension-less or misdetected file, invoke the manual language selector, choose
a language, and confirm the document is re-highlighted in that language immediately and stays that way while
editing.

**Acceptance Scenarios**:

1. **Given** an open editor, **When** the user manually selects a language, **Then** the document is
   re-highlighted using that language's highlighter immediately.
2. **Given** a manual language override is in effect, **When** the user continues editing, **Then** the
   override persists (automatic detection does not silently revert it).
3. **Given** a manual override, **When** the user selects "plain text" / "no language", **Then**
   highlighting is removed and the document shows as plain text.

---

### Edge Cases

- **Unsupported / undetectable language**: A file whose language matches no supported highlighter MUST show
  as readable plain text (US1 AS5) — never an error, blank view, or broken partial highlighting.
- **Misleading extension**: A definitive content signature (shebang, `<?php`, doctype) MUST override a
  generic or wrong extension; a recognised extension is otherwise authoritative (US1 AS3).
- **New / untitled document (no path, no extension)**: Shows as plain text until it gains a detectable
  identity (saved with an extension, a recognised content signature appears, or a manual override is set).
- **Very large file (at the 006 open threshold)**: A file at or below the editor's large-file threshold
  (006 FR-062) MUST open and highlight responsively; highlighting MUST NOT hang the UI or add perceptible
  typing latency. (Files above the threshold are already refused by 006.)
- **Binary / non-text file**: Already blocked by 006 ("cannot open as text"); highlighting does not apply.
- **Mixed-language files (e.g. Vue single-file components, HTML with embedded script/style)**: Embedded
  regions SHOULD be highlighted where the language definition supports it; where it does not, the outer
  language's highlighting is acceptable (best-effort, no error).
- **Jupyter Notebook (`.ipynb`)**: Highlighted as raw JSON (its on-disk form); a rich cell view is out of
  scope.
- **Ctrl+X on the last line without a trailing newline**: The line MUST be cut cleanly (US3 AS4) without a
  stray blank line or error.
- **Right-click menus not colliding**: The editor **content** menu (editing actions) and the 006 **panel
  header** menu (Save/Revert) MUST remain separate (US2 AS5).
- **Indentation setting changed while editors are open**: Editors of the affected file type MUST pick up the
  new indentation style without needing to be reopened (US4 AS3).
- **Cross-window synced editor (006 mirror)**: Highlighting, the content menu, cut-line, and indentation
  MUST work in every mirrored view; they are per-view editing behaviours and MUST NOT disturb the single
  shared buffer or its dirty state (006 FR-034).

## Requirements *(mandatory)*

### Functional Requirements

#### Language detection & the language registry

- **FR-001**: The editor MUST provide **syntax highlighting** for each of these languages: **C#, C, C++,
  Rust, Go, Python, JavaScript, TypeScript, Java, Kotlin, Swift, Dart, PHP, Ruby, Lua, PowerShell, Shell
  (POSIX/Bash), HTML, CSS, SASS/SCSS, LESS, Vue (single-file components), and Jupyter Notebook (as JSON)** —
  23 language targets in total.
- **FR-002**: The system MUST determine a document's **language before selecting a highlighter** (detect
  first, then render). Detection MUST be **informed primarily by the file extension** and MUST be able to
  **fall back to the document's content** (e.g. a `#!` shebang, a leading `<?php`, an `<!DOCTYPE html>`, or
  other recognised structural/keyword signatures) so a file with a missing, generic, or misleading extension
  is still highlighted correctly where its content is recognisable.
- **FR-003**: A **definitive content signature MUST override a mismatched extension** (e.g. a shebang'd
  shell script named with a non-shell extension is treated as Shell); where no such signature is present, a
  recognised extension is authoritative.
- **FR-004**: Detection and highlighter selection MUST be structured as an **extensible language registry** —
  a single authoritative source with **one descriptor per supported language** (its identity/display name,
  associated file extensions, content-detection signatures, and the highlighter to apply) — so **new
  languages can be added by adding a descriptor**, without modifying the editor's core logic (open/closed;
  reuse of the existing editor component's language ecosystem is expected — see Assumptions).
- **FR-005**: The editor MUST apply the highlighter matched to the detected language, and MUST **fall back to
  plain, unhighlighted text** — never an error or corrupted rendering — when no language is confidently
  detected or no highlighter exists for the detected language.
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
  chosen language MUST apply **immediately** (the document is re-highlighted) and MUST **persist for that
  editor** — automatic detection MUST NOT silently revert a manual override.
- **FR-011**: The manual selector MUST offer **plain text / no language** as a choice, which removes
  highlighting for that editor.

#### Editor content context menu

- **FR-012**: Right-clicking within the **editor content area** MUST present a context menu offering the
  standard text-editing actions: **Cut, Copy, Paste, Select All, Undo, Redo** (at minimum). The user MUST be
  able to complete **cut, copy, and paste entirely via this menu** (no keyboard required).
- **FR-013**: The content menu's actions MUST use the **OS clipboard** (so cut/copy/paste interoperate with
  other applications) and MUST act on the current selection/cursor as expected (Paste inserts at the
  cursor/over the selection).
- **FR-014**: The editor **content** context menu MUST be **distinct from** the existing 006 **panel-header**
  right-click menu (Save / Revert / panel actions). The two menus MUST NOT be merged, and neither MUST
  suppress or duplicate the other; right-clicking the content shows editing actions, right-clicking the
  header shows panel actions.

#### Cut line (Ctrl+X)

- **FR-015**: Pressing **Ctrl+X with no active selection** MUST **cut the entire current line** — removing it
  (including its line break) and placing it on the clipboard so that a subsequent paste reinserts a complete
  line — with the lines below shifting up.
- **FR-016**: Pressing **Ctrl+X with an active selection** MUST cut **the selection** (the cut-line behaviour
  applies **only** when nothing is selected).
- **FR-017**: Cut-line MUST behave correctly on the **last line of a file with no trailing newline** — the
  line is cut cleanly without leaving a stray blank line or raising an error.

#### Per-file-type indentation

- **FR-018**: Indentation MUST be configurable **per file type (by extension)**: an **indentation style**
  (**tabs** or **spaces**) and, for spaces, an **indent width**. **Sensible per-language defaults MUST
  ship** (e.g. tabs for Go, spaces with a conventional width for Python and JavaScript/TypeScript).
- **FR-019**: Pressing **Tab** to indent MUST insert the **configured indentation for the current file's
  type** — a tab character, or the configured number of spaces.
- **FR-020**: **Automatic indentation** (e.g. the indentation applied when starting a new line inside an
  indented block) MUST follow the **same** per-file-type tabs-or-spaces style, consistently with FR-019.
- **FR-021**: Changing a file type's indentation setting MUST take effect for editors of that type **without
  reopening** them.
- **FR-022**: The per-file-type indentation configuration (and any other new configurable options this
  feature introduces, such as language-detection overrides) MUST be **exposed and editable through the
  application's visual settings editor**, not solely by hand-editing JSON, and MUST be covered by the
  editor-metadata **completeness** discipline required by the constitution (Configuration-editor
  completeness rule). *(See Dependencies — this relies on the preferences/settings-editor infrastructure.)*

#### Fidelity & isolation (inherited constraints)

- **FR-023**: None of these editing behaviours (highlighting, content menu, cut-line, indentation) may
  compromise the 006 guarantees: text **encoding and line-ending fidelity on save** MUST be preserved
  (highlighting/indentation MUST NOT rewrite untouched lines or change encodings), and per-view editing MUST
  NOT disturb the **single shared buffer** of a cross-window **synced** editor (006 FR-034) or its dirty
  state.
- **FR-024**: All Part-1 behaviour MUST work identically for **project-owned** and **sub-workspace-owned**
  editors and in **sub-workspace windows**, honouring the active-pane focus model (006) — e.g. Ctrl+X and
  Tab-indent act on the editor only when a Panel (not the file tree) is the active shortcut target.

### Key Entities

- **Language descriptor**: One entry in the extensible language registry — a language's identity/display
  name, its associated file extensions, its content-detection signature(s), and the highlighter to apply.
  Adding a language = adding a descriptor.
- **Language-detection result**: The language chosen for a document, together with how it was decided
  (extension vs content vs manual override), used to select the highlighter and to reflect the active
  language to the user.
- **Indentation profile**: The per-file-type indentation configuration — style (tabs/spaces) and, for
  spaces, width — with shipped per-language defaults and user overrides.
- **Editor content action set**: The standard text-editing actions surfaced in the content context menu
  (Cut, Copy, Paste, Select All, Undo, Redo), distinct from the 006 panel-header action set.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: **100% of the 23 named language targets** are recognised and highlighted — verified by opening
  a representative fixture file per language and confirming language-appropriate, non-plain-text
  highlighting.
- **SC-002**: A file whose **extension is missing or misleading but whose content carries a recognised
  signature** (e.g. a `#!` shebang, `<?php`, a doctype) is highlighted in the **correct** language for those
  recognised content cases.
- **SC-003**: Opening a supported file **at or below** the editor's large-file threshold shows highlighting
  effectively instantly (target: within ~200 ms for typical source files) and typing remains responsive
  (no perceptible added latency), with the UI never hanging.
- **SC-004**: A user can **cut, copy, and paste using only the right-click menu** (no keyboard), and pasted
  content interoperates with other applications via the OS clipboard.
- **SC-005**: **Ctrl+X with no selection removes the whole current line** in 100% of cases (including the
  last line without a trailing newline), and a subsequent paste reinserts a complete line; **Ctrl+X with a
  selection cuts only the selection**.
- **SC-006**: Indentation inserted by **Tab matches the file type's configured style** (tabs vs the
  configured number of spaces) for **100% of configured file types**, and auto-indentation uses the same
  style.
- **SC-007**: Syntax highlighting is **legible on every bundled theme** (light and dark) — no
  highlight colour is illegible against its theme's editor background.
- **SC-008**: A file whose language cannot be detected, or that has no supported highlighter, opens as
  **readable plain text with no error** in 100% of cases.
- **SC-009**: A **manual language override** re-highlights the active document immediately and persists
  across further edits until the user changes it.

## Assumptions

- **Reuse the existing editor and its language ecosystem.** This feature enhances the **existing Editor
  Panel** (feature 006) rather than introducing a new editor, and is expected to **reuse the editor
  component's own language/highlighting packages and standard editing commands** wherever they exist for the
  listed languages, rather than hand-writing highlighters. The specific packages and the detection
  mechanism are a **planning decision** (the user asked for a suggested approach — see the note to the plan
  phase); the spec requires only the capabilities and the "detect-first, pluggable-highlighter" structure.
- **Extension-first detection with content fallback**, and a **manual override** as the correction path, are
  the chosen detection model (2026-07-08 clarification).
- **Built-in theme-aware highlight style.** Part 1 ships one highlight style that adapts to the active
  theme's light/dark editor colours and is legible on all bundled themes. **Per-syntax-category,
  per-theme-editable colour tokens** (which would extend the Themes editor and the theme-token set) are a
  **later enhancement**, deliberately deferred to keep Part 1 focused.
- **Jupyter `.ipynb` = JSON highlighting**; a rich notebook cell view is out of scope.
- **Mixed-language files** (Vue SFC, HTML with embedded script/style) are **best-effort** — embedded-region
  highlighting where the language definition supports it, otherwise the outer language's highlighting, never
  an error.
- **Per-language indentation defaults** follow widely accepted community conventions (e.g. tabs for Go,
  4 spaces for Python, 2 spaces for JavaScript/TypeScript/CSS) and are user-overridable.
- **No data-schema or daemon change.** Part 1 is renderer-side editor behaviour plus per-file-type
  configuration; it introduces no new daemon RPC and no SQLite migration.

## Dependencies

- **Feature 006 — Editor Panel** (the editor this feature enhances). The CodeMirror-based Editor Panel, its
  cross-window sync, save/confinement, and large-file open guard are the substrate; Part 1 must preserve
  those guarantees (FR-023/FR-024).
- **Preferences / settings-editor infrastructure** (feature 007 — Preferences Editor). The
  Configuration-editor completeness rule (constitution v3.11.0) requires new configurable options
  (per-file-type indentation, any detection overrides) to be exposed through the **visual settings editor**
  and covered by the **editor-metadata registry + completeness test**. **Branch note:** this feature branches
  from `master`, which does **not** yet contain feature 007's preferences window / editor-metadata registry;
  the plan MUST reconcile this — either the settings-editor infrastructure is present at integration time, or
  the new options are added following the established registry pattern so completeness holds once the two
  features are integrated. New settings MUST NOT be shipped as JSON-only.

## Out of Scope

The following editor capabilities the user mentioned are **explicitly deferred** to a later feature — they
depend on **language-server integration** (bundling/running language servers per language and a
language-client protocol) and are a substantially larger undertaking than Part 1:

- **IntelliSense** (code completion / suggestions).
- **Go to Definition.**
- **Find References.**
- **Symbol Rename across the solution.**

Also out of scope for Part 1: **per-syntax-category theme-editable colour tokens** (a Themes-editor
extension), and a **rich Jupyter notebook cell view**. These are tracked on `ROADMAP.md` under "Rich code
editors — language features" so their delivery is sequenced, not dropped.
