# Feature Specification: Preferences Editor — Title Bar, Settings, Key Bindings & Themes

**Feature Branch**: `007-preferences-editor`

**Created**: 2026-07-07

**Status**: Draft

**Input**: User description: "Implement the settings, preferences and theme editor: a new full-width top bar with window controls and a cog menu (Settings / Key Bindings / Themes) opening a rich, always-on-top preferences window with per-tab visual editors and a JSON toggle, immediate-apply, reset-to-default and reset-all, plus 14 new default themes. Keep the editors in sync with future settings (add to constitution)."

## Clarifications

### Session 2026-07-09

- Q: The Settings tab lists every setting; how does a user find one quickly? → A: **A typeahead search at the top of the Settings section.** The query is split on whitespace and a setting is shown when **any** typed word is a case-insensitive substring of its **name, description, or current value** (OR semantics — extra words *widen* the results, because the user is recalling a setting rather than filtering a known list; this deliberately differs from the font typeahead's AND semantics, FR-038b). Filtering is **debounced** so typing is never blocked, and the field carries an inline **reset (×) button** that clears the query immediately. Groups with no matching setting are hidden; a query matching nothing shows an empty state. (FR-049.)

### Session 2026-07-08

Post-delivery refinements to the shipped preferences editor. Several reverse earlier
2026-07-07 decisions (noted inline); the superseded requirement text is updated below,
not duplicated.

- Q: With multiple key bindings per action now allowed, how does a user remove an individual binding? → A: **Both a deletable pill and a context menu.** Each of an action's chords renders as a small deletable **pill** (an `×` removes that one chord); a **right-click context menu** on a chord also offers Remove. (FR-030/033b.)
- Q: "Change the standard icons to an icon pack" + "add a secondary icon pack" — what form should the two bundled packs take? → A: **A glyph default pack + an SVG secondary.** Package the current built-in glyph icons as a bundled, selectable **`throng` glyph pack** (so the standard icons *are* a pack), plus **one secondary bundled SVG image pack**; both live under `icon-packs/` and are chosen via the existing pack picker. The built-in `throng` glyph map remains the ultimate fallback. (FR-040b.)
- Q: "Button text and colour should have a separate set of style settings" — which button properties? → A: **Background + text + hover colours, plus a button font role.** New theme tokens `colours.buttonBg`, `colours.buttonText`, `colours.buttonHoverBg`, `colours.buttonHoverText`, and a `button` typography role (family/size/weight). (FR-046a.)
- **Preferences window layering (reverses FR-013 always-on-top-over-everything):** the preferences window MUST float **only above throng's own windows** (parented to the main window), **not above other applications**. It **minimises and restores together with the main window**, and on **close** the throng window returns to the foreground (no other-app window is left overlaying it). App-modality (throng windows non-interactive while preferences is open) is unchanged. (FR-013/013a.)
- **Multiple bindings per action (reverses FR-033 "replace"):** on key-up the captured chord is **added** to the action's existing chord(s) — multiple chords per action are managed in the UI, not only via JSON. A duplicate identical chord on the same action is ignored. (FR-033.)
- **Single-key bindings allowed (reverses FR-033a "modifier + key required"):** **any single key is bindable** except a reserved/excluded set — **Esc, Space, Shift, Ctrl, Enter, Caps Lock, Tab, Num Lock**, lone Alt/Meta, and the OS-reserved combos (FR-032a). Modifier combos remain bindable. (FR-033a.)
- **No text selection on double-click:** double-clicking a key-binding row (to open capture) MUST NOT select/highlight text on the row. (FR-031.)
- **Reset control labels + icons:** the reset controls read **"Reset to Defaults"** and **"Revert All"**, each shown as an **icon with a title-hover tooltip** (not text-only buttons). (FR-023/024.)
- **Uniform cog:** the preferences cog uses a **standard, uniform cog icon**. (FR-005.)
- **Font control is a multi-select pill editor:** the font control (every typography section) offers a dropdown of a short default list **on click**, supports **typeahead filtering** and **multi-selection**; each chosen family becomes a **deletable pill** (appended at the end, like tabs) and the pills serialise to the **comma-separated font-family string** saved to the theme. Every typography section MUST expose this font control. (FR-038/038b.)

### Session 2026-07-07

- Q: How should the new top bar relate to the OS-drawn title bar? → A: **Replace it** with a custom, application-drawn full-width bar that hosts the window minimise/maximise/close controls. Additionally, the window-identity chrome currently shown by the OS title bar (application/active-project identity) MUST move into this new bar, and **sub-workspace windows MUST receive the same custom title bar** (showing their own identity + controls).
- Q: How should the theme editor let users edit icon tokens (today stored as glyph strings)? → A: **Icon packs + per-token overrides**, and users MUST be able to **supply their own icon pack**. Icons render at **24px**.
- Q: How many of the 14 listed new themes are in scope for this feature? → A: **All 14** ship with this feature. Brand-derived themes are best-effort colour approximations; **SUBNET is a placeholder** approximation until the user supplies its branding.
- Q: What concretely is an icon pack? → A: A **named pack in which each icon token maps to either a glyph OR an image (SVG/PNG)**, and a pack **may mix** both. Bundled packs and **user-supplied packs (placed under the per-user config directory)** are selectable; a per-token override may itself be a glyph or an image; icons render in a **24px** box; a token missing from the chosen pack falls back to the default `throng` glyph.
- Q: In JSON mode, what does the Themes tab edit (themes are one file per theme)? → A: The Themes-tab JSON editor edits the **currently-selected theme's file**; the theme selector switches which theme file is loaded. (Settings and Key Bindings are each a single file.)
- Q: In the key-binding capture modal, how does a captured chord apply to the action's existing chord(s)? → A: **Replace** the action's chord(s) with the captured chord. If the chord is already bound to another action, **warn and require an explicit Reassign (which removes it from the other action) or Cancel** — never a silent duplicate and never a silent steal.
- Q: What do the "standard windows menus" mean beside the min/max/close controls? → A: **Only** the minimise / maximise / close controls — **no** OS system menu, no right-click title-bar menu, and no throng application menu bar (the cog is the only app menu). Hovering the maximise control **SHOULD** surface the Windows 11 **Snap Layouts** flyout where the platform provides it natively; this is **best-effort and MAY be omitted** if it would require a bespoke reimplementation.
- Q: Does selecting a theme to edit also make it the app's active theme? → A: **Yes — select = activate.** Selecting a theme in the Themes editor sets it as the active applied theme (updating the appearance theme setting) so every edit previews live across the whole app.
- Q: On the Themes tab, what does "reset this editor to default" reset? → A: It resets the **currently-selected theme**, and is **enabled only for built-in (bundled) themes** — reverting the selected built-in theme to its installed default. For a **user-created theme the reset control is disabled**. (Re-creating missing default theme files remains the separate "restore default themes" action, FR-037.)
- Q: Should deleting a theme prompt for confirmation? → A: **Yes — always a single confirmation** before the theme file is removed (no new setting).
- Q: What concrete on-disk shape does an icon pack take? → A: **Folder-per-pack with a manifest** — each pack is a directory under the per-user config `icon-packs` folder containing a `pack.json` that maps each token to a glyph string **or** a relative image filename (SVG/PNG assets stored alongside in that folder); packs are discovered by scanning the `icon-packs` directory. A **`README` documenting the pack format MUST be shipped in the `icon-packs` folder** so users can author their own packs by example.
- Q: For the multi-file Themes tab, what does "reset all" snapshot and revert? → A: **All config touched this session.** Reset-all is a session-scoped **revert** (a reverse-Save): it restores Settings, Key Bindings, and **every theme file edited since the preferences window opened** to their exact on-entry contents, and re-selects/re-activates the theme that was active on entry. The revert is scoped to the preferences-window session (the on-entry snapshot of the config it edits), not to any other main-app window state.
- Q: Where does the editors' field metadata (label, description, control type, allowed values, constraints) come from? → A: A **declarative metadata registry in `@throng/core`** is the single source of truth — one descriptor per setting / keybinding / theme token (label, description, control type, allowed values, min/max). The UI renders controls from it, and a **completeness test asserts every configurable key has a descriptor**, which is how the FR-047/048 governance rule ("editors expose every option, stay in sync") is enforced.
- Q: What happens when a theme is renamed to a name already used by another theme? → A: **Reject with inline validation.** The in-use name is flagged invalid and the rename is blocked until the name is unique — never a silent overwrite and never an auto-appended suffix (consistent with how invalid values are surfaced-and-blocked elsewhere, FR-017).
- Q: What constitutes a bindable chord in the key-binding capture modal? → A: **Require a modifier + key (for now).** A captured chord MUST include at least one modifier (Ctrl/Alt/Shift/Meta) plus a non-modifier key; a bare single key (e.g. `A`, `F2`) and a lone modifier are rejected as invalid and not saved. This is the current rule and MAY be relaxed in a future feature if deemed necessary.
- Q: Where does the font-family picker's list come from, and how does it behave? → A: **Enumerate installed OS fonts via a new `IFontEnumeration` platform seam** (per Principle II). The list is populated **in the background at application start** — it MUST NOT block or delay the app opening — and **cached to a file under `%APPDATA%\throng`**; the app reads that cache, so **a restart is required to pick up newly installed fonts** (no live refresh). The picker is a **typeahead with partial matching**: the query is split on whitespace into tokens and a font matches when **every token is a case-insensitive substring** of the font name, order-independent (e.g. `ar` → "Arial", "Gamar"; `ar es` → "Ariales", "Esarame"). Where enumeration is unavailable or the cache is not yet populated, the picker falls back to a curated list and still accepts a typed family name.
- Q: Do sub-workspace title bars show the cog? → A: **No.** A sub-workspace window's custom title bar shows **only its identity text (name/colour) and the OS-level window controls (minimise, maximise/restore, close)** — it does **not** carry the cog. The cog (and thus the preferences entry point) lives **only on the main window's title bar**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Application title bar with a cog menu (Priority: P1)

A user sees a distinct, full-width bar across the very top of the throng window, above the
Projects / Tabs / Files & Folders bar and the same height as it. At the top-right the bar carries the
standard window controls (minimise, maximise/restore, close). To the left of those controls, after a
small gap, sits a **cog** icon. Clicking the cog opens a menu offering **Settings**, **Key Bindings**,
and **Themes**. The bar is designed so more icons/actions can be added later without rework.

**Why this priority**: This bar is the entry point for the entire feature and replaces the OS window
chrome. Nothing else in the feature is reachable without it, so it is the foundational MVP slice.

**Independent Test**: Launch the app; confirm the new bar spans the full width above the panes bar,
carries working window controls, and that clicking the cog reveals the three-item menu. Fully testable
before any editor exists (the menu items may open an empty placeholder window).

**Acceptance Scenarios**:

1. **Given** the app is running, **When** the main window renders, **Then** a distinct full-width bar
   appears at the top, above the panes bar and matching its height, and no OS-drawn title bar is shown
   in addition.
2. **Given** the title bar is visible, **When** the user clicks minimise, maximise/restore, or close,
   **Then** the window performs the standard OS action (and maximise toggles to restore).
3. **Given** the title bar is visible, **When** the user clicks the cog, **Then** a menu appears with
   exactly **Settings**, **Key Bindings**, and **Themes**.
4. **Given** the window is not maximised, **When** the user drags an empty region of the title bar,
   **Then** the window moves; double-clicking that region toggles maximise/restore.
5. **Given** the app-level window-identity chrome (application / active-project identity) previously
   shown by the OS title bar, **When** the new bar renders, **Then** that identity is shown in the new
   bar and the OS title bar no longer duplicates it.

---

### User Story 2 - Edit application settings from a visual form (Priority: P1)

The user chooses **Settings** from the cog menu. A preferences window opens (defaulting to the Settings
tab) showing every application setting grouped into labelled sections, each with a clear description of
what it changes and why, followed by an input control appropriate to the setting's type (number field,
dropdown, text field, toggle, multi-select, array editor, etc.). When the user changes a setting to a
valid value, leaves a field, or closes the window, the change is written to the settings file and takes
effect in the running app immediately.

