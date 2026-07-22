# Feature Specification: v1.0.0 Tweaks & Enhancements

**Feature Branch**: `feature/S023-v1-tweaks`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Pull all \"Tweaks\" for the v1.0.0 milestone, then create a new worktree and create a single spec for all the tweaks."

**Source issues**: #125, #126, #139, #140, #158 (v1.0.0 `tweak`s) and #137, #141, #154, #156, #89 (v1.0.0 `enhancement`s).

## Overview

This feature bundles the remaining v1.0.0 backlog into one spec: five small **Tweaks** (US1–US5 — polish that adds no new capability) and five **Enhancements** (US6–US10 — new, user-visible capability). Each user story is **independently shippable**; the single spec exists to plan and track them together, not to force them into one PR.

| Story | Issue | Type | Area | One-liner |
|-------|-------|------|------|-----------|
| US1 | #125 | tweak | context menus | Show a command's keyboard shortcut in brackets next to the menu label |
| US2 | #140 | tweak | file explorer | Double-clicking a directory in Single select mode toggles it |
| US3 | #126 | tweak | context menus | Give context-menu items their icons wherever a token exists |
| US4 | #139 | tweak | About dialog | Load the third-party packages list asynchronously |
| US5 | #158 | tweak | file explorer | "Open in OS Explorer" first in the "Open In" submenu |
| US6 | #137 | enhancement | editor/explorer | Editor title menu: "Reveal File" (in-app tree) + "Open in OS Explorer" |
| US7 | #141 | enhancement | editor/prefs | Preference: default file-open target — Last Active Editor vs New Editor |
| US8 | #154 | enhancement | editor/prefs | Preference: "Save Document Scroll Position" (scroll scoped per document) |
| US9 | #156 | enhancement | file explorer | "Copy Path" submenu (absolute/relative × Windows/Linux slashes) |
| US10 | #89 | enhancement | terminal | Show the terminal's live window title in its header |

