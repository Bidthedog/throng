# Feature Specification: Markdown Preview Enhancements

**Feature Branch**: `feature/S047-markdown-preview-enhancements`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "As per the issues selected" — the v1.0.0 Markdown preview group:
#405 (open previews in the last active preview panel), #428 (drop Markdown files onto preview panels),
#420 (find in Markdown previews), #413 (preview outline, amended 2026-09-28 with section folding
linked between the editor and the preview), #424 (Obsidian-style wikilinks) and #432 (fair and
resizable table columns).

This feature extends **044 (file previews)**. Every 044 requirement not named below as superseded or
extended stands unchanged. Where a requirement here changes one of 044's, it says so as a
supersession, naming what it replaces and why.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find text in a Markdown preview (Priority: P1)

A reader has a long document open in a preview and wants to look up a phrase in it. Today they must
switch to the source editor, search there, and find the same spot again in the preview. With this
story they press the same find chord they use in an editor, and the same find bar opens inside the
preview. They type, every match in the rendered document is highlighted, the count reads "3 of 12",
and next/previous walk through the matches.

**Why this priority**: The maintainer asked for it by name, and it is the most frequent reading task
a long document has.

**Independent Test**: Open a Markdown preview of a document containing a phrase several times, focus
the preview, press the find chord, type the phrase, and step through the matches.

**Acceptance Scenarios**:

1. **Given** a focused Markdown preview, **When** the user presses the editor's find chord, **Then**
   the editor's find bar opens in that preview with focus in its query field.
2. **Given** the find bar is open in a preview, **When** the user types a query, **Then** every match
   in the rendered text is highlighted, the current match is distinguished, and the count uses the
   editor's format.
3. **Given** matches exist, **When** the user presses next or previous, **Then** the current match moves
   in document order, wraps at the ends, and is scrolled into view.
4. **Given** the source contains `**bold**`, **When** the user searches for `bold`, **Then** it matches;
   searching for `**` does not match the emphasis markers.
5. **Given** a focused preview, **When** the user presses the replace chord, **Then** nothing happens,
   and the find bar in a preview never shows replace controls.
6. **Given** an active search in a parented preview, **When** the source is edited and the preview
   re-renders, **Then** the highlights are recomputed against the new content, never left stale.
7. **Given** a match inside a folded section (User Story 4), **When** it becomes the current match,
   **Then** the section containing it expands so the match is visible.
8. **Given** a search with several matches, in an editor or a preview, on any shipped theme, **When**
   they are highlighted, **Then** every match carries a visible outline and the current one stays the
   more emphatic (FR-074, Session 2026-09-29).

---

### User Story 2 - Open previews in the preview panel I already have (Priority: P1)

A user whose default open action for Markdown is Preview browses a folder of notes. Every click today
opens another preview panel, leaving a trail to close by hand. With this story a new setting, **Open
previews in**, reuses the most recently active preview panel, so clicking through notes shows each in
the same panel, and Back returns to the previous note.

**Why this priority**: The maintainer asked for it by name ("open-in-place"), and it removes the main
friction of making Preview the default open action.

**Independent Test**: Set Markdown's default open action to Preview and Open previews in to Last
Active, click two `.md` files in Files & Folders in turn, and confirm one preview panel shows the
second file and Back shows the first.

**Acceptance Scenarios**:

1. **Given** default open action Preview and **Open previews in = Last Active**, with one preview panel
   open, **When** the user opens another Markdown file from Files & Folders, **Then** that panel shows
   the new file and Back returns to the previous one.
2. **Given** **Open previews in = New**, **When** the user opens two Markdown files in turn, **Then** two
   preview panels exist (044's current behaviour).
3. **Given** Last Active and no preview panel in the visible tab (even if one exists in a background
   tab), **When** a Markdown file is opened as a preview, **Then** a new preview panel opens where 044
   FR-011 places one, and the background tab's preview is unchanged.
4. **Given** any setting value, **When** the user chooses Files & Folders → Open In → **Last Preview
   Panel** or **New Preview Panel**, **Then** the file opens as that item names.
5. **Given** the file being opened already has a preview open elsewhere, **When** it is opened by any of
   these routes, **Then** that preview is focused and no other panel changes (044 FR-012). *(Superseded in
   part by FR-081 (Session 2026-09-29, round 3) — an open from Files & Folders shows that preview but
   leaves the keyboard in the tree.)*
6. **Given** a preview panel named "Notes" is the most recent in the visible tab, **When** the user opens
   Files & Folders → Open In for a Markdown file, **Then** it offers **Last Preview Panel (Notes)** and
   **New Preview Panel**, and no plain **Preview** item (FR-075, FR-076, Session 2026-09-29).
7. **Given** Files & Folders has the keyboard, **When** the user activates a Markdown file there (click,
   double-click or Enter, per the open-on-click setting) and it opens in a preview — placed new, reusing
   the Last Active preview, or focusing the one that already shows it — **Then** the preview shows the file,
   Files & Folders stays the active pane with the tree keeping the keyboard, and F2 renames the activated
   file (FR-081, Session 2026-09-29 round 3).

---

### User Story 3 - Fold a document's sections, in the editor and the preview together (Priority: P2)

A reader working through a long specification collapses the sections they are not reading. They can
do it in the Markdown editor, with + / − markers in the gutter beside each heading, or in the preview,
with an arrow beside each rendered heading. The two views share one fold state: collapse a section in
the editor and it collapses in the preview beside it, and the other way round. Collapse All and Expand
All work from menus, key bindings and a toggle in the preview's status bar. A preference decides
whether documents open with their sections expanded or collapsed.

**Why this priority**: Added by the maintainer on 2026-09-28 as part of #413. It is the largest story
and introduces editor folding, which does not exist today.

**Independent Test**: Open a Markdown file in an editor with its preview beside it, collapse a
section with the gutter marker, and confirm the same section collapses in the preview; expand it from
the preview's heading arrow and confirm the editor follows.

**Acceptance Scenarios**:

1. **Given** a Markdown editor, **When** the document has headings, **Then** each heading line shows a
   fold marker in the gutter: − while its section is expanded, + while it is collapsed.
2. **Given** a Markdown preview, **When** it renders headings, **Then** each heading shows an arrow that
   reflects and toggles its section's fold state.
3. **Given** an editor and its parented preview, **When** the user collapses or expands a section in
   either, **Then** the same section changes in the other.
4. **Given** the user opens a context menu inside an H2 section, in the editor or the preview, **When**
   they choose **Collapse This H2**, **Then** only that section collapses, in both views.
4a. **Given** an H1 whose H2s are expanded, **When** the user collapses the H1 and expands it again,
   **Then** its H2s are still expanded.
5. **Given** a focused preview or Markdown editor, **When** the user presses the Collapse All or Expand
   All binding, or uses the preview status bar's toggle, **Then** every section changes in both views.
6. **Given** the "Markdown sections open" preference is set to Collapsed, **When** a Markdown document is
   opened, **Then** its sections start collapsed in the editor and in the preview.
7. **Given** a collapsed section, **When** the user follows a link or an outline entry to a heading
   inside it, or the find bar's current match lies inside it, **Then** that section and its ancestors
   expand.
8. **Given** a standalone preview with some sections collapsed and no editor showing its file, **When**
   the user opens the file in an editor, **Then** the editor opens with the same sections collapsed and
   the preview keeps them collapsed (FR-078, Session 2026-09-29).

---

### User Story 4 - See a document's shape and jump to a section (Priority: P2)

A reader opens a 900-line document in a preview and wants to reach "Acceptance criteria" without
scrolling. They press Ctrl+G, and a pop-down opens over the top of the preview listing the document's
headings as a tree, scrolled to and highlighting the section they are in. They type "accept" into its
search box, press Enter, and the preview scrolls smoothly there. Back returns them to where they were.

**Why this priority**: The other half of navigating a long preview, alongside find. It shares the
heading model with folding (User Story 3).

**Independent Test**: Open a preview of a document with nested headings, press Ctrl+G, click an
entry, confirm the preview lands on that heading, then press Back.

**Acceptance Scenarios**:

1. **Given** a focused Markdown preview with nested headings, **When** the user presses Ctrl+G, **Then** a
   fixed-height pop-down opens over the preview listing the headings in document order, nested by level,
   with the search box focused and the list scrolled to the reader's current section, highlighted.
2. **Given** the pop-down is open, **When** the user clicks an entry or presses Enter on it, **Then** the
   preview scrolls smoothly to the heading where a `#slug` link to it would land, a history entry is
   recorded as 044 FR-115 records one, and the pop-down closes.
3. **Given** the user typed into the search box, **When** matches exist, **Then** the list narrows to them,
   scrolls to the first and highlights it, including matches inside collapsed tree nodes, which expand;
   Enter jumps to it.
4. **Given** the search box is focused and the current section is an H5 halfway down the list, **When**
   the user presses Down, **Then** focus moves to that H5 entry; Up from the first entry, or Ctrl+G,
   returns focus to the search box.
4a. **Given** the pop-down is open, **When** the user scrolls its list, **Then** the document does not
   scroll.
5. **Given** a document with no headings, **When** the pop-down opens, **Then** it says "No headings".
6. **Given** a parented preview with scroll synchronisation on, **When** the user jumps from the
   outline, **Then** the editor follows (044 FR-121f).
7. **Given** the pop-down lists more headings than fit, on any shipped theme, **When** it shows its
   scrollbar, **Then** the scrollbar is visibly distinct from the pop-down's background (FR-079, Session
   2026-09-29).

