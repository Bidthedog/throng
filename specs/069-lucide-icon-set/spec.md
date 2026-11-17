# Feature Specification: One default icon set, drawn from Lucide

**Feature Branch**: `feature/S069-I127-lucide-icon-set`

**Created**: 2026-11-14

**Status**: Draft

**Input**: Maintainer direction, 2026-11-14, for #127: reduce the icon sets throng ships to **one**, of
simple single-colour icons throng has full rights to distribute, taken from **Lucide**, and review
every icon individually.

## Background

throng ships two icon sets, and neither is finished. The default `throng` set draws each icon as a
text character from whatever fonts the operating system has, so the same icon looks different on
Windows and Linux, and some (🖪, 🗠, ⛭) render as emoji, as a box, or not at all. Spec 067
swapped those characters for monochrome ones as a stopgap. The secondary `throng-svg` set has real
artwork for 36 of its 110 icons; the other 74 are the same placeholder badge.

This feature replaces both with one **default set** of line icons from Lucide, an icon library under
the ISC licence, which is compatible with throng's AGPL-3.0. Lucide is a single visual family: one
grid, one stroke weight, one corner style. Where Lucide has no icon that fits, throng draws one in the
same style.

The default set cannot be changed. A user who wants different icons creates an icon set of their own
from an existing one, chooses which icons to override, and replaces those icon files outside throng.
Each theme selects a set, and every theme starts on the default set. A user's set holds only the
icons it overrides, so every icon it leaves alone, including icons a later throng adds or redraws,
comes from the default set.

**Terminology.** This specification says **icon set** throughout, the maintainer's term. Earlier
specifications (007, 017, 018) and the code call the same thing an *icon pack*.

#127's earlier design (archived in its comments, 2026-07-18) proposed two bundled packs, animated
hovers, per-icon colours and clone-to-customise. Clone-to-customise survives here as creating a set
from an existing one (US4). The rest of that design is **superseded** by this specification. Its
render-site inventory carries forward as input to the review.

| Story | Delivers |
|---|---|
| US1 | One consistent icon set everywhere, the same on every OS and in every theme |
| US2 | Every icon reviewed, named and described, and distinct wherever its meaning differs |
| US3 | Existing installs move to the new default set |
| US4 | Create an icon set and override icons in it, outside throng |
| US5 | The icon licence is recorded and shown, and a plain-text README tells users how to make sets |

### Requirements this feature changes

| Requirement | Change | Why |
|---|---|---|
| 007 FR-039 | **Superseded by FR-013 and FR-024 to FR-034.** A theme still selects a set, but no longer overrides single icons on top of it. Customising means overriding icons in a user set, whose files are edited outside throng. | Maintainer direction, 2026-11-15. |
| 007 FR-040 | **Superseded by FR-026.** A user set is a folder of SVG files, each named after the icon key it overrides. There is no `pack.json` manifest, and an icon can no longer be a text character. | Maintainer direction, 2026-11-15: the presence of the file is the override, with no metadata to update. |
| 007 FR-040a | **Superseded by FR-023 and FR-035.** The README becomes a plain-text `README.txt` describing the process in US4, kept current by a test. | Maintainer direction, 2026-11-15. |
| 007 FR-040b | **Superseded by FR-001.** throng ships one default set, not two. The `throng` glyph set and the `throng-svg` set are retired. | Maintainer direction, 2026-11-14. |
| 017 FR-003 | **Superseded by FR-013.** The precedence becomes the theme's selected set, then the default set. Per-icon overrides on the theme and the theme's own per-icon glyph map no longer take part. | Overrides now live in a user set (007 FR-039 above). Every shipped theme copies the same glyph map, so that step adds nothing but a second source of icons. |
| 009 FR-021 | **Amended by FR-002.** `dismiss` stays a distinct key, but its art is no longer the `✕` glyph. | Glyphs leave the default set. |
| 068 FR-058 | **Superseded by FR-040.** The Notifications and Sub-workspaces panels' minimise and restore controls draw `minimisePanel` and `restorePanel`, not the side panes' chevron, and the side panes' hide and show controls draw the same two keys. | Maintainer review, 2026-11-15: one pair of collapse icons for every pane and panel, turned to face its edge. |
| 067's placeholder glyphs (shipped-defaults upgrade to version 31) | **Replaced by FR-002.** | They were a stopgap pending this issue, as #127's comment of 2026-11-12 records. |

These requirements **stand** and the new set must satisfy them: 017 FR-001, FR-002, FR-004, FR-004a,
FR-005, FR-006a and FR-006b; 018 FR-027 to FR-031 (icon colour); 067 FR-069, FR-074 and FR-118 (Save
and Save As icons, distinct from each other).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One icon set everywhere (Priority: P1)

A user opens throng on Windows, Linux or macOS, in any shipped theme, and every icon in the application is
a clean line icon from the same family. No icon is an emoji, a box, a missing glyph or a placeholder
badge. Switching theme recolours every icon at once.

**Why this priority**: This is the feature. The other stories protect it.

**Independent Test**: Open every icon-bearing surface on Windows and on Linux (macOS through CI, Principle II), in a light and a dark
theme, and compare. Every icon is line art, none is a font character, and the two platforms match.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the user opens the File Explorer, panel headers, tab chrome,
   window controls, context menus, the find bar, Preferences and the resource monitor, **Then**
   every icon comes from the default set and none is a text character.
2. **Given** the same project on Windows, Linux and macOS, **When** both are open side by side, **Then**
   each icon has the same artwork on both.
3. **Given** a theme with an icon colour set, **When** the user switches to a theme without one,
   **Then** every icon changes colour immediately, with no restart (017 FR-005).

---

### User Story 2 - Every icon reviewed and described (Priority: P1)

The maintainer approves which art each icon key uses before any of it enters the app, then reviews
every icon in place. In Preferences → Themes → Icons, every icon shows its key and a short
description of what it stands for, so a user overriding one knows which file to replace and what it
is for.