US11–US13 (#152, #155, #85) were descoped to **spec 024** (`feature/S024-editor-terminal-enhancements`).

The Tweaks (US1–US5) carry a **no behaviour regressions** constraint. The Enhancements (US6–US10) add capability and each obeys the constitution's cross-cutting rules — the platform seam for OS reveals (Principle II), one-document-one-state (#68), and the scope-based keybinding dispatch — called out per story below.

## Clarifications

### Session 2026-07-22

- Q: US2 (#140) — when double-clicking a directory row in Single select mode, what should "open" the directory do? → A: Toggle its expansion **in place** — expand the folder's children in the tree if collapsed, collapse it if already expanded (the standard file-tree gesture, mirroring the chevron). It does **not** drill in / re-root the tree.
- Q: Do US1 (shortcuts) and US3 (icons) cover the **cog dropdown menu** (Settings / Key Bindings / Themes / About), or only right-click context menus? → A: **Include the cog dropdown.** Every menu built on the shared `MenuItem`/`ContextMenu` component is in scope — icons for all such menus (US3), and shortcut brackets for any cog item whose command has a bound shortcut (US1).
- Q: US5 (#158) — where does "Open in OS Explorer" go when a row has no editor "Open In" targets (folders / target-less files)? → A: **Always route it through the one "Open In" submenu** (reuse the same submenu as the container). Where editor targets exist (files) they appear beneath; where they don't (folders), the submenu simply omits them and contains just "Open in OS Explorer". The previous top-level "Open in OS File Explorer" row is relocated into this submenu.
- Q: US13 (#85) — is **rename** (and **delete**) undo/redo in scope alongside **move**? → A: **Yes to both.** US13's undo/redo covers **move, rename, and delete**. Delete-undo **restores** the removed item — from the **OS recycle bin**, through the file-system seam — under the same validate-before-apply rule; if the content can no longer be recovered, the undo is **refused with an explanation** and changes nothing. Issue #85 updated to match. (moved to spec 024)
- Q: US13 (#85) — where does a deleted item come back from on undo — OS recycle bin or an app-managed staging area? → A: The **OS recycle bin**, via the platform seam. Tree deletes route to the system trash; undo restores from it by original path (the seam keeps macOS/Linux trash open later). If the item is no longer in the recycle bin, the undo is refused with an explanation. (moved to spec 024)

### Session 2026-07-22 (second pass)

- Q: US11 (#152) — default word-wrap state for a new editor/terminal instance? → A: Default **On**, via **two separate persisted preferences** — an **"Editor default word wrap"** and a **"Terminal default word wrap"**, each defaulting to **On**. A new instance starts at its type's preference; the per-instance status-bar toggle overrides it for **that instance only** (in-memory, not persisted). This **supersedes** #152's original "per-instance only, no preference" note. (moved to spec 024)
- Q: US10 (#89) — how does the live terminal title coexist with the panel's own name in the header? → A: The reported title **replaces** the name when present; when the title is empty the header shows the **panel name** (a single label, title-led). Matches FR-033.
- Q: US6 (#137) — one editor-title "Open in OS Explorer" item, or two? → A: **Two**, but reinterpreted: **(1) "Reveal File"** reveals the open file in throng's **in-app Files & Folders view** (expand ancestors + select/scroll to it in the explorer tree) — **not** the OS Explorer; **(2) "Open in OS Explorer"** opens the **OS** file manager at the file's folder (via the platform seam). Issue #137 updated to reflect the in-app-reveal vs OS-reveal split.
- Q: US5/US9 — where do the "Open In" and "Copy Path" submenus sit in the Files & Folders menu? → A: **Adjacent, "Open In" above "Copy Path", grouped near the bottom** (after the file operations). More broadly: **context menus SHOULD be organised into sensible, visually-separated SECTION GROUPS** (e.g. clipboard ops / creation / location actions), which requires the shared `ContextMenu` to support **section separators**. This is a **cross-cutting menu-structure requirement** spanning US1/US3/US5/US9 (see FR-018a) and may warrant its own tracking issue.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keyboard shortcuts shown on context-menu items (Priority: P1)

A user right-clicks in the app (a tab, a panel handle, the explorer tree, a terminal) and sees, next to each menu label whose command has a keyboard shortcut, that shortcut rendered in brackets — e.g. `Copy (Ctrl+C)`. They learn the binding without opening the keybindings editor.

**Why this priority**: Highest-value polish of the four — it improves discoverability of every bound command across the whole app, and the change is maintainer-agreed (issue #125) so it is ready to proceed.

**Independent Test**: Open any context menu that contains at least one item whose command has a bound shortcut; confirm the bracketed shortcut appears, reflects the live keybinding configuration, and that items without a binding are unchanged.

**Acceptance Scenarios**:

1. **Given** a context-menu item whose command has one bound shortcut, **When** the menu opens, **Then** the item shows that shortcut in brackets after its label (e.g. `Copy (Ctrl+C)`), in text smaller than the label.
2. **Given** a command with more than one binding, **When** its menu item renders, **Then** only the **first** binding is shown.
3. **Given** a menu item whose command has no bound shortcut, **When** the menu opens, **Then** the item renders exactly as before — no trailing brackets and no layout shift relative to today.
4. **Given** the user has changed a keybinding, **When** the corresponding menu item next renders, **Then** the bracketed shortcut reflects the new binding (never a hard-coded string).

---

### User Story 2 - Double-click a directory to open it in Single select mode (Priority: P2)

In the Files & Folders tree with selection mode set to **Single**, a user double-clicks a directory row and that directory toggles its expansion in place — its children reveal if it was collapsed, and hide if it was already expanded — mirroring how double-clicking a file already opens it. The two gestures become consistent: double-click means "open", whatever the row's kind (for a folder, "open" is the standard tree expand/collapse toggle, not a drill-in that re-roots the tree).

**Why this priority**: Directly fixes an interaction inconsistency users hit routinely while navigating; small, self-contained, and testable in isolation.

**Independent Test**: In Single select mode, double-click a directory row and confirm it opens; double-click a file and confirm it still opens; single-click either and confirm it only selects.

**Acceptance Scenarios**:

1. **Given** Single select mode and a **collapsed** directory row, **When** the user double-clicks it, **Then** the directory expands (its children reveal).
2. **Given** Single select mode and an **already-expanded** directory row, **When** the user double-clicks it, **Then** the directory collapses (its children hide).
3. **Given** Single select mode, **When** the user double-clicks a file row, **Then** the file opens with its default action, exactly as today.
4. **Given** Single select mode, **When** the user single-clicks any row, **Then** the row is selected only — it does not open/toggle.
5. **Given** any selection mode other than Single, **When** the user interacts with the tree, **Then** behaviour is unchanged from today.

---

### User Story 3 - Icons on context-menu items (Priority: P3)

A user opening any context menu sees an icon next to each action that maps to a known icon token — consistent with surfaces (e.g. the terminal menu) that already show `copy`/`paste` glyphs — instead of a text-only row.

**Why this priority**: Visual consistency polish across many call sites; valuable but lower urgency than the interaction and discoverability fixes, and partly bounded by which icon tokens already exist (icon-token expansion is tracked separately under issue #127).

**Independent Test**: Open each context menu (panel handle, tab, explorer tree, terminal, etc.) and confirm that every action mapping to an existing icon token shows its icon, resolved through the active theme, and that iconless items stay cleanly aligned.

**Acceptance Scenarios**:

1. **Given** a context-menu action that maps to an existing icon token, **When** the menu opens, **Then** the action renders with its icon.
2. **Given** the active theme, **When** an icon renders, **Then** it resolves through the theme's icon tokens (no hard-coded assets) and, if a token is missing, the label still renders intact — never an empty gap or an error.
3. **Given** a menu that mixes icon and legitimately-iconless items, **When** it opens, **Then** spacing/alignment is unchanged for the iconless items (no ragged indentation).
4. **Given** an action for which no suitable token yet exists, **When** the audit is done, **Then** that gap is recorded for the separate icon-token work rather than blocking this change.

---

### User Story 4 - Asynchronous third-party list in the About dialog (Priority: P4)

A user opens "About throng" and the dialog paints immediately with its static content (name, version, etc.); the third-party / open-source packages list loads afterwards, showing a lightweight loading affordance until it populates in place. If the user closes the dialog before the list finishes, the in-flight load is cancelled.

**Why this priority**: Perceived-performance polish with no correctness impact — the dialog already shows the right information; it is simply slower to appear than it should be.

**Independent Test**: Open "About throng" and confirm static content paints without waiting for the list; observe the loading affordance then the populated list; close the dialog mid-load and confirm the load is cancelled and no orphaned work continues; confirm the list content, once loaded, is identical to today's.

**Acceptance Scenarios**:

1. **Given** the About dialog is opened, **When** it appears, **Then** its static content is painted without waiting for the third-party packages list.
2. **Given** the dialog is open and the list is still loading, **When** the load is in progress, **Then** a loading indicator is shown in the list's place.
3. **Given** the list resolves, **When** it is ready, **Then** it populates in place and its content is unchanged from today's list.
4. **Given** the dialog is open and the list has not yet resolved, **When** the user closes the dialog, **Then** the in-flight load is cancelled (no orphaned work continues).

---

### User Story 5 - "Open in OS Explorer" first in the "Open In" submenu (Priority: P5)

In the Files & Folders context menu, the existing **"Open in OS Explorer"** action becomes the **first** item of the **"Open In" submenu**, so the OS-Explorer option leads that submenu. The action itself is unchanged; only its position changes.

**Why this priority**: Pure ordering polish — the smallest of the five, self-contained, and lowest risk.

**Independent Test**: Open the Files & Folders context menu for a file and open the "Open In" submenu → "Open in OS Explorer" is the first entry; invoking it still reveals the item in the OS file explorer; no other item is added, removed, or reordered.

**Acceptance Scenarios**:

1. **Given** the Files & Folders context menu's "Open In" submenu, **When** it opens, **Then** "Open in OS Explorer" is its **first** item.
2. **Given** the repositioned item, **When** the user invokes it, **Then** it opens the target in the OS file explorer exactly as today.
3. **Given** the rest of the submenu (and the menu), **When** US5 lands, **Then** no other item is added, removed, or reordered beyond moving this one to the top.

---

### User Story 6 - Reveal File / Open in OS Explorer from the editor title menu (#137, Priority: P6)

The editor panel's **title (tab) right-click menu** gains **two** actions for the open file: **(1) "Reveal File"** — reveal it in throng's **in-app Files & Folders view** (expand the ancestors and select/scroll to it in the explorer tree; **not** the OS file manager); **(2) "Open in OS Explorer"** — open the **host OS file manager** at the file's folder, the file selected where the OS supports it. The OS action goes through the platform-abstraction seam (Principle II), never a hard-coded Windows call in shared code.

**Why this priority**: Small, self-contained editor affordance — one in-app navigation, one OS reveal — with high day-to-day value.

**Independent Test**: Right-click an editor tab backed by a saved file that belongs to an open project → the menu offers "Reveal File" and "Open in OS Explorer"; "Reveal File" selects the file in the Files & Folders tree; "Open in OS Explorer" opens the OS file manager at its folder; an unsaved buffer's panel offers neither.

**Acceptance Scenarios**:

1. **Given** an editor panel backed by an on-disk file, **When** its title menu opens, **Then** it shows **"Reveal File"** and **"Open in OS Explorer"**.
2. **Given** the file belongs to a project loaded in the explorer, **When** "Reveal File" is invoked, **Then** the Files & Folders view expands to the file and selects it (in-app; no OS window opens).
3. **Given** "Open in OS Explorer" is invoked, **When** it runs, **Then** the host OS file manager opens at the file's folder, the file selected where the OS supports it, via the platform seam.
4. **Given** a panel with no on-disk file (unsaved buffer), **When** its title menu opens, **Then** both actions are unavailable.

---

### User Story 7 - Default file-open target preference (#141, Priority: P7)

A preference sets where an opened file lands: **Last Active Editor** (default — reuse the most recently active editor panel) or **New Editor** (a fresh editor panel each time). Applies to the standard open paths (file tree, double-click). Reusing an already-open document MUST NOT create a second independent state for it (one-document-one-state, #68).

**Why this priority**: A frequently-requested control over a fixed behaviour; small settings + open-dispatch change.

**Independent Test**: Set "New Editor" → each opened file makes a new panel; set "Last Active Editor" → opens reuse the last active editor; opening an already-open document does not duplicate its state.

**Acceptance Scenarios**:

1. **Given** the preference, **When** the settings load, **Then** it offers "Last Active Editor" and "New Editor", defaulting to **Last Active Editor**.
2. **Given** "Last Active Editor", **When** a file is opened, **Then** it opens in the most recently active editor panel (reused).
3. **Given** "New Editor", **When** a file is opened, **Then** a new editor panel is created each time.
4. **Given** a document already open, **When** it is opened again, **Then** one-document-one-state is not violated.

---

### User Story 8 - "Save Document Scroll Position" preference (#154, Priority: P8)

A preference **"Save Document Scroll Position"** (default **No**) controls **in-place** file switching within one editor. Off: opening a different file in place resets scroll to the top, and reopening a previously-scrolled file in place also starts at the top. On: a document remembers its own scroll and restores it when reopened in place. This does **not** change #144's tab/project/panel-switch restore (which keeps each open editor's scroll/caret/active state).

**Why this priority**: Fixes a real annoyance (scroll carrying across in-place opens) with a small, opt-in preference; scoped to the document.

**Independent Test**: With Off, scroll file1 then open file2 in place → file2 at top; reopen file1 in place → top. With On, reopen file1 in place → restored. Tab/project switch still restores each editor (#144), regardless of this setting.

**Acceptance Scenarios**:

1. **Given** the preference, **When** settings load, **Then** it exists and defaults to **No**.
2. **Given** Off, **When** a different file opens in place, **Then** the new file scrolls to the top.
3. **Given** Off, **When** a previously-scrolled file reopens in place, **Then** it starts at the top (scroll not remembered).
4. **Given** On, **When** a previously-scrolled file reopens in place, **Then** its scroll position is restored.
5. **Given** either setting, **When** the user switches tabs/projects/panels, **Then** each open editor's scroll, caret, and active state still restore (unchanged from #144).

---

### User Story 9 - "Copy Path" submenu (#156, Priority: P9)

The Files & Folders context menu gains a **"Copy Path" submenu** for **every item** (files and folders) offering the path in each combination of absolute/relative × slash style: **Absolute Windows (\\)**, **Absolute Linux (/)**, **Relative Windows (\\)**, **Relative Linux (/)**. Relative is relative to the project root; each entry copies plain text to the system clipboard.

**Why this priority**: Common need (paste a path into WSL, a shell, a config), grouped to avoid top-level clutter.

**Independent Test**: Right-click a file → Copy Path → each of the four entries copies the correct path form; repeat for a folder; relative forms are correct against the project root.

**Acceptance Scenarios**:

1. **Given** the Files & Folders menu for a file **or** a folder, **When** it opens, **Then** it shows a "Copy Path" submenu.
2. **Given** the submenu, **When** it opens, **Then** it offers Absolute Windows (\\), Absolute Linux (/), Relative Windows (\\), and Relative Linux (/).
3. **Given** any entry, **When** invoked, **Then** the correct path form for the clicked item is placed on the clipboard as plain text.
4. **Given** the relative entries, **When** invoked, **Then** the path is correct relative to the project root.

---

### User Story 10 - Terminal window title in the header (#89, Priority: P10)

The terminal panel header reflects the **live window title** the terminal reports via OSC 0/2 (`xterm onTitleChange`), updating as the shell/program changes it (cwd, running command, ssh host, `vim` filename). It coexists with the panel's own name — show the reported title when present, fall back to the panel name when empty. The title is **untrusted PTY output**: rendered as text (no escape/markup passthrough) with a length cap. Terminal panels only; renderer-side display state (no persistence, no daemon change). Follows the existing `cwd-store`/`useTerminalCwd` shape.

**Why this priority**: The header is where users tell terminals apart; today it says nothing about what each is doing.

**Independent Test**: Run a program that sets the title (or `cd`) in a terminal → the header updates to the reported title; clear/empty title → header shows the panel name; a non-terminal panel is unaffected; a pathological long title does not break the header.

**Acceptance Scenarios**:

1. **Given** a terminal whose program sets an OSC title, **When** the title changes, **Then** the panel header reflects the new title live.
2. **Given** a terminal reporting no title, **When** the header renders, **Then** it falls back to the panel's name.
3. **Given** a title containing escape sequences or a multi-kilobyte string, **When** it renders, **Then** it is shown as capped plain text — never markup, and the header layout is not broken.
4. **Given** an editor or empty panel, **When** it renders, **Then** its header is unchanged (terminal-only behaviour).

---

### Edge Cases

- **US1**: A command bound to a chord/multi-key sequence — the bracketed text must render the whole first binding, not a truncated fragment. A very long shortcut string must not push the menu to an unreadable width.
- **US1**: A command whose only binding is later unbound — the item must fall back to no brackets, not show a stale shortcut.
- **US2**: Double-click on the chevron/expand affordance of a directory must not double-toggle (open-then-close); the existing expand affordance keeps working.
- **US2**: A double-click that lands across two different rows (pointer moved) must not be treated as an open on either row.
- **US3**: A theme that defines none of the relevant icon tokens must still render every menu item's label with correct alignment.
- **US4**: The packages list fails to load — the failure is surfaced within the dialog (the dialog itself still works); this is explicitly a Tweak, not error-handling for a broken list, so a graceful "couldn't load" state is acceptable and total absence of the list is out of scope to fix here.
- **US4**: The dialog is reopened quickly after being closed mid-load — a fresh load starts cleanly without leaking the cancelled one.
- **US5**: A **folder** (or a target-less file) — its "Open In" submenu intentionally contains **only** "Open in OS Explorer" (a single-item submenu is by design here); the editor targets are omitted as irrelevant, and the OS-Explorer action is never lost.
- **US6**: On a platform whose reveal seam is not implemented, the reveal path degrades cleanly (the action is unavailable or reports it), never a hard-coded Windows call in shared code.
- **US7/US8**: The two preferences interact with #144 (switch-away-and-back restore) and #68 (one document, one state) — US7's reuse and US8's in-place reset MUST NOT create a second document state nor break #144's restore.
- **US10**: A terminal that never reports a title, and one that reports a pathological multi-kilobyte or escape-laden title — the header shows the panel name in the first case and capped plain text in the second, never broken layout or injected markup.

## Requirements *(mandatory)*

### Functional Requirements

**US1 — context-menu shortcuts (#125)**

- **FR-001**: A context-menu item whose command has a bound keyboard shortcut MUST display that shortcut in brackets after the label (e.g. `Copy (Ctrl+C)`).
- **FR-002**: When a command has multiple bindings, the menu item MUST display only the **first** binding.
- **FR-003**: The displayed shortcut MUST be derived from the live keybinding configuration, never a hard-coded string, and MUST update when the binding changes.
- **FR-004**: A context-menu item whose command has no bound shortcut MUST render exactly as it does today — no trailing brackets, no layout shift.
- **FR-005**: The bracketed shortcut text MUST be visually smaller than the menu item's label text.

**US2 — explorer double-click (#140)**

- **FR-006**: In **Single** select mode, double-clicking a directory row MUST toggle that directory's expansion in place — expand it (reveal children) if collapsed, collapse it if already expanded. It MUST NOT re-root or drill into the tree.
- **FR-007**: In **Single** select mode, double-clicking a file row MUST continue to open it with its default action, unchanged from today.
- **FR-008**: Single-click MUST continue to select the row only (not open it) in Single select mode.
- **FR-009**: Behaviour in all selection modes other than Single MUST be unchanged.

**US3 — context-menu icons (#126)**

- **FR-010**: Every context-menu action that maps to an existing icon token MUST render with its icon; the audit MUST cover all `openMenu(...)` call sites (panel handle, tab, explorer tree, terminal, **the cog dropdown**, and any others built on the shared menu component).
- **FR-011**: Icons MUST resolve through the active theme's icon tokens with no hard-coded assets, and MUST degrade gracefully when a token is missing — a missing icon leaves the label intact, never an empty gap or an error.
- **FR-012**: Menu layout and spacing MUST remain unchanged for items that legitimately stay iconless (no ragged indentation between icon and non-icon rows).
- **FR-013**: Where a common action has no suitable icon token yet, the gap MUST be recorded for the separately-tracked icon-token work rather than blocking this change; such an item may remain iconless.

**US4 — About dialog async list (#139)**

- **FR-014**: The About dialog MUST paint its static content (name, version, etc.) without waiting for the third-party packages list.
- **FR-015**: The third-party packages list MUST load asynchronously and populate in place when ready, showing a loading affordance until then.
- **FR-016**: Closing the dialog before the list resolves MUST cancel the in-flight load so no orphaned work continues.
- **FR-017**: The list content, once loaded, MUST be identical to what the dialog shows today.

**US5 — "Open in OS Explorer" submenu ordering (#158)**

- **FR-019**: In the Files & Folders context menu, "Open in OS Explorer" MUST be the **first** item of the "Open In" submenu. This submenu is present for **every row kind**; where editor "Open In" targets exist (files) they appear **beneath** it, and where they do not (folders / target-less files) the submenu contains **only** "Open in OS Explorer".
- **FR-020**: The action MUST be unchanged — invoking it still reveals the target in the OS file explorer.
- **FR-021**: The previous top-level "Open in OS File Explorer" row is **relocated into** the "Open In" submenu as its first item; no other item's presence or relative order changes (editor targets keep their order beneath it).

**US6 — editor "Open in OS Explorer" (#137)**

- **FR-022**: The editor panel title context menu MUST offer two actions for a panel backed by an on-disk file: **"Reveal File"** (reveal in the in-app Files & Folders view) and **"Open in OS Explorer"** (reveal in the OS file manager).
- **FR-023**: **"Reveal File"** MUST reveal the file in throng's own explorer tree — expand its ancestors and select/scroll to it — with **no** OS window; it applies when the file belongs to a project loaded in the explorer.
- **FR-024**: **"Open in OS Explorer"** MUST open the host OS file manager at the file's folder, the file selected where the OS supports it, **through the platform-abstraction seam** — no hard-coded Windows call in shared code (Principle II).
- **FR-024a**: Both actions MUST be unavailable when the panel has no on-disk file (e.g. an unsaved buffer).

**US7 — default file-open target preference (#141)**

- **FR-025**: A preference MUST offer the default open target with values **"Last Active Editor"** (default) and **"New Editor"**.
- **FR-026**: "Last Active Editor" MUST open a file in the most recently active editor panel (reused); "New Editor" MUST create a new editor panel each time; this applies to the standard open paths (file tree, double-click).
- **FR-027**: Opening an already-open document MUST NOT create a second independent state for it (one-document-one-state, #68).

**US8 — Save Document Scroll Position preference (#154)**

- **FR-028**: A preference **"Save Document Scroll Position"** MUST exist, default **No**, with scroll keyed to the **document** for in-place switching within one editor.
- **FR-029**: With it **Off**, opening a different file in place MUST reset scroll to the top, and reopening a previously-scrolled file in place MUST also start at the top; with it **On**, reopening a file in place MUST restore its scroll.
- **FR-030**: This preference MUST NOT change #144's behaviour — switching tabs/projects/panels still restores each open editor's scroll, caret, and active state.

**US9 — Copy Path submenu (#156)**

- **FR-031**: The Files & Folders context menu MUST offer a **"Copy Path"** submenu for every item (files and folders) with four entries: **Absolute Windows (\\)**, **Absolute Linux (/)**, **Relative Windows (\\)**, **Relative Linux (/)**. It sits **adjacent to and directly below "Open In"** in the location-actions group (FR-018a).
- **FR-032**: Each entry MUST copy the correct path form for the clicked item to the system clipboard as **plain text**; relative forms are relative to the **project root**.

**US10 — terminal window title in header (#89)**

- **FR-033**: The terminal panel header MUST reflect the live window title reported via OSC 0/2 (`onTitleChange`), updating as it changes, and MUST fall back to the panel's own name when the reported title is empty. Non-terminal panels are unaffected.
- **FR-034**: The reported title MUST be rendered as **length-capped plain text** — never markup or escape-sequence passthrough (it is untrusted PTY output) — and is renderer-side display state only (no persistence, no daemon/session change).

**Cross-cutting**

- **FR-018**: No change in this feature may regress existing behaviour; each user story (tweak or enhancement) MUST be independently verifiable, and surfaces it does not touch MUST behave identically to today. Every user-facing story MUST ship passing E2E coverage (constitution Principle V), and OS-specific behaviour (US6) MUST go through the platform seam with contract tests (Principle II).
- **FR-018a** (menu structure, spans US1/US3/US5/US9): The shared `ContextMenu` MUST support **visual section separators**, and menus with several logical groups MUST be organised into **sensible, visually-separated sections** (e.g. clipboard operations, item creation, location actions). In the **Files & Folders** menu specifically, **"Open In"** and **"Copy Path"** sit **adjacently ("Open In" first)** in a location-actions group near the **bottom** of the menu; the file operations (Rename/Cut/Copy/Paste/New/Delete) keep their existing relative order. A separator MUST be non-interactive and MUST NOT disturb the icon/label/shortcut alignment of real items.

### Key Entities

- **Context-menu item**: a labelled, optionally-iconed action row that maps to a command; may have zero or more keyboard bindings, and may carry a first-binding shortcut (US1) and an icon (US3). Relevant to US1, US3.
- **Menu section separator**: a non-interactive divider the shared `ContextMenu` supports (FR-018a) to group items into sensible sections; carries no label, icon, shortcut, or action and does not disturb real items' alignment.
- **Keybinding**: a mapping from a command to an ordered list of key chords; the *first* entry is the one surfaced in menus (US1).
- **Selection mode**: the explorer tree's row-interaction mode (Single vs. others); governs which gestures open vs. select (US2).
- **Third-party packages list**: the dependency/licence listing shown in the About dialog, loaded independently of the dialog's static content (US4).
- **"Open In" submenu**: the Files & Folders context-menu submenu of open targets; US5 places "Open in OS Explorer" first within it and US9 adds a sibling "Copy Path" submenu.
- **Open target**: the editor panel a file opens into — the last active editor or a new one, per the US7 preference; resolving it must not duplicate an open document's state (#68).
- **Document scroll position**: scroll kept per document (US8); restored on in-place reopen only when the preference is On; independent of #144's per-panel view-state restore.
- **Path form**: one of absolute/relative × Windows/Linux-slash renderings of an item's path (US9), relative to the project root.
- **Terminal window title**: the live OSC-reported title of a terminal (US10) — untrusted PTY text, length-capped, renderer-side, distinct from the panel's own name.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In every context menu that contains at least one bound command, 100% of items with a binding show the correct first binding in brackets, and 100% of items without a binding are visually unchanged from before the change.
- **SC-002**: After a user changes a keybinding, the corresponding menu item shows the new shortcut the next time the menu opens — 0% stale shortcuts.
- **SC-003**: In Single select mode, double-clicking a directory toggles its expansion (expand↔collapse) in 100% of attempts; single-click never opens/toggles; file double-click behaviour is unchanged.
- **SC-004**: Across all audited context menus, every action that maps to an existing icon token renders its icon; no theme causes a missing-icon gap, error, or misaligned row.
- **SC-005**: The About dialog's static content is visible essentially immediately on open (no wait for the packages list), and closing it mid-load leaves no background work running.
- **SC-006**: No existing behaviour regresses — the pre-existing test suites for the affected surfaces stay green, and the five Tweaks are each demonstrable in isolation.
- **SC-007**: In the Files & Folders "Open In" submenu, "Open in OS Explorer" is the first item 100% of the time, the action's behaviour is unchanged, and no other item's presence or order changes.
- **SC-008** (US6): From an editor backed by a saved file, a user can (a) reveal the file in the in-app Files & Folders tree and (b) reach its folder in the OS file manager, each in one action; both are absent for unsaved buffers; the OS reveal is issued through the platform seam.
- **SC-009** (US7): With "New Editor", 100% of opens create a new panel; with "Last Active Editor" (default), 100% reuse the last active editor; opening an already-open document never produces a second document state.
- **SC-010** (US8): With the preference Off (default), an in-place file switch lands at the top 100% of the time; with it On, a reopened document restores its scroll; tab/project/panel switches still restore each editor's scroll/caret/active state either way.
- **SC-011** (US9): For any file or folder, each of the four "Copy Path" forms places the correct path on the clipboard; relative forms are correct against the project root; the "Copy Path" submenu sits directly below "Open In" in the location group.
- **SC-011a** (menu structure, FR-018a): The Files & Folders menu reads as sensible separated sections — file operations, creation, and a bottom location group with "Open In" then "Copy Path"; separators are non-interactive and no item's icon/label/shortcut alignment is disturbed.
- **SC-012** (US10): A terminal's header reflects its reported title within one render of an OSC title change, falls back to the panel name when empty, and is never broken or made to render markup by hostile title output.

## Assumptions

- Scope is the ten `v1.0.0` issues delivered here at the user's request: five `tweak`s (#125, #126, #139, #140, #158) and five `enhancement`s (#137, #141, #154, #156, #89). All are treated as agreed by virtue of that instruction; all are assigned. The three largest enhancements (#152, #155, #85) were **split out to spec 024** (`feature/S024-editor-terminal-enhancements`) so these ten could ship first (PR #151).
- These are **independently shippable** — the bundle exists to plan and track together, not to merge as one PR.
- Cross-cutting constitutional rules apply and are called out per story: the platform seam for OS reveals (Principle II — US6), one-document-one-state (#68 — US7), and #144's switch-restore (US8).
- The shared context-menu (`MenuItem` / `ContextMenu`) plumbing already supports an optional `icon` token and shortcut display is an additive render concern — no new menu framework is introduced.
- Expansion of the theme icon-token set is tracked separately (issue #127) and is a **dependency, not a blocker**: US3 reuses existing tokens and records gaps rather than adding new tokens here.
- "First binding" for US1 means the first entry in the command's ordered binding list as the keybinding system already orders them.
- US4's scope is perceived-load and cancellation only; fixing a *failed* or *absent* list is out of scope (that would be a Bug, not a Tweak).
- Each Tweak can ship as its own commit/PR slice if desired, since they are independent; the single spec exists to plan and track them together.