---

### User Story 5 - Drop a Markdown file onto a preview panel (Priority: P2)

A user drags a `.md` file from Files & Folders, or from the OS file manager, onto a preview panel.
Today the panel refuses every drop. With this story the panel shows the dropped file, and Back
returns to what it showed before.

**Why this priority**: Makes the preview panel accept the one thing it exists to show; small once
User Story 2's open path exists.

**Independent Test**: Drag a `.md` file from Files & Folders onto an open preview panel and confirm the
panel shows it and Back returns to the previous file.

**Acceptance Scenarios**:

1. **Given** a preview panel, **When** a `.md` file is dropped on it from Files & Folders or the OS file
   manager, **Then** the panel shows that file and Back returns to the previous one.
2. **Given** a preview panel, **When** a file no enabled provider accepts (e.g. `.ts`) is dragged over
   it, **Then** the drop-refused affordance shows and dropping it changes nothing.
3. **Given** a project-owned preview panel, **When** a file outside the project root is dropped, **Then**
   it is refused with the same notice an editor drop raises; in a sub-workspace panel it is accepted.
4. **Given** a preview panel, **When** text or HTML is dropped on it, **Then** it is refused and nothing
   changes.
5. **Given** a preview panel, **When** three `.md` files are dropped on it at once, **Then** the first
   shows in that panel and the other two open in new preview panels, whatever Open previews in says.
6. **Given** Markdown's default open action is Preview, **When** a `.md` file is dropped onto an empty
   panel, **Then** that panel becomes a preview of the file, not an editor (FR-077, Session 2026-09-29).

---

### User Story 6 - Follow Obsidian-style wikilinks (Priority: P3)

A user browsing a notes vault written in Obsidian sees `[[Note]]` rendered as literal brackets today.
With this story wikilinks render as links and behave exactly like the preview's ordinary Markdown
links.

**Why this priority**: Valuable for one class of document; independent of the other stories.

**Independent Test**: Preview a document containing `[[Other]]`, `[[Other|alias]]`, `[[Other#Heading]]`
and `[[#Heading]]`, and follow each.

**Acceptance Scenarios**:

1. **Given** a preview of a document with `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]` and
   `[[#Heading]]`, **When** it renders, **Then** each is a link showing the note name or the alias.
2. **Given** a rendered wikilink, **When** it is followed by any link gesture, **Then** it behaves exactly
   as an ordinary Markdown link to the same resolved target (044 FR-090 – FR-096).
3. **Given** a document in `/tests/folder1/`, **When** `[[README]]` is followed, **Then** it opens
   `/tests/folder1/README.md` (or `/tests/folder1/README`), never a `README` elsewhere in the project;
   `[[../README]]` opens `/tests/README.md`; `[[/docs/README]]` opens `/docs/README.md` from the project
   root.
4. **Given** `[[Missing]]` resolves to no file, **When** it renders, **Then** it is visibly distinct from
   a working link, and following it shows the notice 044 FR-090e shows for a missing target.
5. **Given** `[[…]]` inside inline code or a fenced block, **When** it renders, **Then** it stays literal.

---

### User Story 7 - Read tables that fit the panel (Priority: P3)

A reader has a preview beside an editor, so the preview is narrow. A table with one long unbroken
cell today takes all the width and pushes the other columns off-screen. With this story columns share
the width fairly and long content wraps inside its cell; the reader can drag a column border to resize
a column by hand.

**Why this priority**: A readability fix with no dependants.

**Independent Test**: Preview a table containing a long path in one cell in a narrow panel; confirm
all columns stay legible without a horizontal scrollbar, then drag a column border.

**Acceptance Scenarios**:

1. **Given** a table whose natural width fits the panel, **When** it renders, **Then** it spans the panel
   width with no horizontal scrollbar.
2. **Given** a cell containing a long unbroken string, **When** it renders, **Then** the string wraps
   inside its column and no other column falls below the minimum width.
3. **Given** a rendered table, **When** the user drags a column border, **Then** that column's width
   changes live and the pointer shows a column-resize cursor over the border.
4. **Given** a table that cannot fit however its columns are shared, **When** it renders, **Then** all
   its content remains reachable by horizontal scrolling.