**Why this priority**: Editing settings through a discoverable UI (rather than hand-editing JSON) is the
primary user value of the feature and exercises the immediate-apply pipeline that themes and key bindings
reuse.

**Independent Test**: Open Settings, change a representative setting of each control type, and confirm the
change persists to the settings file and is reflected live in the app without a restart.

**Acceptance Scenarios**:

1. **Given** the cog menu is open, **When** the user clicks **Settings**, **Then** the preferences window
   opens with the **Settings** tab active.
2. **Given** the Settings tab, **When** it renders, **Then** settings appear grouped into sections, each
   item showing a human-readable label, a description, and a control matched to its value type.
3. **Given** a setting with a valid new value, **When** the user changes it and the field settles (blur
   or a valid selection), **Then** the value is written to the settings file and applied to the running
   app immediately (no restart, no explicit Save).
4. **Given** a setting constrained to a set of allowed values, **When** the user opens its control,
   **Then** the control is a dropdown (or multi-select) listing only the allowed values.
5. **Given** an in-progress invalid entry (e.g. a non-numeric string in a number field), **When** the
   value is invalid, **Then** it is not applied and the user is shown that the value is invalid, while
   the last valid value remains in effect.
6. **Given** the Settings tab, **When** the user types a word into the search field at the top, **Then**
   only the settings whose name, description, or current value contain that word remain, groups with no
   match are hidden, and the typed text appears in the field without lag.
