# Feature Specification: Find in Files Polish

**Feature Branch**: `feature/S060-I513-find-in-files-polish`

**Created**: 2026-10-25

**Status**: Draft

**Input**: GitHub issue #513 — Find in Files: in-progress indicator, cleaner results layout, Folder
structure grouping. The panel itself is spec 043's; this spec changes how it presents what 043 finds,
and adds one grouping. Search, counts, replace and navigation are unchanged.

**Extended (2026-10-29)** by GitHub issue #532 — Find in Files: exclusion lists of its own, separate
from the File Explorer (User Story 6, FR-025–FR-040). That changes which files are searched; see FR-025.

## Clarifications

### Session 2026-10-25

- Q: #513 asks for **Change scope**, **Run Search** and **Cancel Search** to leave the panel's menu,
  but Constitution VI ("every panel action has a menu item") and 043 FR-025a require all three there.
  Move them to the header menu, drop them only over result rows, or remove them from every menu? →
  A: **Remove them from every menu.** Each stays reachable through its own on-panel control — the
  run/cancel button, `Enter` in the search input, the find-in-files chord, and the scope input itself.
  This **supersedes 043 FR-025a for those three items only**, under Constitution v6.0.0's
  Principle VI (see *Dependencies*).
- Q: Which "file search result styles" should the results reuse? The find bar (013) draws a match
  as a background plus a `searchMatchBorder` outline; Find in Files draws the background alone. →
  A: **The find bar's match style**, from one shared definition, so a match looks the same on both
  surfaces. Find in Files' own match styling is deleted.
- Q: What shape does the Folder structure grouping take? → A: **The explorer's**: one row per folder
  level, only folders that lead to a matching file, no merging of single-child folder chains.

### Session 2026-10-25 (clarify)

- Q: Under Per file grouping, when two matching files share a name, should the heading show the name
  alone or the name followed by its folder in muted text? → A: **Bold name, then the project-relative
  folder in muted, smaller text** — Per file grouping only, on every heading, not just duplicates.
- Q: Should the Principle VI amendment FR-022 needs be written and committed on this branch before
  planning? → A: **Yes — amend now, on this branch, through `/speckit-constitution`, before
  `/speckit-plan`**, so the plan's Constitution Check runs against the amended text.
- Q: (Raised by the maintainer, 2026-10-25.) Cancelling a search empties the list; should it? → A: **No —
  cancel stops the scan and the rows already found stay listed.** Following FR-094's precedent for the
  cap, the notice bar says the results are partial and Replace All acts only on the rows listed. This
  **supersedes 043's reading of FR-043 that a cancelled scan lists nothing**, and the shipped
  cancel-clears behaviour.
- Q: (Raised by the maintainer, 2026-10-25.) Results should be usable while a search runs — which row
  actions? → A: **Select, open (double-click / `Enter`) and the row's menu work while scanning; Replace
  All, Replace in File and Replace Match stay disabled until the scan completes or is cancelled.** This
  **supersedes 043 FR-095's row lock** (#391), keeping the half of it that guards replacement against a
  list still filling in.
- Q: What does a single click on a folder or file heading do? → A: **It selects the heading — the reading
  position moves to it — without collapsing or expanding it.** Double-click (043 FR-071), the chevron and
  `Enter` toggle it; the arrow keys step through headings and rows alike, as they already do. The File
  Explorer's single-click/double-click pairing, which 043 FR-071 already cites.
- Q: When the user switches grouping, does the selected row stay selected? → A: **Yes — the selected
  result row stays selected and is scrolled into view.** A selected heading with no counterpart in the
  new grouping hands the selection to its first result row.

### Session 2026-10-25 (hand-test feedback)

The maintainer's feedback after hand-testing the first build. Answers given by the maintainer except
where marked *(derived)*.

- Q: Should every loading indicator in the app look the same? → A: **Yes — one glyph everywhere.** The
  Find in Files busy control, the shared spinner (app loading, diagram drawing) and the app-closing
  overlay all draw the `busy` icon token, which is **◜** (quarter arc) by default and **rotates around
  its own centre**. → FR-001a, FR-001b.
- Q: Which glyph is the busy glyph? → A: **◜ (quarter arc).**
- Q: Which icons must be plain glyphs rather than colour emoji? → A: **The shared icon tokens the Find in
  Files panel draws, changed app-wide** — the explorer, the find bar and every other surface that uses
  them change with them. FR-011 (headings match the explorer) still holds, because both surfaces change
  together. → FR-011a.
- Q: Which glyph is Group by folder structure? → A: **⋔ (fork).** → FR-011b.
- Q: 043 FR-065 made `findInFiles` a colour emoji so it matched Quick Open's 🔎 beside it in the File
  Explorer toolbar. A plain `findInFiles` brings that mismatch back. What changes? → A: **The File
  Explorer toolbar goes plain too** — `quickOpen` and `newFolder` as well — so the toolbar is plain glyphs
  at one weight. → FR-011c.
- Q: The match highlight in result rows is clipped at the top and bottom — a spec change? → A: **No — a
  defect against FR-009** *(derived: FR-009 already requires the find bar's whole match style, border
  included)*.