5. **Given** a table with short columns (an ID like `MT-01`, a date, a status, a commit hash) beside a
   long prose column, in a panel too narrow for every column on one line, **When** it renders, **Then**
   the short columns stay on one line, the prose column wraps between words, and no word is split —
   unless one word alone is wider than about 40% of the panel (FR-072, FR-073, Session 2026-09-29).

---

### Edge Cases

- **Find and re-render**: the source changes while the find bar is open; highlights and the count are
  recomputed, and the current match stays on the nearest surviving match rather than jumping to the
  first.
- **Find across a fold**: a query whose only matches lie in collapsed sections still counts them; the
  current one expands its section (User Story 1, scenario 7).
- **Find in front matter**: the front-matter table (044 FR-085, FR-117) is searched when shown and not
  when hidden.
- **Last Active across tabs, projects and windows**: the "last active preview panel" is scoped to the
  requesting window's visible tab; a preview in a background tab, another project or another window is
  never reused, and a new panel opens instead (FR-015).
- **Last Active and a sub-workspace**: a sub-workspace window reuses its own last active preview, never
  the main window's.
- **Last Active whose panel was closed**: when the remembered panel no longer exists, the next open
  falls back to the next most recently active preview panel, or to a new panel if none remains.
- **Last Active and a parented preview**: reusing a parented preview for another file unbinds it from
  its editor, which stays open; Back re-pairs it while the editor is still open, or shows the file
  standalone once the editor has closed (FR-016, FR-016a).
- **Fold state and a second view**: an editor shown in more than one window (Sync to) shares one fold
  state across every view of the document.
- **Fold state and a standalone preview**: a standalone preview has no editor to link to; its fold state
  is its own and starts from the preference.
- **Fold state when a preview becomes parented** (044 FR-013a): the preview adopts the editor's fold
  state.
  *Superseded in part by FR-078 (Session 2026-09-29) — a newly opened editor that is the document's
  first view follows the preview's fold state instead.*
- **Headings added or removed while folded**: a section whose heading is deleted drops its fold state;
  a new heading starts in the document's current default — the preference (FR-039), or whatever the
  last Collapse All / Expand All set (FR-037a). *[derived, plan R3]*
- **Setext and duplicate headings**: setext headings fold and appear in the outline at the right level;
  two headings with identical text fold, and jump to, their own sections.
- **Spoofed headings**: raw HTML in the document that imitates a heading, or plants a heading slug,
  creates no outline entry and no fold point and cannot retarget one (044 FR-081, FR-090b).
- **Scroll sync with folds**: with sections folded on either side, scroll synchronisation keeps mapping
  the block at the top of the preview to its source line (044 FR-121b).
- **Drop of a file already previewed elsewhere**: the existing preview is focused, as for a followed link
  (044 FR-090c), and the dropped-on panel is unchanged.
- **Wikilink to a non-Markdown file**: `[[diagram.png]]` or `[[script.ts]]` resolves like an ordinary
  link to that file (044 FR-090d).
- **Wikilink block reference**: `[[Note#^block-id]]` links to `Note` and ignores the block id.
- **Table resize and re-render**: a parented preview re-renders on every edit; hand-set widths survive
  a re-render of the same table.

## Requirements *(mandatory)*

### Functional Requirements

#### Find in a preview (#420)

- **FR-001**: A Markdown preview panel MUST support the application's find bar: the same component,
  commands, key bindings and behaviour as in an editor panel, including match case, whole word, the
  match count, next and previous with wrap-around, highlight all, and scrolling the current match into
  view.
- **FR-002**: Matching MUST run against the preview's **rendered text**, not the Markdown source.
- **FR-003**: Replace MUST be unavailable in a preview: no replace controls are shown, and the replace
  commands and their chords MUST be inert while a preview has focus.
- **FR-004**: **Supersedes 044 FR-021 in part.** 044 FR-021 listed "find and replace" among the commands
  inert while a preview has focus. That list now splits: **find** (FR-001) acts on the focused preview,
  scoped to it; **replace** stays inert, as do save, revert, rename and delete. *Why*: FR-021's intent is
  to stop commands acting on something the user cannot see; find in a preview acts on exactly what the
  user sees and changes nothing, so it is outside that intent. The rest of FR-021, including its ban on
  falling back to another surface's keyboard scope, stands.
- **FR-005**: While a search is active, a re-render of the preview MUST recompute the matches and the
  count against the new content, keeping the current match on the nearest surviving match. Closing the
  find bar MUST clear every highlight.
- **FR-005a**: A preview that navigates onto a **different file** (a Last Active open, a followed link, a
  history step) MUST close its find bar and discard the query; a re-render or rename of the same file
  does not (FR-005). *(Added in review, 2026-09-28, MT-02.)*
- **FR-006**: Search highlights in a preview MUST use the find bar's existing match-highlight colours
  (**013 FR-019**), so a match looks the same in an editor and a preview.
  *Refined by FR-074 (Session 2026-09-29) — every match is also outlined, in editors and previews alike.*
- **FR-007**: Wherever a menu exposes Find for an editor panel, the same menu MUST expose it for a
  preview panel (Principle VI, *every panel action has a menu item*).
- **FR-008**: When regular-expression match mode (#376) is delivered, it MUST apply to this surface too;
  nothing in this feature may prevent it.

#### Where a preview opens (#405)

- **FR-010**: An **Open previews in** setting MUST exist under Editor → Previews (044 FR-061), with the
  values **Last Active** and **New**, shipping as **Last Active**. It mirrors the editor's **Open files
  in** setting (**023 FR-025/FR-026**) in naming, placement and behaviour.
- **FR-011**: **Supersedes 044 FR-011 for the Last Active case.** When a file with no open editor is
  opened as a preview and Open previews in is **Last Active**, it MUST open **in place** in the most
  recently active preview panel of the requesting window's visible tab (FR-015) — a navigation, recorded in that
  panel's history (044 FR-103), exactly as following a link in place is (044 FR-090a) — and a new panel
  MUST be created (placed per 044 FR-011) only when no preview panel exists there. Under **New**,
  044 FR-011 applies unchanged. *Why*: the maintainer's #405 — browsing a folder of notes must not leave
  a trail of panels.
- **FR-012**: FR-011 governs every route that opens a standalone preview: the default open action
  (044 FR-052), Files & Folders → Open In → Preview, and Quick Open. It MUST NOT change where a preview
  opens when the file is open in an editor (044 FR-010, FR-053): a parented preview still opens beside
  its editor.
- **FR-013**: 044 FR-012 (a file has at most one preview) stands. When the file being opened already
  has a preview, that preview MUST be focused and no other panel changes, whatever the setting.
- **FR-014**: Files & Folders' **Open In** submenu MUST offer **Last Preview Panel** and **New Preview
  Panel** for a file with an enabled provider, each doing as named whatever the setting says. They follow
  044 FR-003's rules for availability (disabled while the provider is disabled or the file already has
  a preview; absent on folders and files with no provider). **Last Preview Panel** MUST be disabled while
  no preview panel exists in the visible tab (FR-015).
  *Label amended by FR-076 (Session 2026-09-29): **Last Preview Panel (&lt;panel name&gt;)**. The
  submenu's plain **Preview** item is removed by FR-075.*