7. **Given** a search query of several words, **When** it is applied, **Then** every setting matching
   **any** of the words is shown (the words widen, not narrow, the results).
8. **Given** an active search, **When** the user clicks the reset (`×`) control inside the field, **Then**
   the query clears and the full grouped list returns immediately.
9. **Given** a query that matches no setting, **When** it is applied, **Then** an explicit "no settings
   match" message is shown rather than an empty pane.

---

### User Story 3 - Rebind a keyboard shortcut by pressing it (Priority: P2)

The user chooses **Key Bindings**. The tab lists key bindings grouped into sections, each with a
description of what the binding does and its current chord. The user double-clicks a binding; a modal
invites them to press the desired key combination. As they hold keys down, the modal shows the chord
building live; on key-up the new binding is saved and the modal closes.

**Why this priority**: Key bindings are a core configuration surface but secondary to settings and themes
for first delivery; the capture interaction is self-contained.

**Independent Test**: Open Key Bindings, double-click a binding, press a new chord, and confirm the new
chord is saved to the keybindings file and resolves the action afterward.

**Acceptance Scenarios**:

1. **Given** the Key Bindings tab, **When** it renders, **Then** bindings appear grouped with a
   description and the current chord for each.
2. **Given** a binding row, **When** the user double-clicks it, **Then** a capture modal opens inviting a
   key combination.
3. **Given** the capture modal is open, **When** the user presses and holds a combination, **Then** the
   forming chord is displayed live as keys go down.
4. **Given** keys are held in the modal, **When** the user releases them, **Then** the new chord is saved
   to the keybindings file, the modal closes, and the change takes effect immediately.
5. **Given** a chord already assigned to another action, **When** it is captured, **Then** the modal warns
   and offers **Reassign** (removing it from the other action) or **Cancel** — never a silent duplicate or
   a silent steal.

---

### User Story 4 - Design a theme with pickers (Priority: P2)

The user chooses **Themes**. Above a grouped list of theme settings, they can select the theme being
edited, rename it, or delete it (any theme, with no restrictions — all themes may be deleted). A control
restores throng's default themes if any are missing. The grouped settings expose the right control per
type: a colour picker for colours, a font-family picker for fonts, a font-size picker in px, number
inputs for numeric values, and dropdowns for enumerated values. Icons are handled by choosing an icon
**pack** and optionally overriding individual icon tokens; the user may also supply their own pack.

**Why this priority**: Theming is a headline capability and the richest editor, but depends on the
window/editor shell (US1/US2) and the shared apply/JSON/reset machinery.

**Independent Test**: Open Themes, select a theme, change a colour / font / font-size / enum / icon, and
confirm each change is written to that theme's file and reflected live; rename, delete, and restore
defaults and confirm the theme list updates accordingly.

**Acceptance Scenarios**:

1. **Given** the Themes tab, **When** it renders, **Then** a theme selector, rename control, delete
   control, and a "restore default themes" control appear above a grouped list of the selected theme's
   settings.
2. **Given** a theme is selected, **When** the user edits a colour token, **Then** a colour picker is
   used and the chosen colour is applied live and saved to that theme.
2a. **Given** a theme is chosen in the selector, **When** the selection changes, **Then** that theme
   becomes the active applied theme and the whole app repaints with it so subsequent edits preview live.
2b. **Given** the user clicks delete on the selected theme, **When** they confirm the single prompt,
   **Then** the theme file is removed; **When** they cancel, **Then** nothing is deleted.
3. **Given** a font, font-size, numeric, or enumerated setting, **When** the user edits it, **Then** the
   control matches the type (font picker / px size picker / number input / dropdown) and applies live.
4. **Given** the selected theme, **When** the user renames it, **Then** the theme list and any reference
   to the active theme update to the new name without losing its settings.
5. **Given** one or more default themes are missing, **When** the user clicks "restore default themes",
   **Then** throng's bundled default themes are re-created from their installed source and appear in the
   list (existing user themes are untouched).
6. **Given** all themes have been deleted, **When** the list is empty, **Then** the app still renders
   using its built-in fallback styling and "restore default themes" recovers a working set.
7. **Given** the icon section, **When** the user selects an icon pack, **Then** all icon tokens adopt that
   pack; **When** the user overrides an individual token, **Then** only that token changes; **When** the
   user supplies a custom pack, **Then** it becomes selectable and its icons render at 24px.

---

### User Story 5 - Switch every tab between the visual UI and the raw JSON (Priority: P2)