### Session 2026-10-29 (#532 — search exclusions)

Answers given by the maintainer except where marked *(derived)*.

- Q: Should Find & Replace in Files keep using the File Explorer's excluded globs and hidden paths? →
  A: **No — every dependency is removed.** The explorer's list and hidden paths govern the tree only;
  search gets its own lists. → FR-025.
- Q: What does the new global list hold by default? → A: **The explorer's shipped default globs, plus**
  `**/dist`, `**/build`, `**/out`, `**/coverage`, `**/.claude`, `**/.vscode`, `**/.idea`, `**/log`,
  `**/logs`, `**/*.log`, `**/.remember`, `**/.cache`, `**/.turbo`, `**/.next`, `**/.nuxt`, `**/target`,
  `**/bin`, `**/obj`, `**/.venv`, `**/__pycache__`, `**/*.min.js`, `**/*.map`, `**/package-lock.json`,
  `**/pnpm-lock.yaml`, `**/yarn.lock`. It is a list in Preferences, edited like the explorer's.
  Everyone starts from these shipped defaults; a user's customised explorer list is not copied. → FR-026.
- Q: How is the global list switched off? → A: **A toggle on the panel**, for that panel; a preference
  sets the toggle's state for new panels. → FR-027, FR-028.
- Q: Does the toggle also switch off the project's own list? → A: **No — the project list always
  applies.** → FR-030.
- Q: Can a user add one-off exclusions? → A: **Yes — a semicolon-separated box on the panel**, empty on
  every new panel; it applies whatever the toggle says. → FR-029.
- Q: Do the toggle and the box survive a restart? → A: **Yes — they are kept with the panel**, like its
  term. A new panel starts from the default preference and an empty box. → FR-031.
- Q: What does a project's "Hidden to Find & Replace" list hold, and how do entries get there? → A:
  **Globs**, added and removed in the project settings dialog; the File Explorer and the results list
  also offer **Exclude from Find in Files in this project** on a file or folder, which adds its path. →
  FR-032–FR-034.
- Q: How is the project settings dialog laid out? → A: **The same title, two sections** — Hidden in File
  Explorer, then Hidden to Find & Replace — each with its own list, its own add box and a note naming
  the global list that also applies. **Each list scrolls on its own**, as either can grow long. →
  FR-035, FR-036.
- Q: Which glyph is the project settings control? → A: **⌂ (house)**, distinct from the app's ⚙. →
  FR-037.

### Session 2026-10-29 (hand-test feedback)

- Q: How does a heading's count read? → A: **In brackets**, consistent with a result row's
  `(line:character)`, in every grouping — Per file, Per folder + file and Folder structure. → FR-013b.
- Q: What does the exclusions toggle's hover title say? → A: "Global search exclusions enabled /
  disabled. Edit '<preference name>' in Preferences to change." → FR-027a.
- Q: Which rows does the results body menu keep? → A: The Group by rows, the Use search exclusions
  row, the Split submenu and the Replace toggle are **removed** — each is available elsewhere. → FR-042.
- Q: Is Open In offered on a file heading? → A: **Yes**, in every grouping; it opens the file at its
  first line rather than at a match. → FR-041.
- Q: Can results start collapsed? → A: A **Show results** preference under Search — Collapsed /
  Expanded, default **Expanded** — and a toggle on the panel that changes the preference. → FR-043.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See that a search is running (Priority: P1)

A user runs a search over a large project. Today nothing in the panel moves, so a long scan looks like
a hang. The run control itself shows the panel is busy for as long as the scan runs, and clicking it
still cancels.

**Why this priority**: A search that looks crashed gets cancelled or the app restarted; this is the
only item in #513 that changes whether the user trusts the panel.

**Independent Test**: Start a search over a project large enough to take a few seconds, watch the
control, then let it finish; repeat and cancel mid-scan.

**Acceptance Scenarios**:

1. **Given** a search is running, **When** the user looks at the panel, **Then** the cancel control
   visibly shows a busy state (animated) that distinguishes it from the idle run control.
2. **Given** a search is running and has listed some results, **When** the user clicks the busy control,
   **Then** the search is cancelled, the busy state stops, the results already listed stay in place, and
   the notice bar says the results are partial.
3. **Given** a search is running and has listed some results, **When** the user double-clicks a listed
   row or selects it and presses `Enter`, **Then** its file opens while the scan carries on.
4. **Given** a search is running, **When** the user right-clicks a listed row, **Then** the menu opens,
   Open In works, and Replace All, Replace in File and Replace Match are drawn disabled.
5. **Given** a search completes on its own, **When** results finish arriving, **Then** the busy state
   stops at the same moment the status line stops reporting the scan as in progress.
6. **Given** the operating system asks for reduced motion, **When** a search runs, **Then** the busy
   state is still shown, without animation.
7. **Given** a search is running, **When** the user watches the busy glyph, **Then** it is ◜ and it turns
   in place around its own centre — it does not drift, wobble or shift the control.
8. **Given** the app is starting, a diagram is drawing, or the app is closing, **When** a loading
   indicator shows, **Then** it is the same ◜ glyph, turning the same way.

---

### User Story 2 - Read results at a glance (Priority: P1)