- **FR-015**: The "most recently active preview panel" MUST be the preview panel that most recently had
  focus **among those in the requesting window's currently visible tab**. When it has closed, the next
  most recent in that tab MUST be used. A preview in a background tab, another window, another project or
  another sub-workspace MUST never be reused: with none in the visible tab, a new panel opens (044
  FR-011). *(Clarified 2026-09-28: a hidden tab is never brought forward or changed out of sight.)*
- **FR-015a**: The setting's short description in the preferences editor MUST say so, e.g. *"Last
  Active reuses the most recently used preview in the tab you are looking at; otherwise a new preview
  opens."*
- **FR-016**: Reusing a parented preview for a different file — by Last Active (FR-011), Open In → Last
  Preview Panel (FR-014) or a drop (FR-020) — MUST go ahead, and MUST unbind the preview from its editor
  exactly as 044 FR-090a does for a followed link. The editor MUST stay open and unchanged; only the
  preview changes file. *(Clarified 2026-09-28: the user asked for the preview to change, not the
  editor.)*
  - **FR-016a**: **Back** to the earlier file MUST re-derive the pairing (044 FR-013): while that file's
    editor is still open, the preview is parented to it again; once the editor has closed, the preview
    shows the file standalone (044 FR-023).

#### Dropping files on a preview (#428)

- **FR-020**: A preview panel MUST accept a dropped file that an enabled preview provider can render,
  from Files & Folders or from the OS file manager, through the same inbound drop path editor panels use.
  The panel MUST navigate to the file, recording a history entry (044 FR-103).
  *A drop onto an EMPTY panel is governed by FR-077 (Session 2026-09-29).*
- **FR-020a**: An accepted drop MUST make the workspace the active pane and focus the panel dropped
  on. *(Added in review, 2026-09-28, MT-03.)*
- **FR-021**: **Narrows the preview body's blanket drop refusal (044 FR-020 as implemented).** 044 FR-020
  forbids any drop that changes the file or the source document; it stands. A drop that only changes
  which file the panel shows changes neither, so it is allowed. Every other drop — text, HTML, a file no
  enabled provider accepts — MUST stay refused, with the same drop-refused affordance an editor panel
  shows.
- **FR-022**: A dropped file MUST be confined exactly as an editor drop is: a project-owned panel accepts
  only files inside that project's root, and a sub-workspace panel accepts any file. A refused drop MUST
  raise the same notice an editor drop raises.
- **FR-023**: When a dropped file already has a preview elsewhere, that preview MUST be focused and the
  dropped-on panel MUST stay unchanged (044 FR-090c, FR-012).