**Why this priority**: The maintainer asked for each icon to be reviewed individually. A set taken
wholesale from a library still needs each choice judged against throng's own actions.

**Independent Test**: Sign off the token-to-art review page. Then open Preferences → Themes → Icons:
every icon has a key and a description. Work through the manual test plan area by area and confirm
each icon reads as its action in place.

**Acceptance Scenarios**:

1. **Given** Preferences → Themes → Icons, **When** the user hovers any icon in the grid, **Then**
   its key and description show.
2. **Given** two icons for different actions, such as Save and Save As, or Find Next and Find
   Previous, **When** they appear together, **Then** they are visibly different.
3. **Given** any icon on screen, **When** the user hovers the control that carries it, **Then** the
   hover title names the action (constitution, *Action controls MUST be themeable icons with hover
   titles*).

---

### User Story 3 - Upgrade to the new default set (Priority: P2)

A user upgrading from alpha16 opens throng and sees the new icons straight away. throng converts
nothing. Any old icon folder that might hold the user's own work is kept, renamed with a `.bak`
suffix, out of throng's sight. A notice says so at every start, until the user has moved what they
want into a new-style set and moved or deleted the backups themselves.

**Why this priority**: An upgrade must not leave a broken or half-old icon set behind, and must not
destroy or quietly mangle a user's own icons.

**Independent Test**: Start from an alpha16 configuration holding one theme on each old set choice,
one user pack, one edited seeded `throng-svg` folder, an unedited seeded `throng` folder, one theme
with per-icon overrides and one hand-edited theme glyph. Upgrade, start throng, and look at the icon
sets folder and the notices.

**Acceptance Scenarios**:

1. **Given** any theme, whatever set it used and whatever overrides or glyph edits it carried,
   **When** the user upgrades, **Then** it uses the default set, and no icon is blank.
2. **Given** a user pack folder or an edited seeded folder, **When** the user upgrades, **Then** it is
   renamed with a `.bak` suffix, its contents untouched, and no set picker in throng lists it.
3. **Given** an unedited seeded `throng` or `throng-svg` folder, or an old `README.md`, **When** the
   user upgrades, **Then** it is deleted.
4. **Given** any `.bak` folder in the icon sets folder, **When** throng starts, **Then** one notice
   says the folders hold icons from before the upgrade, offers to open the folder, and asks the user
   to migrate what they want and then delete the backups or move them out.
5. **Given** the user has moved or deleted every `.bak` folder, **When** throng next starts, **Then**
   the notice does not return.
6. **Given** an upgraded configuration, **When** throng starts a second time, **Then** the upgrade
   changes nothing more (FR-020).

---

### User Story 4 - Create an icon set and override icons in it (Priority: P2)

A user wants a different Save icon. In Preferences → Themes → Icons:

1. With the default set selected, they create a new set from it and give it a name. The theme
   switches to the new set, which overrides nothing yet, so every icon still looks the same.
2. They find the Save icon in the read-only grid and press **Override this icon**. throng copies the
   default set's `save.svg` into the new set's folder.
3. They press the button beside the set that opens its folder in the OS file manager, and replace
   `save.svg` with their own file, outside throng. Any file with the right name works; there is no
   metadata to update.
4. They go back to throng and press **Reload the icon sets from disk**. Every Save icon, in every theme and window
   using the set, shows their file.

A later throng that redraws icons or adds new keys keeps their `save.svg`, and shows the new shipped
art for every icon they have not overridden.

**Why this priority**: It is the only way to customise icons once theme overrides are retired.

**Independent Test**: Run steps 1 to 4 above, then look at an editor panel's title bar.

**Acceptance Scenarios**:

1. **Given** the default set selected, **When** the user opens Preferences → Themes → Icons,
   **Then** the grid is read-only, offers no Override button and no open-folder button, and offers
   creating a new set from this one.
2. **Given** the user creates a set from the default set and names it, **When** the set is created,
   **Then** its folder holds no icons, the theme selects it, and every icon still looks the same.
3. **Given** the user creates a set from a user set, **When** the set is created, **Then** its folder
   holds a copy of every override the source set holds.
4. **Given** a user set selected, **When** the user presses Override this icon on a key the set does
   not override, **Then** the default set's file for that key is copied into the set's folder, and
   the grid marks the key as overridden.
5. **Given** a user set that already holds a file for a key, **When** the user presses Override this
   icon on it, **Then** throng asks whether to replace the existing file. Cancel leaves the file as
   it was.
6. **Given** a user set whose folder the user has changed outside throng, **When** the user presses
   Reload the icon sets from disk, **Then** the changes show in every theme and window using the set, with no
   restart.
7. **Given** a user set changed on disk while throng was closed, **When** throng starts, **Then** it
   shows the changes with no further action.
8. **Given** a new set's name, **When** the user enters `throng` or the name of an existing set,
   **Then** the set is not created, and the name field says why.

---

### User Story 5 - Licence recorded and a README for set authors (Priority: P3)

The application's third-party licence list names Lucide and carries its notice. A plain-text
`README.txt` beside the user's icon sets explains, step by step, how to create a set, override an
icon, replace its file and reload, and lists every icon key with its description.

**Why this priority**: The licence notice is a distribution obligation, and the README is how a user
learns the file names US4 depends on.

**Independent Test**: Open the third-party licence list and find Lucide. Open `README.txt` in the
icon sets folder in a plain text editor and follow it to override one icon.

**Acceptance Scenarios**:

1. **Given** an installed build, **When** the user opens the third-party licences, **Then** Lucide is
   listed with its licence text.
2. **Given** the user's icon sets folder, **When** the user opens `README.txt`, **Then** it reads
   correctly as plain text, describes the steps in US4, and lists every icon key with its
   description.

---

### Edge Cases

- A user set lacks a key, including one added or redrawn by a later throng: that icon shows the
  default set's current art for it (FR-015, FR-034).
- A user set holds a file whose name matches no icon key, such as a typo or a key this feature
  retires (FR-011): it is ignored with no error, and the grid lists it as unrecognised (FR-027).