A user scans a results list for the hit they want. File rows name only the file, matches read as text
first and position last, only headings are bold, and highlights are legible in every theme.

**Why this priority**: This is the panel's everyday surface; every search pays for its clutter.

**Independent Test**: Run a search that matches in several files across folders, in each bundled theme,
in each grouping mode.

**Acceptance Scenarios**:

1. **Given** results grouped per file and folder, **When** the user looks at a file heading, **Then** it
   shows the file name only, not its full path.
2. **Given** results grouped per file, **When** the user looks at a file heading, **Then** it shows the
   file name in bold, followed by its project-relative folder in muted, smaller, non-bold text.
3. **Given** any grouping mode, **When** the user hovers a folder or file heading, **Then** a tooltip
   shows its full project-relative path.
4. **Given** a result row, **When** the user reads it, **Then** it reads `matched text … (line:character)`
   — snippet first, position last in brackets — and sits further indented than its heading.
5. **Given** a results list, **When** the user compares weights, **Then** headings are bold and result
   rows are not.
6. **Given** any bundled theme, **When** the user looks at a match in a result row, **Then** it is drawn
   exactly as a match is in the find bar, and is legible.
7. **Given** a file of any type, **When** it appears in the results, **Then** its icon is the same icon
   the File Explorer shows for it.
8. **Given** a match in a result row, **When** the user looks at it, **Then** its whole highlight box —
   top and bottom border included — is visible.
9. **Given** the Find in Files panel in the default theme, **When** the user looks at its toolbar and its
   headings, **Then** every icon is a plain single-colour glyph, not a colour emoji — and the File
   Explorer and the find bar show the same plain glyphs.
10. **Given** the File Explorer toolbar, **When** the user looks at it, **Then** every control is a plain
   glyph at one visual weight, and Find in Files, Quick Open and the find bar's search are three
   different glyphs.

---

### User Story 3 - Browse results as a folder tree (Priority: P2)

A user whose matches are spread through a deep tree wants to see them where they live. A third grouping,
**Folder structure**, shows the matching files in the explorer's folder hierarchy.

**Why this priority**: New capability, bundled at the maintainer's request; the panel is fully usable
without it.

**Independent Test**: Run a search with matches at several depths, choose Folder structure, compare the
tree with the File Explorer.

**Acceptance Scenarios**:

1. **Given** results are shown, **When** the user chooses Folder structure, **Then** the same matches are
   shown as a tree of folders, one row per folder level, with files under their folders and result rows
   under their files, without re-running the search, and the row that was selected stays selected and
   in view.
2. **Given** Folder structure, **When** the tree is drawn, **Then** only folders that lead to a matching
   file appear, in the order the File Explorer would list them, and no single-child chain is merged
   into one row.
3. **Given** Folder structure, **When** results arrive, **Then** every level is expanded and every result
   row is visible without an expand action.
4. **Given** Folder structure, **When** the user double-clicks a folder heading, **Then** that folder
   collapses or expands; **Collapse all** and **Expand all** act on every level.
5. **Given** remembering is enabled and the user last chose Folder structure in this project, **When**
   they run another search there, **Then** results open in Folder structure.
6. **Given** the default-grouping preference, **When** the user opens it, **Then** Folder structure is
   offered as a third value, and Per file stays the shipped default.
7. **Given** the grouping controls, **When** the user looks at Group by folder structure, **Then** its
   icon is ⋔ (fork).

---

### User Story 4 - Select without opening (Priority: P2)

A user clicks through results to look at them before deciding which to open. A single click selects a
row; double-click or `Enter` opens it.

**Why this priority**: An accidental open steals focus into an editor and loses the user's place.

**Independent Test**: Click a row, confirm nothing opens and the row is selected; press `Enter`, confirm
it opens; double-click another, confirm it opens.

**Acceptance Scenarios**:

1. **Given** a result row, **When** the user single-clicks it, **Then** it becomes the selected row and no
   file is opened.
2. **Given** a selected row, **When** the user presses `Enter` or double-clicks it, **Then** its file opens
   exactly as 043 FR-037 and FR-038 describe.
3. **Given** a selected row, **When** the user moves with the arrow keys, **Then** keyboard navigation
   between results behaves as it does today.
4. **Given** an expanded folder or file heading, **When** the user single-clicks its label, **Then** it
   becomes selected and stays expanded; **When** they double-click it or click its chevron, **Then** it
   collapses.

---

### User Story 5 - A shorter, narrower menu (Priority: P3)

A user right-clicks a result. The menu carries no form controls, and its replace items name the file
without stretching the menu across the screen.

**Why this priority**: Clutter, not function.

**Independent Test**: Right-click a result in a deeply nested file and inspect the menu.

**Acceptance Scenarios**:

1. **Given** the panel's menu, **When** it opens anywhere in the panel, **Then** it contains no
   **Change scope**, **Run search** or **Cancel search** item.
2. **Given** a result row in a deeply nested file, **When** the user opens the menu over it, **Then**
   **Replace in…** and **Replace Match in…** show a left-truncated name such as `…/dir/file.ts`, and the
   menu's width stays bounded however long the path is.

### User Story 6 - Choose what a search skips (Priority: P2)