- **FR-024**: When several files are dropped at once, the first accepted file (in the drop's order) MUST
  open in the dropped-on panel, and each remaining accepted file MUST open in a **new** preview panel,
  placed per 044 FR-011, whatever Open previews in says. Each file is judged on its own under FR-020 –
  FR-023: a refused file is skipped with its notice and does not stop the others. *(Clarified
  2026-09-28, Q1.)*
- **FR-025**: Drops MUST work in preview panels in sub-workspace windows as well as the main window, and
  the drop highlight MUST be the same component editors use.

#### Section folding (#413, amendment 2026-09-28)

- **FR-030**: A Markdown document's **section** is a heading plus everything after it up to the next
  heading of the same or a higher level. Sections nest; each folds independently.
  - **FR-030a**: Collapsing a section MUST hide its content without changing the fold state of the
    sections nested inside it. Expanding it again MUST show each nested section exactly as it was:
    collapsing an H1 and expanding it again leaves its H2s and H3s expanded if they were expanded before.
    The same holds at every level, in the editor and the preview alike. *(Clarified 2026-09-28.)*
- **FR-031**: A Markdown **editor** MUST show a fold marker in its gutter on each heading line: **−** while
  the section is expanded and **+** while collapsed. Clicking it toggles that section. The markers
  live in the editor's gutter, so they are hidden with it when `editor.showGutter` is off; folding
  stays available from the menus and bindings. *[derived, plan Complexity Tracking]*
  **Supersedes 040 FR-046 in part.** 040 FR-046 kept the editor gutter to line numbers alone; this adds
  the Markdown fold markers as its one other content, governed by `editor.showGutter` as FR-046 feared
  they would not be. FR-046's other half — no per-document or per-language gutter override — still
  holds. The preview gutter (FR-032a) is a separate strip in the preview, not an override of the
  editor's, so its setting (FR-032b) is the one other gutter-named key.
- **FR-032**: A Markdown **preview** MUST show an arrow beside each rendered heading that reflects and
  toggles that section's fold state, matching the editor's marker in meaning. The arrows sit in the
  **preview gutter** (FR-032a).
  - **FR-032a**: A Markdown preview MUST have a **preview gutter**: a fixed-width strip down the left edge
    of the rendered document. It is a *soft* gutter — no border, no background of its own, not
    resizable, and unlike the editor's — whose only effect on layout is to move the whole document to
    the right so its icons are clearly visible, aligned with the heading each belongs to. It MUST be
    built to carry further per-line icons in future without redesign.
  - **FR-032b**: A **Markdown preview gutter** setting MUST exist under Editor → Previews with the values
    **Enabled** and **Disabled**, shipping as **Enabled**. It is the only control that shows or hides the
    gutter; no menu item, button or binding toggles it. While Disabled, the gutter and its arrows are
    absent and the document is not shifted; folding stays available from the menus and bindings
    (FR-036 – FR-038). *(Clarified 2026-09-28.)*
- **FR-033**: **One fold state per document.** The editor views of a document and its parented preview
  MUST share a single fold state: collapsing or expanding a section in any of them changes it in all of
  them. It is one authority, not two peers kept in step (Principle XI).
- **FR-034**: A **standalone** preview MUST hold its own fold state. When it becomes parented (044
  FR-013a) it MUST adopt its document's fold state; when it becomes standalone (044 FR-013b) it MUST keep
  the state it was showing.
  *Superseded in part by FR-078 (Session 2026-09-29) — when the editor that parents it is the
  document's first view, the document adopts the preview's fold state rather than the reverse.*
- **FR-035**: Folding MUST be view state only. It MUST NOT change the document, mark it dirty, or add a
  navigation-history entry (044 FR-020, FR-041).
- **FR-036**: The editor's and the preview's body context menus MUST be **context-sensitive**: opened
  inside a section, they MUST offer **Collapse This H*n*** or **Expand This H*n*** — named with the level
  of the innermost section containing the point the menu was opened at (e.g. "Collapse This H2") — acting
  on that section only. Opened on a heading line, the section is that heading's. Opened outside every
  section (before the first heading), the items are absent (Principle VI, *absent when meaningless*).
  *(Clarified 2026-09-28: named for the section they act on, not "Collapse All".)*
- **FR-037**: **Collapse This Section**, **Expand This Section** and **Toggle This Section** MUST be
  bindable commands acting on the innermost section at the caret in a focused Markdown editor, or at the
  top of the view in a focused preview; where a menu shows them, they carry the level-specific label
  FR-036 names.
  - **FR-037a**: **Collapse All** and **Expand All** MUST be bindable commands that collapse or expand
    **every section at every level, each individually**, in the focused editor or preview (and so in its
    linked view, FR-033). Collapse All on a document with one H1 therefore leaves only the H1 showing;
    expanding that H1 shows its H2s collapsed. **Toggle All** MUST run Collapse All when any section is
    expanded and Expand All otherwise. *(Clarified 2026-09-28.)*
  - **FR-037b**: The six commands MUST ship with the **Visual Studio / ReSharper outlining chords**, as
    two-stroke chords (046 FR-124): Toggle This Section **Ctrl+M, M**; Toggle All **Ctrl+M, L**; Collapse
    This Section **Ctrl+M, S**; Expand This Section **Ctrl+M, E**; Collapse All **Ctrl+M, A**; Expand All
    **Ctrl+M, X**. They are scoped to Markdown editors and preview panels only, and MUST pass
    **046 FR-021**'s check within that scope — including against the editor's own built-in use of
    Ctrl+M, which the binding must take over there. *(Clarified 2026-09-28: the maintainer asked for
    the ReSharper chords.)* *(Amended 2026-09-28, maintainer review: **Expand This Section** and
    **Expand All** ship **unbound** — Ctrl+M, E and Ctrl+M, X are dropped. Both stay bindable and on
    the context menus; Toggle This Section and Toggle All already expand.)*
- **FR-038**: A preview panel's status bar (044 FR-015a) MUST carry a **Collapse All / Expand All** toggle
  for a Markdown preview, invoking Toggle All (FR-037a). It MUST use a themeable icon token, carry an
  accessible name, and never be hidden by width.
- **FR-039**: A **Markdown sections open** setting MUST exist, with the values **Expanded** and
  **Collapsed**, shipping as **Expanded**. It decides the initial fold state of a document when it is
  first opened, in the editor and in the preview alike. **Collapsed** means every section is collapsed,
  so only the top-level headings show.
- **FR-040**: Reaching a heading inside a collapsed section — by following a link (044 FR-090b, FR-090f),
  by an outline jump (FR-042), or by the find bar's current match (FR-001) — MUST expand that section and
  every collapsed ancestor.
- **FR-041**: Fold points MUST come from the headings the Markdown pipeline recorded, never from the
  sanitised DOM. A `#` in front matter or in any code block MUST NOT create a fold point, and raw HTML
  imitating a heading MUST NOT create or retarget one (044 FR-081, FR-090b). Setext headings MUST fold
  at their level.
- **FR-041a**: With sections folded on either side, scroll synchronisation (044 FR-121) MUST keep
  mapping the block at the top of the preview to its source line.
- **FR-041b**: Fold state is not persisted across a restart or a reopen; a reopened document starts
  from FR-039. The fold state MUST survive a preview re-render and an edit that does not remove the
  section's heading.
  - **FR-041d**: A preview's navigation-history entry (044 FR-101) MUST also remember the fold state the
    preview was showing when it left that entry, and Back or Forward MUST restore it, as 044 FR-107
    restores scroll position. This is held for the life of the panel only: it is not part of the
    persisted history (044 FR-109), so after a restart every entry starts from FR-039. When returning
    re-pairs the preview with an open editor (FR-016a), the document's shared fold state (FR-033) wins
    over the remembered one. *(Clarified 2026-09-28.)*
- **FR-041c**: The editor folding this feature introduces MUST be built so that #375 extends the same
  mechanism to other languages, rather than adding a second one (Principle VIII).

#### Outline (#413)

- **FR-042**: A Markdown preview MUST offer a **Go to Heading** outline: a **pop-down** over the top of the
  preview, listing the document's headings, `h1`–`h6`, as a tree nested by level in document order, each
  labelled with its rendered text. It overlays the document and never moves or resizes it. *(Clarified
  2026-09-28: a pop-down, not a strip.)*
- **FR-042a**: **Opening.** A bindable **Go to Heading** command MUST open it, shipping bound to **Ctrl+G**
  scoped to preview panels, and passing **046 FR-021**'s check within that scope; the preview's body and
  header menus MUST offer **Go to Heading…** (Principle VI). It opens with the **search box focused** and
  the list scrolled so the entry for the reader's current section (FR-044) is visible and highlighted.
- **FR-042b**: **Size and scrolling.** The pop-down MUST have a fixed height and a vertical scrollbar, and
  its list MUST scroll independently of the preview: scrolling it never scrolls the document.
- **FR-042c**: **Jumping.** Clicking an entry, or pressing Enter on it, MUST scroll the preview to that
  heading exactly where a `#slug` link lands, expanding any collapsed section around it (FR-040), and MUST
  record a history entry exactly as 044 FR-115 does for a same-document heading link. The pop-down then
  closes. Esc, or a click outside it, closes it without jumping.
- **FR-042d**: **Smooth scroll.** A jump MUST scroll smoothly over the duration set by a **Heading jump
  scroll duration** setting under Editor → Previews, in milliseconds, shipping at **200 ms**; **0** jumps
  instantly. With scroll synchronisation on, the editor follows the jump (044 FR-121f).
- **FR-043**: **Typeahead search.** Typing in the search box MUST narrow the list to headings whose text
  contains the typed characters (case-insensitive), each shown with its ancestors for context, and MUST
  scroll the list to the first match, highlighting it. Enter in the search box jumps to the highlighted
  match (FR-042c). Search MUST find headings inside collapsed tree nodes and expand those nodes to show
  them.
- **FR-043a**: **Keyboard.** From the search box, **Down** MUST move focus straight to the entry for the
  reader's current section — the one highlighted on open — not to the top of the list; entries above it
  are reached by moving **Up** from there. **Up** from the first entry in the list returns focus to the
  search box. Pressing **Ctrl+G** while the pop-down is open MUST return focus to the search box. Up and
  Down move through the visible entries in list order; Enter jumps.
- **FR-044**: The entry for the section at the top of the preview's view MUST be the **current** entry: it
  is highlighted, and the list is scrolled to it whenever the pop-down opens.
- **FR-045**: The pop-down's tree nodes MUST be collapsible independently of document folding: collapsing
  a node hides its child entries and MUST NOT fold the document, and folding the document MUST NOT
  collapse a node. Search still finds entries in collapsed nodes (FR-043).
- **FR-046**: A document with no headings MUST show a stated "No headings" message in the pop-down.
- **FR-047**: The outline MUST follow the document live: in a parented preview, a heading typed into the
  editor appears without saving, as the preview itself does (044 FR-022).
- **FR-048**: The outline MUST be built from the headings the pipeline recorded (as FR-041), using the
  same document-symbol shape #375 defines for Markdown headings, so the two surfaces share one model.
- **FR-049**: The pop-down, its search box, its entries and its current highlight MUST take their colours
  from theme tokens, and every control in it MUST carry an accessible name.
  *Refined by FR-079 (Session 2026-09-29) — its background is distinguishable from its scrollbar.*

#### Wikilinks (#424)

- **FR-050**: The Markdown provider MUST render `[[Target]]`, `[[Target|Alias]]`, `[[Target#Heading]]` and
  `[[#Heading]]` as links, showing the alias when given and the target's name otherwise. `[[…]]` inside
  inline code or any code block MUST stay literal.
- **FR-051**: A wikilink MUST resolve to a target and then be classified and followed exactly as an
  ordinary `[text](href)` link to that target (044 FR-090 – FR-096, FR-115, FR-116, FR-118): same
  gestures, menu, notices, history and security rules. A wikilink MUST never open a path an ordinary
  link could not. The sanitiser remains the single gate.
- **FR-052**: A wikilink target MUST resolve as a **path**, never by searching the project for a name.
  *(Clarified 2026-09-28: same folder only — no project-wide lookup, so no tie-break is needed.)*
  - **FR-052a**: A target with no leading `/` — `[[README]]`, `[[sub/Note]]`, `[[../README]]` — MUST
    resolve **relative to the current document's folder**, exactly as an ordinary relative link does.
    `[[README]]` in `/tests/folder1/` can only mean a file in `/tests/folder1/`.
  - **FR-052b**: A target with a leading `/` — `[[/tests/folder1/README]]` — MUST resolve from the
    **root of the preview's throng project**. In a preview with no owning project (a sub-workspace
    panel), a root target is unresolved (FR-055).
  - **FR-052c**: When the target names no extension, it MUST match, in order: the path plus `.md`, the
    path plus `.markdown`, then the path exactly as written. When it names an extension, only that exact
    file matches.
