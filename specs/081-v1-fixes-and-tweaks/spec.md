# Feature Specification: v1.0.0 fixes and tweaks

**Feature Branch**: `feature/S081-v1-fixes-and-tweaks`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "Spec 081, v1.0.0 fixes and tweaks bundle. Covers #723, #728, #730, #733, #725, #731,
#724, #729, #732, #727. Each issue body holds the detailed requirements and acceptance criteria."

This spec bundles ten v1.0.0 issues that the backlog plan grouped into one branch. Each user story maps to one
issue, or to two issues on the same surface. The issue bodies remain the source for repro detail and code leads;
this spec records what must hold when the branch merges, and every supersession of an earlier requirement.

| Story | Issues | Surface |
|---|---|---|
| US1 | [#723](https://github.com/Bidthedog/throng/issues/723) | Nightly pipeline |
| US2 | [#728](https://github.com/Bidthedog/throng/issues/728) | Couldn't-open notices |
| US3 | [#730](https://github.com/Bidthedog/throng/issues/730) | Markdown preview table layout |
| US4 | [#733](https://github.com/Bidthedog/throng/issues/733) | Sync-scroll highlight |
| US5 | [#725](https://github.com/Bidthedog/throng/issues/725) | Editor and preview title bars |
| US6 | [#731](https://github.com/Bidthedog/throng/issues/731) | Link context menu |
| US7 | [#724](https://github.com/Bidthedog/throng/issues/724) | Follow the active preview |
| US8 | [#729](https://github.com/Bidthedog/throng/issues/729) | Faded ignored entries |
| US9 | [#732](https://github.com/Bidthedog/throng/issues/732) | CSV Preview Editor entry row |
| US10 | [#727](https://github.com/Bidthedog/throng/issues/727) | Focus Mode status strips |

## Clarifications

### Session 2026-11-26

- Q: How long does throng wait after an outside delete of an open file before reporting it missing? → A: 500 ms, a
  named constant rather than a setting, so it can be raised later if rewrites land later than that. (FR-013a)
- Q: When the CSV file has no final newline and the user writes into the entry row, what happens to the final
  newline? → A: The file keeps its convention. A line separator (the file's own line ending) goes before the new row,
  and no final newline follows it. A file that had a final newline keeps one after the new row. (FR-081a)
- Q: When an editor's file really is missing but the editor is hidden by Focus Mode, when
  is the user told? → A: The notice is deferred until that panel is next shown, then raised once. (FR-012a)
- Q: How are entries drawn while git has not yet answered which are ignored? → A: Unfaded at once; the ignored ones
  fade in when git answers. The tree never waits on git. (FR-072a)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A green nightly pipeline (Priority: P1)

The maintainer needs the nightly `pipeline.yml` run on master to pass, because a green full run is the only proof
that work is done. Two failures broke it on `bec9fb43`: the macOS integration test in
`pty-agent-launch-timeout.integration.test.ts` ("does not attribute a previous launch attempt's reason to a later
lapse") failed, and the Linux E2E test in `panel-state-across-windows.e2e.ts` ("an editor synced into a new
sub-workspace window keeps its selection and its open find session") flaked.

**Why this priority**: Every other story's done-ness depends on a green pipeline.

**Independent Test**: Dispatch `pipeline.yml` with the stress options on each test and its platform; both pass every
round.

**Acceptance Scenarios**:

1. **Given** the macOS integration stage, **When** the launch-timeout test runs repeatedly, **Then** it passes every
   time, and a lapse after an earlier failed attempt reports its own reason.
2. **Given** the Linux E2E stage, **When** the cross-window panel-state test runs under stress, **Then** it passes
   every round with no retry.

---

### User Story 2 - Couldn't-open notices that are true (Priority: P1)

A user switching between tabs gets "Couldn't open …" notices several times a day. Many name a panel they cannot
find, some call an existing folder missing, and about half report a file that an agent deleted and rewrote within a
second. The user learns to dismiss the notice unread, including the real one.

**Why this priority**: A false error notice several times a day trains the user to ignore true ones.

**Independent Test**: Each confirmed cause has its own failing test before the fix; the delete-and-rewrite case can
be driven from a terminal with `rm f; sleep 0.2; printf 'x\n' > f` (inside the 500 ms window) and with
`sleep 1` (outside it).

**Acceptance Scenarios**:

1. **Given** an editor whose path is an existing folder, **When** the tab-open scan reports it, **Then** the notice
   says it is a folder, and nothing calls it missing.
2. **Given** a panel the user cannot see or a path they only stepped through in Back/Forward history, **When** a tab
   activates, **Then** no notice names it.
2a. **Given** a hidden panel whose file is really missing, **When** the user brings that panel into view, **Then** one
   notice names it (FR-012a).
3. **Given** a file open in an editor and in a Markdown preview, **When** another program deletes it and writes it
   again within the settle window, **Then** no notice and no banner appear, a clean buffer stays clean, and both
   panels show the new content.
4. **Given** a file deleted and not re-created, **When** the settle window ends, **Then** it is reported missing
   exactly once, as today.
5. **Given** a project root renamed away, **When** the workspace notices, **Then** the one consolidated notice still
   appears (030 FR-034a).

---

### User Story 3 - Tables survive a background reload (Priority: P1)

A user keeps a generated report open in a Markdown preview in a collapsed panel or another tab. Another program
rewrites the file. When the user brings the preview back, some columns are far too wide, and dragging a resize
handle breaks the table completely.

**Why this priority**: Agent output and generated reports are rewritten in the background as a matter of course,
and the tables become unreadable until the preview is reopened.

**Independent Test**: A test redraws a document while its preview has no layout box, then shows it, and compares
the table geometry with a fresh open of the same file.

**Acceptance Scenarios**:

1. **Given** a preview out of view whose file changes on disk, **When** the preview is shown again, **Then** every
   table lays out with the column widths a fresh open gives (047 FR-063/FR-064).
2. **Given** that preview, **When** the user drags a column's resize handle, **Then** the column resizes as it does
   on any other table.

---

### User Story 4 - A sync-scroll highlight on every stop (Priority: P1)

With Synchronise Scrolling on, the in-step highlight (073 FR-033d/FR-033e) misbehaves on tables and blank lines. A
highlighted table row lays out differently while highlighted, scrolling the editor onto a table highlights the
preview row only sometimes, and a stop on a blank line highlights nothing.

**Why this priority**: The highlight exists to show where the two views are in step, and it fails or misleads at
the stops where the user needs it.

**Independent Test**: Component tests on the issue's table shape (empty header row and normal header row) and on a
document with blank lines between paragraphs.

**Acceptance Scenarios**:

1. **Given** a table row under the preview's centre, **When** it is highlighted, **Then** its cells keep the same
   widths, heights, positions and borders as unhighlighted; only the background changes.
2. **Given** the editor scrolled so a table body line sits at the centre, **When** scrolling stops, **Then** the
   matching preview row is highlighted, every time.
3. **Given** a stop with a blank line at the centre, **When** scrolling stops in either view, **Then** the next
   non-blank line and its block are highlighted.
4. **Given** a blank line at the end of the document at the centre, **When** scrolling stops, **Then** the previous
   non-blank line is highlighted.

---

### User Story 5 - One-click Open and Find on title bars (Priority: P2)

A user who wants to open a file in its OS program, or find it in the File Explorer, has to open the panel menu
first. Editors and previews gain two title-bar buttons that run those menu items.

**Why this priority**: A convenience on actions that already work.

**Independent Test**: A component test renders an editor and a preview header and checks the order, the disabled
states and the hide order.

**Acceptance Scenarios**:

1. **Given** an editor title bar, **When** it renders, **Then** it reads `[Open in OS Default Program] [Find in File
   Explorer] | [Save] [Save As] | [common icons]`.
2. **Given** a preview title bar, **When** it renders, **Then** it reads `[Open in OS Default Program] [Find in File
   Explorer] | [common icons]`.
3. **Given** an unsaved document or a source outside the project, **When** the user hovers a button, **Then** it is
   disabled exactly when its menu item is, and the tooltip gives the same reason.
4. **Given** a narrowing header, **When** space runs out, **Then** the pair and their separator hide before Save
   and Save As, and return as it widens.

---

### User Story 6 - The same Open In menu on a link (Priority: P2)

Right-clicking a link to a local file in a terminal or Markdown preview offers different destinations, under
different names, from right-clicking the same file in the File Explorer. The link menu gains the File Explorer's
Open In ▸ submenu, drawn from the same source.

**Why this priority**: A consistency tweak with no broken behaviour behind it.

**Independent Test**: A unit test compares the link menu's Open In rows with the File Explorer's for the same file,
folder, out-of-project file and binary file.

**Acceptance Scenarios**:

1. **Given** a link to an in-project text file, **When** the user right-clicks it, **Then** Open In ▸ matches the
   File Explorer's rows, labels, icons, order and dividers, and each row does the same thing.
2. **Given** a link to a folder, **When** the user right-clicks it, **Then** Open In ▸ shows the File Explorer's
   folder rows.
3. **Given** a link to a file outside the project or a binary file, **When** the user right-clicks it, **Then** the
   submenu omits exactly the rows 045 omits.
4. **Given** any link, **When** its menu opens, **Then** no row appears twice.

---

### User Story 7 - Follow the active preview (Priority: P2)

Follow the active editor reveals an editor's file in the File Explorer, but a preview that becomes active leaves the
tree where it was. A sibling setting extends the follow to previews.

**Why this priority**: An extension of working behaviour behind its own toggle.

**Independent Test**: A component test activates previews with the setting on and off, with sources inside and
outside the project.

**Acceptance Scenarios**:

1. **Given** the setting on, **When** a preview opens or becomes active, **Then** the tree expands to its source
   file and selects it, and focus stays in the preview.
2. **Given** the setting off, **When** a preview becomes active, **Then** the tree is unchanged.
3. **Given** a preview whose source is outside the project, **When** it becomes active, **Then** the tree is
   unchanged.

---

### User Story 8 - Ignored entries read as secondary (Priority: P2)

Build output, dependency folders and local env files look the same in the File Explorer as the project's own files.
Entries git ignores are drawn faded.

**Why this priority**: A visual aid; nothing is broken without it.

**Independent Test**: An integration test asks the ignore source about a fixture repo; a component test checks the
faded rows keep their hue and stay selectable.

**Acceptance Scenarios**:

1. **Given** a git project, **When** the tree shows an ignored file and an ignored folder, **Then** both are faded and
   their tracked or untracked-but-not-ignored siblings are not.
2. **Given** an ignored folder, **When** it is expanded, **Then** everything beneath it is faded.
3. **Given** `.gitignore` edited to add or remove a pattern, **When** the explorer's watch fires, **Then** the fade
   updates with no reload.
4. **Given** a project that is not a git repository, or no git, **When** the tree renders, **Then** nothing fades and
   no notice appears.

---

### User Story 9 - A row to type into after the last CSV row (Priority: P2)

Adding a row at the end of a CSV in the CSV Preview Editor needs Insert Row Below or a paste. The grid gains one
empty entry row after the last row, as a spreadsheet has.

**Why this priority**: A data-entry convenience.

**Independent Test**: A component test types into the entry row and checks the document text, the dirty state and
one-step undo.

**Acceptance Scenarios**:

1. **Given** a CSV open in the CSV Preview Editor, **When** it renders, **Then** one empty row shows after the last
   row, and the document and dirty state are unchanged.
2. **Given** that row, **When** the user types a value into a cell, **Then** the document gains one line of the
   file's column count with the value in its column, and a new entry row appears beneath.
3. **Given** that edit, **When** the user undoes once, **Then** the line and the value go together.

---

### User Story 10 - Focus Mode looks the same on every panel (Priority: P3)

Editors and previews paint their status strip in the Focus Mode highlight with a centred label and exit chord.
Terminals do not. Every panel type with a status strip gains the same highlight.

**Why this priority**: A visual consistency fix; Focus Mode works on terminals already.

**Independent Test**: A component test renders a terminal status bar inside and outside Focus Mode.

**Acceptance Scenarios**:

1. **Given** a terminal in Focus Mode with its status bar shown, **When** it renders, **Then** the bar uses the
   panel border colour with accent text, a centred "Focus Mode" and the exit chord, as an editor's does.
2. **Given** that terminal, **When** Focus Mode ends, **Then** the bar returns to its normal look.
3. **Given** `terminals.showStatusBar` off, **When** a terminal enters Focus Mode, **Then** no status bar appears.

---

### Edge Cases

- A file deleted from outside and re-created as a folder within the settle window is reported as a folder once the
  window ends, never as missing.
- A delete-and-rewrite during throng's own move bracket follows the bracket rules (019 FR-004); the settle window
  adds nothing to a bracketed move.
- A preview redrawn several times while out of view lays out from the last draw only.
- A table whose header row is empty (`| | |`) highlights its header row for the header and delimiter lines.
- A document made only of blank lines highlights nothing, and raises no error.
- A link whose target is still resolving draws the resolution-dependent Open In rows disabled (045 FR-170a/FR-170c).
- A preview and an editor of the same file both reveal the same tree row; the two follows do not fight.
- A nested repository or submodule answers its own ignore rules for the entries inside it.
- Pasting a multi-row block into the CSV entry row writes every pasted row and leaves one new entry row beneath.
- A CSV with no rows at all shows only the entry row.
- A CSV with no final newline still has none after a value is written into the entry row (FR-081a).

## Requirements *(mandatory)*

### Functional Requirements

#### Nightly pipeline (US1, #723)

- **FR-001**: The launch-timeout integration test MUST pass on every platform without a retry. A lapse after an
  earlier failed launch attempt MUST report its own reason, never the earlier attempt's.
- **FR-002**: The cross-window panel-state E2E test MUST pass on every platform without a retry. The fix MUST remove
  the race behind the flake (`throng-testing` stress dispatch), never widen a wait or add a retry.
- **FR-003**: Where either failure turns out to be a product defect, the fix MUST land with a failing test at the
  cheapest layer that shows it.

#### Couldn't-open notices (US2, #728)

- **FR-010**: The tab-open scan MUST report the reason the load or verification actually returned: folder,
  too large, out of tree (018 FR-061) or missing. Only a path that is not there MUST be called missing.
- **FR-011**: The scan's cause kind MUST match its reason. A folder, too-large or out-of-tree verdict MUST NOT carry
  the `path-missing` cause, so it never supersedes the File Explorer's report as an absent folder would (030 FR-029,
  FR-034a).
- **FR-012**: A notice MUST name only editor panels the user can find and open in the tab it names. A panel hidden
  by Focus Mode, the only way a panel in a shown tab is hidden (research R4), and a path the user only passed through in Back/Forward history
  (044 FR-106d) that is no longer the panel's file, MUST NOT raise one.
- **FR-012a** *(Q3, 2026-11-26)*: A hidden editor panel whose file really cannot be opened MUST have its notice
  deferred until the panel is next shown, and then raised once, naming that panel. If the file opens by then, no
  notice is raised.
- **FR-013**: A path that disappears from outside throng MUST wait a settle window before the notice, the panel
  banner and the force-dirtied buffer report it missing. If the path comes back inside the window, nothing is
  reported and the panel reloads or offers the changed-on-disk choice. If it does not, the report MUST be the same
  report as today, once. The window applies to editors and previews alike.
- **FR-013a** *(Q1, 2026-11-26)*: The settle window MUST be a named constant of **500 ms**, not a setting, defined
  once so a later change to its value is one edit. It is not the timer 019 FR-011 forbids.
  FR-011 forbids outlasting throng's own debounce where a bracket exists; an outside delete followed by a write cannot
  be bracketed, so a settle window is the only signal available. The code comment at the constant MUST say so.
- **FR-014**: throng's own move, rename and delete brackets (019 FR-004) MUST stay timer-free.
- **FR-015**: Each confirmed cause of a false notice MUST have a failing test before its fix; the fix MUST record in
  the test which candidate cause from #728 it was.

#### Markdown table layout (US3, #730)

- **FR-020**: A Markdown preview redrawn while it has no layout box MUST measure its tables again when it is next
  shown, and lay them out with the widths a fresh open of the same content gives (047 FR-063/FR-064, R13).
- **FR-021**: A column resize handle on such a table MUST work from the fresh measurement.
- **FR-022**: Table layout on a visible preview's live reload, and on panel and window resize, MUST be unchanged.

#### Sync-scroll highlight (US4, #733)

- **FR-030**: Highlighting a table row MUST change only its background. Cell widths, heights, positions and borders
  MUST equal the unhighlighted row's, with an empty header row and with a normal one.
- **FR-031**: Every table body line in the editor MUST map to its own rendered row; the header and delimiter lines
  MUST map to the header row. Scrolling the editor onto any of them MUST highlight that row every time.
- **FR-032**: When the line at the centre of the scrolled view is blank, the highlight MUST move to the next non-blank
  line and its block in the other view, in both directions of sync. A blank line with no non-blank line after it
  MUST fall back to the previous non-blank line. This supersedes 073 FR-033e's "the row or line under the middle of
  its visible area" for blank lines only; 073's spec gains a supersession note pointing here.
- **FR-033**: The highlight's colour, fade and duration (073 FR-033f), the bars on code blocks and display equations,
  and the alignment Synchronise Scrolling itself keeps MUST be unchanged.

#### Title-bar buttons (US5, #725)

- **FR-040**: Every editor and preview title bar MUST show **Open in OS Default Program** then **Find in File
  Explorer** at the head of its right-hand action group, followed by the section separator Save and Save As use
  (067 FR-069 – FR-074).
- **FR-041**: Each button MUST run its panel menu item's action with no second code path, and MUST be disabled
  exactly when the menu item is, with the same reason in its tooltip (067 FR-071, FR-073). The menu rows, which
  are absent today for a document with no file, MUST instead be drawn disabled with the reason, so menu and button
  agree (Principle VI). Where the user has turned the default-program row off
  (`explorer.showOpenInOsDefaultProgram`), its button is not shown either.
- **FR-042**: Each button MUST use a themeable icon token with an overridable colour (themeable icon controls gate).
- **FR-043**: The pair and their separator MUST join the header fit order (067 FR-069a/FR-069b), hiding before Save
  and Save As. Both actions MUST stay on the panel menu at every width.
- **FR-044**: The panel menu item **Reveal File in File Explorer** MUST be renamed **Find in File Explorer**,
  matching the button and the Link menu (#714). This supersedes the label 046 records for that item; 046's spec gains
  a supersession note pointing here.
- **FR-045**: Terminal and placeholder title bars MUST be unchanged.

#### Link menu Open In (US6, #731)

- **FR-050**: A link to a local file or folder MUST offer an **Open In ▸** submenu built from the same source as the
  File Explorer's Open In ▸ (033, 043, 067 FR-015), with the same rows, labels, icons, groups, dividers and order. A
  later change to one menu MUST reach both.
- **FR-051**: 045's omission rules MUST hold inside the submenu: no editor or preview rows for a target outside the
  project (FR-170a/FR-170c), no editor rows for a binary file (FR-170e), and resolution-dependent rows drawn disabled
  before main answers.
- **FR-052**: A folder target MUST get the File Explorer's folder rows. Rows that need a project (Terminal in the
  file's folder, Search scoped to it) MUST appear when the target is in a project, and be absent otherwise.
- **FR-053**: "Open in OS Explorer" and "Open in OS Default Program" MUST move into Open In ▸ under the File
  Explorer's labels, and appear once. Open Link, Find in File Explorer and Copy Link to Clipboard MUST stay outside
  the submenu. This supersedes 045's top-level placement of those two rows and of "Open Preview"; 045's spec gains a
  supersession note pointing here.
- **FR-054**: The link menu for URLs and UNC paths, and Open Link's chord, MUST be unchanged.

#### Follow the active preview (US7, #724)

- **FR-060**: A setting **Follow the active preview** (`explorer.autoRevealActivePreview`), default **on**, MUST sit
  directly below Follow the active editor (`explorer.autoRevealActiveFile`) in the File Explorer group, with a
  one-line description, searchable, in the shipped defaults and the preferences docs (configuration-editor
  completeness gate).
- **FR-061**: With it on, a preview that opens or becomes active MUST reveal its source file in the tree as Follow the
  active editor does, without moving focus. It MUST key on the path, so a selection made by hand stands until the
  active preview's file changes.
- **FR-062**: A preview with no source, or a source outside the project root, MUST leave the tree unchanged.
- **FR-063**: The two follow settings MUST be independent.

#### Faded ignored entries (US8, #729)

- **FR-070**: The File Explorer MUST draw every entry git ignores faded: `.gitignore` at every level,
  `.git/info/exclude` and the user's global excludes. Everything shown beneath an ignored folder MUST fade with it.
  The answer MUST come from git itself, not a reimplementation of its matching.
- **FR-071**: The fade MUST reduce opacity only, keeping the theme's text hue and the icon pack's colours. The amount
  MUST be a theme token. Selection, hover, focus, the active-file highlight and drag targets MUST stay legible on a
  faded entry in every bundled theme (078 contrast gate).
- **FR-072**: The fade MUST follow changes to the ignore files and the tree through the explorer's existing watch,
  with no extra recursive watch per root (#274).
- **FR-072a** *(Q4, 2026-11-26)*: The tree MUST draw a listing at once, unfaded, and fade its ignored entries when
  git answers. The question to git MUST be event-driven, never polled: it is asked for a folder's entries when the
  folder's listing loads or changes, and asked again for every listed entry when the explorer's watch reports a change
  to a `.gitignore`. Calls MUST be batched per listing and debounced like the watch. A change to `.git/info/exclude`
  or the global excludes file is picked up the next time a listing loads or the tree refreshes.
- **FR-073**: Outside a git repository, or with git unavailable, nothing MUST fade and no notice MUST appear.
- **FR-074**: What the File Explorer shows and hides (`explorer.excludeGlobs`, 062 FR-051), and Quick Open's and Find
  in Files' scope, MUST be unchanged.

#### CSV entry row (US9, #732)

- **FR-080**: The CSV Preview Editor MUST show one empty entry row after the file's last row. While it is empty, the
  document MUST have no line for it: the file, Save, the editor view and the dirty state are unaffected.
- **FR-081**: Typing or pasting into the entry row MUST write it to the document as the file's delimiters with the
  value in its column, as one undo step with the value, and a new entry row MUST appear beneath. Undo MUST remove the
  line and the value together.
- **FR-081a** *(Q2, 2026-11-26)*: Writing the entry row MUST keep the file's final-newline convention and line
  ending. In a file with no final newline, the row is written as the file's line ending followed by the row, with no
  line ending after it. In a file with a final newline, the row is written after that newline and followed by one.
- **FR-082**: Clicking, selecting or moving through the entry row with the keyboard MUST write nothing.
- **FR-083**: The entry row MUST look not yet part of the file (a muted or absent row number, from existing theme
  tokens). Cut and Insert Row Above (the row-header operations that need a real row; the menu has no Delete Row)
  MUST be drawn disabled on it, never hidden (Principle VI). This
  refines 073 FR-038 and FR-037c/FR-037f; 073's spec gains a note pointing here.
- **FR-084**: Empty rows already in the document, Insert Row Above/Below, paste past the last row, the file's line
  endings and final newline, and the read-only spreadsheet preview MUST be unchanged.

#### Focus Mode status strips (US10, #727)

- **FR-090**: Every panel type with a status strip that can enter Focus Mode MUST paint it in the Focus Mode
  highlight with the centred label and exit chord, exactly as editors and previews do, through the one shared class
  and badge. No second styling of the state MUST exist.
- **FR-091**: The terminal status bar's toggles (076 FR-001) and flavour label MUST stay legible and clickable on the
  highlight in every bundled theme.
- **FR-092**: With `terminals.showStatusBar` off, Focus Mode MUST look as it does today.
- **FR-093**: The PR MUST list every panel type with a status strip as checked.

#### Cross-cutting

- **FR-100**: Every bug story (US1–US4) MUST start from a failing test at the cheapest layer that shows it
  (Principle V, `replicating-bugs`).
- **FR-101**: `README.md` and `docs/` MUST be updated in the same change for every user-visible change: the new
  setting, the renamed menu item, the title-bar buttons, the link menu and the entry row (docs-currency gate).
- **FR-102**: Each superseded requirement named above (073 FR-033e, 046's menu label, 045's top-level link rows, 073
  FR-038) MUST carry a supersession note in its own spec pointing to the FR here.

### Key Entities

- **Settle window**: the interval between an outside delete and the missing report, during which a re-created path
  cancels the report.
- **Entry row**: the CSV grid row after the last row that exists only in the view until a value is written into it.
- **Ignore verdict**: git's answer, per visible explorer entry, to whether the entry is ignored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A full `pipeline.yml` run on the branch's final commit is green on Windows, Linux and macOS, and each
  US1 test passes 20 stress rounds on its failing platform.
- **SC-002**: A delete-and-rewrite of an open file that completes inside the 500 ms settle window raises no notice in
  20 out of 20 trials.
- **SC-003**: A session of tab switching on a workspace with restored panels raises no "Couldn't open" notice for a
  file or folder that exists.
- **SC-004**: After a background rewrite while out of view, every table's column widths match a fresh open's within
  1 pixel.
- **SC-005**: Every scroll stop in a Markdown document with tables and blank lines highlights exactly one line in
  each view.
- **SC-006**: Opening a file in its OS program, or finding it in the File Explorer, takes one click from any editor
  or preview at full header width.
- **SC-007**: For any local file, the link menu's Open In ▸ and the File Explorer's Open In ▸ list identical rows.
- **SC-008**: Adding a row at the end of a CSV takes a click and typing, with no menu.

## Assumptions

- The settle window is 500 ms (Q1). The observed rewrite gap is about half a second, so a rewrite that lands just
  past the window still raises the notice; raising the constant is the expected remedy if that shows up in use.
- The fade theme token ships at an opacity that keeps faded text within the 078 contrast gate's tolerance in every
  bundled theme; the exact value is settled at plan time against that gate.
- "Panel types with a status strip" means editors, every preview provider and terminals today; the audit in FR-093
  confirms or extends that list.
- US1's two failures are separate causes. If either proves to be a test defect rather than a product defect, the fix
  lands in the test and FR-003 does not apply to it.
- The branch merges only after every story is complete; no story is deferred to a later release without its own
  issue.