A user searches a project with build output, caches, logs and lock files in it. They want those kept
out of their results without hiding them from the File Explorer, to search them anyway when they
need to, and to keep particular folders of one project out of every search there.

**Why this priority**: noise in the results is the most common reason a search is hard to read, and
today the only way to remove it also hides the files from the tree.

**Independent Test**: in a project with a `dist` folder and a matching file in it, search: the file is
not listed. Turn the panel's exclusion toggle off and search again: it is. The `dist` folder stays in
the File Explorer throughout.

**Acceptance Scenarios**:

1. **Given** a project with matches in `dist/` and `src/`, **When** the user searches with the panel's
   exclusion toggle on, **Then** only `src/` matches are listed, and `dist/` still shows in the File
   Explorer.
2. **Given** the same project, **When** the user turns the panel's toggle off and searches, **Then**
   `dist/` matches are listed too; another open Find in Files panel is unaffected.
3. **Given** a folder hidden from the File Explorer (by its excluded globs or by Hide in this project),
   **When** the user searches, **Then** matches in that folder are listed unless a search exclusion
   list covers it.
4. **Given** a panel, **When** the user types `**/fixtures;*.snap` in its exclusions box and searches,
   **Then** no match from a `fixtures` folder or a `.snap` file is listed, whatever the toggle says.
5. **Given** a panel with the toggle off and a box filled in, **When** the app restarts, **Then** the
   restored panel still has the toggle off and the same box; **When** the user opens a new panel,
   **Then** its toggle follows the default preference and its box is empty.
6. **Given** Preferences › Search · Find in Files, **When** the user looks at it, **Then** it lists the
   search exclusions (the explorer's default globs plus the agreed additions), lets them add and remove
   entries, and offers the toggle's default for new panels.
7. **Given** a project whose "Hidden to Find & Replace" list holds `**/generated/**`, **When** the user
   searches there with the toggle off, **Then** nothing under a `generated` folder is listed; in another
   project it is.
8. **Given** a file or folder in the File Explorer or a heading in the results, **When** the user chooses
   **Exclude from Find in Files in this project**, **Then** its path joins that project's list, and the
   next search skips it.
9. **Given** the project settings dialog, **When** the user opens it, **Then** it shows Hidden in File
   Explorer and Hidden to Find & Replace as two sections, each with its own scrolling list and add box.
10. **Given** the File Explorer toolbar, **When** the user looks at the project settings control,
    **Then** its icon is ⌂, not the ⚙ Preferences uses.

---

### Edge Cases

- **Two files with the same name** under Per file grouping: the muted folder after each name (FR-004)
  tells them apart; the order is unchanged from today.
- **A match in the project root** under Folder structure: the file sits at the top level with no folder
  heading above it.
- **A file directly in a scoped folder** when the search scope is a sub-folder: Folder structure starts
  at the scope, not at the project root, so no empty ancestor levels are drawn above it.
- **A stale file** (043 FR-045a) under Folder structure: the stale mark sits on the file heading, as in
  the other groupings; folder headings carry none.
- **A scan that finishes almost instantly**: the busy state may show for a single frame or not at all;
  it is never left showing after the scan ends.
- **A search cancelled while the menu is open**: the menu has no run or cancel item to go stale; its
  replace items stay disabled until the menu is reopened.
- **A cancel that hits the cap at the same moment**: one partial notice, not two (FR-003b).
- **A file opened from a row mid-scan whose later matches arrive afterwards**: they are listed under its
  heading as they arrive; the opened editor is not disturbed.
- **Cancel with nothing yet listed**: an empty, cancelled list and no partial notice.
- **A file type the explorer has no specific icon for**: both surfaces show the same generic file icon.
- **A path short enough not to need truncation** in a replace item: it is shown whole, with no leading
  ellipsis.

- **Exclusions and an explicit file scope** *(derived, from 043 FR-092)*: a scope naming one file
  searches it whatever any exclusion list says — the user named it.
- **A malformed entry in the panel's box** *(derived)*: it is ignored, and one inline notice on the box
  names it; the rest of the box still applies.
- **Excluding a path that already has rows listed** *(derived)*: the rows stay until the next run, as
  any other change since the scan does (043 FR-045a–c).

## Requirements *(mandatory)*

### Functional Requirements

#### In-progress state

- **FR-001**: While a scan runs, the panel's cancel control MUST show a **busy state** — an animated
  indicator that reads as "working" — and MUST stop showing it the moment the scan completes or is
  cancelled. Clicking the control while busy MUST cancel the scan, as it does today. The busy indicator
  MUST be a themeable icon (Constitution: themeable icon controls), and the control MUST expose its busy
  state to assistive technology.
- **FR-002**: When the operating system requests reduced motion, the busy state MUST still be shown,
  without animation.
- **FR-001a**: The busy indicator MUST be the `busy` icon token, **◜** by default, and MUST rotate around
  the glyph's own centre: the turning glyph MUST NOT drift, wobble or change the control's size.
  **Refines FR-001**, whose glyph (◌) and animation are superseded by this one.
- **FR-001b**: **Every** loading or busy indicator in the app MUST draw the same `busy` glyph with the
  FR-001a rotation and FR-002's reduced-motion rule — at least the shared spinner (app loading, diagram
  drawing) and the app-closing overlay as well as the Find in Files busy control. A CSS-drawn spinner
  MUST NOT remain.