- **FR-053**: Wikilink resolution MUST reuse the preview's existing relative-link resolution
  (044 FR-090, FR-084's folder rule), not a second resolver.
- **FR-054**: A target that resolves outside the project MUST be treated as 044 FR-090e treats an
  ordinary link outside the project.
- **FR-055**: An unresolved wikilink MUST render visibly distinct from a working one, using theme tokens,
  and following it MUST show the notice 044 FR-090e shows for a missing target. Following a wikilink MUST
  never create a file.
- **FR-056**: `[[Target#^block-id]]` MUST link to `Target` and ignore the block id. Embeds (`![[…]]`) are
  out of scope and MUST render literally.
- **FR-057**: Find (FR-002) MUST match a wikilink's displayed text, not its `[[…]]` source.

#### Tables (#432)

- **FR-060**: A table in a Markdown preview whose content can fit the panel MUST render no wider than the
  panel, with no horizontal scrollbar, and each column MUST receive a fair share of the width: content
  wraps inside its cell rather than widening its column past that share.
  *Refined by FR-072 and FR-073 (Session 2026-09-29) — short columns stay on one line and the long ones
  wrap first; words do not break mid-word.*
- **FR-061**: No column MUST be squeezed below a minimum legible width by another column's content.
- **FR-062**: A table that cannot fit — too many columns for the minimum width — MUST keep all its
  content reachable by horizontal scrolling.
- **FR-063**: The reader MUST be able to drag a column border to resize the column, live, with a
  column-resize cursor over the border. A hand-set width MUST take precedence over the automatic one.
- **FR-064**: Hand-set widths MUST survive a re-render of the same table while the panel stays open, and
  MUST NOT be persisted: closing the panel, navigating it to another file, or restarting returns every
  table to its automatic widths. *(Clarified 2026-09-28, Q2: the automatic layout is expected to be
  right almost all of the time, so resizing is an occasional override, not a stored preference.)*
- **FR-065**: Resizing MUST write nothing to the file and MUST NOT mark the document dirty (044 FR-020).
- **FR-066**: The front-matter table (044 FR-085) MUST follow the same rules, its key column staying
  readable.
- **FR-067**: Column borders and the drag affordance MUST be drawn from theme tokens only and be visible
  on every shipped theme.
- **FR-068**: The sizing and resizing behaviour MUST be available to any later provider that renders
  tables, not bound to the Markdown provider alone (044 FR-070).

#### Configuration, menus and documentation

- **FR-070**: Every setting and binding this feature adds MUST have a descriptor the preferences editor
  renders (configuration-editor completeness gate) and a reader in the code (Principle X).
- **FR-071**: Every new binding MUST be listed in `docs/key-bindings.md` and every new setting in
  `docs/preferences.md`, in the same change (documentation currency).

#### Manual-test amendments (Session 2026-09-29)

- **FR-072**: **Short columns stay on one line.** A column whose widest cell fits on one line within its
  fair share MUST get the width that cell needs, so none of its entries wrap (an ID, a date, a status, a
  commit hash); the remaining width goes to the longer columns, which wrap instead. Widths MUST be
  measured with the cell's real font and padding, as the table draws it. *(MT-07.)*
- **FR-073**: **No mid-word breaks.** A cell's text MUST wrap only between words — never inside a word,
  and never at a hyphen within one (`MT-01` stays whole). The single exception: a word wider than about
  **40%** of the panel on its own (a long URL, path or hash) MAY break, as a last resort, rather than
  give the table a horizontal scrollbar. A column's minimum is its widest word, up to that limit.
  *(MT-07; the 40% threshold is the user's chosen option.)*
- **FR-074**: **Every find match is outlined** — in editors and previews alike. **Supersedes 013 FR-019
  and 043 FR-067 in part**: the fills stay as derived; an ordinary match additionally carries a thin
  outline from theme tokens at **≥ 3:1** against the surface it sits on, and the current match keeps its
  stronger fill and its own outline (`searchMatchCurrentBorder`), so the two stay distinguishable. It
  MUST hold on every shipped theme. *(MT-01.)*
- **FR-075**: **Supersedes 044 FR-003 in part.** Files & Folders' **Open In** submenu MUST NOT offer a
  plain **Preview** item: **Last Preview Panel** and **New Preview Panel** (FR-014) replace it. The
  default open action (044 FR-052) and the preview commands are unchanged. *(MT-02.)*
- **FR-076**: **Last Preview Panel** MUST be labelled **Last Preview Panel (&lt;panel name&gt;)**, naming the
  preview panel it would reuse (FR-015) as that panel's header shows it *(derived: the header title; not
  confirmed by the user)*. With no preview in the visible tab it stays disabled and unnamed. *(MT-02.)*
  *(Label length amended by FR-080, Session 2026-09-29 round 3.)*
- **FR-077**: **Extends 044 FR-052's routes.** A file dropped onto an **empty** panel — one with no type
  yet — MUST open in the view its provider's default open action names: a preview when that is
  **Preview**, an editor otherwise. *(MT-03.)*
- **FR-078**: **Supersedes FR-034 in part.** When a standalone preview becomes parented because an editor
  opened its document, and that editor is the document's **first** view (no other editor shows it), the
  document MUST adopt the **preview's** fold state, so the new editor opens folded as the preview was.
  When an editor already showed the document, FR-034 stands: the preview adopts the document's state.
  *(MT-04; the first-view condition is derived, not confirmed by the user.)*
- **FR-079**: The Go to Heading pop-down's background MUST differ visibly from its scrollbar thumb, from
  theme tokens, on every shipped theme *(derived: the thumb clears a measurable contrast against the
  pop-down surface; not confirmed by the user)*. *(MT-05.)*
- **FR-080**: **Amends FR-076's label.** The panel name in **Last Preview Panel (&lt;panel name&gt;)** is the
  panel's header title cut to **32 characters** (grapheme clusters) in this menu item, whatever
  `tabs.maxNameLength` is set to. *(MT-02, Session 2026-09-29 round 3.)* *(Superseded in part by FR-082
  (Session 2026-09-29, round 4) — 32 characters still read long, and the " - Preview" suffix repeated what
  the item already says.)*
- **FR-081**: **Supersedes in part 044's preview placement and US2 acceptance scenario 5, for opens from
  Files & Folders.** Activating a file in Files & Folders (click, double-click or Enter, per the
  open-on-click setting) MUST leave Files & Folders the active pane, with the tree keeping the keyboard —
  whether the file opens in an editor or a preview, and whether the preview is placed new, reuses the Last
  Active preview or is one that already shows the file. The preview is still shown: its tab brought
  forward and made that tab's active panel. Opens from other routes (Open In menus, drops, commands,
  links) keep their focus behaviour *(derived; not confirmed by the user)*. *(Session 2026-09-29 round 3:
  "keep the explorer view active instead, so users can do things like rename with F2".)*