A toggle icon on the right of the tab header bar switches all three tabs between the **visual UI** editor
and a **JSON** editor (throng's built-in code editor). The mode is global: when JSON is selected, all
three tabs show their file as JSON; when UI is selected, all three show their form. The toggle is always
visible, even when the window is very small. The JSON editors are independent of one another and of every
other editor in the app. Edits made in JSON apply immediately on a valid, settled change just as the UI
form does.

**Why this priority**: The JSON escape hatch is important for power users and for settings the UI may not
yet surface, but the UI editors deliver value without it.

**Independent Test**: Toggle to JSON on any tab and confirm all three tabs switch to JSON; edit valid
JSON and confirm it applies and persists; shrink the window and confirm the toggle stays visible.

**Acceptance Scenarios**:

1. **Given** the preferences window, **When** the user clicks the mode toggle, **Then** all three tabs
   switch together between UI and JSON mode.
2. **Given** JSON mode, **When** the user edits a tab's JSON to a valid document and the edit settles,
   **Then** it is saved to the corresponding file and applied to the running app immediately.
3. **Given** JSON mode with an invalid document, **When** the edit is invalid, **Then** it is not applied,
   the invalidity is surfaced, and the last valid state remains in effect.
4. **Given** the window is resized very small, **When** it renders, **Then** the mode toggle remains
   visible and usable.
5. **Given** two JSON tabs are open at different times, **When** edits are made, **Then** each tab's JSON
   is independent and does not affect the other tabs or any editor elsewhere in the app.

---

### User Story 6 - Reset an editor, or revert all editors (Priority: P3)

The tab bar offers a control to reset the **current** editor to throng's default values, and another to
reset **all three** editors at once to the state they were in when the user entered the preferences
window. Both actions require explicit confirmation before applying.

**Why this priority**: A safety/undo affordance that is valuable but not required for the core editing
journeys.

**Independent Test**: Change several settings, use "reset this editor to defaults" (confirm) and verify
the current editor returns to factory defaults; change more, use "reset all" (confirm) and verify all
three return to their on-entry snapshot.

**Acceptance Scenarios**:

1. **Given** an editor with modified values, **When** the user clicks "reset to default" and confirms,
   **Then** that editor's document is replaced with throng's default values and applied immediately.
2. **Given** the reset-to-default confirmation, **When** the user cancels, **Then** nothing changes.
3. **Given** modifications across editors this session — including edits to more than one theme file after
   switching the selected theme — **When** the user clicks "reset all" and confirms, **Then** the settings
   and keybindings files and **every theme file edited this session** revert to their values at the moment
   the preferences window was opened, and the on-entry active theme is re-selected/​re-activated.
4. **Given** the reset-all confirmation, **When** the user cancels, **Then** nothing changes.

---

### User Story 7 - Bundled default themes (Priority: P3)

throng ships with a set of default themes the user can select and use immediately: **Light**, **Snake**
(Metal Gear Solid), **Gothic**, **Windows Terminal**, **Bash**, **SUBNET** (placeholder), **VSCode**,
**VI/VIM**, **English Garden**, **Matrix**, **Cyberpunk**, **Claude**, **Debian**, and **Ubuntu**, in
addition to the existing default `throng` theme. These are stored as the installed default theme source so
they can be restored after deletion.

**Why this priority**: Content value that showcases the theme editor; independent of the editor mechanics
and safely deliverable last.

**Independent Test**: From a fresh install, confirm all listed themes appear in the theme selector, each
applies a visually distinct look, and each survives a delete-then-restore-defaults cycle.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the theme selector is opened, **Then** all listed default themes
   are present alongside `throng`.
2. **Given** any default theme, **When** it is selected, **Then** the app adopts a coherent, visually
   distinct appearance consistent with that theme's intent.
3. **Given** a deleted default theme, **When** "restore default themes" is used, **Then** it returns
   identical to its installed default.

---

### User Story 8 - Sub-workspace windows share the custom title bar (Priority: P3)

Each detached sub-workspace window carries the same custom title bar as the main window: its own identity
(the sub-workspace name/colour) at the left and the standard window controls at the right. Unlike the main
window, a sub-workspace title bar does **not** show the cog — the preferences entry point lives only on the
main window.

**Why this priority**: Parity that completes the chrome replacement; depends on US1 and is cosmetic
relative to the editors.

**Independent Test**: Detach a sub-workspace and confirm its window shows the custom title bar with the
sub-workspace's identity and working window controls, with no OS-drawn title bar in addition.

**Acceptance Scenarios**:

1. **Given** a sub-workspace window, **When** it renders, **Then** it shows the custom title bar with the
   sub-workspace's name/colour and standard window controls, **no cog**, and no OS title bar in addition.
2. **Given** a sub-workspace title bar, **When** the user uses its window controls, **Then** minimise,
   maximise/restore, and close behave per the sub-workspace window rules (independent minimise; close
   retains the sub-workspace per existing behaviour).

---

### Edge Cases

- **Malformed config file on disk**: If a settings/keybindings/theme file is malformed when the editor
  opens, the UI editor MUST present the tolerant, defaults-merged view (existing parse behaviour) and the
  JSON editor MUST show the raw text so the user can repair it; applying a valid edit repairs the file.
- **Simultaneous external edit**: If a config file changes on disk while the preferences window is open
  (e.g. edited elsewhere), the running app already live-reloads config; the preferences window MUST not
  silently overwrite an external change without reflecting it. Precedence: a **clean** buffer reloads to the
  external content (external wins); a **dirty** buffer (user mid-edit on the same doc) surfaces a
  reload/conflict prompt rather than silently discarding either side. [Behaviour detailed in FR-041.]
- **Invalid JSON left in the JSON editor on close**: Closing the window with invalid JSON in a tab MUST
  NOT apply or persist the invalid text; the last valid document remains in effect.
- **Reset with the file missing**: "Reset to default" MUST succeed even if the underlying file is absent
  (it is (re)created with defaults).
- **All themes deleted, then app restart**: The app MUST still start and render with built-in fallback
  styling; "restore default themes" recovers the set.
- **Deleting the currently-active theme**: The app MUST fall back to a still-present theme (or built-in
  fallback) so the UI never renders unstyled.
- **Renaming a theme to an existing name**: The rename MUST be **rejected with inline validation** — the
  in-use name is flagged invalid and the rename is blocked until the name is unique; no silent overwrite of
  the other theme and no auto-appended suffix.
- **Capturing a chord that is a reserved OS/window control**: The key-bindings capture MUST handle a
  combination it cannot bind gracefully — a captured token matching the reserved denylist (`isReservedChord`,
  e.g. `Ctrl+Alt+Delete`, `Alt+F4`, `Alt+Tab`, `Alt+Space`, or a Meta/Super-only combo) is surfaced as
  **unavailable** and is **not** saved (no dead chord); the modal stays open (FR-032a).
- **Capturing an excluded key or a lone modifier**: A single key IS bindable now, but a capture of an
  **excluded** key (Esc, Space, Shift, Ctrl, Enter, Caps Lock, Tab, Num Lock) or a **lone modifier** held
  alone MUST be surfaced as unavailable and not saved — the modal stays open until a bindable key/chord is
  captured or the user cancels (FR-033a).
- **Very small window**: All always-visible affordances (mode toggle, tab switching, reset controls) MUST
  remain reachable when the window is resized to its minimum.
- **Custom icon pack with missing tokens**: A user-supplied pack missing some tokens MUST fall back to the
  default glyph for the missing tokens rather than rendering blanks.
- **Font list not yet available**: On first start (or before background enumeration finishes / if the
  `%APPDATA%\throng` font cache is missing or empty), the font-family picker MUST remain usable — falling
  back to a curated common-family list and still accepting a typed family name — without blocking the
  preferences window or the application (FR-038a).
- **Preferences window open, user clicks the main window**: The main window and sub-workspaces MUST remain
  non-interactive while the preferences window is open, but the preferences window MUST be movable so the
  underlying windows can be seen.

## Requirements *(mandatory)*

### Functional Requirements

#### Title bar & window chrome

- **FR-001**: The application MUST render its own full-width title bar across the top of the main window,
  positioned above the Projects / Tabs / Files & Folders bar and matching that bar's height, and visually
  distinct from it.
- **FR-002**: The custom title bar MUST host the standard window controls (minimise, maximise/restore,
  close) at its top-right, styled per the host operating system's conventions, and the application MUST
  NOT also show a separate OS-drawn title bar. Only these three controls are required — the application
  MUST NOT introduce an OS system menu, a right-click title-bar menu, or a throng application menu bar
  (the cog is the only application menu). Hovering the maximise control SHOULD surface the Windows 11
  Snap Layouts flyout where the platform provides it natively; this is best-effort and MAY be omitted if
  it would require a bespoke reimplementation.
- **FR-003**: The window-identity chrome previously carried by the OS title bar (application / active
  context identity) MUST be presented within the custom title bar.
- **FR-004**: An empty region of the custom title bar MUST act as the window drag handle, and
  double-clicking it MUST toggle maximise/restore, matching standard window behaviour.
- **FR-005**: The custom title bar MUST display a **cog** icon immediately to the left of the window
  controls, separated by a small gap. The cog MUST be a **standard, uniform cog glyph** (a conventional
  settings gear), not a bespoke/irregular mark.
- **FR-006**: The title bar MUST be structured so additional icons/actions can be added to it in the
  future without redesign (an extensible action area), following a standard, documented arrangement.
- **FR-007**: Sub-workspace windows MUST use the same custom title bar, showing each sub-workspace's own
  identity (name/colour) and its own window controls, with no OS-drawn title bar in addition. A
  sub-workspace title bar MUST **NOT** display the cog (nor any preferences entry point): it carries **only**
  the identity text and the OS-level window controls (minimise, maximise/restore, close). The cog appears
  **only on the main window** (FR-005).

#### Cog menu

- **FR-008**: Clicking the cog MUST open a menu containing exactly **Settings**, **Key Bindings**, and
  **Themes** (in that order), and MUST be dismissible without a selection.
- **FR-009**: Selecting any of the three cog-menu items MUST open the preferences window with the
  corresponding tab active (Settings → Settings tab, etc.).

#### Preferences window

- **FR-010**: The three cog-menu options MUST open a **single, shared** preferences window with three tabs
  (Settings, Key Bindings, Themes); re-invoking from the cog focuses/reuses that window rather than
  opening additional ones.
- **FR-011**: When opened via **Settings**, the window MUST show the Settings tab first; when opened via
  Key Bindings or Themes, that tab MUST be active on open.
- **FR-012**: The user MUST be able to switch between the Settings, Key Bindings, and Themes tabs within
  the window.
- **FR-013**: While the preferences window is open, it MUST stay above throng's **own** windows (the main
  and sub-workspace windows) — parented to the main window — but MUST **NOT** float above other
  applications' windows (it is not globally always-on-top). While it is open the throng windows MUST be
  non-interactive (the user cannot select or act on them) until the preferences window is closed.