- A user set holds a file for a key that is missing, unreadable or not a valid SVG: that icon shows
  the default set's art, and the grid says why on its row (FR-027). The rest of the set still loads
  (017 FR-004a: a partially readable set is not a failure).
- The user removes an override: they delete its file outside throng and press Reload the icon sets from disk; the
  icon shows the default set's art again.
- Several themes select the same user set: a reload changes the icon in all of them.
- A user set a theme selects is deleted from disk: the theme falls back to the default set, and the
  picker shows the set as unavailable, with the reason (FR-016).
- Old customisations from before this feature (theme overrides, glyph maps, `pack.json` packs): none
  is converted. Theme overrides and glyph maps are dropped; folders are kept as `.bak` (FR-018,
  FR-019).
- A `.bak` folder from this upgrade already exists, for example after a reinstall over a half-finished
  upgrade: the next backup takes a numbered name rather than overwriting it (FR-019).
- The user renames a `.bak` folder back to its old name without migrating it: it is an old-format
  folder with a `pack.json`. throng treats it as a user set of whatever `<key>.svg` files it happens
  to hold, and the grid lists its other files as unrecognised (FR-027).
- The user tries to name a new set something ending `.bak`: refused (FR-025).
- Lucide has no fitting icon for a key (for example `diagramZoomReset`, shown today as `1:1`):
  throng draws one in Lucide's style (FR-002).
- Two keys mean the same action in different places, such as `destroy`, `dismiss` and
  `windowClose`: they may share art, and the shared art is listed in the review (FR-008).
- An icon rendered at the smallest size throng uses (status bar, tree rows) must stay legible
  (FR-007).

## Requirements *(mandatory)*

### Functional Requirements

**The default set**

- **FR-001**: throng MUST ship exactly **one** icon set, the **default set**, named `throng`. It
  replaces the bundled `throng` glyph set and the `throng-svg` set, which are retired.
- **FR-002**: Every icon in the default set MUST be single-colour line art. It is taken from Lucide,
  or, where Lucide has no icon that fits the action, drawn for throng in Lucide's style (same grid,
  stroke weight, cap and corner style) so the set reads as one family.
- **FR-003**: Every icon in the default set MUST be distributable under terms compatible with
  throng's licence: Lucide's licence for Lucide art, and throng's own licence for art drawn for
  throng. No icon may come from any other source.
- **FR-004**: The default set MUST cover **every** icon key. A key with no art in it MUST fail the
  build.
- **FR-005**: No icon, in the default set or a user set, may be a text character drawn by a font. An
  icon MUST look the same whatever fonts the operating system has installed.
- **FR-006**: Every icon MUST take its colour from the active theme, as 017 FR-004 and 018 FR-029
  and FR-030 require. No default-set icon carries a colour of its own.
- **FR-007**: Every default-set icon MUST fit the icon box at every size throng renders icons today,
  without cropping, and MUST stay recognisable at the smallest of those sizes.
- **FR-008**: Two keys for **different** actions MUST NOT share art. Keys for the **same** action in
  different places (such as `destroy`, `dismiss` and `windowClose`) MAY share art. Every shared use
  MUST be listed in the token-to-art mapping (Key Entities), so the review sees it.
- **FR-009**: The pairs and families whose members appear together MUST be visibly distinct: Save
  and Save As (067 FR-118); expand and collapse; expand all and collapse all; find next and find
  previous; move up and move down; zoom in, zoom out and reset; folder and open folder; maximise and
  restore, for both the window and the panel; undo and redo; navigate back and forward.
- **FR-031**: Before this feature merges, the token-to-art mapping MUST be
  produced as a review page showing, for every key, its name, description (FR-012), its proposed
  art drawn at real size in a light and a dark theme, the art's origin,
  and the keys sharing it (FR-008). The maintainer MUST sign the mapping off first. Hand testing in
  the app then checks size, legibility and fit in context, not the choice of icon.
- **FR-021**: The default set MUST ship compiled into the application: never as a folder under the
  user's icon sets directory, and never as loose, individually editable files in the installation
  directory. Nothing the user does can change it, and every upgrade brings its current art. The
  only way to change an icon is a user set, created and overridden through Preferences (FR-024,
  FR-032).

**Icon keys and render sites**

- **FR-010**: Every place throng draws an icon MUST resolve it through an icon key. An icon drawn
  outside the key system is brought into it by this feature, as the constitution's
  themeable-icon-control rule requires.
- **FR-011**: Every icon key MUST have at least one place where throng draws it. A key with none is
  retired.
- **FR-012**: Every icon key MUST carry a short description of what the icon stands for. Preferences
  → Themes → Icons MUST show it beside the key, as the icon's hover title.
- **FR-040**: Every control that collapses or restores a pane or panel MUST draw `minimisePanel`
  while open and `restorePanel` while collapsed, turned to face the edge it collapses toward: the
  side panes' hide and show controls, and the Notifications and Sub-workspaces panels' minimise and
  restore controls and menu items. The art is drawn facing down (minimise) and up (restore) and is
  turned by one shared component that takes any angle; no turned copy of the art exists. A set that
  overrides either key changes every one of these controls.

**Selection and resolution**

- **FR-013**: Every icon MUST resolve from the theme's selected set, and, for a key that set does not
  override, from the default set. No per-icon override on the theme and no per-theme glyph map takes
  part. Every icon MUST always resolve to something drawable.
- **FR-014**: Every theme MUST select exactly one set. A shipped theme, and a theme the user creates,
  MUST start on the default set. The user MAY switch any theme to any user set.
- **FR-015**: A key a user set does not override MUST show the default set's art for that key.
- **FR-016**: 017 FR-004a stands for user sets: a selected set that cannot be loaded falls back to
  the default set, and the picker shows it as unavailable, with the reason.

**User sets and overriding**

- **FR-024**: Preferences → Themes → Icons MUST offer creating a new set from the selected set,
  whether that is the default set or a user set. It asks for a name, creates a user set of that name,
  and switches the current theme to it. A set created from the default set holds no icons. A set
  created from a user set holds a copy of every override file the source set holds.