- **FR-003**: While a scan runs, every listed row and heading MUST stay live: drawn normally (not
  disabled), selectable, collapsible, openable by double-click and `Enter`, and its menu MUST open with
  Open In available. **Replace All, Replace in File and Replace Match MUST be disabled** — on the toolbar
  and in the menu — until the scan completes or is cancelled. **Supersedes 043 FR-095's row lock** (#391);
  its Replace All clause stands and is widened to the two narrower granularities. Rows arriving while the
  user works MUST NOT move the selected row or steal focus.

#### Cancelling

- **FR-003a**: Cancelling a scan MUST stop it and MUST **keep every row already listed**, with its
  headings, counts and grouping. The status line reads the scan as cancelled with the count listed.
  **Supersedes 043's reading of FR-043 that a cancelled scan lists nothing.** A cancel with nothing yet
  listed shows an empty, cancelled list, as today.
- **FR-003b**: When a cancel leaves rows listed, the notice bar (043 FR-096) MUST say the results are
  **partial** and that **Replace All acts only on the results listed below** — the cap's notice (043
  FR-094), reused for a second cause, one notice not two. Replace All, Replace in File and Replace Match
  MUST then act on the listed rows only; no unlisted match on disk is touched.
- **FR-003c**: Running again after a cancel MUST supersede the kept rows exactly as a new run supersedes
  any earlier results (043 FR-043c), and MUST clear the partial notice.
- **FR-003d**: No update from a cancelled scan that arrives after the cancel MAY add rows to the kept list:
  what is listed at the moment of cancel is what stays.

#### Headings and tooltips

- **FR-004**: Under **Per file and folder** grouping, a file heading MUST show the file's name only — its
  path relative to its folder heading. Under **Per file** grouping, a file heading MUST show the file's
  name in bold followed by its **project-relative folder** in muted, smaller, non-bold text; a file in the
  project root shows no folder. The folder text MUST truncate before the name does.
- **FR-005**: In every grouping mode, hovering a folder heading or a file heading MUST show its full
  project-relative path as a tooltip.

#### Result rows

- **FR-006**: A result row MUST read **snippet first, position last**: the matched text in its snippet
  (043 FR-036, unchanged), followed by the position in brackets, `(line:character)`. The position's
  figures MUST be digit-grouped (Constitution: displayed quantities MUST be digit-grouped).
- **FR-007**: A result row MUST be indented further from its heading than it is today, so the nesting
  reads at a glance in every grouping mode.
- **FR-008**: Only headings — folder and file — MUST be bold (043 FR-063, unchanged). Result rows MUST
  NOT be bold. A folder heading MUST use the same bold weight token as a file heading.

#### Styling and icons

- **FR-009**: A match in a result row MUST be drawn with the **find bar's match style** — the same
  background and border tokens 013 uses — from **one shared definition** that both surfaces use.
  **Extends 043 FR-044**, which reused 013's background token but not its border.
- **FR-010**: Any Find in Files style made unused by FR-009 or by this spec's other changes MUST be
  deleted, not left behind.
- **FR-011**: A file heading's icon MUST come from the **same source** the File Explorer uses for that
  file, so a given file shows the same icon on both surfaces. A folder heading MUST show the explorer's
  folder icon.
- **FR-011a**: Every icon token the Find in Files panel draws — its toolbar, its grouping controls and its
  headings, including every file-type token `fileIconToken` can return — MUST default to a **plain
  single-colour text glyph**, never a colour emoji. The change is to the **shared** default, so every
  other surface drawing those tokens (the File Explorer, the find bar) changes with it, and FR-011 holds.
  A theme or icon pack that overrides a token keeps its override.
- **FR-011b**: The Folder structure grouping control's icon (`groupFolderTree`) MUST default to **⋔**
  (fork).
- **FR-011c**: Every icon in the File Explorer toolbar — `quickOpen` and `newFolder` as well as
  `findInFiles` — MUST also default to a plain glyph, so the toolbar reads at one weight. The three
  searches (`search`, `quickOpen`, `findInFiles`) MUST stay three distinct glyphs. **Supersedes 043
  FR-065's** emoji-presentation rule for `findInFiles`; its intent — the same weight as the controls
  beside it — is kept by making the neighbours plain as well.

#### Folder structure grouping

- **FR-012**: Results MUST be groupable by **Folder structure** in addition to **Per file** and **Per
  file and folder**. **Extends 043 FR-073**, whose two groupings stand unchanged.
- **FR-013**: Under Folder structure, the results MUST form a tree: **one heading per folder level**, from
  the search scope downward; files as children of their folder; result rows as children of their file.
  Only folders that lead to at least one matching file appear. Single-child folder chains MUST NOT be
  merged into one row.
- **FR-014**: Under Folder structure, folders and files MUST be ordered as the File Explorer orders them.
- **FR-015**: Switching to or from Folder structure MUST NOT re-run the search (043 FR-033's clause,
  extended to the new value). Totals and per-file counts MUST be identical across all three groupings.