- **FR-013a**: The preferences window MUST track the main window's minimise/restore: when the main window
  is minimised the preferences window MUST minimise with it, and it restores together with the main
  window. When the preferences window is **closed**, the throng window it belonged to MUST return to the
  foreground — no other application's window may be left overlaying throng as a result of the close.
- **FR-014**: The preferences window MUST be independently movable so the user can reposition it to see
  the throng windows beneath it.
- **FR-015**: The preferences window MUST edit the user's actual configuration files in the per-user
  throng configuration directory (settings, keybindings, and themes), and every applied change MUST be
  written to those files.

#### Immediate apply

- **FR-016**: A change made in any editor (UI or JSON) MUST be applied to the running application and
  persisted immediately when the value becomes valid, when a form field loses focus, or when the
  preferences window is closed — with no explicit Save action.
- **FR-017**: An invalid value MUST NOT be applied or persisted; the invalidity MUST be surfaced to the
  user and the last valid value MUST remain in effect.
- **FR-018**: Applying a change MUST take effect live without requiring an application restart.

#### UI ⇄ JSON toggle

- **FR-019**: A mode toggle on the right of the tab header bar MUST switch between the **visual UI** editor
  and the **JSON** editor, and MUST be **always visible**, including when the window is resized to its
  minimum.
- **FR-020**: The mode toggle MUST be **global**: switching mode changes all three tabs at once (all UI or
  all JSON).
- **FR-021**: The JSON editors MUST use throng's built-in code editor and MUST be independent of one
  another and of every other editor in the application (no shared document/buffer).
- **FR-022**: Toggling from JSON back to UI (and vice versa) MUST preserve the current applied
  configuration and reflect it in the newly shown mode.
- **FR-022a**: In JSON mode, the Settings and Key Bindings tabs each edit their single file, while the
  **Themes tab edits the currently-selected theme's file**; changing the selected theme in the Themes tab
  MUST switch which theme file the JSON editor is loaded with.

#### Reset

- **FR-023**: The tab bar MUST provide a control — labelled **"Reset to Defaults"** and presented as an
  **icon with a title-hover tooltip** (not a text-only button) — to reset the **current** editor to
  throng's default values for that document, applied and persisted on confirmation. On the **Themes** tab
  this control targets the **currently-selected theme** and MUST be **enabled only for built-in (bundled)
  themes** — reverting the selected built-in theme to its installed default; for a **user-created theme the
  control MUST be disabled** (re-creating missing default themes remains FR-037).
- **FR-024**: The tab bar MUST provide a control — labelled **"Revert All"** and presented as an **icon
  with a title-hover tooltip** — to reset **all three** editors to the state they held at
  the moment the preferences window was opened (an on-entry snapshot), applied and persisted on
  confirmation — a session-scoped **revert** ("reverse Save"). For Settings and Key Bindings this restores
  their single file's on-entry contents; for the multi-file Themes tab it MUST restore **every theme file
  edited since the window opened** to its on-entry contents and re-select/​re-activate the theme that was
  active on entry. The revert is scoped to the preferences-window session's on-entry snapshot of the config
  it edits; it MUST NOT touch unrelated main-app window state.
- **FR-025**: Both reset actions MUST require an explicit confirmation before changing anything, and
  cancelling MUST leave all values unchanged.

#### Settings editor (UI)

- **FR-025a**: The field metadata that drives the editors — for each setting, key binding, and theme token:
  its human-readable label, description, control type, allowed values, and any numeric/format constraints —
  MUST originate from a **single declarative metadata registry in `@throng/core`** (one descriptor per
  configurable key). The UI editors MUST render their controls from this registry rather than from
  independently hand-maintained field definitions, so the registry is the authoritative source consumed by
  both the form and its validation. This registry is the mechanism by which FR-047/FR-048 are enforced (see
  FR-047).
- **FR-026**: The Settings UI editor MUST list every configurable application setting, grouped into
  labelled sections.
- **FR-027**: Each setting MUST show a human-readable label and a clear description of what it changes and
  why.
- **FR-028**: Each setting MUST render an input control appropriate to its value type — at minimum: number
  input, single-select dropdown (for enumerated values), text field, boolean toggle, multi-select, and an
  array editor (add/remove/reorder entries).