- **FR-025**: A new set's name MUST be unique among sets, ignoring case, MUST NOT be `throng`, MUST
  NOT end in `.bak`, and MUST be usable as a folder name on Windows, Linux and macOS. A name that fails MUST be refused, with the reason
  on the name field, and nothing is created.
- **FR-026**: A user set MUST be a folder under the user's icon sets directory, named after the set,
  holding one SVG file per overridden key, named `<key>.svg`. The presence of that file is the
  override: there is no manifest or other metadata to update. Icon files MUST be edited outside
  throng; Preferences offers no icon editor.
- **FR-027**: The Icons grid MUST be a read-only view of the loaded icons, showing for each key its
  current icon, the key, its file name (`<key>.svg`) and its description (FR-012). With a user set
  selected, each row MUST make it obvious whether the key is overridden by the set or comes from the
  default set. An override is decided by the file's presence alone, so a file identical to the
  default still shows as overridden. A row whose override file cannot be loaded MUST say why. Files
  in the set's folder that match no key MUST be listed as unrecognised.
- **FR-032**: With a user set selected, every row in the grid MUST offer **Override this icon**, which
  copies the default set's SVG for that key into the set's folder as `<key>.svg` and marks the row
  as overridden. With the default set selected, no row offers it.
- **FR-033**: When the set's folder already holds `<key>.svg`, Override this icon MUST first ask
  whether to replace the existing file. Choosing to cancel MUST leave the file exactly as it was.
- **FR-028**: Preferences MUST offer, beside the set, a button that opens the selected user set's
  folder in the OS file manager, or the icon sets folder itself while the default set is selected
  (amended 2026-11-16, maintainer review: it is always offered, FR-047).
- **FR-029**: throng MUST read the user sets from disk when it starts and on every icon-set action
  (FR-041). Preferences MUST offer **Reload the icon sets from disk** beside the set, whichever set is
  selected. A reload MUST update the icons everywhere they are used, in every theme and window, with
  no restart. throng MUST NOT watch set folders for changes. When the user selects a user set,
  Preferences MUST say, in a toast (FR-046), that changes to its files show after the next icon-set
  action or a restart (amended 2026-11-16, maintainer review).
- **FR-034**: When a later throng ships redrawn icons or new keys, every override file a user set
  holds MUST be kept and MUST still win for its key. Every key the set does not override MUST show
  the newly shipped art.
- **FR-030**: Creating, renaming and deleting a set, Override this icon, Reset this icon to the
  default, Reload the icon sets from disk and the open-folder button MUST be icon controls with hover
  titles naming the action, as the constitution's themeable-icon-control rule requires. The buttons
  inside the name prompts, the replace prompt and the delete prompt keep text labels, under that
  rule's exception for dialog decisions.

**Maintainer review, 2026-11-16**

- **FR-041**: Every icon-set action in Preferences MUST read every user set from disk again, before
  and after it runs, and the result MUST reach every window whether the action succeeded or not:
  selecting a set, creating, renaming, deleting and reloading sets, opening a folder, and Override
  and Reset on an icon. A set made, renamed or removed outside throng, or a file edited there, is what
  the action finds and what the grid shows next.
- **FR-042**: With a user set selected, Preferences MUST offer **Rename this icon set**. It asks for
  the new name, which FR-025 governs, except that the set's own name is not a clash, so a change of
  case alone is a rename. Every theme naming the set MUST name the new one afterwards.
- **FR-043**: With a user set selected, Preferences MUST offer **Delete this icon set**. It asks
  first; on confirmation the set's folder MUST go to the OS trash, and every theme naming the set MUST
  draw the default set afterwards.
- **FR-044**: Each row of a user set whose key is overridden MUST offer **Reset this icon to the
  default**, which moves that `<key>.svg` to the OS trash, so the key draws the default set's art.
  On a row whose key is not overridden the control is on screen and greyed out (FR-049; amended
  2026-11-16, second review: it was hidden).
- **FR-045**: The folder that Open folder shows MUST come up above Preferences: Preferences stops
  holding itself above throng's other windows until throng has lost focus once.
- **FR-046**: The messages of the Icon set row MUST be toasts, not text in the row: why the selected
  set cannot be loaded (FR-016), raised once for each reason, and the hint FR-029 names.
- **FR-047**: Nothing on the Icon set row moves as the selection changes. Read from the right: the
  set picker, then the controls every selection can use (New set from this set, Open folder, Reload
  the icon sets from disk), then the ones only a user set can use (Rename, Delete), which are greyed
  out while the default set is selected (FR-049; amended 2026-11-16, second review: they were hidden).
- **FR-048**: Every user set in the picker MUST be marked with an asterisk after its name.

**Maintainer review, 2026-11-16 (second)**

- **FR-049**: Every action control on the Themes tab MUST always be on screen: the theme toolbar
  (Revert, Restore, Clone, Rename, Delete, Restore all), the search's Clear, the icon colour's Clear,
  the Icon set row, and each icon's Override and Reset. A control the current selection or state
  cannot use MUST be disabled and greyed out, with a hover title saying why. This is 015 FR-015a's
  idle state, extended from the row actions to every action control on the tab; it replaces showing
  those controls only while they could be used.
- **FR-050**: Every button a notice offers MUST sit in the card's control group at its top-right, to
  the left of Copy and Dismiss (constitution 6.8.0, *Toast controls*). The icon set backups notice's
  Open folder, the installed-version notice's Restart, the paste card's Cancel and the throng command
  notice's Install (070) move there. This
  supersedes the placement in 050 FR-039: Cancel stays a dedicated icon at the right, set apart from
  the text, but as the group's first control rather than a slot at the end of the card's body.
- **FR-051**: The controls of a toast and of an entry in the Notifications panel MUST be spaced apart,
  and each MUST show the hover surface when pointed at, not only a change of colour.