- **FR-015a**: Switching grouping MUST keep the selected **result row** selected and scroll it into view.
  A selected **heading** keeps its selection where the new grouping has the same heading (a file heading
  exists in every grouping); where it has none (a folder heading switched to Per file), the selection
  MUST pass to the first result row beneath it. With nothing selected, switching selects nothing.
- **FR-013a**: Every folder heading under Folder structure MUST show the match count of everything beneath
  it, digit-grouped, as every heading already does. *(Derived from the shipped heading, which carries a
  count on every group.)*
- **FR-013b**: Every heading's count — file and folder, in every grouping — MUST read in brackets,
  `(n)`, as a result row's position does (FR-006). The figure stays digit-grouped.
- **FR-016**: Folder structure MUST open fully expanded (043 FR-034a, extended), every folder heading
  MUST be collapsible (043 FR-034) and toggle on double-click (043 FR-071), and Collapse all / Expand all
  MUST act on every level. Folder headings carry the hover affordance (043 FR-085).
- **FR-017**: The default-grouping preference (043 FR-033a) MUST offer Folder structure as a third value.
  It MUST still ship as **Per file**. The remembered-grouping preference (043 FR-033b, FR-033c) MUST
  remember Folder structure like either other value.
- **FR-018**: The panel's menu MUST carry a **Group by folder structure** toggle beside the two existing
  grouping toggles, showing its state, in the same section. *(Constitution VI: a new state toggle adds
  its menu item in the same increment.)* Any toolbar grouping control MUST offer the new value too.
- **FR-019**: A stale file (043 FR-045a) MUST carry its stale mark on its file heading under Folder
  structure, exactly as in the other groupings. Folder headings MUST NOT carry one.

#### Selection

- **FR-020**: A single click on a result row MUST select it — make it the row the reading position is on —
  and MUST NOT open its file. Double-click (043 FR-037) and `Enter` MUST open it.
- **FR-020a**: A single click on a folder or file heading MUST select it — move the reading position to
  it — and MUST NOT collapse or expand it. Double-click (043 FR-071), the heading's chevron and `Enter`
  MUST toggle it. A single click on the chevron toggles without needing a double-click.
- **FR-021**: Keyboard navigation between results MUST be unchanged, in every grouping mode, including
  Folder structure: the arrow keys step through headings and rows alike, `Enter` opens a row and toggles
  a heading.

#### Menu

- **FR-022**: The panel's menu MUST NOT contain **Change scope**, **Run search** or **Cancel search**,
  wherever it is opened. **Supersedes 043 FR-025a for these three items only**; its remaining items stand.
  Each command stays reachable without the menu: run through the run control, `Enter` in the search
  input and the find-in-files chord (043 FR-043a); cancel through the cancel control; the scope through
  the scope input. *(Permitted by Constitution v6.0.0, Principle VI — see Dependencies.)*
- **FR-023**: **Replace in…** and **Replace Match in…** MUST name their file by a **left-truncated**
  form — the file name preceded by as much of its path as fits, with a leading `…/` when anything was
  cut — and the menu's width MUST stay bounded for any path length. A path that fits MUST be shown whole.

#### Search exclusions (#532)