- **FR-029**: A setting whose value is constrained to a fixed set of options MUST be edited via a dropdown
  or multi-select limited to those options (never a free-text field).
- **FR-049**: The Settings UI editor MUST provide a **typeahead search** at the **top of the Settings
  section**. The query MUST be split on whitespace into words, and a setting MUST be shown when **any** word
  is a case-insensitive substring of its **name**, its **description**, or its **current value**. Extra words
  therefore **widen** the result set (OR), unlike the font typeahead's every-token rule (FR-038b). Filtering
  MUST be **debounced** so that typing remains responsive, while the typed text itself MUST appear in the
  field immediately. The field MUST carry an inline **reset control (an `×` inside the field)** that clears
  the query and restores the full list immediately (never debounced); it MUST be shown only while a query is
  present. Groups left with no matching setting MUST be hidden, and a query matching nothing MUST show an
  explicit empty state rather than a blank pane. An empty query MUST show every setting.

#### Key Bindings editor (UI)

- **FR-030**: The Key Bindings UI editor MUST list bindings grouped into sections, each showing a
  description of the action and its current chord(s). An action MAY have **multiple** chords; each chord
  MUST render as an individually **deletable pill** (an `×` on the pill removes just that chord), and a
  **right-click context menu** on a chord MUST also offer **Remove**. Removing a chord saves immediately.
- **FR-031**: Double-clicking a binding row MUST open a capture modal inviting the user to press the key
  combination. Double-clicking the row MUST **NOT** select or highlight any text on the row.
- **FR-032**: While the capture modal is open, the forming chord MUST be displayed live as keys are
  pressed (key-down).
- **FR-032a**: A captured chord that is a **reserved OS / window-control combination** the application cannot
  bind MUST be surfaced as **unavailable** and MUST NOT be saved (no dead chord written, the modal does not
  close). "Reserved" is a curated denylist of OS-owned combinations — at minimum `Ctrl+Alt+Delete`,
  `Ctrl+Shift+Escape`, `Alt+F4`, `Alt+Tab`, `Alt+Escape`, `Alt+Space`, and any chord whose only modifier is
  the Meta/Super (Windows) key — evaluated by a pure `isReservedChord` helper so the set is testable and
  extensible. This is distinct from the excluded single keys (FR-033a) and from an already-bound conflict
  (FR-034).
- **FR-033**: On key-up, the captured chord MUST be **added** to the action's existing chord(s) (an action
  supports **multiple** chords, managed in the UI — not only via the JSON editor), be saved to the
  keybindings file, close the modal, and take effect immediately. Capturing a chord **identical** to one
  the action already has MUST be a no-op (no duplicate entry), not an error. (Individual chords are removed
  per FR-030.)
- **FR-033a**: **Any single key is bindable** (a bare key no longer requires a modifier), **except** a
  reserved/excluded set that MUST be surfaced as unavailable and not saved: **Esc, Space, Shift, Ctrl,
  Enter, Caps Lock, Tab, Num Lock**, a **lone modifier** (Alt/Meta/Shift/Ctrl on their own), and the
  OS-reserved combinations of FR-032a. Modifier combinations remain bindable. The exclusion set is a pure,
  testable, extensible helper (the maintainer MAY add further OS-owned or unsafe keys). (This reverses the
  earlier modifier-plus-key minimum.)
- **FR-033b**: The user MUST be able to **remove an individual chord** from an action (since an action may
  hold several): each chord's **deletable pill** carries an `×` that removes just that chord, and a
  **right-click context menu** on a chord also offers **Remove**. Removal is saved immediately (the same
  rendering + affordance described in FR-030). This is the counterpart to the additive capture of FR-033.
- **FR-034**: If a captured chord is already bound to another action, the modal MUST warn and require an
  explicit choice — **Reassign** (which removes the chord from the other action and assigns it here) or
  **Cancel** — never silently creating a duplicate binding and never silently stealing the chord.

#### Themes editor (UI)

- **FR-035**: The Themes UI editor MUST provide, above the theme settings, a control to **select** which
  theme is being edited, and controls to **rename** and **delete** the selected theme. Selecting a theme
  to edit MUST also make it the **active applied theme** (updating the appearance theme setting) so edits
  preview live app-wide.
- **FR-036**: The user MUST be able to delete any and all themes — there are no protected/undeletable
  themes — but deleting a theme MUST first prompt for a **single confirmation** before the theme file is
  removed.
- **FR-036a**: Renaming the selected theme to a name already used by another theme MUST be **rejected with
  inline validation** — the name is flagged invalid and the rename is blocked until it is unique; the
  editor MUST NOT silently overwrite the colliding theme nor auto-append a disambiguating suffix.
- **FR-037**: The Themes editor MUST provide a control to **restore throng's default themes** from their
  installed source, re-creating any that are missing without disturbing existing user themes.
- **FR-038**: The Themes editor MUST group a theme's settings and render controls by type: a **colour
  picker** for colour tokens, a **font-family control** for fonts (FR-038a/038b), a **font-size picker in
  px** for sizes, **number inputs** for numeric values, and **dropdowns** for enumerated values. **Every
  typography section/role** (not only those that pin a family in the default) MUST expose the font-family
  control so its font can be changed.
- **FR-038a**: The font-family picker MUST offer the **fonts installed on the operating system**, obtained
  through a **new platform abstraction (`IFontEnumeration`, contract-tested)** per Principle II. The
  installed-font list MUST be gathered **in the background at application start and MUST NOT block or delay
  the application opening**, and MUST be **cached to a file under `%APPDATA%\throng`**. The application uses
  the cached list, so newly installed fonts appear only after an application **restart** (there is no live
  refresh while running). Where enumeration is unavailable or the cache is not yet populated, the picker
  MUST fall back to a curated common-family list and MUST still accept a typed family name (an
  unavailable name falls back gracefully at render time).
- **FR-038b**: The font-family control MUST be a **multi-select pill editor** (not a single-value field):
  - On **click** it MUST offer a dropdown of a **short default list** (the curated common families), and it
    MUST support **typeahead filtering** with partial, order-independent matching — the query is split on
    whitespace into tokens and a font qualifies only if **every token is a case-insensitive substring** of
    the family name (e.g. `ar` matches "Arial" and "Gamar"; `ar es` matches "Ariales", "Esarame").
  - Selecting a family MUST **append a pill** (styled like a tab) at the **end** of the current list; the
    user MUST be able to **delete each pill individually**. The user MAY also add a typed family not in the
    list (graceful fallback at render time).
  - The ordered pills MUST serialise to the **comma-separated font-family string** that is saved to the
    theme (a standard CSS fallback stack, e.g. `"Segoe UI", system-ui, sans-serif`), and an existing
    comma-separated value MUST be parsed **back into pills** when the control loads.