- **FR-082**: **Supersedes FR-080 in part.** The panel name in **Last Preview Panel (&lt;panel name&gt;)** is
  the panel's **name without the header's " - Preview" suffix** (the item already says "Preview Panel"),
  cut to **16 characters** (grapheme clusters) whatever `tabs.maxNameLength` is set to, and a name that
  was cut MUST end in an ellipsis (**…**). A name of 16 characters or fewer shows whole, with no ellipsis.
  *(MT-02, Session 2026-09-29 round 4.)*
- **FR-083**: **Extends FR-081.** A file opened from File Explorer — activated (click, double-click or
  Enter), or through its **Open In** menu's preview or editor items — MUST briefly flash the border of the
  panel it lands in, whether that panel is placed new, reused, or already showed the file, so the user can
  see where it went. The flash is shown in this window only (a panel in another window is raised by main
  as before), lasts under a second, and never takes the keyboard or blocks the pointer; with reduced motion
  set it is a single fade rather than a blink. A preview link to a file no preview claims opens as from File
  Explorer (044 FR-090d) and flashes likewise; opens from other routes do not flash *(derived: the
  duration, the Open In items and reduced-motion behaviour; not confirmed by the user)*. *(MT-02, Session
  2026-09-29 round 4: "make the target panel's border flash briefly, just so the user knows where the
  file they just opened is".)*
- **FR-084**: **Extends 004 FR-026.** With open-on-click set to **single click**, a double click on a file in
  File Explorer MUST open it once: only the first click of a multi-click (the browser's click count, which
  follows the OS double-click time) opens the file; its second click and the double click open nothing. A
  separate click on the same file opens it again however soon it comes — cancelling the unsaved-changes
  prompt and clicking the file again is a new click. *(MT-02, Session 2026-09-29 round 4: "detect double
  clicks and disable the second click action for about 400ms after it is initially clicked". A fixed 400ms
  window was tried first and swallowed that deliberate re-click, failing `editor-open.e2e.ts`; the click
  count detects the double click itself.)*

### Key Entities

- **Document fold state**: which sections of one Markdown document are collapsed. One per document;
  shared by its editor views and parented preview; a standalone preview holds its own, and each preview
  history entry keeps an in-memory snapshot (FR-041d). Keyed by the heading the pipeline recorded, not by
  DOM position.
- **Heading symbol**: a heading's level, rendered text, slug and source line, as the Markdown pipeline
  records it. Feeds the outline, the fold points and heading navigation; the shape #375 shares.
- **Last active preview panel**: per window workspace, the preview panel that most recently had focus,
  with a fallback order when it closes.
- **Wikilink**: target name or relative path, optional heading, optional alias; resolved to a project
  file or to "unresolved".
- **Column widths**: per rendered table, the hand-set widths that override the automatic sizing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can find and reach any phrase in a previewed document without leaving the
  preview, in the same number of keystrokes as in an editor.
- **SC-002**: With Open previews in = Last Active, opening ten Markdown files in turn leaves exactly one
  preview panel, and Back walks through all ten.
- **SC-003**: Collapsing or expanding a section in either view is reflected in the other within the
  preview's update delay (044 FR-060), in 100% of attempts.
- **SC-004**: A reader can reach any named section of a 900-line document from the outline in under
  five seconds, without scrolling.
- **SC-005**: Every wikilink form in User Story 6 opens the same target as its equivalent ordinary link.
- **SC-006**: In a preview half the width of a typical window, every column of a table with a long
  unbroken cell stays at or above the minimum legible width.
- **SC-006a**: With no hand resizing, at least **95%** of the tables in a representative corpus — every
  table in this repository's `docs/` and `specs/` — render with every column legible and no horizontal
  scrollbar, in a preview half the width of a typical window. The remainder are tables that genuinely
  cannot fit (FR-062). *(Clarified 2026-09-28, Q2.)* *(Target amended to 90% by SC-006b (Session
  2026-09-29, round 4) — FR-073 forbids the mid-word breaks the 95% relied on.)*
- **SC-006b**: **Supersedes SC-006a's target.** The same measurement MUST reach at least **90%**. Measured
  at 92.2% (844 of 915, T084); the tables that scroll are those whose unbreakable tokens — chords such as
  `Ctrl+Shift+Alt+ArrowRight`, dotted setting keys — together exceed the panel, which FR-073 keeps whole.
  *(Session 2026-09-29, round 4.)*
- **SC-007**: No action added by this feature changes a file on disk or marks a document dirty.

## Assumptions

- "Open-in-place" in the maintainer's request is #405.
- Open previews in ships as **Last Active**, matching #405's proposal and the editor's own default
  (023 FR-025).
- Wikilinks deliberately differ from Obsidian's vault-wide name lookup: they resolve as paths (FR-052),
  so a link means the same thing wherever the vault is opened from.
- An unresolved wikilink reuses 044 FR-090e's missing-target notice rather than offering "create file";
  044 forbids a followed link creating a file.
- Fold state is session-only (FR-041b); persisting it can follow as a separate issue if wanted.
- The Go to Heading pop-down's exact height is a planning decision; it is fixed, not user-sized.
- Ctrl+G is the editor's Go to Line chord; in a preview it has no current meaning, so reusing it there
  for Go to Heading is subject only to 046 FR-021's check within the preview scope.
- Out of scope: Mermaid (#392), math (#393), PDF (#388), image preview panels (#441), regex mode (#376),
  editor outlines for languages other than Markdown (#375), wikilink embeds, backlinks and graph views,
  keyboard-driven column resizing, table sorting.

## Clarifications

### Session 2026-09-28

- Q: When several files are dropped on a preview panel at once, what happens? → A: The first goes into
  the dropped-on panel; the rest always open in new preview panels, whatever Open previews in says
  (FR-024).
- Q: Do hand-set table column widths survive closing the panel or a restart? → A: No — only while the
  panel is open. The maintainer expects the automatic layout to be right about 95% of the time, which
  SC-006a now measures (FR-064).
- Q: Should a preview paired with an open editor be reused for a different file (Last Active, Last
  Preview Panel, or a drop)? → A: Yes. The preview changes file and its link to the editor is broken; the
  editor stays open. Back re-pairs it while the editor is open, and shows the file standalone once the
  editor has closed (FR-016, FR-016a).
- Q: How should collapsing nest, and what should the fold menu items be called? → A: Collapsing a
  section keeps its nested sections' own state, so re-expanding an H1 restores its H2s/H3s as they were
  (FR-030a). Context menu items are context-sensitive and named for the section they act on — "Collapse
  This H2" — not "Collapse All" (FR-036, FR-037).
- Q: What do Collapse All / Expand All and the "start collapsed" setting do? → A: Collapse or expand every
  section at every level, individually; bound to the Visual Studio / ReSharper outlining chords
  (Ctrl+M, M / L / S / E / A / X) (FR-037a, FR-037b).
- Q: Where do the preview's outline controls appear, and are they shown by default? → A: In a soft,
  non-resizable gutter down the preview's left edge that shifts the document right; shown by default;
  switched only by the "Markdown preview gutter: Enabled / Disabled" preference; built to take more icons
  later (FR-032a, FR-032b).
- Q: How is the heading tree laid out and used? → A: A fixed-height pop-down over the top of the preview
  with its own scrollbar and a typeahead search box, opened by Ctrl+G, scrolled to and highlighting the
  current section. Down from the search box goes to the current entry; Up past the first entry or Ctrl+G
  returns to the search box. Click/Enter smooth-scrolls the document (duration setting in ms). Tree
  nodes collapse independently of document folding; search finds and expands them (FR-042 – FR-045).
- Q: When a preview moves to another file and the reader presses Back, do the earlier file's folds come
  back? → A: Yes — each history entry remembers its fold state for the panel's lifetime (not across a
  restart); an open editor's shared fold state wins when Back re-pairs (FR-041d).
- Q: When two files share a wikilink's name, which does `[[Note]]` open? → A: Neither is searched for.
  A wikilink is a path: no leading `/` is relative to the current file's folder (`[[README]]`,
  `[[../README]]`); a leading `/` is from the project root. `.md`, then `.markdown`, then the exact name
  (FR-052 – FR-054).
- Q: Under Last Active, what if the last-used preview is in a tab that isn't showing? → A: Only reuse a
  preview in the visible tab; otherwise open a new panel. The preference's description says so (FR-015,
  FR-015a).

