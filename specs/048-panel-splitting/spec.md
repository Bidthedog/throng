# Feature Specification: Panel Splitting and Content-Derived Panel Titles

**Feature Branch**: `feature/S048-I433-I453-panel-splitting`

**Created**: 2026-09-29

**Status**: Draft (rewritten 2026-09-30 after the maintainer's review)

**Input**: User description: "Create a spec based on the issues referenced" — the v1.0.0 panel header and
splitting group: #433 (panel splitting: split from a menu, **+** adds beside the clicked panel, and drops
against the centre pane's outer edges) and #453 (remove the ability to rename panels). Revised
2026-09-30: the splits move onto the **+** button as a four-way dropdown, mirrored in a **Split** submenu
of the panel header menu, with a two-stroke arrow-key chord and a visible split mode. Widened
2026-09-30 by a backlog sweep to fold in three issues that touch the same drag and chord code:
#458 (Esc-cancelled drag leaves its ghost), #459 (an abandoned cross-tab drag moves a preview's scroll)
and #275 (one window-chord dispatcher for every window).

The two original issues share one surface — the panel header, its menu and its **+** button — and both change
what happens when a panel is added. They ship together so the header and the add path are reworked once.

This feature builds on **002 (panes and panels)**, the owner of the docking model; on **046**, which
introduced multi-stroke chords; and on **024**, **031**, **033**, **043**, **044** and **046**, each of
which carries a panel-rename clause. Every requirement in those specs not named below as superseded,
refined or extended stands unchanged. Where a requirement here changes an older one, it says so,
naming what it replaces and why.

**Tab renaming, project renaming and sub-workspace renaming are not affected.** Each is a separate
mechanism (its own operation, its own rename box, no custom-title flag) and each keeps working exactly
as today. Only the renaming of a **panel** is removed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Split a panel in any direction from its + button (Priority: P1)

A user knows exactly the layout they want — "a new panel above this terminal" — but today the only
way to get it is to drag an existing panel's header onto another panel's edge, and the **+** button
ignores where it was clicked: it appends a full-height column at the far side of the tab and
re-equalises every column. With this story the **+** button on every panel header opens a small menu
of four splits — **Split Down**, **Split Up**, **Split Right** and **Split Left** — and choosing one
puts a new empty panel on that side of the panel whose **+** was clicked. Nothing else moves.

**Why this priority**: Adding a panel is the most frequent layout action in the product, its current
result surprises the user whenever the layout is not a single row, and a directional split has no
route today except dragging.

**Independent Test**: In a 2x2 layout, open the bottom-left panel's **+** menu and choose each split in
turn (undoing between them); check that the new panel appears on the chosen side inside the
bottom-left quadrant, takes focus, and that the other three panels have not moved or resized.

**Acceptance Scenarios**:

1. **Given** any panel, **When** the user clicks its **+** button, **Then** a menu opens listing Split
   Down, Split Up, Split Right and Split Left, each showing its chord; nothing is added until one is
   chosen.
2. **Given** the **+** menu of a panel is open, **When** the user chooses **Split Right**, **Then** that
   panel's slot is divided left/right, the original panel keeps the left half, a new empty panel takes
   the right half, and the new panel has focus.
3. **Given** the same, **When** the user chooses **Split Left**, **Split Down** or **Split Up**, **Then**
   the new panel takes the left, bottom or top half respectively, and the original keeps the other half.
4. **Given** a 2x2 layout, **When** the user splits the bottom-left panel, **Then** only that panel's slot
   is divided; the other three panels keep their positions and sizes.
5. **Given** the **+** menu is open, **When** the user presses Escape or clicks elsewhere, **Then** the
   menu closes and the layout is unchanged.
6. **Given** a panel that is not the active panel, **When** the user clicks its **+** button, **Then** that
   panel becomes the active panel as the menu opens, and the chosen split applies to it.
7. **Given** any panel, **When** the user right-clicks inside its content, **Then** the content menu also
   contains the **Split** submenu (User Story 2).
8. **Given** the **+** button has keyboard focus, **When** the user presses Enter or Space, **Then** the
   menu opens and its items can be chosen with the arrow keys and Enter.

---

### User Story 2 - Split from the right-click menus (Priority: P1)

A user who reaches for a right-click menu to find what a panel can do sees a **Split** entry there —
whether they right-click the panel's header or its content — with the same four directions as a
submenu.

**Why this priority**: The panel's menus are the canonical index of its actions (Principle VI), and
they are the route a keyboard user reaches with Shift+F10.

**Independent Test**: Right-click a panel header, open **Split**, choose each direction in turn, and
check the result matches the same choice from the **+** menu; repeat from a right-click inside the
panel's content.

**Acceptance Scenarios**:

1. **Given** any panel, **When** the user opens its header menu or right-clicks inside its content,
   **Then** the menu contains a **Split** item whose submenu lists Split Down, Split Up, Split Right and
   Split Left, each showing its chord.
2. **Given** a menu was opened with Shift+F10, **When** the user picks a split from the
   submenu with the keyboard, **Then** the result is identical to choosing it with the mouse or from
   the **+** menu.
3. **Given** a user rebinds one split command in Key Bindings, **When** they open either menu, **Then**
   that item shows the new chord.

---

### User Story 3 - Split from the keyboard with split mode (Priority: P1)

A keyboard user presses **Ctrl+Shift+Alt+End** to enter **split mode** on the active panel: its border
pulses and its status bar says a chord is waiting. They then press an arrow key, and the panel splits
in that direction. Escape leaves split mode without doing anything.

**Why this priority**: It makes splitting a keyboard operation (#26), and it pairs with moving focus
between panels, which already uses Ctrl+Shift+Alt+Arrow.

**Independent Test**: Focus a terminal panel, press Ctrl+Shift+Alt+End, check the border pulses and the
status text appears, press the Down arrow, and check a new empty panel appears below with focus.
Repeat, pressing Escape instead of an arrow, and check nothing changes and the terminal received
neither key.

**Acceptance Scenarios**:

1. **Given** any panel is active, **When** the user presses Ctrl+Shift+Alt+End, **Then** split mode
   starts on that panel: its border pulses, and its status bar (where the panel has one) reads
   "(Ctrl+Shift+Alt+End) was pressed. Waiting for the next key of the chord…".
2. **Given** split mode, **When** the user presses Down, Up, Right or Left, **Then** the active panel
   splits in that direction exactly as the matching menu item does, and split mode ends — whether the
   user released Ctrl+Shift+Alt first or is still holding them.
3. **Given** split mode, **When** the user presses Escape, **Then** split mode ends, nothing is split,
   the Escape is consumed (no find bar closes, nothing reaches the terminal), the border stops
   pulsing, and keyboard focus is on the panel that was in split mode.
4. **Given** split mode, **When** the user presses any other key, **Then** split mode ends without a
   split, and the standard "The key combination (…) is not bound." indication appears.
5. **Given** split mode, **When** no key is pressed within the multi-stroke timeout, or focus leaves
   the window or moves to another panel, **Then** split mode ends without a split.
6. **Given** a terminal panel is active, **When** the user enters and completes split mode, **Then**
   neither stroke is delivered to the shell.

---

### User Story 4 - Drop a panel along a whole edge of the workspace (Priority: P2)

A very common layout is a tall terminal down one side, or a wide one along the bottom, with the rest of
the workspace beside or above it. Today it cannot be reached by dragging: every drop zone belongs to a
single panel and splits only that panel, so in a 2x2 layout a dropped panel can only ever split one of
the four quadrants. With this story, while a panel is being dragged, the panel area itself shows a drop
zone along each of its four outer edges. Dropping there places the panel along the whole of that edge,
spanning every panel already there.

**Why this priority**: It unlocks a layout that is impossible today, but the split stories deliver value
on their own and carry less risk, so they come first.

**Independent Test**: Build a 2x2 layout plus one extra panel, drag the extra panel to the far left of
the panel area, check that the preview spans the full height before releasing, release, and check that
the result is one full-height column beside the untouched 2x2 block — and that it survives a restart.

**Acceptance Scenarios**:

1. **Given** a panel is being dragged over the panel area, **When** the pointer enters the band along
   the area's left edge, **Then** an outer-edge drop zone is highlighted whose preview covers the full
   height of the panel area and is visibly different from a single panel's own edge-zone preview.
2. **Given** a 2x2 layout and a fifth panel being dragged, **When** the user drops it on the left outer
   edge, **Then** the layout becomes one full-height column on the left, a third of the width, beside
   the unchanged 2x2 block.
3. **Given** the same, **When** the user drops on the bottom outer edge, **Then** the dropped panel spans
   the full width along the bottom, a third of the height, beneath the unchanged 2x2 block.
4. **Given** the pointer is over a panel's own edge zone but outside the outer-edge band, **When** the
   user releases, **Then** the existing per-panel split happens exactly as it does today.
5. **Given** a layout produced by an outer-edge drop, **When** the application is restarted, **Then** the
   same layout is restored; the same drop made in a sub-workspace window changes only that sub-workspace.
6. **Given** a panel dragged from inside the layout, **When** it is dropped on an outer edge, **Then** it is
   removed from its old position (with the usual collapse of its emptied split) and placed along the
   edge; it keeps its identity and content.

---

### User Story 5 - A panel is always named by what it holds (Priority: P2)

A panel's title already says what is in it: the file an editor or preview shows, a terminal's shell and
folder, the Find in Files panel. A renamed panel mostly hides that information. The rename feature also
costs a header edit mode, a menu item, a chord, a Reset Name command, a flag persisted in every layout,
cross-window sync and a precedence rule — for something the maintainer no longer uses. With this story
the panel title is always derived from its content, and every way of renaming a panel is gone.

**Why this priority**: It simplifies rather than adds, and it must land with User Story 1 because the
**+** button currently opens a new panel in rename mode.

**Independent Test**: Right-click a panel header, double-click it, press the former rename chord, and add
a new panel; check that none of them offers to rename the panel. Then load a layout saved by the
previous release with custom panel titles and check that it loads without error, showing each panel's
content-derived title.

**Acceptance Scenarios**:

1. **Given** any panel, **When** the user opens its header menu, **Then** there is no Rename item and no
   Reset Name item.
2. **Given** any panel, **When** the user double-clicks its header title, **Then** no text box appears
   and the title is unchanged.
3. **Given** any panel has focus, **When** the user presses F2 (the former rename chord), **Then** the panel
   is not renamed; F2 does whatever else it is bound to in that context (for example, renaming a file in
   the File Explorer), or nothing.
4. **Given** the Key Bindings editor, **When** the user searches for "rename panel", **Then** no such
   command is listed.
5. **Given** a layout saved by an earlier release in which panels have custom titles, **When** it is
   loaded, **Then** it loads without error, every panel shows its content-derived title, and every
   panel's identity, position, size and content is unchanged.
6. **Given** a tab, a project or a sub-workspace, **When** the user renames it as today, **Then** the
   rename works exactly as before.

---

### User Story 6 - An abandoned drag changes nothing (Priority: P2)

A user starts dragging a panel or a tab and changes their mind. Pressing Escape cancels the drag, but
today the drag ghost stays on screen over the workspace until another drag is made and dropped (#458).
A preview dragged through another tab and back can also come back scrolled somewhere else, losing the
reader's place (#459). With this story an abandoned drag cleans up after itself at once and leaves the
layout, and every panel's scroll position, as it was.

**Why this priority**: The outer-edge zones (User Story 4) add more drag targets, and split mode and the
**+** menu both end on a drag, so the drag lifecycle is being reworked anyway; Escape is the natural way
to abandon a drag and it currently leaves debris every time.

**Independent Test**: Drag a panel by its header until the ghost appears, press Escape while still holding
the button, release, and check the ghost and every drop highlight are gone and the layout is unchanged.
Repeat with a tab from the tab strip, and with a panel dragged over another tab until that tab shows.

**Acceptance Scenarios**:

1. **Given** a panel or tab drag is in progress, **When** the user presses Escape, **Then** the drag ends,
   the ghost disappears at once, every drop highlight is cleared, and no layout change is made or saved.
2. **Given** a panel drag has hovered another tab long enough to show it, **When** the user presses
   Escape, **Then** that tab stays the active tab; the drag does not switch back to the tab it started from.
3. **Given** a drag was cancelled with Escape, **When** the user starts another drag, **Then** it shows a
   single ghost and behaves exactly as a first drag does.
4. **Given** a Markdown preview in tab A scrolled to the middle, and a preview in tab B with collapsed
   sections scrolled past them, **When** the user drags tab A's preview onto tab B, moves across several
   of tab B's drop regions, returns to tab A and drops it where it started (or presses Escape), **Then**
   the tab A preview is at the scroll position it had before the drag (#459). This holds with no editor
   open for either file.
5. **Given** any preview whose tab is hidden and shown again, for any reason, **When** it is shown,
   **Then** it is at its own last scroll position.

---

### Edge Cases

- **Split a zoomed panel**: the original panel keeps its zoom level; the new panel starts at the default
  zoom level.
- **Split a very small panel**: the split happens; each half is clamped by the same minimum-size rule a
  per-panel drop split uses today.
- **Split a preview, the Find in Files panel or another special panel**: allowed; the new panel is an
  ordinary empty panel beside it. The special panel is unchanged (a parented preview stays parented).
- **Split mode with focus outside the workspace** (File Explorer, project list, a find bar): the chord
  targets the workspace's active panel, as every panel command dispatched by chord does, and moves focus
  to that panel as split mode starts; cancelling leaves focus there.
- **Split mode entered twice**: pressing Ctrl+Shift+Alt+End again while in split mode restarts the
  timeout on the same panel; it does not stack.
- **Split mode and a menu**: opening any menu, or starting a drag, ends split mode without a split.
- **Splitting in a sub-workspace window**: works on that window's active panel and changes only that
  sub-workspace's layout. No project layout is split. Layouts, tabs and panel sizes are each window's own;
  only project-owned panels stay synced with their project counterparts (005 FR-021, FR-027a), and a split
  creates a new placeholder, not a project-owned panel.
- **+ menu and a drag**: the **+** menu is closed if a panel drag starts.
- **A tab with a single panel**: a panel can only reach it by being dragged from another tab, and the
  outer edge and the panel's own edge are the same position. No outer-edge zones are offered; only the
  panel's own edge zones are (FR-060).
- **Outer-edge drop that changes nothing**: dropping the panel that already spans the whole of that edge
  onto that same edge is a no-op; the layout is unchanged and nothing is persisted.
- **Outer-edge drop when the root already runs that way**: dropping on the left edge of a layout whose
  top level is already a row of columns adds the panel as a new first column; the existing columns keep
  their relative proportions within the remaining space.
- **Pointer in a corner**: where two outer-edge bands overlap, exactly one zone is highlighted, and the
  drop does what the preview showed.
- **Drag that leaves the window**: tearing a panel out into a new window is unchanged; the outer-edge
  bands sit inside the panel area and never steal a tear-off.
- **Drag onto the tab strip**: dropping on a tab or on the tab-strip **+** is unchanged. The tab-strip
  **+** (new tab) is a different control from a panel's **+** and is not affected by this feature.
- **Former rename chord in a terminal**: F2 in a terminal goes to the terminal program once it is no
  longer a panel command (subject to Principle IV's reserved-key rules).
- **Duplicate automatic titles**: two panels showing the same content are still told apart by the
  existing automatic uniqueness rule; removing custom titles does not remove that rule.
- **Title length**: the tab/panel name limit (031 FR-037) still applies to content-derived panel titles.
- **Loading an old layout twice**: the migration that drops custom titles is idempotent; loading the
  migrated layout again changes nothing.
- **Downgrade**: a layout written by this release and opened by an earlier one loads there with
  content-derived titles; no field the earlier release needs is removed.
- **Escape during a drag with split mode or the + menu open**: the drag has already ended both (FR-022);
  Escape cancels the drag only.
- **Escape after the drag switched tabs**: the tab showing stays active (FR-081); only the drag's own
  visuals and state are undone.

## Requirements *(mandatory)*

### Functional Requirements

#### Split commands (#433)

- **FR-001**: Four **split commands** MUST exist — **Split Down**, **Split Up**, **Split Right** and
  **Split Left** — each dividing the target panel's slot 50/50 and placing a new **empty placeholder
  panel** on the named side, with the original panel keeping the other half. No other panel changes
  position or size.
- **FR-002**: The new panel MUST take focus (Principle XI, *focus follows the active panel*) and MUST NOT
  open in any rename or text-entry mode (FR-030).
- **FR-003**: The split commands MUST be registered commands: listed in the Key Bindings editor, each
  bindable and rebindable on its own, and dispatched to the **active panel** when invoked by chord.
- **FR-004**: The split commands MUST be available on every panel type, including previews and the Find
  in Files panel, in the main window and in sub-workspace windows. A split in a sub-workspace window MUST
  change only that sub-workspace's layout. Splitting a zoomed panel MUST leave the original panel's zoom
  level unchanged and start the new panel at the default zoom level.
- **FR-005**: **Supersedes 002 FR-017 in part.** 002 FR-017 made docking mouse drag-and-drop only and put
  keyboard or command docking out of scope. The split commands are a command route to a split. *Why*:
  the exclusion predates the registered-command model and the every-panel-action-has-a-menu-item rule;
  a split with no command cannot be reached from the keyboard (#26). Moving an **existing** panel
  remains drag-only; FR-017's rule stands for moves.

#### The + button (#433)

- **FR-010**: Clicking a panel's **+** button MUST open a menu listing, in this order, Split Down, Split
  Up, Split Right and Split Left, each showing its command's current chord. Choosing one MUST split the
  panel whose **+** was clicked (FR-001). Nothing is added until an item is chosen; dismissing the menu
  changes nothing.
- **FR-011**: Clicking a panel's **+** button MUST make that panel the active panel as the menu opens, so
  the chosen split applies to the active panel, in its own tab.
- **FR-012**: The **+** button MUST be operable from the keyboard: Enter or Space opens the menu, and the
  menu's items are navigable with the arrow keys and chosen with Enter, like every other menu.
- **FR-013**: **Refines 002 FR-012a.** 002 FR-012a requires the add-panel affordance to add a placeholder
  panel "into the active Tab" and states no placement. The affordance now opens a menu of directional
  splits (FR-010), each of which adds its placeholder beside the clicked panel in the clicked panel's
  tab (FR-011). *Why*: the append-to-root placement was never a requirement, only the code's
  behaviour, and it moves the new panel away from where the user clicked.
- **FR-014**: The **+** button's hover title MUST describe what it now does ("Split panel…") rather than
  "Add panel" (Development Workflow, *themeable icon controls with hover titles*).

#### The header and content menus (#433)

- **FR-015**: Every panel's header menu **and** its content (right-click inside the panel) menu MUST contain
  a **Split** item that opens a submenu listing the same four split commands, in the same order, each
  showing its current chord. This satisfies Principle VI's *every panel action has a menu item* for the
  split commands; the **+** menu is an accelerator alongside them. A panel type with no content menu
  today (an empty placeholder) gains one carrying at least the **Split** item.
- **FR-016**: The **Split** item MUST sit in the section Principle VI's section vocabulary assigns to
  layout actions, in both menus, and the menu section contract (033) MUST be updated to include it.

#### Split mode — the keyboard route (#433)

- **FR-020**: Each split command MUST ship with a **two-stroke default chord**: first stroke
  **Ctrl+Shift+Alt+End**, second stroke the matching arrow key — `Ctrl+Shift+Alt+End,ArrowDown`,
  `…,ArrowUp`, `…,ArrowRight` and `…,ArrowLeft`. The first stroke MUST be matched on the physical key,
  as every Ctrl+Shift+Alt chord is (Principle IV, tier 1). AltGr cost: none — End and the arrow keys
  produce no AltGr character on the UK, German, French, Spanish, Italian, Nordic or Polish layouts, so
  the chords are reachable on all seven.
- **FR-020a**: The expected way to type a split chord is to hold Ctrl+Shift+Alt, press and release End,
  then press an arrow — usually with Ctrl+Shift+Alt **still held**, though the user may release them
  first. The arrow MUST complete the split in both cases: during split mode, an arrow pressed with any of
  the first stroke's modifiers still held MUST count as the bare arrow. Split mode takes precedence, so
  Ctrl+Shift+Alt+Arrow during split mode never moves focus (`focus.*`). **Refines 046 FR-092** for
  window-scope chords only, where modifiers otherwise count per stroke.
- **FR-021**: Pressing the first stroke MUST start **split mode** on the active panel, moving keyboard focus
  to that panel if it was elsewhere (the File Explorer, the project list, a find bar). While it lasts:
  the panel's border MUST pulse, using the attention colour of 047 FR-083's flash; and where the panel
  has a status bar, it MUST show the standard multi-stroke pending text (046 FR-091), "(Ctrl+Shift+Alt+End)
  was pressed. Waiting for the next key of the chord…". A panel with no status bar shows the pulse alone.
- **FR-022**: Split mode MUST end:
  - on a bound second stroke (an arrow key), which performs that split;
  - on **Escape**, which cancels, is consumed, and closes no bar and reaches no terminal;
  - on any other key, which cancels and shows the standard "not bound" indication (046 FR-092);
  - on the multi-stroke timeout, a focus change to another panel or out of the window, opening a menu,
    or starting a drag, each of which cancels.
  When split mode ends for any reason, the pulse and the pending text MUST stop at once. When it is
  cancelled by Escape, another key or the timeout, keyboard focus MUST remain on (or return to) the panel
  that was in split mode.
- **FR-023**: Neither stroke of a split chord MUST reach a terminal's shell, whether the chord completes
  or is cancelled.
- **FR-024**: **Extends 046 FR-091 / FR-092 / FR-126** (multi-stroke chords, their pending indication, their
  endings and their written form) from the editor to **window scope**: a multi-stroke chord bound to a
  panel command is live in every panel type, including terminals. Its first stroke is judged by the
  terminal tiers as Principle IV requires; `Ctrl+Shift+Alt+End` is tier 1, not reserved, so it is live in
  terminals. The endings, timeout and wording are 046's, unchanged except for the
  held-modifier rule of FR-020a.
- **FR-025**: Pressing the first stroke again during split mode MUST restart the timeout on the same panel,
  not start a second mode.
- **FR-026**: The pulse MUST be a compositor-only animation that adds no layout work while it runs
  (Principle XII), and MUST respect the operating system's reduced-motion setting by showing a steady
  highlighted border instead of a pulse.

#### Outer-edge drop zones (#433)

- **FR-060**: While a panel is being dragged, the **panel area** of a tab (the region holding its
  panels, in the main window and in sub-workspace windows) MUST offer four **outer-edge drop zones**:
  bands along its left, right, top and bottom edges. A tab holding a **single panel** MUST NOT offer
  outer-edge zones: its outer edge and its panel's edge are the same position, so only the panel's own
  edge zones are available there.
- **FR-061**: Dropping on an outer-edge zone MUST place the dragged panel along the whole of that edge:
  full height for left and right, full width for top and bottom. It spans every panel currently along
  that edge.
- **FR-062**: The dropped panel MUST take **one third** of the panel area along the drop axis: a third of
  the width for a left or right drop, a third of the height for a top or bottom drop. The rest of the
  layout keeps its internal arrangement and relative proportions within the remaining space.
- **FR-063**: When the top level of the layout already runs along the drop axis (for example, a row of
  columns and a left or right drop), the dropped panel MUST become a new first or last member of that
  top level rather than wrapping it in a further split.
- **FR-064**: An outer-edge band MUST be narrow enough that the panel zones underneath stay easy to hit,
  and wide enough to hit deliberately. Inside the band, the outer-edge zone MUST win over the zone of the
  panel beneath the pointer. Where two bands overlap at a corner, exactly one zone MUST win, by a fixed
  and documented rule.
- **FR-065**: The outer-edge drop preview MUST show the result before release: a highlight spanning the
  full edge, sized as the drop will be, and visibly distinct from a panel's own edge-zone preview.
- **FR-066**: Outer-edge zones MUST give feedback within the same bound 002 NFR-001 sets for existing
  drop targets, and MUST NOT add layout measurement on every pointer move (Principle XII).
- **FR-067**: A panel moved by an outer-edge drop MUST keep its identity and content; the split it left
  MUST collapse by the existing collapse rules (002; Principle XI). Dropping a panel onto the edge it
  already spans alone MUST be a no-op.
- **FR-068**: A layout produced by an outer-edge drop MUST persist and be restored after a restart,
  exactly like any other layout change (002 FR-026): the main window's with the project, a
  sub-workspace's with that sub-workspace. It changes only the window it was made in. The existing per-panel edge zones, tear-off, tab-strip and tab drops MUST behave exactly as
  today.

#### Removing panel renaming (#453)

- **FR-030**: No surface may offer to rename a panel: no header edit mode, no double-click on the header
  title, no Rename item in any menu, no rename command or chord, and no rename-on-add for a new panel.
- **FR-031**: The **Reset Name** command and its menu item MUST be removed.
- **FR-032**: Every panel's title MUST be its content-derived title everywhere a panel is named: the
  header, the tab strip, menus, tooltips, notices, and the default save name for an unsaved editor
  (006 FR-083).
- **FR-033**: The existing automatic naming rules MUST stay unchanged: content-derived titles (024
  FR-015), terminal titles (023 FR-033), uniqueness across panels, and the name-length limit applied to
  derived titles (031 FR-037).
- **FR-034**: Every panel MUST keep its unique identifier. Panel identifiers MUST NOT change across this
  change or its migration.
- **FR-035**: A persisted layout carrying custom panel titles (from the main window, a sub-workspace or a
  tear-off) MUST load without error. Its custom titles MUST be discarded and each panel shown with its
  content-derived title. Nothing else in the layout may change. The migration MUST be idempotent.
- **FR-036**: Cross-window synchronisation of panel **renames** MUST be removed. Synchronisation of a
  project-owned panel's content-derived title with its counterparts MUST be kept.
- **FR-037**: The removed command MUST disappear from the Key Bindings editor. A user override that
  bound it MUST be ignored without error, and MUST NOT block the chord it named from resolving to
  another command.
- **FR-038**: Tab renaming, project renaming and sub-workspace renaming MUST be unchanged.
- **FR-127**: An empty panel — one with no content assigned yet, whether created by **+**, a split or any
  other route — MUST be titled **Blank Panel** until content is assigned, when its content-derived title
  takes over. Uniqueness across panels (FR-033) still holds: the first is "Blank Panel", further ones
  "Blank Panel 2", "Blank Panel 3", …, taking the lowest free number, as the generated "Panel N" sequence
  did. *(Iterate 1, 2026-09-30, maintainer at MT-05; the numbering is derived from FR-033 and the existing
  generated-name rule, not confirmed by the maintainer.)*
- **FR-128**: A persisted layout whose empty panels carry a generated "Panel N" title MUST load with those
  panels titled by the Blank Panel sequence (FR-127). Panel identifiers and everything else in the layout
  MUST be unchanged, and the migration MUST be idempotent, as FR-035's is. *(Iterate 1, derived from
  FR-035; not confirmed by the maintainer.)*
- **FR-130**: An empty panel MUST be **shown** as exactly "Blank Panel" everywhere a panel is named
  (FR-032), with no number, however many empty panels exist. The stored generated name MAY keep its
  number ("Blank Panel 2", …) internally, so FR-033's uniqueness and FR-128's migration are unchanged;
  only what the user sees drops it. *Supersedes the numbered display FR-127 implied (Session 2026-09-30,
  iterate 2, maintainer: "The Blank Panels do not need numbers. You can keep them internally if you need
  to, but the panel should just say 'Blank Panel'").*

#### Destroy Panel from the keyboard (#461)

- **FR-131**: A **Destroy Panel** command (`panel.destroy`) MUST ship with the default chord
  `Ctrl+Shift+Alt+F4` and MUST be live in **every panel type** — editor, terminal (including one
  running a program), preview, Find in Files, an empty panel and a stopped terminal — in the main
  window and in a sub-workspace window. It MUST act on the panel that holds focus and run exactly the
  flow that panel's own **Destroy** menu item and header ✕ run: the same confirmations, the same
  unsaved-editor guard, the same verb (a preview, or a project panel viewed in a sub-workspace, is
  closed rather than destroyed), and the same last-panel handling. While a terminal holds focus the
  chord MUST be consumed and MUST NOT reach the terminal's program. While focus is in a side pane
  (File Explorer, Projects) it destroys nothing. The command MUST be listed and rebindable in the Key
  Bindings editor, and the panel menus' Destroy item MUST show its chord. *(Session 2026-10-01,
  maintainer: "Add a new default key binding that is active in all panel types called 'Destroy
  Panel'… Ctrl+Shift+Alt+F4", and "It should work in all panels". Constitution v5.8.0 records the
  chord under Principle IV. The side-pane behaviour is derived — a side pane is not a panel —
  not confirmed by the maintainer.)*

#### Keyboard focus between and into panels (2026-10-01, from hand-testing)

- **FR-132**: Confirming a type on an empty panel's type form MUST move keyboard focus into the new
  content, so the user can type at once: an editor's caret, as a terminal already receives it. This
  holds whether Confirm was clicked or pressed from the keyboard. *(Maintainer: "if I navigate to
  'Confirm' on the blank panel page, and a new editor is created, the editor should take the carat
  focus … This works OK in terminals.")*
- **FR-133**: Moving keyboard focus to another panel (`focus.left/right/up/down`, `focus.cycle`,
  `focus.cycleBack`, split mode's new panel, or any other keyboard focus move) MUST close every open
  transient control in the panel being left — an expanded drop-down such as the type form's "Choose a
  type", an open menu — exactly as clicking another panel with the mouse does. It MUST NOT close what a
  click elsewhere does not close: a find bar keeps its state (033: a find bar closes only when its user
  or its editor closes it). *(Maintainer: "Any active control in other panels should close when the
  user uses a keyboard to move between panels, just like it would if the user clicked another panel
  with their mouse.")*

#### Supersessions recorded by FR-030–FR-038

- **FR-040**: **Supersedes 002 FR-037** (a panel is renameable from its header menu) in full, and **002
  FR-041** in part, for the panel clause only; tabs and projects stay renameable by double-click.
- **FR-041**: **Supersedes 024 FR-016 and FR-017** (a manual rename wins and persists; Reset Name) in full,
  024 FR-017a in part (its custom-title clause), 024 SC-005, and 024 User Story 5's acceptance scenarios
  3–6. 024 FR-015 (automatic basename titles) stands.
- **FR-042**: **Supersedes 031 FR-035g** (panel rename fields) and the panel clauses of 031 FR-033, FR-035
  and User Story 4 scenario 2. The rename-field limits now apply to tabs only. 031 FR-037 and FR-037a–e
  (the limit on derived panel titles) stand.
- **FR-043**: **Supersedes 033 FR-033 in part.** The clause "not opened in rename mode" and 033 acceptance
  scenario 2a become universal: no panel opens in rename mode (FR-002, FR-030). 033's menu-section
  contract loses its panel Rename (Content) and Reset Name (View & state) rows and gains the Split
  submenu (FR-016).
- **FR-044**: **Makes 043 FR-061 and 044 FR-030's rename clauses obsolete.** Find in Files and the preview
  panel were stated exceptions to an app-wide rename rule that no longer exists. 044 FR-031's reference
  to a "custom or derived" parent name narrows to "derived".
- **FR-045**: **Supersedes 046's `panel.rename` rows**, the F2 default that sits outside the modifier tiers
  and its F2-sharing exception with `file.rename`. It also requires a PATCH constitution amendment, via
  `/speckit-constitution`, that removes `panel.rename` from Principle IV's recorded exceptions and replaces
  panel Rename / Reset Name as the worked examples in Principle VI's section vocabulary.
- **FR-046**: Each superseded requirement in its owning spec MUST gain a one-line italic back-note naming
  the 048 requirement that supersedes it, following 047's style.

#### Cancelling a drag (#458)

- **FR-080**: Pressing Escape during a panel or tab drag MUST cancel it with the same teardown a completed
  drop performs: the drag ghost is removed at once, every drop highlight (panel edge zones, outer-edge
  zones, tab targets) is cleared, and no layout change is made or persisted. Any other way a drag ends
  without a drop MUST perform the same teardown.
- **FR-081**: A cancelled drag MUST leave active whichever tab is showing when it is cancelled, including
  a tab the drag switched to by hovering; it MUST NOT switch back to the tab where the drag started.
- **FR-082**: A drag started after a cancelled one MUST behave exactly as a first drag: one ghost, no
  stale hover state.

#### A preview keeps its own scroll position (#459)

- **FR-083**: A preview whose tab is hidden and shown again — by a tab switch, or by a drag hovering
  another tab — MUST come back at its **own** last scroll position. Nothing another tab's panels hold
  (their scroll positions, collapsed sections or drop regions) may be applied to it, and a drag that
  passes over other tabs' panels MUST NOT change it. This holds for standalone and parented previews
  alike, whether or not an editor is open for the file.
- **FR-084**: **Refines 044 FR-121h.** Showing a hidden tab again is neither an opening nor a restore after
  restart, so FR-121h's "the editor's top line decides" does not apply to it: a parented preview with
  synchronised scrolling on keeps its own place, as its editor keeps its own. Both sides were in step when
  the tab was hidden, so restoring each side's own place keeps the pair in step without either being moved
  to match the other. *Why*: the preview is the reader's place in the document, and a return to the tab
  must not lose it. Two-way synchronisation from whichever side is scrolled (044 FR-121, FR-121f) is
  unchanged.

#### One chord dispatcher for every window (#275)

- **FR-090**: Window-level chords MUST be resolved by **one dispatcher**, the same code in the main window
  and in every sub-workspace window: one key normalisation, one Shift rule, one resolver and one gate. The
  sub-workspace window's separate listener MUST be retired. *Why*: two resolution paths are how a chord
  ends up right in one window and silently wrong in the other (033 plan D6/F7), and split mode (FR-020–
  FR-026) is the first window-level multi-stroke chord, so it would otherwise be built twice.
- **FR-091**: Keyboard behaviour inside a sub-workspace window MUST be the same as in the main window's
  panel area: every window-level chord, including multi-stroke chords and split mode, resolves and acts
  identically. Any window-specific difference MUST be handled inside the shared dispatcher, once, for
  both windows — never by a second code path.
- **FR-092**: A chord whose command has nothing to act on in a sub-workspace window (for example cycling
  projects or focusing a side pane that window does not have) MUST be consumed — it MUST NOT reach a
  terminal's shell — and the status bar (where the active panel has one) MUST say that the command is not
  available in a sub-workspace window. It MUST NOT do nothing silently (033 Assumption 6).
- **FR-093**: Quick Open, Go To Line and Back/Forward MUST keep working in sub-workspace windows exactly as
  today (033 Assumption 6), now through the shared dispatcher.
- **FR-129**: In a sub-workspace window, an editor panel that an open route creates to show a project's
  file — Quick Open, and every other route that creates an editor to open a file — MUST be owned by the
  project the file belongs to (the project whose root Quick Open listed), so the file opens (033 FR-008)
  without breaching 006 FR-036. It MUST NOT be created as a sub-workspace-owned editor that then refuses
  the file as outside the project. *(Iterate 1, 2026-09-30, from MT-08; derived, not confirmed by the
  maintainer.)*

#### Documentation

- **FR-050**: The key-bindings doc MUST list the four split commands with their two-stroke chords and
  describe split mode, and drop the Rename panel row. The quick-start MUST describe the **+** menu, the
  Split submenu, split mode and outer-edge drops, and drop "F2 or a double-click gives one a name of
  its own". Both land in the same change (docs currency).

### Key Entities

- **Panel**: a slot in a tab's layout, with a stable identifier, a content-derived title and content.
  It no longer carries a custom title or a custom-title flag.
- **Layout tree**: a tab's arrangement of splits and panels. A split changes a single panel's slot; an
  outer-edge drop changes the top level.
- **Split command**: one of four registered commands (Down, Up, Right, Left) that targets a panel: the
  clicked one from a menu, the active one from a chord.
- **Split mode**: the pending state between the first and second stroke of a split chord, shown on the
  active panel by a pulsing border and the pending text.
- **Outer-edge drop zone**: one of four transient bands along a tab's panel area, present only during a
  panel drag.
- **Window chord dispatcher**: the single resolver of window-level chords, shared by the main window and
  every sub-workspace window (FR-090).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can put a new panel on any of the four sides of any chosen panel in two clicks
  (**+**, then a direction), with no dragging and no need for a second panel to exist.
- **SC-002**: Across single-row, nested and 2x2 layouts, 100% of splits place the new panel on the
  chosen side of the target panel, and no other panel moves or resizes.
- **SC-003**: A keyboard user can split the active panel in any direction with two keystrokes, from any
  panel type including a terminal, and no keystroke of the chord reaches the shell.
- **SC-004**: Split mode's pulse and pending text appear within 100 ms of the first stroke and disappear
  within 100 ms of any ending, and Escape cancels it in 100% of attempts with no other effect.
- **SC-005**: From a 2x2 layout, one drag produces a full-height column beside, or a full-width row
  beneath, the unchanged 2x2 block. Today no sequence of drags produces this.
- **SC-006**: Outer-edge drop feedback appears within the same bound as existing drop targets (002
  NFR-001), and the preview matches the resulting layout in 100% of drops.
- **SC-007**: Zero surfaces offer to rename a panel: menus, double-click, chords, Key Bindings and newly
  added panels.
- **SC-008**: 100% of layouts saved by the previous release with custom panel titles load without error,
  with every panel identifier, position, size and content unchanged.
- **SC-009**: A layout changed by a split or an outer-edge drop is identical after a restart, and a
  change made in one window leaves every other window's layout untouched.
- **SC-010**: In 100% of Escape-cancelled panel and tab drags, no drag ghost or drop highlight remains
  visible once the drag ends, and the layout is unchanged.
- **SC-011**: Across 20 consecutive runs of #459's sequence (drag a preview across another tab's drop
  regions and back), the preview's scroll position after the drag equals its position before it every
  time.
- **SC-012**: 100% of window-level chords discovered from the shared dispatcher resolve to the same
  command in the main window and in a sub-workspace window, and every one either acts or shows the
  not-available indication there; none does nothing silently.

## Assumptions

- The new panel created by a split is the same empty placeholder panel **+** creates today; what fills it
  (a terminal, a file, a preview) is unchanged.
- Splits divide the target slot 50/50, matching every existing split (002 FR-014, 044 FR-010). Outer-edge
  drops take a third (FR-062).
- The multi-stroke timeout, Escape handling, "not bound" wording and written chord form are 046's; this
  feature widens where they apply and, for window-scope chords, lets the second stroke carry the first
  stroke's held modifiers (FR-020a).
- An empty placeholder panel keeps its automatic "Panel N" title (unique within the layout) until content
  is assigned to it; nothing needs a name typed in.
  *Superseded by FR-127 / FR-128 (Session 2026-09-30, iterate 1) — an empty panel is titled "Blank Panel".*
- The outer-edge bands and split mode exist in every window that shows a tab's panels, main and
  sub-workspace alike.
- Removing panel rename also removes the test helpers that relied on rename-on-add to name panels; tests
  that named panels to make notices readable will identify panels by their content-derived titles.
- No setting governs panel renaming; `tabs.maxNameLength` stays, since it covers tab names and derived
  panel titles.
- Out of scope: tearing panels into windows, splitter resizing and its persistence, new panel types, the
  tab-strip **+**, keyboard **moves** of existing panels (002 FR-017 stands for moves), and chord changes
  beyond the four split defaults (#442).

## Clarifications

### Session 2026-09-29

- Q: What are the split commands called, given that "horizontal" and "vertical" are read in opposite ways
  by different tools? → A: Direction-explicit names. *(Extended 2026-09-30 to four directions.)*
- Q: Do the split commands ship with default chords? → A: Yes.
  *(The Tier 2 single-chord requirement is superseded 2026-09-30 by the two-stroke chord, FR-020.)*
- Q: How much of the panel area does an outer-edge drop take? → A: **One third** along the drop axis
  (FR-062).

### Session 2026-09-30

- Q: Where do the split commands live? → A: On the **+** button as a dropdown of four directions —
  Split Down, Split Up, Split Right, Split Left — and also as a **Split** submenu in both the header
  menu and the content (right-click inside the panel) menu (FR-010, FR-015). The menu entries satisfy
  Principle VI, so no amendment is needed for them.
- Q: What does a plain click on **+** do? → A: It opens the split dropdown; nothing is added until a
  direction is chosen (FR-010).
- Q: What are the default chords? → A: Two strokes: `Ctrl+Shift+Alt+End`, then an arrow key for the
  direction (FR-020). Chosen over `Ctrl+Shift+Alt+Insert` because many laptops have no Insert key, and it
  mirrors focus movement on `Ctrl+Shift+Alt+Arrow`.
- Q: How is split mode shown, and how does the user leave it? → A: A pulsing border on the active panel
  plus the standard pending text in its status bar (FR-021). Escape cancels, as do any other key, the
  timeout, a focus change, a menu or a drag (FR-022).
- Q: (Review) Which panel does a **+** click split? → A: Its own; clicking **+** makes that panel active as
  the menu opens (FR-011). The "panel you did not last focus" scenario was unrealistic and is removed.
- Q: (Review) Where does focus go when split mode is cancelled? → A: It stays on, or returns to, the
  panel that was in split mode; entering split mode moves focus to that panel (FR-021, FR-022).
- Q: (Review) What happens to zoom when a zoomed panel is split? → A: The original keeps its zoom level;
  the new panel starts at the default zoom level (FR-004). Zoom here is the panel's content zoom.
- Q: (Review) Does a split or outer-edge drop in a sub-workspace window change other windows? → A: No.
  Layouts, tabs and panel sizes are each window's own; only project-owned panels sync with their
  counterparts (FR-004, FR-068, SC-009).
- Q: During split mode, does an arrow count as the second stroke while Ctrl+Shift+Alt are still held? →
  A: Yes. The user holds Ctrl+Shift+Alt, presses and releases End, then presses an arrow — most likely
  releasing only End. Held or released, the arrow completes the split, and split mode takes precedence
  over focus movement (FR-020a).
- Q: (Review) Does a single-panel tab offer outer-edge zones? → A: No; only the panel's own edge zones,
  since both are the same position (FR-060).
- Q: When a panel drag has switched tabs by hovering and is then cancelled with Escape, which tab shows?
  → A: The one showing when Escape is pressed; a tab that is active stays active (FR-081).
- Q: When a preview is shown again after its tab was hidden, does it return to its own scroll position or
  to its editor's line? → A: Its own position (FR-083, FR-084). The maintainer notes #459's jump happens
  with **no** editor open or synced, so synchronisation is not its cause; the cause is for the plan to
  find. Scroll sync runs from whichever side is scrolled, editor or preview — already 044 FR-121/FR-121f,
  unchanged here.
- Q: With one chord dispatcher for every window (#275), what does a chord do in a sub-workspace window
  when its command has nothing to act on there? → A: It is consumed and the status bar says the command is
  not available in a sub-workspace window (FR-092). Keyboard behaviour in a sub-workspace matches the main
  window's panel area, and any problem is solved once, in shared code, for both (FR-090, FR-091).
- Q: (Iterate 1, MT-05) What is a new, empty panel called? → A: **Blank Panel**, not "Panel N" (FR-127);
  this reverses the Assumption that an empty panel keeps "Panel N". Several empty panels are "Blank
  Panel", "Blank Panel 2", … and saved "Panel N" titles are migrated on load (FR-128) *(numbering and
  migration derived, not confirmed)*.
- Q: (Iterate 2) Does an empty panel show its number ("Blank Panel 2")? → A: No. It always shows
  "Blank Panel"; the number may stay in the stored name only (FR-130). This reverses the numbered display
  derived in iterate 1's answer above.
- Q: (Iterate 4, 2026-10-01) Where does keyboard focus go after Confirm on an empty panel, and what
  happens to an open drop-down when focus moves to another panel by keyboard? → A: Into the new content
  — an editor's caret, as for a terminal (FR-132); open drop-downs and menus close as on a mouse click
  elsewhere, find bars stay (FR-133).
- Q: (Iterate 3, 2026-10-01, #461) Can a panel be destroyed from the keyboard, and where? → A: Yes,
  `panel.destroy` on `Ctrl+Shift+Alt+F4`, in every panel type including a terminal, through the same
  flow as the menu's Destroy item (FR-131); constitution v5.8.0 records the chord as a Principle IV
  exception. In a side pane it destroys nothing *(derived)*.
- Q: (Iterate 1, MT-08) In a sub-workspace window, who owns the editor Quick Open creates for a picked
  project file? → A: The project the file belongs to, so the file opens (FR-129) *(derived from 033 FR-008
  and 006 FR-036, not confirmed)*.