- **FR-039**: The Themes editor MUST let the user assign an **icon pack** that maps all icon tokens at
  once, and **override individual icon tokens** on top of the chosen pack; an override value MAY itself be
  a glyph or an image.
- **FR-040**: An icon pack MUST be a **named folder** under the per-user config `icon-packs` directory
  containing a **`pack.json` manifest** that maps **each icon token to either a glyph string or a relative
  image filename (SVG/PNG)** stored alongside in that folder; a pack **MAY mix** glyphs and images across
  its tokens. Packs MUST be **discovered by scanning the `icon-packs` directory**. The user MUST be able to
  **supply their own pack by placing such a folder under the per-user throng configuration directory**,
  after which it becomes selectable. Icons MUST render in a **24px** box, and any token missing from the
  chosen pack MUST fall back to the default `throng` glyph.
- **FR-040a**: throng MUST ship a **`README` in the `icon-packs` folder** documenting the pack format
  (folder layout, `pack.json` schema, the glyph-or-image-per-token rule, the full list of icon tokens, and
  the 24px render/​fallback behaviour) so users can author their own packs by example.
- **FR-040b**: throng MUST ship **at least two bundled, selectable icon packs**: (1) a **`throng` glyph
  pack** that packages the current built-in glyph icons as a first-class pack (so the "standard" icons are
  themselves a selectable pack, selected by default), and (2) a **secondary pack using SVG images**. Both
  MUST be seeded under the `icon-packs` directory on first run (like the default themes / README) and MUST
  be discoverable and selectable through the icon-pack picker. The built-in `throng` glyph map remains the
  ultimate per-token fallback (FR-040).

#### Config safety & external changes

- **FR-041**: If a config file changes on disk while the preferences window is open, the preferences
  window MUST reflect the external change rather than silently overwriting it with a stale in-window value.
  Precedence when both sides change: if the in-window buffer for that document is **not dirty** (no unsaved
  in-progress edit), the external change **wins** — the buffer reloads to the on-disk content. If the buffer
  **is dirty** (the user is mid-edit on the same document), the editor MUST NOT silently discard either side:
  it MUST surface the external change (a reload prompt / conflict indicator) and let the user reload
  (adopting the external content) or keep editing (their next apply then overwrites) — never a silent
  clobber in either direction.
- **FR-042**: Editing MUST be confined to the per-user throng configuration directory; the editors MUST
  NOT read or write configuration outside that directory.
- **FR-043**: A malformed config file MUST NOT crash the editor: the UI editor MUST show the
  defaults-merged tolerant view and the JSON editor MUST show the raw text for repair.

#### Default themes

- **FR-044**: throng MUST ship the following default themes in addition to `throng`: **Light**, **Snake**,
  **Gothic**, **Windows Terminal**, **Bash**, **SUBNET**, **VSCode**, **VI/VIM**, **English Garden**,
  **Matrix**, **Cyberpunk**, **Claude**, **Debian**, and **Ubuntu**.
- **FR-045**: The default themes MUST be stored as an installed default source in the per-user throng
  application data location on installation, so they can be restored after deletion (FR-037).
- **FR-046**: Each default theme MUST style the full set of theme tokens (colours, fonts, typography roles,
  and icons) so no theme leaves UI surfaces unstyled; `throng`'s built-in defaults remain the ultimate
  fallback for any missing token.
- **FR-046a**: Buttons MUST have their **own** style settings, separate from generic surface/text tokens:
  new colour tokens **`buttonBg`**, **`buttonText`**, **`buttonHoverBg`**, and **`buttonHoverText`**, and a
  new **`button` typography role** (family/size/weight, like the other typography roles). These MUST appear
  in the theme editor (colour pickers + the font control), be part of the full token set every default
  theme styles (FR-046), have descriptors in the metadata registry (FR-047), and — being additive — fall
  back to the current generic button styling when absent so existing themes are unaffected.

#### Completeness & governance

- **FR-047**: The configuration editors MUST expose **every** configurable setting, key binding, and theme
  token; when new configuration is added to the application in future, the corresponding editor MUST be
  updated to expose it (no configuration may be editable only by hand-editing JSON). This MUST be enforced
  by the declarative metadata registry (FR-025a) plus a **completeness test asserting every configurable
  key has a descriptor** in the registry, so a newly added config key without an editor descriptor fails
  the test.
- **FR-048**: The requirement that the configuration editors stay in sync with all configurable options
  (FR-047) MUST be recorded in the project constitution as an ongoing governance rule.

### Key Entities *(include if feature involves data)*

- **Custom Title Bar**: The application-drawn top bar. Attributes: window-identity display, window
  controls, and — **on the main window only** — an extensible action area (currently the cog). Present on
  the main window and every sub-workspace window; sub-workspace title bars omit the cog/action area,
  showing only identity text and the OS-level window controls.
- **Cog Menu**: The action menu opened from the title bar cog; items map to preferences tabs.
- **Preferences Window**: The single shared, always-on-top, movable editing window. Attributes: active
  tab, edit mode (UI/JSON), and an on-entry snapshot for reset-all — the settings and keybindings files
  plus **every theme file edited during the session** as they were when the window opened, and the
  on-entry active theme. Reset-all is a session-scoped revert of that snapshot.
- **Editor Metadata Registry** *(new, in `@throng/core`)*: The single declarative source of truth for
  editor field metadata — one descriptor per configurable setting, key binding, and theme token (label,
  description, section/group, control type, allowed values, numeric/format constraints). The UI editors
  render from it; a completeness test asserts every configurable key has a descriptor (FR-025a/047).
- **Settings Document** *(existing `AppSettings`)*: The user's sectioned application settings; edited by
  the Settings tab.
- **Keybindings Document** *(existing `Keybindings`)*: Action-id → chord map; edited by the Key Bindings
  tab.
- **Theme** *(existing `Theme`)*: A named set of colour, font, typography-role, and icon tokens; multiple
  themes exist; one is active. Edited by the Themes tab. Extended with **button** styling: colour tokens
  `buttonBg`/`buttonText`/`buttonHoverBg`/`buttonHoverText` and a `button` typography role (FR-046a).
  Font-family values are CSS fallback stacks (comma-separated), edited via the pill control (FR-038b).
- **Installed-Fonts Cache**: The list of OS-installed font families gathered at application start through
  the `IFontEnumeration` seam (Principle II), persisted to a file under `%APPDATA%\throng`. Read at startup
  to populate the font-family typeahead; refreshed only on application restart. Falls back to a curated
  common-family list when absent or not yet populated.