### Session 2026-09-29

From the maintainer's manual tests of the branch (MT-01 – MT-05, MT-07).

- Q: Should a table's short entries wrap before its long ones? → A: No. Short columns (an ID, a date, a
  status, a hash) stay on one line and the longer columns wrap instead (FR-072).
- Q: May a word break mid-word, or at a hyphen, to fit a column? → A: No — `MT-01` stays whole. Only a
  word wider than about 40% of the panel on its own may break, as a last resort, rather than give the
  table a scrollbar (FR-073).
- Q: How should find matches become clearer, in editors and previews? → A: Outline every match: an
  ordinary match gets a thin outline at ≥ 3:1 against the page, and the current match keeps its stronger
  fill and outline (FR-074).
- Q: Does Files & Folders' Open In keep its plain Preview item beside Last and New Preview Panel? →
  A: No, remove it; it is obsolete (FR-075).
- Q: How is Last Preview Panel labelled? → A: **Last Preview Panel (&lt;panel name&gt;)**, naming the panel
  it would reuse (FR-076; the header title as the name is derived, not confirmed by the user).
- Q: A file dropped onto an empty panel — editor or preview? → A: Whichever the file's default open action
  in Preferences names (FR-077).
- Q: A preview with sections collapsed gains a newly opened editor — whose fold state wins? → A: The new
  editor follows the preview's outlining (FR-078; the "document's first view" condition is derived, not
  confirmed by the user).
- Q: Must the Go to Heading pop-down's background differ from its scrollbar? → A: Yes, slightly, so the
  scrollbar is distinguishable (FR-079; the measurable separation is derived, not confirmed by the user).
- Q: How long may the panel name in Last Preview Panel (&lt;name&gt;) be? → A: Truncated to 32 characters
  (FR-080, round 3).
- Q: A file activated in Files & Folders opens in a preview — where does the keyboard go? → A: It stays in
  Files & Folders, "so users can do things like rename with F2" (FR-081, round 3; that other open routes
  keep their behaviour is derived, not confirmed by the user).
- Q: How is the name in Last Preview Panel (&lt;name&gt;) shortened? → A: 16 characters, without
  " - Preview", with an ellipsis when cut (FR-082, round 4).
- Q: Clicking between files with several previews open still sometimes moves the keyboard to the preview
  — is that FR-081? → A: Yes, a defect against FR-081: it holds for every open from Files & Folders,
  including one whose preview already exists (round 4).
- Q: With the keyboard left in File Explorer, how does the user see where a file opened? → A: The target
  panel's border flashes briefly (FR-083, round 4; which routes, the duration and reduced-motion behaviour
  are derived, not confirmed by the user).
- Q: SC-006a's 95% table-fit target is unreachable while FR-073 keeps words whole (92.2% measured) —
  which gives? → A: Lower the target to 90% (SC-006b, round 4).
- Q: In single-click mode, what does a double click on a file do? → A: Opens it once; repeat clicks on the
  same file within about 400ms are ignored (FR-084, round 4; implemented with the browser's click count
  rather than a timer, so a deliberate re-click still opens).