- **FR-025**: Which files Find in Files searches MUST NOT depend on the File Explorer's excluded globs or
  on the project's hidden paths. Those govern the tree, Quick Open and the file index only. Search
  follows FR-026–FR-030 instead. **Supersedes 043 FR-045** ("searchable files follow the project's
  existing exclusion rules") and narrows **FR-024** to say so: which files are searched changes, how a
  searched file is matched, counted and replaced does not. 043 FR-045e's skipping of binary, oversized
  and unreadable files is unchanged.
- **FR-026**: A **search exclusion list** preference MUST hold glob patterns, editable in the Preferences
  editor as a list (add, remove), and MUST default to the File Explorer's shipped default globs followed
  by the patterns recorded in the 2026-10-29 clarification. An install that has never set it gets the
  shipped default; a user's customised File Explorer list is not copied into it.
- **FR-027**: Each Find in Files panel MUST have a **toggle** that switches the search exclusion list on
  or off for that panel only. It is a themeable icon control with a hover title naming its state and a
  pressed state, and the panel's menu offers the same toggle (Constitution VI).
- **FR-027a**: The toggle's hover title MUST read "Global search exclusions enabled." or "Global search
  exclusions disabled." by its state, followed by "Edit '<label>' in Preferences to change.", where
  `<label>` is the Preferences label of the search exclusion list (FR-026).
- **FR-028**: A preference MUST set the toggle's state for **new** panels, defaulting to **on**.
- **FR-029**: Each panel MUST have a text box of **semicolon-separated** glob patterns that it also
  excludes, applied whatever the toggle says. Entries are trimmed and empty ones ignored. A new panel's
  box is empty.
- **FR-030**: Each project MUST have a **Hidden to Find & Replace** list of glob patterns, which applies
  to every search in that project whatever the panel's toggle says, and to no other project.
- **FR-031**: A panel's toggle state and box text MUST be kept with the panel and restored with it
  after a restart. A new panel takes the FR-028 default and an empty box.
- **FR-032**: The toggle, the box, the global list and the project list are part of the search's
  query: changing any of them re-runs the search under the as-you-type trigger, exactly as editing the
  term does, and applies to the next run otherwise.
- **FR-033**: The File Explorer's menu on a file or folder MUST offer **Exclude from Find in Files in
  this project**, which adds that entry's project-relative path to the project's list. A path excludes
  the file, or the folder and everything beneath it.
- **FR-034**: The results list's menu on a file or folder heading MUST offer the same command for that
  file or folder.
- **FR-035**: The project settings dialog MUST keep its title and show two sections: **Hidden in File
  Explorer** (the existing hidden paths) and **Hidden to Find & Replace** (FR-030's list). Each has its
  own add box and remove controls, and a note naming the global list that also applies to it — the File
  Explorer's excluded globs and the search exclusion list respectively. The Hidden in File Explorer add
  box takes a project-relative path *(derived from the chosen layout)*.
- **FR-036**: Each of the dialog's two lists MUST scroll on its own when it outgrows its space, so the
  other section and the Close button stay in view.
- **FR-037**: The project settings control MUST have its own icon token, defaulting to **⌂** (a plain
  glyph, FR-011a), distinct from the app's Preferences `settings` ⚙.
- **FR-038**: The panel's toggle icon MUST be a themeable icon token with a plain-glyph default.
- **FR-039**: The new preferences MUST appear in the Preferences editor and in `docs/preferences.md`
  (Principle X; the docs-currency guard).
- **FR-040**: A project's list MUST be stored with the project, like its hidden paths, and survive a
  restart; a project from before this change has an empty list.

#### Hand-test feedback (2026-10-29)

- **FR-041**: The results menu opened over a **file heading**, in any grouping, MUST offer **Open In**
  for that file, with the same targets a result row's offers; choosing one opens the file at its first
  line rather than at a match. A folder heading names no file and keeps the row disabled. *(Supersedes
  043 FR-087d for file headings only.)*
- **FR-042**: The results **body** menu MUST NOT carry the Replace toggle, the Use search exclusions
  toggle, the Group by rows or the Split submenu. Each keeps its other route — the toolbar control, the
  replace chord, the panel header's Split — which Constitution VI (v6.0.0) requires. The menu keeps the
  three replace granularities, Open In, Exclude from Find in Files in this project, and Collapse all /
  Expand all. *(Supersedes 043 FR-025a's and FR-046's menu rows, 048 FR-015's content-menu Split for
  this panel, and the menu clauses of 060 FR-018 and FR-027.)*
- **FR-043**: A **Show results** preference (`search.inFiles.showResults`, Search · Find in Files)
  MUST choose whether result headings show **Collapsed** or **Expanded**, defaulting to **Expanded**.
  The panel's toolbar MUST carry a toggle, pressed while collapsed, that writes this preference. Every
  panel follows it, including results already on screen; a heading the user opens or closes by hand
  stays so until the preference next changes, and Collapse all / Expand all act as before. *(Supersedes
  043 FR-034a and 060 FR-016's "open fully expanded" when the preference is Collapsed.)*
- **FR-044**: The project settings dialog MUST close from a ✕ in its title row, with no Close button at
  its foot; a row's remove ✕ MUST line up with its section's add ＋; and each section MUST carry an icon
  control that closes the dialog and opens Preferences at its Settings tab, where that section's global
  list is edited. *(Amends FR-035/FR-036's layout.)*
- **FR-045**: Every **Open In** menu — the File Explorer's, a Find in Files result's or heading's, and a
  link's — MUST, when the file is already open in an editor anywhere, offer one **Current Editor** row in
  place of *Last Active Editor* / *Active Editor* and *New Editor*. Choosing it focuses the editor that
  holds the file and reveals the position the menu was opened for. Rows that would open the file in a
  different editor or tab are drawn disabled: a file is never moved between editors, and must be closed
  where it is before it can open anywhere else (006 FR-011a, unchanged). *(Supersedes 006 FR-072's and
  FR-082's disabled New Editor / Last Active rows for an open file, and 045 FR-170 row 2's New Editor /
  Active Editor rows for one.)*
- **FR-046**: Choosing a grouping in a Find in Files panel MUST set `search.inFiles.defaultGrouping`, and
  every open panel MUST follow a change to it. `search.inFiles.rememberGrouping` is **retired**: a
  persisted value is dropped, not migrated, since the linked preference makes it say nothing. *(Supersedes
  043 FR-033b.)*
- **FR-047**: A Find in Files match revealed in a preview (054 FR-031) MUST be painted as find paints its
  current match in an editor, a terminal or a preview: the current-match fill AND its current-match frame,
  kept on the text as the preview scrolls or resizes. *(Amends 054 FR-031's paint.)*
- **FR-048**: Open In on a Find in Files result row or file heading MUST offer the File Explorer's preview
  rows — *Last Preview Panel* and *New Preview Panel*, with the explorer's labels and disabled rules —
  for a file a preview provider claims. A row's preview opens at its match, as a double-click into a preview
  does (054 FR-031); a heading's opens at the top. The rows are described by one shared builder for both
  surfaces. *(Supersedes the "a result row never offers Preview" reading 044 FR-054 left in the 043/044
  tests; 044 FR-055's editor targets are unchanged.)*
- **FR-049**: Wherever Open In offers *Last Preview Panel* / *New Preview Panel* — the File Explorer and
  Find in Files — a file whose one preview is already open (044 FR-012) MUST instead get one live
  **Current Preview** row. Choosing it focuses that preview and, from a result row, reveals the match there.
  *(Supersedes 047 FR-014's disabled pair for an already-previewed file; the link menu's single Open Preview
  row is not an Open In pair and is unchanged.)*

#### Must not change

- **FR-024**: Search results, match counts, replace behaviour and its granularities, keyboard navigation
  between results, and the ordering within the existing two grouping modes MUST be unchanged.

### Key Entities

- **Grouping**: how results are arranged — Per file, Per file and folder, and now Folder structure.
  Persisted as the default-grouping preference value and as the remembered per-project choice.
- **Folder heading** (Folder structure): one level of the folder hierarchy between the search scope and a
  matching file, collapsible, with its full path as a tooltip.

- **Search exclusion list** — the global glob list Find in Files skips (FR-026), independent of the File
  Explorer's.
- **Panel exclusion state** — a panel's toggle and its box text (FR-027, FR-029), kept with the panel.
- **Project search exclusions** — a project's Hidden to Find & Replace globs (FR-030), kept with the
  project.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For the whole of every scan, a user can tell from the panel alone that it is running — no
  scan of one second or longer completes with the run control showing idle.
- **SC-002**: In every bundled theme, a match highlight in the results is drawn identically to one in the
  find bar and meets the same contrast checks the find bar's does.
- **SC-003**: For a project with files three or more folders deep, a user can locate a given match under
  Folder structure in no more actions than under Per file and folder (043 SC-005's limit holds).
- **SC-004**: No file heading's bold label, in any grouping, contains a path separator; every heading's
  tooltip shows the full path.
- **SC-005**: With a 200-character path, the menu over that row is no wider than over a row whose path is
  20 characters.
- **SC-006**: A single click on a result row opens nothing, in 100% of attempts.
- **SC-007**: After a cancel, the number of rows listed equals the number listed at the moment of
  cancel, in 100% of attempts; none is lost and none is added.
- **SC-008**: During a scan, a listed row opens on its first double-click, with no wait for the scan.
- **SC-009**: No default icon glyph drawn by the Find in Files panel has default emoji presentation, and
  every loading indicator in the app draws the one `busy` glyph.
- **SC-010**: Changing the File Explorer's excluded globs or a project's hidden paths changes the set of
  files Find in Files searches in 0 cases.
- **SC-011**: With the panel's toggle off, a file matched only by the search exclusion list is listed in
  100% of searches; with it on, in 0%.
- **SC-012**: A project's Hidden to Find & Replace entry excludes its matches in 100% of searches in that
  project, whatever the toggle says, and in 0% of searches in other projects.

## Dependencies

- **Constitution v6.0.0 — Principle VI.** FR-022 removes three panel commands from the panel's menu,
  which v5.10.0's "every panel action has a menu item" forbade. v6.0.0, made on this branch, replaces
  that rule with "every panel action is reachable" by a mouse-click or a keyboard command; each of the
  three keeps its on-panel control, and run keeps its chord. The amendment is MAJOR (5.10.0 → 6.0.0). Withdrawing a guarantee for a class of command is likely
  **MAJOR** by the constitution's own versioning test; the amendment owns that judgement.
- **043**: the panel, its groupings, preferences and menu. Superseded or extended requirements are named
  where they change: FR-025a (narrowed), FR-095 (row lock superseded, replace lock widened), FR-043
  (cancelled scans keep their rows), FR-094 (its partial notice reused for a cancel), FR-033/033a/033c,
  FR-034/034a, FR-044, FR-071, FR-073 and FR-085 (extended to Folder structure). Nothing else in 043
  changes. Tests asserting the superseded behaviour (`find-in-files-cancel.test.ts`, and any asserting
  locked rows) change with it.
- **#532 (2026-10-29)**: supersedes **043 FR-045** (search follows the project's exclusion rules) and
  narrows **FR-024** of this spec; extends **004**'s project settings dialog (its hidden-paths list
  stays, and gains a sibling) and **043 FR-092**'s explicit-file-scope rule to the new lists. **033**'s
  rule that the tree and Quick Open give one answer about hidden files is untouched — search is no
  longer part of that answer.
- **013**: the find bar's match tokens, now shared by definition rather than by token alone.

## Assumptions

- "The file search results' styles" means the find bar's match highlight (confirmed, Q2); row layout and
  hover stay the explorer vocabulary 043 FR-085 already uses.
- The busy state replaces the cancel control's glyph rather than adding a separate spinner; the panel's
  status line keeps its own "searching" reading.
- Folder structure is rooted at the **search scope**, not always at the project root, so a scoped search
  draws no empty ancestors.
- The left-truncated name in FR-023 is bounded by width, not by a fixed number of path segments; the full
  path stays in the tooltip of the row the menu was opened from.
- Removing the three menu items needs no replacement chord: each already has one, or is a field.