- **Icon Pack**: A named **folder** under the per-user config `icon-packs` directory holding a
  **`pack.json` manifest** (token → glyph string **or** relative image filename) plus its SVG/PNG image
  assets; a pack may mix glyph and image tokens, and icons render in a 24px box. Packs are discovered by
  scanning `icon-packs`; may be bundled or user-supplied (a folder dropped under that directory). The
  active theme references a pack plus optional per-token overrides (each override also a glyph or an image).
  Missing tokens fall back to the default `throng` glyph. An `icon-packs/README` documents the format for
  pack authors. throng ships **two bundled packs** seeded on first run: a **`throng` glyph pack** (the
  default, packaging the built-in glyphs) and a **secondary SVG-image pack** (FR-040b).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can change any exposed setting, key binding, or theme token from the visual editors
  and see it take effect in the running app **without restarting** and without hand-editing any file.
- **SC-002**: Opening any of the three cog-menu options presents the correct editor tab in **1 action**
  (single click on the menu item), with the Settings option landing on the Settings tab.
- **SC-003**: **100%** of configurable settings, key bindings, and theme tokens are reachable and editable
  through the visual editors (no configuration is UI-invisible).
- **SC-004**: A user can rebind a shortcut by opening the capture modal and pressing the combination — the
  new chord is saved on key-up in a **single** press-and-release gesture.
- **SC-005**: Every applied change is written to the corresponding config file such that it survives an
  application restart.
- **SC-006**: An invalid value (form or JSON) is **never** applied or persisted; the last valid state is
  always preserved.
- **SC-007**: All **14** listed default themes are selectable from a fresh install, each yields a visually
  distinct appearance, and each survives a delete-then-restore-defaults cycle identically.
- **SC-008**: The UI/JSON mode toggle and the reset controls remain visible and usable at the window's
  minimum size (verified at the minimum window dimensions).
- **SC-009**: While the preferences window is open, the main and sub-workspace windows cannot be
  interacted with, yet the preferences window can be moved to reveal them.
- **SC-010**: Font enumeration never delays application startup — the app opens without waiting on the
  installed-font list; the font-family picker is fully usable (typeahead over the cached list, or the
  curated fallback with free typing) whether or not enumeration has completed, and typing a partial,
  multi-token query narrows the list by case-insensitive substring on every token.
- **SC-011**: From the Settings tab, a user can isolate any single setting by typing **one** remembered word
  from its name, description, or current value — the matching setting is visible and non-matching groups are
  gone — and can restore the full list in **1 action** (the reset control). Typing never blocks: the typed
  characters appear in the field before the filter is applied.

## Assumptions

- **Config locations**: User-editable config (settings, keybindings, themes) lives in the existing
  per-user throng configuration directory (`%USERPROFILE%\.throng`, overridable via `THRONG_CONFIG_ROOT`).
  The installed default-theme source (FR-045) and the installed-fonts cache (FR-038a) live under the throng
  application-data location (`%APPDATA%\throng`), consistent with existing app-data usage.
- **Reuse of existing config model**: The feature edits the existing `AppSettings`, `Keybindings`, and
  `Theme` documents and their tolerant parse/merge behaviour; it does not introduce a new settings schema
  beyond the **declarative editor-metadata registry in `@throng/core`** (FR-025a) that describes each
  configurable key's label, description, control type, allowed values, and constraints — the single source
  of truth the editors render from.
- **JSON editor**: "throng's built-in code editor" is the existing CodeMirror-based editor delivered in
  feature 006, reused in a standalone, disconnected mode for each config file.
- **Live config reload**: The app already watches and live-reloads config files; immediate-apply builds on
  that existing mechanism, so applying an edit and the app reacting to the file change are the same path.
- **Immediate-apply debounce**: JSON/text edits settle via a short debounce (consistent with the editor's
  existing auto-save debounce) before validity is evaluated and applied; form controls apply on
  valid-change or blur.
- **Themes are best-effort brand approximations**: Brand-derived default themes (VSCode, Cyberpunk,
  Ubuntu, Debian, Claude, Windows Terminal, Bash, VI/VIM, Snake) are colour/typography approximations, not
  official assets. **SUBNET is an explicit placeholder** approximation pending the user's branding details;
  refining it is a follow-up, not a blocker.
- **"Standard windows menus"**: Interpreted as **only** the minimise / maximise / restore / close controls
  and their expected drag/double-click behaviours — no OS system menu, no right-click title-bar menu, and
  no throng application menu bar (see FR-002). The Windows 11 Snap Layouts flyout on maximise-hover is a
  best-effort native nicety that MAY be omitted if it requires a bespoke reimplementation.
- **Themes are stored one file per theme**: Under `%USERPROFILE%\.throng\themes\<name>.json` (existing
  layout), while `settings.json` and `keybindings.json` are single files. The Themes editor and its JSON
  mode operate on the currently-selected theme's file (FR-022a).
- **Icon packs live in their own directory**: Under `%USERPROFILE%\.throng\icon-packs\<pack>\` — each a
  folder with a `pack.json` manifest and its SVG/PNG assets — discovered by scanning `icon-packs`. A
  bundled `icon-packs\README` documents the format so users can drop in their own packs (FR-040/040a).
- **Sub-workspace cog scope**: Sub-workspace title bars do **not** carry the cog — they show only identity
  text and the OS-level window controls. The cog (the sole preferences entry point) lives only on the main
  window, and there is only ever one preferences window per app instance.
- **Cross-platform**: Windows is the first target; the custom title bar and window controls sit behind the
  platform abstractions so macOS/Linux control conventions can be added later without reworking the core.

## Dependencies

- Existing per-user config store and live config watcher (feature 003).
- Existing `AppSettings` / `Keybindings` / `Theme` core models and tolerant parsers.
- Existing CodeMirror-based editor (feature 006) for the JSON mode.
- Existing sub-workspace window creation and focus-group behaviour (feature 002/003), extended to carry the
  custom title bar.
- A **new `IFontEnumeration` platform seam** (Principle II, contract-tested) with an OS-specific
  implementation for the first target, feeding the `%APPDATA%\throng` installed-fonts cache consumed by the
  font-family picker (FR-038a).

## Out of Scope

- Syntax-aware validation UI beyond JSON validity + the existing tolerant parse (e.g. rich inline schema
  hints) — only validity/apply and clear error surfacing are required.
- Import/export of settings/theme bundles (future; the per-user store already carries an owner key for this).
- Per-project or per-sub-workspace setting overrides — configuration remains user-scoped.
- A full application menu bar beyond the cog action area.
- Official/licensed brand assets for the brand-derived themes (approximations only; SUBNET is a placeholder).
- Syntax highlighting/language features in the JSON editor beyond what the built-in editor already provides.