- **FR-052**: Pointing at a notice MUST reveal more only once the pointer has stayed on it for the
  **Notification hover delay** (`notifications.hoverDelayMs`, 0 to 1,500 ms in steps of 25, shipped at
  250): a Notifications panel entry expanding in place (068 FR-085) and a cut-off toast's whole-text
  popover (068 FR-079). Leaving before then reveals nothing; leaving afterwards hides it at once.
  Keyboard focus reveals at once, and a delay of 0 does too. This amends the timing of 068 FR-079 and
  FR-085, which revealed on the pointer's arrival, so that moving the pointer across the notices does
  not make them jump.

**Maintainer review, 2026-11-16 (fourth): the secondary windows** — #638, #639

- **FR-053** (#638): In the project settings dialog every button of a section — the shortcut to
  Preferences, the add button and each row's remove — MUST sit in one right-hand column, each with its
  icon centred; each section MUST be set apart in a box of its own; and each section's global list MUST
  sit on a line of its own below its description, in smaller text. Each section's shortcut MUST open
  Preferences at the setting that holds its global list (`explorer.excludeGlobs`,
  `search.inFiles.excludeGlobs`), unfolding the section holding it and bringing it into view.
  *(Amends 060 FR-044, which opened Preferences at its Settings tab; widens 068's Preferences deep link,
  which named a section, to name a setting.)*
- **FR-054** (#639): About, Preferences, the project settings dialog and the Resource Monitor MUST share
  one look from theme tokens: the windows on the app background, one icon button (the icon centred in a
  24 px box, a hover that shows on any surface, the same disabled dimming and focus ring), one section
  heading, one field and one text button. An icon button's resting background MUST be the optional
  **Icon Button Background** theme token (`colours.iconButtonSurface`, General › Buttons); unset, an icon
  button shows only its icon until pointed at, as every one did before. No button in these windows may
  draw the browser's own look.
- **FR-055**: The File Explorer's Delete, in its toolbar and in its context menu, MUST draw a rubbish bin
  (Lucide `trash-2`) under a key of its own, `deleteFile`. `destroy`'s ✕ stays on every control that
  closes or discards (a tab, a panel, a project, a list row), so changing the File Explorer's Delete
  changes nothing else. A user icon set without `deleteFile.svg` draws the shipped bin. *(Amends
  FR-010's key list: 113 keys.)*
- **FR-056**: The File Explorer MUST draw every file and folder kind Lucide 1.66.0 has art for and throng
  did not use, each under a key of its own: `fileArchive`, `fileShell`, `fileConfig`,
  `fileSpreadsheet`, `fileDatabase`, `fileDiff`, `fileKey`, `fileAudio`, `fileVideo`, `fileFont`,
  `fileModel`, `filePackage`, `folderSymlink`, `folderGit`, `folderConfig` (Lucide `folder-dot`, as
  `folder-cog` is Project settings') and `folderDependencies`.
  A file takes its key from its extension or, for a dotfile, its whole name; a folder from its name,
  the same open or closed; the project root stays the open folder; a linked folder's badge is
  `folderSymlink` and a linked file's stays `symlink`. A name the tree does not know draws `file`.
  *(Amends FR-010's key list.)*
- **FR-057**: Each common programming language MUST draw an icon of its own — C, C++, C#, Java,
  JavaScript, TypeScript, Python, Go, Rust, Ruby, R, Lua, Dart, Swift, Scala, Kotlin, PHP, SQL, HTML,
  CSS, Sass and PowerShell. Lucide has none, so each is Lucide's plain `file` with the language's
  short label drawn inside it in strokes (no text element, no font), by
  `scripts/draw-file-label-icons.mjs`. Shell scripts keep Lucide's `file-terminal`; `fileCode` is the
  source file of any other language. *(Amends FR-010's key list: 151 keys.)*
- **FR-058**: The Markdown file icon (`fileMarkdown`) MUST be the Markdown mark, an M and a down arrow,
  drawn inside Lucide's plain `file` in strokes the same way as FR-057's labels, in place of Lucide's
  `file-type`.
- **FR-059**: Resting the pointer on a File Explorer row for `explorer.popoverDelayMs` (default 500 ms,
  0–1500 in steps of 25, under File Explorer in Settings) MUST open a popover holding the row's own icon at
  twice the theme's icon size, to the left of the row's project-relative path (the root's name for the
  root) and centred on it, in place of the row's plain `title`. It is a floating surface like the tab
  popover: it opens below the row, flips or clamps to stay in the window, and never takes a click. A
  press, a wheel or a context menu on the row puts it away until the pointer leaves; leaving, renaming
  and the window losing focus close it.
- **FR-060**: Every window's title bar — the main window's, a sub-workspace's, Preferences', About's and
  the Resource Monitor's — MUST sit on a background of its own, the optional **Title Bar Background**
  theme token (`colours.titleBarSurface`, General). Unset, it is the app background mixed a tenth of
  the way toward the text colour, so in every bundled theme the bar stands apart from the window, maximised
  or not.
- **FR-061**: File icons in the File Explorer, Find in Files and the row popover MUST be coloured by
  category — code, markup, data, documents, media, archives and scripts (keys and certificates with
  scripts) — each an optional theme colour token (`colours.fileIconCode` … `colours.fileIconScript`,
  File Explorer › File Icons). Unset, a category's icons take the Icon Colour; the unknown file, folders
  and link badges always do. Every bundled theme MUST carry a value for each category that clears 4.5:1
  against the tree's pane, a hovered row, a selected row and the app background, and the seven MUST stay
  at least ΔE 12 (CIEDE2000) apart. Colour is a second signal beside each icon's art (WCAG 2.1 SC 1.4.1),
  so no separate colour-blind mode is required. The theme contrast check MUST measure every category a
  theme sets.
- **FR-062**: Each Resource Monitor "?" helper MUST draw its icon within its own box, overlap no other
  element, and sit raised at the top right of the element it explains, a small gap from it and a larger
  one from the element after it, with the elements around it moved to make that room. *(Refines 055's
  sixth-feedback placement, "superscript and close beside", which the code had read as no margin at all;
  the Lucide art also sized itself from the theme's icon size and overflowed the helper's box onto its
  text.)*
- **FR-063**: The Themes tab's **Icon set** and **Icon colour** rows MUST carry Revert, Reset and Clear in
  the same place and with the same rules as every other preference row (015 FR-015, issue #76): all three
  always on screen, an action that does not apply greyed out with its reason as its title, and Reset
  declined on a theme of the user's own. Clear on Icon set selects the default set; Clear on Icon colour
  empties it. *(Replaces FR-049's lone Clear beside the icon colour.)*
- **FR-064**: The unknown file's icon — a file whose kind matches no category — MUST be coloured by its
  own optional theme token, **Other File Icons** (`colours.fileIconOther`), which every bundled theme sets
  to a neutral grey derived as FR-061's categories are and held to the same 4.5:1. Folders keep the Icon
  Colour, so the unknown file reads apart from them and from the seven kinds. *(Amends FR-061, which left
  the unknown file on the Icon Colour with the folders.)*
- **FR-065**: A panel's type icon MUST be the first thing in its header, at the far left, in every window.
  Anything else drawn left of the title — today the editor's and preview's Back and Forward — MUST sit
  between the type icon and the title. *(Supersedes 044 FR-104's "before the panel's type icon": Back
  and Forward keep everything else FR-104 requires.)*
- **FR-066**: A Markdown preview diagram's Maximise MUST be Focus Mode: its control MUST be named **Enter
  Focus Mode** and **Exit Focus Mode**, as the panel header's and the diagram menu's are, and entering it
  MUST collapse both side panes and leaving it restore them exactly as a panel's Focus Mode does (#635).
  *(Supersedes #635's rule that a diagram maximised on its own is a section target that leaves the panes
  alone.)*
- **FR-067**: The Settings tab's **File Manager** item MUST sit under a heading of its own — General's last
  subgroup (FR-068) — that expands and collapses like every other, and that Expand All and Collapse All reach.
- **FR-068**: The Settings tab MUST group its preferences as follows. **General** holds Appearance, Window,
  Projects, Behaviour, Attention and File Manager, each a subgroup. Every editor preference sits under the one
  **Editor** heading, with a subgroup for each section: Status Bar, Previews, Links, Navigation, Indentation
  and Languages. Every search preference sits under the one **Search** heading, with Find Bar and Find in Files
  as subgroups. No key, default or control changes, and search still finds each row by its subgroup's name.
  *(Supersedes 040 FR-037a, which kept the three "Editor · …" sibling-string groups off the subgroup
  mechanism, and 043 FR-076's "Search · Find Bar" and "Search · Find in Files" group strings, whose two
  sections it keeps.)*
- **FR-069**: In About, the pointer over the licence box and its scrollbar MUST be the arrow, not the text
  cursor. Lucide's row in the third-party list MUST read like every other package's — name, version and a
  licence link — with no control to show its licence text; FR-022's notice still ships in the application's
  third-party licence data and beside the art.

**Upgrade**

- **FR-017**: On the first start after upgrading, every theme MUST select the default set, whatever
  set it selected before.
- **FR-018**: The upgrade MUST convert nothing. It MUST remove every theme's per-icon overrides and
  per-icon glyph map without carrying them anywhere.
- **FR-019**: The upgrade MUST rename every folder in the user's icon sets directory by adding a
  `.bak` suffix, leaving its contents untouched. The two folders earlier versions seeded, `throng`
  and `throng-svg`, are the exception: each is renamed only when it holds a customisation (FR-036),
  and is otherwise deleted. Where the `.bak` name is taken, the backup MUST take the next free
  numbered name (`throng-svg.bak.2`) rather than overwrite anything. The upgrade MUST delete the old
  `README.md` from that directory if it exists.
- **FR-036**: A seeded folder MUST count as customised when it holds a file throng never seeded
  there, lacks a file throng seeded, or holds a file whose contents match no version throng ever
  seeded under that name. The check MUST read only the seeded folders, and only once, during the
  upgrade.
- **FR-037**: No icon set picker or list in throng may show a folder whose name ends in `.bak` or in
  `.bak.<n>`.
- **FR-038**: Every time throng starts while the user's icon sets directory holds any `.bak` folder,
  it MUST raise **one** notice saying those folders hold icons from before the upgrade, that nothing
  in them was converted, and that the user should move what they want into a new set (US4) and then
  delete the backups or move them out of the directory. The notice MUST offer an action that opens
  the directory in the OS file manager. Dismissing it lasts until the next start. Once no `.bak`
  folder remains, it MUST NOT be raised.
- **FR-020**: Running the upgrade a second time MUST change nothing. In particular, it MUST NOT rename
  a `.bak` folder again, or rename user sets created after the upgrade.
- **FR-039**: The release notes for the version that ships this feature MUST say plainly that icon
  customisations were not converted, that old icon folders were renamed with `.bak`, and how to
  migrate them, and MUST point to `README.txt`.

**Licence and documentation**

- **FR-022**: Lucide's licence notice MUST ship with the application, appear in its third-party
  licence list, and be recorded in the repository beside the art.
- **FR-023**: throng MUST ship a plain-text `README.txt`, not Markdown, in the user's icon sets
  directory, rewriting it at every start whenever its content differs, so it always matches the running version. It MUST
  describe, step by step, creating a set (FR-024), overriding an icon (FR-032, FR-033), replacing and
  removing override files outside throng (FR-026), reloading (FR-029), how new and redrawn icons
  reach a set (FR-034), and migrating a `.bak` folder by hand (FR-019, FR-038). It MUST list every
  icon key with its file name and description (FR-012). `docs/preferences.md`
  MUST describe the same process.
- **FR-035**: A test MUST fail the build when `README.txt`'s list of keys differs from the icon keys
  throng defines. Any later specification that changes icon sets or how they are customised MUST
  update `README.txt` before it ships. This specification updates it before deployment.

### Key Entities

- **Icon key**: a named slot for an icon, such as `save` or `findNext`, with a description (FR-012)
  and at least one place it is drawn (FR-011). It is also the file name a user set overrides it with
  (`save.svg`).
- **Default set**: the one set throng ships (`throng`), read-only, with art for every key (FR-004,
  FR-021).
- **User set**: a folder under the user's icon sets directory holding `<key>.svg` override files and
  nothing else it needs (FR-026). Every key it does not override comes from the default set.
- **Set selection**: each theme's choice of one set (FR-014).
- **Token-to-art mapping**: for each key, the default set's art, its origin (a named Lucide icon, or
  drawn for throng) and the other keys sharing it (FR-008). It is reviewed and signed off as a page
  before the feature merges (FR-031).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 110 of today's icon keys, less any retired under FR-011, plus any added under
  FR-010, show default-set line art. None shows a text character or the placeholder badge.
- **SC-002**: Every icon-bearing surface looks the same on Windows, Linux and macOS, with no box, emoji
  or missing-glyph rendering on either.
- **SC-003**: The maintainer has signed off the token-to-art mapping before merge (FR-031),
  then every icon in the manual test plan, area by area, as legible and fitting in context.
- **SC-004**: An alpha16 configuration holding each of the old set choices, a user pack and an
  edited seeded folder upgrades with no blank icon, every user-made file still on disk byte for byte
  in a `.bak` folder, no `.bak` folder visible in throng, and exactly one notice per start until the
  backups are gone.
- **SC-005**: The third-party licence list of an installed build names Lucide and shows its licence.
- **SC-006**: Following only `README.txt` and the labels in Preferences, a user can create a set,
  override one icon with their own file, reload, and see it in every theme using the set, with no
  restart.

## Clarifications

### Session 2026-11-14

- Q: Spec or a one-by-one icon review? → A: A spec. The maintainer's per-icon review runs as the
  manual test plan's sign-off (SC-003).
- Q: Which source? → A: Lucide (maintainer, 2026-11-14), with gaps drawn in its style.

### Session 2026-11-15

- Q: Which of today's customisations survive: choosing a user set per theme, overriding a single
  icon, and text characters in either? → A: The default set cannot be overridden or changed, but a
  set can be created from it and customised. Each theme can select a different set, and every theme
  uses the default set until it does. Customising means making a set of one's own (FR-013, FR-014,
  FR-024 to FR-034).
- Q: When a user copies the default set, does the copy hold every icon, or start empty and show the
  default set's icons until the user changes one? → A: Empty. A set created from another holds only
  what its source holds itself (FR-024). All icon editing happens outside throng's own interface
  (FR-026).
- Q: After a user edits a set's files outside throng, when does throng show the change? → A: When
  throng starts, when the set is selected, and when the user presses Reload the icon sets from disk, with a line
  telling them so. No folder watching: icons change rarely (FR-029).
- Q: Does the maintainer approve the full token-to-art mapping as a document before any art enters
  the app? → A: Yes. A review page with every key's proposed art at real size is signed off first;
  hand testing then checks the icons in context (FR-031, SC-003).
- Q: May implementation proceed before the mapping is signed off? → A: Yes (maintainer, 2026-11-15).
  The code is built with the proposed mapping; the maintainer reviews the icons once the code is done,
  and any change is a swap of `SOURCES.json` or a drawing followed by re-running the vendoring and
  generation scripts. The sign-off still gates the merge (FR-031).
- Q: Which icon do the collapse controls of the side panes and the bottom-of-pane panels draw? → A:
  `minimisePanel` and `restorePanel`, turned to face each control's edge, through one shared
  component that takes any angle, in place of the side panes' chevron (maintainer review,
  2026-11-15; FR-040, superseding 068 FR-058).
- Q: When does throng read the sets from disk? → A: On every icon-set action, not only Reload
  (maintainer review, 2026-11-16; FR-041, amending FR-029).
- Q: Can a user rename or delete a set, or undo one icon's override, from throng? → A: Yes: Rename
  and Delete beside the picker, and Reset on an overridden row; deleted files go to the OS trash, and
  the themes follow a rename or a delete (maintainer review, 2026-11-16; FR-042 to FR-044).
- Q: How should the Icon set row behave as the selection changes? → A: Its messages are toasts, the
  picker is rightmost with the always-shown controls beside it, user-only controls further left, and
  user sets carry an asterisk (maintainer review, 2026-11-16; FR-045 to FR-048).
- Q: Should a control that cannot be used disappear? → A: No. Every action icon on the Themes tab,
  per-icon and per-set included, is always shown and greyed out when it cannot be used (maintainer
  review, 2026-11-16, second; FR-049, amending FR-044 and FR-047).
- Q: Where does a toast's own button go? → A: Beside the card's other controls at its top-right, to
  the left of Copy and Dismiss, on every toast; recorded in the constitution (maintainer review,
  2026-11-16, second; FR-050, constitution 6.8.0).
- Q: Do the notification controls need more room? → A: Yes: more spacing, and a hover style, on the
  toasts and the Notifications panel alike (maintainer review, 2026-11-16, second; FR-051).
- Q: Should hovering a notice reveal its whole text at once? → A: No: after a small delay, so scanning
  the pointer across the toasts or the Notifications panel does not jitter them. The delay is a
  preference, as the tab and resource popover delays are (maintainer, 2026-11-16; FR-052, amending
  068 FR-079 and FR-085).
- Q: Is there a theme override for the grey behind the project settings dialog's buttons? → A: There
  was none: those buttons had no style at all, so the grey was the browser's own. They take the shared
  icon button now, and the new optional Icon Button Background token governs every icon button's resting
  background (maintainer, 2026-11-16; FR-054, #638).
- Q: Should About, Preferences, the project settings dialog and the Resource Monitor look alike? → A: Yes:
  the same backgrounds, text, buttons and fields (maintainer, 2026-11-16; FR-054, #639).
- Q: Does the File Explorer's Delete need a new icon key to become a rubbish bin? → A: Yes. It drew
  `destroy`, the ✕ that about 35 controls share for closing and discarding; repainting `destroy` would
  have turned all of them into bins (maintainer, 2026-11-16; FR-055).
- Q: Which file kinds should the tree draw? → A: Every kind Lucide has art for that throng did not use,
  and a drawn icon per common programming language, built from Lucide's plain file where Lucide has
  none (maintainer, 2026-11-16; FR-056, FR-057).
- Q: What should the Markdown icon show? → A: An M and a down arrow (maintainer, 2026-11-16; FR-058).
- Q: Can hovering a File Explorer row show its icon larger? → A: Yes: a popover with the icon to the
  left of the path, middle-aligned (maintainer, 2026-11-16; FR-059).
- Q: Can the title bar be told apart from the window beneath it? → A: Yes: every window's title bar takes
  a slightly different colour, themeable (maintainer, 2026-11-16; FR-060).
- Q: Should file icons be colour-coded, and does that need separate accessibility modes? → A: Yes, by
  seven categories rather than per language, each a theme token with light and dark values per theme,
  held to 4.5:1; colour only reinforces the icon's art, so no colour-blind mode (maintainer, 2026-11-16;
  FR-061).
- Q: Where should a Resource Monitor "?" helper sit? → A: Raised to the top right of what it explains,
  overlapping nothing, with the elements around it moved to make room (maintainer, 2026-11-16; FR-062).
- Q: Do Icon colour and Icon set get the row actions? → A: Yes: revert, reset and clear, laid out as on
  every other preference (maintainer, 2026-11-17; FR-063).
- Q: Should the fallback file icon share the default icon colour? → A: No: it gets a colour of its own,
  neutral in every theme, distinct from the other icons and the folders; folders may keep the default icon
  colour (maintainer, 2026-11-17; FR-064).
- Q: Where does the panel type icon go when a header has other icons left of its title? → A: Furthest
  left in every window, with the other icons between it and the title (maintainer, 2026-11-17; FR-065).
- Q: Is a Markdown diagram's Maximise a Focus Mode? → A: Yes: called Focus Mode, and it closes the side
  panes as a panel's Focus Mode does (maintainer, 2026-11-17; FR-066).
- Q: Where does the File Manager preference go? → A: Under its own category that expands and collapses
  (maintainer, 2026-11-17; FR-067), which FR-068 then puts inside General.
- Q: How should the Settings tab be grouped? → A: Appearance, Window, Projects, Behaviour, Attention and File
  Manager in one General category; every editor preference under one Editor heading with a sub-heading per
  section; the same for search (maintainer, 2026-11-17; FR-068).
- Q: Why does Lucide have a "show licence text" control in About's third-party list? → A: It should not:
  list it like every other package. And the licence box's scrollbar must show the arrow, not the text
  cursor (maintainer, 2026-11-17; FR-069).
- Q: Does this feature cover macOS, which spec 070 made a supported target while it was in review? → A:
  Yes, at 070's level: everything here ships on macOS too and is proved there by CI alone, with no hand
  test on a Mac (constitution 6.6.0, Principle II; maintainer, 2026-11-16). Preferences on macOS keeps the
  native traffic lights, so the Linux maximise emulation does not apply there, and a case-only rename
  of a set is refused when another folder has that name on a case-sensitive volume (070 FR-020).
- Q: How does a user customise icons, and what does throng provide? → A: The user creates a set from
  an existing one and names it, presses Override this icon on each icon they want (throng copies the
  default file into the set's folder, asking before replacing one already there), opens the set's
  folder from Preferences, replaces the files outside throng (the file's presence is the override,
  with no metadata), and presses Reload the icon sets from disk; restarting throng also picks the changes up.
  Overrides survive later throng versions; keys without one show the newly shipped art. Preferences
  is a read-only view of the loaded icons and their keys. throng ships a plain-text `README.txt` with
  these instructions, kept current by every specification that changes icon sets (FR-023 to FR-035).
- Q: What does the upgrade do with customisations made under the old system? → A: Convert nothing.
  Every existing folder in the icon sets directory gets a `.bak` suffix, the seeded `throng` and
  `throng-svg` folders only when a lightweight check finds them customised (otherwise deleted), and
  the old `README.md` is deleted. `.bak` folders are invisible inside throng, and every start raises a
  notice until the user has migrated by hand and moved or deleted them. The release notes say so
  plainly (FR-017 to FR-020, FR-036 to FR-039). The grid shows each icon's file name with its key and
  current icon, and an override is obvious even when the file is a copy of the default (FR-027). The
  default icons ship compiled into the application, not as editable files (FR-021).

## Assumptions

- Lucide's licence permits redistribution in an AGPL-3.0 application with its notice kept. The plan
  confirms the current licence text before any art is copied in.
- The user's icon sets directory keeps its current location and folder name (`icon-packs`) under
  throng's per-user configuration. Renaming it is not part of this feature.
- Renaming or deleting a user set is done on disk; FR-016 covers a theme whose set has gone.
- Compiling the default set into the application (FR-021) stops casual and accidental edits, not a
  determined reader. throng is AGPL-3.0, its art is in its public repository, and Override this icon
  hands a copy of any default icon to the user by design.
- The `.bak` notice (FR-038) offers no delete action. The user deletes or moves backups themselves,
  so throng never destroys a file the user may still want.
- Out of scope, from #127's superseded design: animated hover icons and per-icon colours. Each would
  need its own issue.
- The application's own window and taskbar icon (`icon/`) is not part of the icon-key system and is
  untouched.
- Marks throng draws in CSS rather than as icons, such as the numbered attention circle, are not
  icons and are untouched.
- The constitution's themeable-icon-control rule needs no amendment: icons are still resolved
  through icon keys from the set the active theme selects, and coloured from theme tokens. The
  *Toast controls* rule added beside it in 6.8.0 (FR-050) places controls; it does not change how
  they are drawn.
