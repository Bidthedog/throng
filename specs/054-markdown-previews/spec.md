# Feature Specification: Markdown Previews — Restored Reuse, Outlining Submenu, Task Lists, Mermaid, Search Results, Maximise

**Feature Branch**: `feature/S054-I474-I469-I462-I392-I478-I467-markdown-previews`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Markdown previews group for v1.0.0, covering
[#474](https://github.com/Bidthedog/throng/issues/474) (a restored preview is ignored by Last Active),
[#469](https://github.com/Bidthedog/throng/issues/469) (Outlining submenu with Collapse/Expand All
Inside This H*n*), [#462](https://github.com/Bidthedog/throng/issues/462) (tick task-list checkboxes in
previews, writing the source) and [#392](https://github.com/Bidthedog/throng/issues/392) (Mermaid
diagram previews). Maintainer priority: Markdown previews, Markdown editing and terminals matter most;
code-editor features are deprioritised." Added before clarification (2026-10-10), at the maintainer's
request: [#478](https://github.com/Bidthedog/throng/issues/478) (a Find in Files result opens Markdown in
an editor even when Preview is the default open action). Added in clarification (2026-10-10):
[#467](https://github.com/Bidthedog/throng/issues/467) (maximise a panel to fill its tab's middle
section), because diagram Full Pane shares its mechanism.

This feature builds on spec **044** (file previews) and spec **047** (Markdown preview enhancements).
It **supersedes** or narrows six of their requirements, each restated where it is replaced:

| Superseded | By | What changes |
|---|---|---|
| 044 FR-020 | FR-020 | A task-list checkbox click is the one input in a preview that changes the source |
| 044 FR-080 | FR-021 | Task lists render as checkboxes that toggle the source, not read-only ones |
| 044 FR-086 | FR-040 | A `mermaid` fenced block renders as a diagram, not as code (math is unchanged) |
| 047 FR-036 | FR-010 | The fold rows move from the top level of the body context menu into an **Outlining** submenu |
| 040 FR-035 | FR-050a | Preferences fields gain a second, optional nesting level (`subsection`) under `subgroup`; still no recursion |
| 044 FR-090 | FR-008 | A link to a file of a different preview type no longer opens in place |
| 044 FR-054 | FR-030 | A Find in Files result honours the default open action when the provider can reveal a match; 044 *Finding 4*'s "043 FR-037 / FR-087c untouched" note no longer holds for such providers |

044 FR-055 (Open In's editor targets always open an editor), 044 FR-021 (document commands inert while a preview has focus), 044 FR-081/FR-082/FR-093
(sanitisation, no code execution, no remote resources) and 047 FR-015 (which preview Last Active
reuses) are **not** changed; this feature must satisfy them.

## Clarifications

### Session 2026-10-10

- Q: When a restored tab holds more than one preview, which does Last Active reuse? → A: **Exactly
  what opening a `.md` file from File Explorer does** — the last active preview, with restored previews
  counting and their recency surviving the restart; and if the file already has a preview, its tab is
  brought forward and that preview focused. (FR-002, FR-004)
- Q: Is the standalone `.mmd`/`.mermaid` provider in this feature? → A: **Yes, both halves of #392.**
  Use an existing library for rendering wherever one fits. (FR-042)
- Q: Which preference routes a Find in Files result? → A: **Both, in order.** **Default open action**
  decides editor or preview; only when it is **Preview** does **Open previews in** decide which preview
  panel. With Editor, Open previews in is ignored. (FR-030)
- Q: Should **Open previews in** be explicit about Markdown? → A: **Yes.** Markdown-specific settings get
  their own **Markdown** subsection under **Editor → Previews**, every Markdown and preview setting is
  audited into the right place, and Open previews in is labelled for Markdown. (FR-050 – FR-055)
- Q: When a Mermaid file is opened under Last Active, may it reuse the last active Markdown preview
  (and the other way round)? → A: **No — same type only.** Every preview provider, now and in future, is
  its **own preview panel type** ("Markdown Preview", "Mermaid Preview"), and every type follows the same
  rules and has the same access and activation points as Markdown previews unless a spec explicitly says
  otherwise. (FR-005 – FR-008)
- Q: When a checkbox is ticked in a preview and no editor holds unsaved changes to the file, is the
  change saved to disk immediately? → A: **Yes**; with unsaved editor changes it is applied to that
  document and left unsaved. (FR-025)
- Q: While a diagram's source is temporarily invalid, does the preview keep the last good diagram or
  replace it with the notice? → A: **Keep the last good diagram, dimmed, with the notice above it**; a
  diagram that has never rendered shows the notice alone. (FR-044)
- Q: When a diagram is wider than the preview, does it shrink to fit or scroll? → A: **Shrink to fit
  down to a readable minimum, then scroll** — plus per-diagram view controls fixed in the top-left of
  each diagram's box (Fit, Full Size, Zoom In, Zoom Out, Full Pane), on embedded and standalone
  diagrams alike; middle-mouse drag pans; Full Size fills the panel's frame; Full Pane maximises the
  diagram over the middle section, sharing #467's maximise mechanism. (FR-046a – FR-046h)
- Q: Is #467 (maximise a panel) built in this feature, since Full Pane shares its mechanism? → A:
  **Yes.** One maximise mechanism serves whole panels and sections inside panels (a diagram now, an
  image in a preview later). Anything maximised is a **modal for the middle section**: the tab's other
  actions are restricted until it is restored. (FR-070 – FR-079; FR-046f)
- Q: Should Maximise / Restore Panel ship with a default shortcut, and which? → A: **Alt+Shift+Enter**
  (the same combination as Visual Studio's full-screen toggle). In a focused terminal it is consumed
  by throng and no longer reaches the shell as a line break; **Shift+Enter** and **Ctrl+Enter** MUST
  stay untouched in terminals and editors. (FR-071a)
- Q: When a copied section of a Markdown preview contains a diagram, what does the clipboard hold
  there? → A: **Rich text: the diagram as a picture; plain text: its Mermaid source.** (FR-049a)
- Q: Full Pane on a diagram inside an already-maximised preview — nest, or restore the preview first?
  → A: **Nest**: the diagram covers the maximised preview, and Esc steps back one level at a time.
  (FR-074)
- Q: Collapsible preferences sections? → A: Not tracked anywhere; filed as
  [#479](https://github.com/Bidthedog/throng/issues/479) in v1.0.0. Not part of this feature unless
  scheduled into it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A restored preview is reused by Last Active (Priority: P1)

A user works with **Open Previews in** set to **Last Active**. They quit throng with a Markdown
preview open, relaunch, open the project, and preview a different `.md` file from Files & Folders
without first clicking the restored preview. The restored preview shows the new file; no second
preview panel appears.

**Why this priority**: It is the only open v1.0.0 bug in the group, every session that starts with a
preview open hits it, and the fix is small.

**Independent Test**: Seed a saved layout holding one preview panel, launch, open another Markdown file
in preview, and confirm the tab still holds exactly one preview panel, now showing the second file.

**Acceptance Scenarios**:

1. **Given** Last Active, and a project whose saved layout has one preview panel in the visible tab,
   **When** the user launches throng and previews a different Markdown file without touching the
   restored preview, **Then** the restored preview panel shows the new file and no new panel opens.
2. **Given** a restored tab holding two preview panels, **When** the user previews another file,
   **Then** the preview that was most recently active before the app was closed is reused.
3. **Given** a restored preview in a **background** tab only, **When** the user previews a file from the
   visible tab, **Then** a new preview opens in the visible tab and the background tab is unchanged
   (047 FR-015).
4. **Given** **New Preview Panel** mode, **When** the user previews a file after launch, **Then** a new
   panel opens as today; restored previews are not reused.

---

### User Story 2 - Tick off a task list while reading it (Priority: P1)

A user reading a README or spec in a preview clicks an unchecked task-list checkbox. It becomes ticked,
and that item's `[ ]` becomes `[x]` in the file. Clicking it again unticks it. Nothing else in the file
changes.

**Why this priority**: Ticking a list while reading it is the main reason to keep one in Markdown, and
it is the first time a preview edits Markdown — the maintainer's stated priority.

**Independent Test**: Preview a fixture with task items in every list shape (nested, in a block quote,
`-`/`*`/`+`, numbered, `[x]` and `[X]`), click each, and diff the file: exactly one marker changes per
click, on the right line.

**Acceptance Scenarios**:

1. **Given** a preview of a file not open in any editor, **When** the user clicks an unchecked
   checkbox, **Then** the box shows ticked, that line's `[ ]` becomes `[x]` on disk, and the preview
   keeps its scroll position.
2. **Given** a checked item written `[x]` or `[X]`, **When** the user clicks it, **Then** it becomes
   `[ ]`.
3. **Given** an editor open on the same file with **unsaved** edits, **When** the user clicks a
   checkbox in the preview, **Then** the toggle appears in the editor at once, the unsaved edits
   survive, the document stays unsaved, and Ctrl+Z in the editor undoes the toggle.
4. **Given** an editor open on the same file with **no** unsaved edits, **When** the user clicks a
   checkbox, **Then** the toggle is applied and saved, the editor shows it and stays clean, and Ctrl+Z
   in the editor undoes it (leaving the document unsaved).
5. **Given** a read-only or locked file, **When** the user clicks a checkbox, **Then** one notice says
   the file could not be changed, and the checkbox keeps its previous state.
6. **Given** any preview, **When** the user types, pastes or drops into it, **Then** nothing in the file
   or the document changes (044 FR-020 otherwise intact).

---

### User Story 3 - A search result opens Markdown where the user reads it (Priority: P1)

A user who has set Markdown's default open action to **Preview** runs Find in Files and clicks a result
in a `.md` file. The file's preview opens — or the last active one is reused — scrolled to the match,
with the match highlighted. They are not dropped into the source.

**Why this priority**: Raised by the maintainer as a defect in daily use; anyone reading Markdown in
previews hits it on every search.

**Independent Test**: With Markdown's default open action set to Preview, search for a term in a
fixture `.md` and click the result; confirm a preview, not an editor, shows the match highlighted and
in view.

**Acceptance Scenarios**:

1. **Given** Markdown's default open action is Preview, **When** the user clicks a Find in Files result
   in a `.md` file, **Then** the file's preview shows with the match scrolled into view and
   highlighted, and no editor opens.
2. **Given** Last Active and a preview already in the visible tab, **When** the user clicks a result,
   **Then** that preview is reused; under New Preview Panel a new one opens.
3. **Given** Markdown's default open action is Editor, **When** the user clicks a result, **Then** an
   editor opens at the match as today.
4. **Given** a match the rendered preview cannot show (hidden front matter, inside a diagram), **When**
   the user clicks it, **Then** an editor opens at the match instead.
5. **Given** the file is already open in an editor with a preview beside it, **When** the user clicks a
   result, **Then** the preview reveals the match. [Assumed — see Assumptions.]

---

### User Story 4 - See Mermaid diagrams in Markdown previews (Priority: P2)

A user previews a README or spec containing a ` ```mermaid ` fenced block. The preview shows the
diagram, coloured from the active theme, instead of its source text. A diagram with a syntax error shows
one inline notice naming the error in its place; the rest of the document renders normally.

**Why this priority**: Diagrams are how architecture lives in Markdown, and today they can only be
checked by pasting them into a browser tool. Requested by the maintainer for this feature.

**Independent Test**: Preview a fixture with a flowchart, a sequence diagram, an invalid diagram and an
ordinary code block, in one light and one dark theme; confirm two diagrams, one notice and one
highlighted code block.

**Acceptance Scenarios**:

1. **Given** a `.md` file with a valid ` ```mermaid ` block, **When** it is previewed, **Then** the
   block renders as a diagram in the active theme's colours, and every other fenced block still
   renders as highlighted code.
2. **Given** a parented preview, **When** the user edits the diagram source in the editor, **Then** the
   diagram updates without a save, on the preview's existing live-update cadence (044 FR-060).
3. **Given** an invalid diagram that has never rendered, **When** previewed, **Then** one inline notice
   naming the parse error shows in its place; the rest of the document renders.
4. **Given** a diagram that rendered and is then edited into invalid source, **When** the preview
   updates, **Then** the last good diagram stays, dimmed, with the notice above it, and both clear when
   the source is valid again.
5. **Given** a diagram using `click` directives, HTML labels containing script or event handlers, or a
   `javascript:` URL, **When** previewed, **Then** nothing executes and no network request is made.
6. **Given** a diagram wider than the preview, **When** it renders, **Then** it is shrunk to fit; the
   user can Zoom In/Out, drag it with the middle mouse button, choose Full Size to fill the panel, or
   Full Pane to fill the middle section and Esc back — and the controls stay put in the box's top-left
   corner throughout.
7. **Given** the Markdown provider's **Render Mermaid diagrams** setting turned off, **When** the
   preview is showing, **Then** Mermaid blocks render as code again, without a restart.
8. **Given** a preview with no Mermaid content, **When** it opens, **Then** the diagram renderer is not
   loaded.

---

### User Story 5 - Preview a standalone Mermaid file (Priority: P3)

A user opens a `.mmd` or `.mermaid` file. Its editor offers the preview button; the preview shows the
diagram, live as they type, through the same provider machinery every other preview uses.

**Why this priority**: Same renderer as Story 4 at small extra cost, and it holds 044 User Story 5 to
its promise (a new preview type is one provider). Standalone diagram files are rarer than embedded ones.

**Independent Test**: Open a `.mmd` file, open its preview, edit the source, and confirm the diagram
follows; Open In → Preview on an unopened `.mermaid` file shows a standalone preview.

**Acceptance Scenarios**:

1. **Given** a `.mmd` or `.mermaid` file open in an editor, **When** the user clicks the preview
   button, **Then** a preview opens beside it showing the diagram, and follows the buffer live.
2. **Given** an unopened `.mermaid` file, **When** the user chooses Open In → Preview, **Then** a
   standalone preview shows the diagram and follows the disk.
3. **Given** the Mermaid provider disabled under **Editor - Previews**, **When** the user looks for any
   `.mmd` preview affordance, **Then** there is none, and open Mermaid previews close; embedded
   rendering in `.md` follows the Markdown provider's own setting.

---

### User Story 6 - Fold or unfold one section and everything under it (Priority: P3)

A user right-clicks inside an H2 section of a long Markdown document, in the editor or the preview, and
opens **Outlining →**. They choose **Collapse All Inside This H2**: that section and every heading
nested under it fold; the rest of the document is untouched. All fold rows now live in that submenu.

**Why this priority**: A reorganisation plus one scoped command; useful, but nothing is broken today.

**Independent Test**: In a fixture with nested H2/H3/H4 sections, run Collapse All Inside This H2 and
check the fold state of every section inside and outside it, in both the editor and the preview.

**Acceptance Scenarios**:

1. **Given** a Markdown editor or preview, **When** the user right-clicks inside a section, **Then**
   the menu shows an **Outlining** submenu holding every fold row, and no fold row remains at the top
   level of the menu.
2. **Given** the cursor inside an H2, **When** the user chooses **Collapse All Inside This H2**,
   **Then** that H2 and every heading nested under it collapse, each individually; sections outside it
   are unchanged, in both linked views.
3. **Given** the same, **When** the user chooses **Expand All Inside This H2**, **Then** that H2 and
   every heading nested under it expand; sections outside are unchanged.
4. **Given** a right-click before the first heading, **When** the submenu opens, **Then** the *This
   H*n** and *All Inside This H*n** rows are absent, and Collapse All / Expand All behave as today.
5. **Given** a non-Markdown document, **When** the user right-clicks, **Then** there is no Outlining
   submenu.

---

### User Story 7 - Find every Markdown setting in one place (Priority: P3)

A user opens Preferences to change how Markdown previews behave. Under **Editor → Previews** they find
the settings shared by every preview, and beneath them a **Markdown** subsection holding every
Markdown setting — including **Markdown: Open previews in** and **Markdown sections open** — and a
**Mermaid** subsection for diagram files. A choice they made before upgrading is still in effect.

**Why this priority**: Requested by the maintainer alongside this feature; Mermaid makes "previews"
plural, so settings that silently meant "Markdown" need saying so.

**Independent Test**: Seed a settings file with **Open previews in** = New Preview Panel, launch, and
confirm both **Markdown: Open previews in** and **Mermaid: Open previews in** read New Preview Panel,
and that every row sits where FR-051 places it.

**Acceptance Scenarios**:

1. **Given** Preferences → Settings, **When** the user opens Editor → Previews, **Then** the shared
   preview settings are listed first, followed by a Markdown subsection and a Mermaid subsection, each
   row placed as FR-051 lists.
2. **Given** a settings file written before this feature with New Preview Panel chosen, **When** the
   user upgrades and launches, **Then** **Markdown: Open previews in** reads New Preview Panel and
   previews open in new panels.
3. **Given** a preferences search for "open previews", **When** results show, **Then** each provider's
   Open previews in row is found.

---

### User Story 8 - Give one panel or diagram the whole middle section for a while (Priority: P2)

A user with three panels split side by side maximises a terminal to watch a busy build. It fills the
tab's middle section; the other panels are hidden but intact, and split, `+` and drop are disabled.
They restore it and the layout is exactly as before. Later, in a Markdown preview, they choose **Full
Pane** on a large diagram; it takes over the middle section the same way, and Esc returns it to the
document.

**Why this priority**: Requested in #467 and needed by diagram Full Pane; one mechanism serves both.

**Independent Test**: In a tab with three split panels, maximise each panel type in turn, attempt every
disabled action, switch tabs and back, resize a side pane, restore, and compare the layout to its
starting state; repeat with a diagram's Full Pane.

**Acceptance Scenarios**:

1. **Given** a tab with several panels, **When** the user maximises one from its menu or header
   control, **Then** it fills the middle section, is marked maximised with a Restore control, and the
   others are hidden, not closed.
2. **Given** a maximised panel, **When** the user tries to split, press `+`, drop a panel, or pick a
   hidden panel from *Open in*, **Then** split, `+` and drop are disabled and the hidden panels are not
   offered.
3. **Given** a maximised panel, **When** the user switches tabs and back, or resizes a side pane, and
   then restores, **Then** the panel is still maximised after the switch, and after restore every
   panel has its original position and size.
4. **Given** a maximised Markdown preview under Last Active, **When** the user previews another
   Markdown file, **Then** the maximised preview shows it; an open that would land in a hidden panel
   restores first.
5. **Given** a diagram in Full Pane, **When** the user presses Esc or Restore, **Then** the diagram
   returns to its place in the document with its zoom and pan kept.
6. **Given** a maximised Markdown preview, **When** the user chooses Full Pane on one of its diagrams
   and then presses Esc twice, **Then** the diagram first covers the maximised preview, the first Esc
   returns to the maximised preview, and the second restores the tab's layout.
7. **Given** a maximised terminal whose shell exits, **When** the user changes the panel to an editor,
   **Then** the panel stays maximised.

---

### Edge Cases

- **Restored layout with no recorded recency** (a layout saved before this feature): the reuse
  candidate is chosen by FR-002's fallback rather than opening a duplicate.
- **Restored preview closed before the first open**: the next most recent preview in the tab is used,
  or a new panel opens if none remains (047 FR-015).
- **Task file changed on disk since the preview rendered**: the toggle applies to the item in the
  current content if it can still be identified unambiguously; otherwise it is refused with one notice.
  It never writes to a different line.
- **Two clicks in quick succession**: each applies in order to the then-current state; the second click
  never acts on a stale render.
- **A checkbox inside a front matter table, a code block or inline HTML**: not a task-list item;
  nothing to toggle.
- **A task item whose source spans several lines** (a lazy continuation or a wrapped paragraph): only
  the marker on the item's first line changes.
- **Line endings and encoding**: a toggle preserves the file's line endings, encoding and BOM.
- **A preview of a file outside every project** (044's out-of-project preview, if any): the toggle is
  refused with one notice (Principle I).
- **A huge or pathological diagram**: rendering is bounded; a diagram that cannot render within the
  bound shows the inline notice rather than freezing the preview.
- **Theme change with a diagram showing**: the diagram re-renders in the new theme without reopening
  (044 FR-083).
- **Find in a preview with diagrams** (047): diagram text is not a find target unless the renderer
  exposes it as text; find never breaks on a diagram.
- **A Find in Files match inside a collapsed section of the preview**: the section expands to show it,
  as preview find already does (#455).
- **A Find in Files match inside a maximised tab**: FR-074's open rule applies — a maximised preview of
  that type is reused in place; a hidden one is never targeted.
- **A maximised panel is closed**: the tab restores and its layout reflows exactly as closing that
  panel un-maximised would.
- **The maximised tab is dragged to another window or its project unloads**: the tab arrives or reloads
  un-maximised (FR-076).
- **Esc inside a maximised terminal or editor**: goes to the terminal or editor as today; Restore stays
  available from the control, the menu and the binding.
- **Collapse All Inside on a heading with no nested headings**: it acts as Collapse This H*n*.

## Requirements *(mandatory)*

### Functional Requirements

#### Restored previews and Last Active (#474)

- **FR-001**: Under **Last Active**, a preview panel restored from a saved layout MUST be a candidate for
  reuse exactly as if the user had focused it, so the first preview opened after launch reuses a
  restored preview in the visible tab instead of opening a new panel. 047 FR-015's scope rules (visible
  tab only; never a background tab, another window, project or sub-workspace) are unchanged.
- **FR-002**: When a restored tab holds more than one preview panel, the reused panel MUST be the one
  most recently active before the layout was saved: each tab's preview recency MUST be saved with the
  layout and restored with it. A layout saved before this feature carries no recency; for it, the
  tab's focused preview is used, else the first preview in the tab's layout order.
- **FR-003**: **New Preview Panel** mode MUST be unaffected.
- **FR-004**: An open that resolves to a preview — by the default open action, Open In → Preview, or a
  Find in Files result (FR-030) — of a file that already has a preview MUST bring forward the tab
  holding that preview and focus it, whichever route opened it, never a second preview of the file
  (044 FR-012). This is the one case where a tab other than the visible one
  is brought forward; 047 FR-015's rule that a **reuse** candidate is never taken from a hidden tab is
  unchanged.

#### One preview panel type per provider

- **FR-005**: Every preview provider MUST be its **own preview panel type**, named for its provider —
  **Markdown Preview** and **Mermaid Preview** in this feature — replacing today's single **Preview**
  panel type. A panel's type is shown wherever a panel type is shown today (panel title fallback, title
  menu, layout).
- **FR-006**: Every preview panel type MUST follow the same rules and offer the same access and
  activation points as Markdown previews — editor status-bar preview button, Open In → Preview, Files &
  Folders, Quick Open, Find in Files (FR-030), default open action, Open previews in, title menu, layout
  persistence, enable/disable — unless a spec explicitly says otherwise for that type. This is the
  standing rule for every preview type added after this feature.
- **FR-007**: **Last Active reuse is per type.** An open MUST reuse only the most recently active
  preview **of the file's own type** in the visible tab (047 FR-015's scope otherwise unchanged); with
  none, a new panel of that type opens. A Markdown file never replaces a Mermaid preview, or the
  reverse.
- **FR-008**: *(Narrows 044 FR-090.)* A followed link to a file whose provider is a **different** type
  from the preview it is clicked in MUST NOT open in place; it MUST open as an open of that file would
  (FR-007, FR-004). A link to a file of the **same** type still opens in place (044 FR-090).
- **FR-009**: A saved layout holding a preview panel of the old single **Preview** type MUST restore as
  the panel type of the file it shows; a restored preview of a file with no enabled provider restores
  as 044 already prescribes for that case. Restoring the same layout again MUST change nothing.

#### Outlining submenu (#469)

- **FR-010**: *(Supersedes 047 FR-036's placement.)* The body context menu of a Markdown editor and of a
  Markdown preview MUST group every fold row in one **Outlining** submenu, in this order: Collapse /
  Expand This H*n*, Collapse All Inside This H*n*, Expand All Inside This H*n*, Collapse All, Expand
  All. No fold row remains at the top level. The editor and the preview MUST show identical submenus.
  The submenu uses the same submenu mechanism as the existing *Split* and *Open in* submenus.
- **FR-011**: **Collapse All Inside This H*n*** MUST collapse the innermost section at the point the
  menu was opened and every section nested beneath it, each individually (as 047 FR-037a does for the
  whole document); **Expand All Inside This H*n*** MUST expand the same set. Sections outside it MUST be
  unchanged. Both act on the linked view too (047 FR-033) and are view state only (047 FR-035).
- **FR-012**: Both rows follow 047 FR-036's naming and visibility: labelled with the section's level,
  and absent when the menu is opened before the first heading. Collapse All / Expand All keep their
  current behaviour there.
- **FR-013**: **Collapse All Inside This Section** and **Expand All Inside This Section** MUST be
  bindable commands, scoped like the other outlining commands (047 FR-037b), shipping **unbound**.
  Every existing outlining binding MUST still work and still be shown against its row in the submenu.
- **FR-014**: Non-Markdown documents MUST show no Outlining submenu.

#### Task-list checkboxes (#462)

- **FR-020**: *(Supersedes 044 FR-020.)* A preview panel MUST be read-only except for one sanctioned
  input: toggling a Markdown task-list checkbox (FR-022). No keystroke, paste, drop or other command
  issued in a preview changes the file or the source document. 044 FR-021 is unchanged.
- **FR-021**: *(Supersedes 044 FR-080's "task lists (shown as read-only checkboxes)".)* The Markdown
  provider MUST render task lists as checkboxes that toggle their source.
- **FR-022**: Clicking a task-list checkbox MUST change that item's marker in the source — `[ ]` to
  `[x]`, or `[x]`/`[X]` to `[ ]` — and nothing else on the line or in the file. When the checkbox has
  keyboard focus, **Space** MUST do the same.
- **FR-023**: Each rendered checkbox MUST map to its exact source item, including nested lists, lists in
  block quotes, `-`/`*`/`+` and numbered markers, and both `[x]` and `[X]`.
- **FR-024**: The toggle MUST go through the shared document that editors use, never a direct file
  write, so an editor open on the file shows it immediately and can undo it like any other edit.
- **FR-025**: If no editor holds unsaved changes to the file, the toggle MUST be saved to disk
  immediately. If an editor holds unsaved changes, the toggle MUST be applied to the open document and
  the document left unsaved; the user's unsaved edits MUST survive.
- **FR-026**: The preview MUST re-render with the new state and keep its scroll position.
- **FR-027**: If the source has changed since the preview rendered, the toggle MUST apply to the same
  item in the current content when it can be identified unambiguously, and otherwise be refused with
  one notice. A toggle MUST never change a different line.
- **FR-028**: A file that is read-only, locked, or outside the preview's project MUST refuse the toggle
  with one notice on the preview, and the checkbox MUST keep its previous state. The notice follows the
  repository's one-condition-one-notice rule.
- **FR-029**: A toggle MUST preserve the file's line endings, encoding and byte-order mark.

#### Find in Files results (#478)

- **FR-030**: *(Supersedes 044 FR-054 for providers that can reveal a source position.)* When a Find in
  Files result's file has an enabled provider whose default open action is **Preview**, and that
  provider can reveal a source position, clicking the result MUST open the file's preview — placed or
  reused per **Open Previews in** (047 FR-015) — instead of an editor. In this feature only the
  Markdown provider can reveal a source position. **Default open action** decides editor or preview;
  only when it is Preview does **Open previews in** choose the panel. With Editor, Open previews in has
  no effect on a result. If the file already has a preview, FR-004 applies.
- **FR-031**: The preview MUST scroll the match into view and highlight it with the highlight
  vocabulary find already uses in previews (#420), so the user sees which occurrence the result named.
- **FR-032**: A match the rendered preview cannot show (hidden front matter, a diagram, any construct
  that does not render its source text) MUST open an editor at the match, as today.
- **FR-033**: With the default open action at **Editor**, or for a provider that cannot reveal a
  position, a result MUST open an editor at the match exactly as 043 FR-037 / FR-087c require today.
  Open In's editor targets are unchanged (044 FR-055).
- **FR-034**: The default-open-action setting's description and `docs/preferences.md` MUST stop saying
  Find in Files results always open an editor, and say what they do now.

#### Mermaid diagrams (#392)

- **FR-040**: *(Supersedes 044 FR-086 for Mermaid only; math stays literal text.)* The Markdown
  provider MUST render a fenced block tagged `mermaid` as a diagram. Every other fenced block keeps
  syntax highlighting.
- **FR-041**: The Markdown provider MUST carry a setting, **Render Mermaid diagrams**, under **Editor -
  Previews**, on by default. Turning it off renders Mermaid blocks as code again, without a restart.
- **FR-042**: A **Mermaid text provider** MUST register for `.mmd` and `.mermaid` through 044's provider
  contract, and get everything 044 gives a text provider unchanged: the editor status-bar preview
  button, Open In → Preview, parented live preview, standalone preview following the disk, the preview
  title menu, layout persistence, and an enable/default-open entry under **Editor - Previews**.
  Adding it MUST require no change to the preview panel, its menus, the status bar or the preferences
  page beyond its own registration and settings (044 User Story 5).
- **FR-043**: The standalone provider and the embedded rendering MUST use one renderer. The seam that
  lets the Markdown provider delegate a fenced block MUST NOT be Mermaid-specific, so a later diagram
  language is one more delegate.
- **FR-044**: Invalid Mermaid source MUST show one inline notice naming the parse error at that
  diagram, with the rest of the document still rendered. If that diagram rendered successfully earlier
  in the preview's life, its last good rendering MUST stay in place, visibly dimmed, with the notice
  above it; a diagram that has never rendered shows the notice alone. The notice and dimming clear on
  the next successful render. Live updates MUST NOT blank the preview, and MUST NOT alternate between
  error and diagram faster than the preview's live-update debounce.
- **FR-045**: Diagram output MUST pass through the same sanitisation as all preview content (044
  FR-081): no script, no event-handler attributes, no `javascript:` URLs, no `click` callbacks, and no
  network request (044 FR-093). The renderer MUST run at its strictest security level. A test MUST
  assert the sanitiser is in the path for both the embedded and the standalone case.
- **FR-046**: Diagrams MUST take their colours and fonts from the active theme's tokens, be legible in
  every shipped theme, and follow a theme change without reopening (044 FR-083).
- **FR-046a**: A diagram wider than its space MUST by default be **shrunk to fit** the width, down to a
  minimum readable scale, below which it keeps that scale and scrolls sideways. The preview's own zoom
  applies on top.

- **FR-049a**: Copying a selection of a Markdown preview that includes a diagram MUST put, in the
  diagram's place, the diagram **as an image** when the copy format is **Rich text**, and its **Mermaid
  source as a fenced `mermaid` block** when it is **Plain text**. The image is the diagram as currently
  themed, at its natural size, unaffected by its zoom or pan. Copying from a standalone Mermaid preview
  follows the same rule for the whole diagram.

#### Diagram view controls

- **FR-046b**: Every diagram — each embedded diagram in a Markdown preview, and the diagram of a
  standalone `.mmd`/`.mermaid` preview — MUST carry its own set of view controls in the **top-left
  corner of the diagram's box**: **Fit**, **Full Size**, **Zoom In**, **Zoom Out** and **Full Pane**.
  The controls MUST stay fixed in that corner whatever the diagram's zoom or pan, and each diagram's
  controls act on that diagram only.
- **FR-046c**: **Fit** returns the diagram to the shrink-to-fit view (FR-046a). **Zoom In** / **Zoom
  Out** change that diagram's scale in steps, within bounds, leaving every other diagram unchanged.
- **FR-046d**: **Full Size** MUST make the diagram's box fill the whole frame of the panel it is in —
  full width and full height, like a full-panel frame — with the diagram navigable inside it by
  panning and zooming. Choosing it again, or **Fit**, returns the box to its place in the document.
- **FR-046e**: Dragging with the **middle mouse button** MUST pan a diagram whenever it is larger than
  its box, in every view (in the document, Full Size, Full Pane). Middle-button dragging MUST NOT
  scroll the surrounding preview or trigger the platform's autoscroll while over a diagram.
- **FR-046f**: **Full Pane** MUST temporarily maximise the diagram to the full size of throng's middle
  section (the area a tab's panels share), over the tab's panels, without changing the tab's layout.
  A visible control and **Esc** MUST return it to where it was, with its zoom and pan kept. It MUST
  use the one maximise mechanism (FR-070) and obey its modal rules (FR-074).
- **FR-046g**: A diagram's zoom, pan and view mode are view state only: they MUST NOT change the file
  or mark it dirty, and they reset when the diagram's preview is reopened. A live re-render of the same
  diagram (FR-044) keeps them.
- **FR-046h**: Every control MUST be reachable and operable by keyboard, carry a tooltip naming it, and
  take its colours and icons from the active theme (Principle VI; themeable icon controls).
- **FR-047**: The diagram renderer MUST load only when a preview first needs it; startup and previews
  without diagrams MUST NOT load it.
- **FR-048**: A diagram whose rendering exceeds a bounded time MUST show the inline notice (FR-044)
  rather than block the preview.
- **FR-049**: Disabling the Mermaid provider MUST remove every `.mmd`/`.mermaid` preview affordance and
  close open Mermaid previews; embedded rendering follows FR-041 only.

#### Maximise: panels and sections (#467)

- **FR-070**: throng MUST have **one maximise mechanism** that temporarily shows a **target** over the
  whole middle section of its tab and restores it exactly. A target is either a **whole panel** of any
  type (terminal, editor, every preview type, find in files, and every later type) or a **section
  inside a panel** that declares itself maximisable (in this feature: a Mermaid diagram, FR-046f). A
  later section type — an image in a preview, for example — MUST be able to become a target by
  declaring itself, without changing the mechanism.
- **FR-071**: Every panel MUST offer **Maximise** from its title menu and from a themeable header
  control, and a bindable **Maximise / Restore Panel** command MUST act on the focused panel. A
  maximised target MUST be visibly marked as maximised and show a **Restore** control; **Esc** restores
  when focus is not inside something that uses Esc itself (a terminal, an editor's own Esc uses).
  - **FR-071a**: **Maximise / Restore Panel** MUST ship bound to **Alt+Shift+Enter** and act from every
    panel type, including a focused terminal and editor; it MUST pass 046 FR-021's conflict check in
    every scope it applies to. In a terminal, Alt+Shift+Enter is consumed by throng and no longer sends
    a line break to the shell — a deliberate, documented change (`docs/key-bindings.md`), since
    Shift+Enter still does. **Shift+Enter** and **Ctrl+Enter** MUST keep their current behaviour in
    terminals and editors, and a test MUST assert both still reach a focused terminal and editor
    unchanged once the binding ships.
    *Principle IV recorded exception (constitution v5.10.0).* **What it displaces:** in a terminal,
    `Alt+Shift+Enter` today reaches the program as a modified Enter (`CSI 13;4 u` under the kitty
    keyboard protocol, a line feed otherwise) — a secondary binding whose end, a line break without
    submitting, `Shift+Enter` still reaches. **Why no free chord serves:** the maintainer chose it
    (clarification 2026-10-10) because it is the full-screen toggle Visual Studio users already know;
    the tier-2 forms are taken or worse — `Ctrl+Alt+Enter` is `search.replaceAll`, and
    `Ctrl+Shift+Enter` is a chord terminal programs bind more often than `Alt+Shift+Enter`. It sits
    outside the modifier tiers as `editor.columnSelect*`'s `Shift+Alt` does. The title-menu row and the
    header control remain the canonical routes (Principle VI).
- **FR-072**: Restoring MUST return the target to its exact previous position and size; the tab's
  layout underneath MUST be unchanged, its other panels hidden while maximised, never closed.
- **FR-073**: Maximising is **per tab**. Switching to another tab and back MUST show the target still
  maximised. Resizing the side panes while maximised resizes the maximised view only; after restore,
  every panel keeps its original split size.
- **FR-074**: **A maximised target is a modal for its tab's middle section.** Until it is restored:
  - the target behaves normally and is the active panel for every panel-dependent action;
  - the tab's hidden panels MUST NOT be targetable (*Open in → <Panel>* and every other panel-picking
    action omit them);
  - adding panels to the tab MUST be disabled — split, `+`, and dropping a panel or file into the tab's
    layout — with those affordances shown disabled, not hidden (Principle VI);
  - an open that would place or reuse a panel in that tab (a preview under Last Active, a file into an
    editor) MUST NOT act on a hidden panel; it MUST restore the target first and then proceed, so the
    user sees where the file went;
  - targets **nest**: a section inside a maximised panel (a diagram's Full Pane in a maximised
    preview) MUST cover the maximised panel's area rather than restoring it, and Esc / Restore steps
    back **one level at a time** (diagram → maximised panel → layout). Maximising a **different panel**
    restores whatever is maximised first; the stack is never deeper than a panel plus its sections.
  Actions outside the tab — side panes, other tabs, the title bar, other windows — are unaffected.
- **FR-075**: A maximised **panel's type** can still change in place (e.g. a terminal exits and the
  panel becomes another type); it stays maximised. A maximised **section** whose panel closes, or whose
  section disappears (the diagram's block is deleted from the source), MUST restore automatically.
- **FR-076**: Maximised state is temporary view state: it MUST NOT be saved with the layout. A layout
  restored at launch shows every tab un-maximised.
- **FR-077**: Every new command MUST have a menu item and appear in the key-bindings editor and
  `docs/key-bindings.md`; the Maximise / Restore control is a themeable icon control.

#### Preview settings audit and layout

- **FR-050**: The **Editor → Previews** section MUST hold only settings that apply to every preview
  type, and each preview provider's settings MUST sit in that provider's own subsection beneath it —
  **Editor → Previews → Markdown** and **Editor → Previews → Mermaid**. With Mermaid shipping, Markdown
  is no longer the only preview type, so "applies to every preview" and "Markdown only" are now
  different sets.
- **FR-050a**: *(Narrows 040 FR-035's "one level of nesting under `group`".)* A settings descriptor MAY
  carry an optional **`subsection`**, valid only with a `subgroup`, giving exactly one further level —
  no deeper level and no recursion. 040 FR-036 – FR-036c apply to it unchanged: every tab that renders
  subgroups renders subsections, a subsection is static in declaration order, unsectioned fields of a
  subgroup render first, and an all-filtered subsection disappears with its heading. *[derived at
  implementation, 2026-10-10: FR-050's Previews → Markdown placement needs it.]*
- **FR-051**: The audited placement MUST be:

  | Setting | Today | After |
  |---|---|---|
  | Preview update delay | Editor → Previews | Editor → Previews (every text preview) |
  | Preview maximum wait | Editor → Previews | Editor → Previews (every text preview) |
  | Synchronise preview and editor scrolling | Editor → Previews | Editor → Previews (every text preview) |
  | Open previews in | Editor → Previews | Per provider: **Markdown: Open previews in**, **Mermaid: Open previews in** |
  | Preview copy format | Editor → Previews | Editor → Previews (every text preview — Mermaid copies follow it too, FR-049a) |
  | Markdown: Enabled / Default open action | Editor → Previews | Markdown |
  | Markdown: Load remote images / Show front matter / Preview gutter / Heading jump scroll duration | Editor → Previews | Markdown |
  | Markdown sections open | Editor (top level) | Markdown — it governs Markdown editors and previews alike, so its description keeps saying both |
  | Render Mermaid diagrams (FR-041) | new | Markdown |
  | Mermaid: Enabled / Default open action | new | Mermaid |

  The plan MAY move a further setting found to be Markdown- or preview-specific; every move is listed
  in the plan and in `docs/preferences.md`.
- **FR-052**: Labels inside a provider's subsection MUST keep the provider name (*"Markdown: Open
  previews in"*), so a row read alone — in a search result, the JSON editor or the docs — still says
  which previews it governs.
- **FR-053**: A setting whose **key** changes because of this audit (e.g. **Open previews in** becoming
  per-provider) MUST carry the user's existing value to the new key, once, on first read; a user who
  chose New Preview Panel keeps that choice for every preview type.
  This is a migration of a live setting, not the retired-key drop 019 FR-023 prescribes for a key that
  never had an effect. Re-running it MUST be a no-op.
- **FR-054**: A setting that only changes place (e.g. **Markdown sections open**) MUST keep its key.
- **FR-055**: Every moved or new setting MUST keep working from every place it is already switched from
  (menus, status-bar buttons), and the preferences search MUST find it by its old and new labels'
  words.

#### Configuration and documentation

- **FR-060**: Every new setting MUST be a descriptor shown in the preferences editor and covered by the
  configuration-completeness tests (Principle X).
- **FR-061**: Every new bindable command MUST appear in the key-bindings editor and `docs/key-bindings.md`;
  every new setting in `docs/preferences.md`; the docs-currency test MUST pass.

### Key Entities

- **Preview recency (per tab)**: the order in which the tab's preview panels were last active; decides
  which preview Last Active reuses. Today in memory only; FR-001/FR-002 extend it to restored panels.
- **Task item**: a list item carrying a `[ ]`/`[x]`/`[X]` marker, identified by its position in the
  source; the unit a checkbox toggles.
- **Diagram block**: a fenced block (or whole file, for the standalone provider) handed to a diagram
  renderer instead of being highlighted as code.
- **Section**: a heading and everything up to the next heading of the same or higher level, including
  its nested sections; the unit the outlining commands act on.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a relaunch with a preview restored, the first preview opened in that tab under Last
  Active creates **zero** new preview panels.
- **SC-002**: Across a fixture covering every list shape in FR-023, **100%** of checkbox clicks change
  exactly one marker on the correct line and nothing else in the file.
- **SC-003**: A ticked checkbox shows its new state, and the file or open editor reflects it, within
  **500 ms** of the click.
- **SC-004**: In a session with unsaved editor changes, **zero** unsaved edits are lost by toggling a
  checkbox.
- **SC-005**: Every diagram type the bundled renderer supports out of the box renders in a `.md`
  preview, legibly in every shipped theme, light and dark.
- **SC-006**: A preview of a document with no diagrams opens no slower than before this feature, and
  app startup time is unchanged.
- **SC-007**: A hostile-diagram fixture (click directives, script in labels, `javascript:` URLs, remote
  references) executes nothing and makes **zero** network requests.
- **SC-009**: With Preview as Markdown's default open action, **100%** of Find in Files results in
  `.md` files whose match renders as text open a preview with the match visible, and **zero** open an
  editor.
- **SC-010**: Maximising then restoring any panel, in any tab layout, leaves every panel's position
  and size exactly as before in **100%** of cases, including after tab switches and side-pane resizes.
- **SC-008**: Folding one section and its descendants takes **one** menu action, where today it takes
  one action per nested heading.

## Assumptions

- Keyboard toggling of a checkbox (Space when focused) is included for accessibility; checkboxes are
  reachable by keyboard focus only where the preview already supports focusable content.
- Undo of a toggle is available in an editor on the file; a preview itself keeps no undo history (its
  commands stay inert under 044 FR-021). Clicking the checkbox again reverses it.
- The renderer for Mermaid is the MIT-licensed `mermaid` library, confirmed in the plan's research
  against 044's constraints (sanitisation, no network, theme variables, on-demand loading).
- **Render Mermaid diagrams** ships on, and the Mermaid provider ships enabled.
- Mermaid editor support (highlighting, completion), diagram export, scroll-sync between source and
  diagram, other diagram languages, Mermaid outside Markdown, and math typesetting (#393) are out of
  scope.
- A Find in Files result for a file already open in an editor with a parented preview reveals the
  match in the **preview** when Preview is the default open action (User Story 3, scenario 5); the
  editor keeps its own caret.
- Replace from a preview, and revealing matches in previews of providers other than Markdown, are out
  of scope for #478.
- A third preferences level (Editor → Previews → Markdown) needs a rendering the two-level
  group/subgroup model does not have today; the plan chooses the mechanism, consistent with #319 (one
  sub-grouping convention). Folding sections is #479, not this feature.
- The Mermaid renderer is an existing library (the maintainer asked for one wherever it fits); the plan
  confirms which.
- Outlining stays Markdown-only; folding for other languages (#375) is deferred to vNext.
