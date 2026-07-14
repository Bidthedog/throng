# Feature Specification: Theming, Preferences & Shell Polish

**Feature Branch**: `018-theming-prefs-and-shell-polish`

**Created**: 2026-07-13

**Status**: Draft

**Input**: Consolidates nine tracked issues deferred from features 007, 011, 014, 015 and 017: [#62](https://github.com/Bidthedog/throng/issues/62), [#63](https://github.com/Bidthedog/throng/issues/63), [#56](https://github.com/Bidthedog/throng/issues/56), [#64](https://github.com/Bidthedog/throng/issues/64), [#55](https://github.com/Bidthedog/throng/issues/55), [#53](https://github.com/Bidthedog/throng/issues/53), [#58](https://github.com/Bidthedog/throng/issues/58), [#48](https://github.com/Bidthedog/throng/issues/48), [#60](https://github.com/Bidthedog/throng/issues/60).

---

## Summary

throng is a themed application with surfaces that do not obey the theme, preference values that cannot be sensibly edited, and nine different ways of telling the user the same thing. This feature is a **consistency sweep**, in the spirit of feature 017: it closes a class of defects rather than adding a capability.

It has three strands:

1. **Theming** — one colour token is doing at least five unrelated jobs, so a theme author cannot fix one surface without breaking another. Split it. Then bring the surfaces that were never themed at all — scrollbars, the cog menu, the Key Bindings menu, the colour-picker popup, the icon artwork — inside the theming system.
2. **Preferences** — numeric values are bare text boxes showing unreadable digit runs like `10485760`. And a project's hidden-files list is write-only: there is a way to hide a file and no way to un-hide it.
3. **Shell** — confirmations and errors are surfaced through **nine** distinct idioms (this specification originally counted five; the Phase 0 survey found four more); and a file cannot be dragged in from the operating system's file manager at all.

### Corrections to the source issues

The issues were written against a reading of the code that is now partly wrong. This specification is written against the code as it **actually is**. The material corrections:

- **There is no `panelSurface` theme token.** Issue #62's title names a token that does not exist. The real token is **`surface`**; the name in the issue comes from its *copy label*, "Panel surface". Its overuse is **worse** than the issue reports — roughly 30 call sites, not 8 — and its sibling **`surfaceActive`** is overloaded in the same way. Meanwhile the files the issue names as offenders — `editor.css`, `app.tsx`, `dismiss-button.tsx`, `capture-modal.tsx` — do not reference it at all.
- **Issue #56 is far cheaper than it claims.** It assumes the preferences window is a separate renderer that cannot reach the shared context-menu provider. It is not: there is **one** renderer bundle, routed by query string, so the shared provider is already importable and its stylesheet is already loaded. The preferences window simply never *mounts* the provider.
- **`resolveIcon()` no longer exists.** Feature 017 deleted it, with a build guard that fails if anything reaches for it. Icons now resolve through a single shared component and render as inline markup so they inherit colour. Issue #56's remedy must be restated in those terms.
- **Issue #55's blocker is cleared.** It was blocked by #54, which feature 017 closed. Icon artwork now genuinely inherits its colour from the enclosing control — which is what makes an icon-colour token possible, and also what makes it a genuinely *new* concept: there is no icon-colour token today, and icons have no independent colour of their own.
- **There is no scrollback-lines setting.** Issue #53 cites one as a motivating example. The only genuinely large-magnitude numeric value in the application is the maximum openable file size.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A theme author can colour each surface independently (Priority: P1)

A user opens the Themes editor and changes the colour whose label reads "Panel surface", intending to restyle the Files & Folders pane. Today that single change also repaints the drop-down menus, the key-binding row hover, the preferences search box, the find bar, the modal cards, the active project row, the active tab chip, several buttons and the panel body — because every one of them reads the same token. At least one then looks wrong, and there is no second dial to turn.

After this story, each of those is a **distinct role** with its own token. Changing the pane background changes the pane background.

**Why this priority**: It is the foundation. Stories 2, 3 and 4 all add or re-point themed surfaces, and every one of them would have to be redone if the token model were split afterwards. It is also the only story that is a *data-model* change to every bundled theme.

**Independent Test**: Set the pane-background token to a colour that is deliberately wrong for a menu (say, near-white on a dark theme). Confirm the Files & Folders pane changes and that the drop-down menus, row hovers and input fields do **not**. Confirm every bundled theme (the 14 shipped plus the built-in `throng` theme — see FR-003) still renders.

**Acceptance Scenarios**:

1. **Given** any bundled theme, **When** the user changes the pane-background token, **Then** only pane backgrounds change; menu, hover, input and button surfaces are unaffected.
2. **Given** any bundled theme, **When** the user changes the menu-surface token, **Then** every drop-down and context menu in the application changes together — including the cog menu and the Key Bindings menu (Story 2) — and nothing else does.
3. **Given** a newly added **required** token, **When** the test suite runs, **Then** the completeness test confirms it is present in every bundled theme, has an editor descriptor, and has hand-written copy. (The one **optional** token, the icon colour, is exempt from the all-themes rule and is surfaced by a hand-authored descriptor — see FR-003 and FR-031a. Its absence is its meaning.)
4. **Given** the shipped themes, **When** the distinctness guard runs, **Then** every pair of bundled themes remains distinguishable, and the guard's calibration constant has been **re-derived** against the new token set rather than relaxed.

---

### User Story 2 — Every menu in the application obeys the theme (Priority: P1)

A user picks a theme. The tab, panel and file-and-folder menus adopt it. The **cog drop-down** in the title bar and the **Key Bindings editor's right-click menu** do not: they are two bespoke re-implementations that take their background from hard-coded colour literals, position themselves without flipping away from the screen edge, roll their own click-away, and — in the cog menu's case — draw a gear from a hard-coded inline vector, which the constitution prohibits outright.

After this story there is **one** menu implementation, and every menu in every window goes through it.

**Why this priority**: It is a constitutional violation sitting in the most visible chrome in the app, and the survey shows the fix is far smaller than assumed — the shared provider is already reachable from the preferences window and merely unmounted. High value, low cost.

**Independent Test**: Switch themes with the cog menu open, then with the Key Bindings menu open; both repaint. Open each near the right and bottom edges of the display; both flip to stay on-screen. Open one, then open another; the first closes.

**Acceptance Scenarios**:

1. **Given** any theme, **When** the user opens the cog menu, **Then** its surface, text, border and icons all derive from that theme's tokens, and its gear resolves from the theme's icon set.
2. **Given** the cog menu is opened near the right or bottom edge of the display, **When** it renders, **Then** it flips and is clamped so it stays entirely on-screen.
3. **Given** the cog menu is open, **When** the user opens any other menu **in that window**, **Then** the cog menu closes — one menu open at a time. And **when the window loses focus**, any open menu closes with it (FR-017a), so no menu is ever left hanging in a window the user has clicked away from.
4. **Given** the Key Bindings editor, **When** the user right-clicks a bound chord, **Then** the menu that appears is the shared menu, themed and icon-bearing, and its remove action still removes the chord.
5. **Given** the preferences window, **When** any menu is opened in it, **Then** it is the same implementation the main window uses.

---

### User Story 3 — Scrollbars are part of the theme (Priority: P2)

Every scrollable surface in the application — the preferences panels, the file tree, the editor, the project and sub-workspace lists, the menus — renders the browser engine's default scrollbar. On a dark theme that is a light-grey bar in an otherwise dark application. The single exception is the terminal, and its scrollbar is styled only because a classic non-overlay bar is needed for **layout**: it must take real width so the terminal's fit calculation wraps text *before* the bar rather than underneath it.

**Why this priority**: Highly visible and self-contained. It cannot be done convincingly before the token split, because the terminal's thumb currently borrows two unrelated tokens for want of a scrollbar token of its own.

**Independent Test**: On each bundled theme, scroll each scrollable surface and confirm the track, thumb and hover state are theme colours. Then resize a terminal and confirm the last column is still not overlapped.

**Acceptance Scenarios**:

1. **Given** any bundled theme, **When** the user scrolls any scrollable surface, **Then** the scrollbar's track, thumb and thumb-hover colours come from theme tokens.
2. **Given** the terminal panel, **When** the theme changes, **Then** its scrollbar recolours **and** remains a classic non-overlay bar occupying real layout width, so terminal text still wraps before the bar and the last column is never overlapped.
3. **Given** the new scrollbar tokens, **When** the test suite runs, **Then** every bundled theme (the 14 shipped plus the built-in `throng` theme — see FR-003) ships values for them, each has copy, and the completeness test covers them.

---

### User Story 4 — The colour picker is themed and keyboard-usable (Priority: P2)

To edit a colour token the user clicks a swatch. The swatch itself is themed. The **popup it opens is the operating system's own colour dialog** — a light-grey panel with system fonts, in the middle of a fully-themed dark application. No stylesheet, attribute or application flag can theme it. The only remedy is to stop using the native control.

**Why this priority**: The most jarring break in the app's visual integrity, and it sits on the control the Themes editor is *built from* — every colour token uses it. It must land before Story 5, which needs it for the icon colour.

**Independent Test**: Open the Themes editor on a dark theme, click any colour swatch, and confirm the picker is drawn from theme tokens. Drive it entirely from the keyboard. Confirm the edited colour still applies live and persists.

**Acceptance Scenarios**:

1. **Given** any theme, **When** the user opens the colour picker, **Then** every part of it — surface, border, text, sliders, handles — derives from theme tokens, and no operating-system dialog appears.
2. **Given** the picker is open, **When** the user adjusts the saturation/value area, the hue control, or types a hex value, **Then** the colour applies live exactly as today (immediate apply, debounced persist, hot-reloaded), and all three routes agree on one value.
3. **Given** the picker is open, **When** the user operates it with the keyboard alone, **Then** every control is reachable, operable, and shows a visible focus indicator.
4. **Given** the picker is open, **When** the user presses Escape or clicks away, **Then** it closes and the last applied value stands.
5. **Given** an invalid hex value, **When** the user commits it, **Then** it is rejected, the last valid colour stands, and the error is shown on the row.

---

### User Story 5 — Icons take their colour from the theme (Priority: P2)

The bundled SVG icon set is monochrome line art. It reads well on dark themes and badly on light ones. The obvious remedy — ship a black set and a white set — is the wrong one: the artwork is already authored to inherit its colour, so the two sets would be the same art twice, and would still be wrong for every theme that suits neither pure black nor pure white.

Instead, keep one set and give the theme an **icon colour** it can override, edited with the picker from Story 4, beside the icon-pack selector.

**Why this priority**: Depends on Story 4 for its control. Unblocked only recently — feature 017 is what made the artwork actually inherit colour, so the token finally has something to drive.

**Independent Test**: On a light theme, select the SVG icon pack and confirm the icons are legible. Change the icon colour and confirm every icon in the application — toolbar, tree, tabs, menus, panels — changes together.

**Acceptance Scenarios**:

1. **Given** the SVG icon pack is selected, **When** the user sets the theme's icon colour, **Then** every icon rendered from that pack, in every window, adopts it.
2. **Given** the icon colour is left unset, **When** icons render, **Then** they inherit the colour of the control hosting them, exactly as today — so no existing theme changes appearance.
3. **Given** the Themes editor, **When** the user views the Icons section, **Then** an icon-colour control sits beside the icon-pack selector and uses the same picker as every other colour token.
4. **Given** the icon-colour token, **When** the test suite runs, **Then** it has copy, it is **editable in the visual editor**, and it is covered by a test asserting every optional token is reachable there. It **does not** ship a value on the bundled themes — it is the one **optional** token, and shipping it with a value would repaint every theme's icons, contradicting Scenario 2 above. See FR-003, FR-031 and FR-031a.

---

### User Story 6 — One way to confirm, one way to be notified (Priority: P2)

The same class of interaction looks and behaves differently depending on which control the user clicked. Confirming a destructive action is an inline strip in one place and a modal dialog in another — and there are **two unrelated modal-confirmation implementations** in the codebase, one of which the themes surface cannot even use. Being told something failed is an inline strip in the preferences window and a dismissable panel copy-pasted into four places in the main window. There is also a non-dismissable restore notice.

Nine idioms, all saying "confirm this" or "this went wrong". (This story originally counted five. The Phase 0 survey found three further blocking decision modals, a modal message box and a fifth error strip — enumerated in FR-048.)

**Why this priority**: A maintenance tax on every future feature — each new surface must pick one of five and re-implement it. Feature 015 explicitly relaxed its own "exactly one confirmation model" criterion pending this work.

**Independent Test**: Trigger a destructive confirmation from the preferences window, from the themes surface, and from the main window; all three present the same way. Trigger a failure in each of the four main-window error surfaces; all four notify the same way. Confirm "revert" (session undo) stays distinct from "reset to shipped defaults".

**Acceptance Scenarios**:

1. **Given** any destructive action anywhere in the application, **When** the user triggers it, **Then** they confirm through one single confirmation model, with the consequence stated in the button label.
2. **Given** any failure or success notice, **When** it is raised, **Then** it appears through one single notification model, themed from theme tokens and dismissable.
3. **Given** the preferences window, **When** the user resets a tab to shipped defaults and separately reverts the session's changes, **Then** the two remain semantically distinct and are described distinctly, exactly as today.
4. **Given** the migration is complete, **When** the codebase is searched, **Then** **eight** of the nine surfaces no longer exist and the ninth has become the confirmation model (the enumeration is in FR-048) — the inline confirm strip, the inline notice strip, the rival confirmation dialog, the **five** copy-pasted error strips, the non-dismissable restore notice, the modal message box and the three n-way decision modals have collapsed into **two** models. (This scenario originally named only five surfaces and a single model; both were superseded — see FR-048 and Decision 3.)
5. **Given** the existing end-to-end suites, **When** they run, **Then** they still pass: the identifiers the broadest suites rely on are preserved rather than renamed.

---

### User Story 7 — Numbers are editable by dragging and readable at a glance (Priority: P3)

Every numeric preference — in both the Settings and Themes editors — is a bare text box. Font sizes, delays, pane widths and byte counts are all typed. The maximum-openable-file-size setting displays as `10485760`: eight digits with no grouping, which nobody reads as ten megabytes. Sizes, delays and widths are far easier to set by dragging than by typing.

**Why this priority**: A real ergonomic improvement, but nothing is broken and nothing depends on it. Note the descriptors already declare bounds *and* a step — and the step is currently **dead metadata**, declared and never read.

**Independent Test**: Drag a slider for a font size and watch the application update. Type into the same field and watch the slider follow. Confirm the value stored on disk is a plain number with no grouping characters.

**Acceptance Scenarios**:

1. **Given** a numeric preference with bounds, **When** it renders, **Then** it offers both a slider and a typed field, and both drive the same underlying value.
2. **Given** the user drags the slider, **When** they release it, **Then** the value applies and persists, and the typed field shows the same number.
3. **Given** the user types a value and commits it, **When** the field commits, **Then** the slider moves to match; out-of-bounds or non-numeric entries are rejected with the last valid value standing.
4. **Given** a large-magnitude value, **When** it is displayed, **Then** it is shown with digit grouping (`10,485,760`).
5. **Given** any value displayed with grouping, **When** it is written to disk, **Then** the persisted value is a plain number — no grouping character ever reaches a settings or theme file.

---

### User Story 8 — Hidden files can be seen and un-hidden, from the project's own settings (Priority: P3)

The explorer's context menu offers "Hide in this project". It works. There is **no way back**: no list, no toggle, no un-hide, nowhere in the application that even shows what is hidden. The list is append-only, and a user who hides a file can recover it only by hand-editing the database.

The remedy is **not** a row in the Preferences window. Preferences is the *user's* editor: every value in it is user-scoped and lives in the settings file. A project's hidden paths are **project data** — they belong beside the project's name, colour and root folder, not beside the user's font size. Forcing them into Preferences would make the settings registry grow a scope concept it does not have, and would leave a row whose "reset to shipped default" could never mean anything, because the shipped-defaults record holds no project data at all.

Instead, the **File & Folders pane gains an options icon** that opens a **project settings dialog** for the active project. The hidden-paths list lives there, where it can be seen and un-hidden. That dialog is the surface any future project-scoped setting belongs on.

**Why this priority**: A genuine one-way door for the user, but a rare one. It introduces a new surface, so it is sequenced after the theming and notice work it draws on.

**Independent Test**: Hide three paths in a project. Open the options icon on the File & Folders pane and find them listed. Remove one and confirm it reappears in the tree. Switch projects and confirm the dialog shows the new project's hidden paths, not the old one's.

**Acceptance Scenarios**:

1. **Given** a project is active, **When** the user views the File & Folders pane, **Then** an options icon is present, drawn from the active theme's icon set and carrying a hover title that names the action.
2. **Given** the user activates the options icon, **When** the dialog opens, **Then** it presents the **active project's** settings, is themed entirely from theme tokens, and names the project so there is no doubt which one is being edited.
3. **Given** the active project has hidden paths, **When** the dialog opens, **Then** every hidden path is listed and each can be removed.
4. **Given** the user removes a hidden path, **When** they return to the explorer, **Then** that path is visible again without a restart.
5. **Given** no project is active, **When** the user views the File & Folders pane, **Then** the options icon is **disabled**, with a hover title saying why — a project settings dialog with no project is never reachable. (See FR-041: "absent **or** disabled" was a disjunction no test could meaningfully fail, and is now settled.)
6. **Given** this dialog exists, **When** the configuration-completeness test runs, **Then** it passes **unchanged** — no project-scoped key enters the user-settings registry, so the audit requiring every descriptor to be a leaf of the user settings document is neither weakened nor taught a new concept.

---

### User Story 9 — A file can be dragged in from the operating system (Priority: P3)

Dropping a file onto an editor is the most reflexive gesture a user brings from every other editor. In throng it does nothing at all — there is no drop handling anywhere in the application. The only way into an editor panel is throng's own explorer tree or the panel-type form.

This matters most in **sub-workspace windows**, which have no explorer at all: a drop would be the *only* way to open a file there.

**Why this priority**: The largest and riskiest story — it crosses the renderer and the main process (**not** the daemon: Phase 0 found the editor path never involves it); it touches an already-shipped confinement rule and deliberately changes its behaviour; and it must coexist with two existing drag systems without hijacking either. It goes last so a slip here does not hold up the other eight issues.

**Independent Test**: Drag a file from the OS file manager onto an editor panel; it opens. Drag one onto an empty untyped panel; the panel becomes an editor showing the file. Drag one that violates the ownership rule; it is visibly rejected rather than silently ignored.

**Acceptance Scenarios**:

1. **Given** an editor panel owned by a project, **When** the user drops a file from inside that project's folder onto it, **Then** the file opens in that panel.
2. **Given** an untyped panel, **When** the user drops a file onto it, **Then** the panel becomes an editor panel showing that file, without the user first choosing a panel type.
3. **Given** an editor panel owned by a project, **When** the user drops a file from **outside** that project's folder onto it, **Then** the drop is rejected with a visible affordance explaining why — never a silent no-op.
4. **Given** a sub-workspace window, **When** the user drops a file onto a panel in it, **Then** the drop is handled in that detached window exactly as in the main window.
5. **Given** a path that reaches the panel through a symbolic link, **When** the drop is evaluated, **Then** the path is resolved to its real location **before** the ownership rule is applied, so a link cannot slip past the project boundary.
6. **Given** the user is dragging a panel, or dragging within the explorer tree, **When** an operating-system file drag is also possible, **Then** neither drag system interferes with the other.

---

### Edge Cases

**Theming**

- A **user-authored theme** predating the split lacks the new tokens. It must still load, with the new tokens falling back to a value that preserves its current appearance — not to transparent or black.
- A user has already overridden the old overloaded token in a custom theme. The split must not silently discard that override.
- The distinctness guard's calibration constant is derived from the closest legitimate pair of bundled themes. **Adding colour tokens moves it.** If it is not re-derived, the suite fails on a change that is actually correct.
- The copy test **bans a list of abbreviations** and rejects descriptions that are mechanically derivable from the key. New token names and copy must be chosen accordingly.

**Menus**

- A menu opened in a screen corner must flip on **both** axes at once.
- The terminal's right-click menu is a **native** OS menu, deliberately, because it provides Copy/Paste. It is a further visual idiom but is out of scope — see Out of Scope.

**Colour picker**

- A colour is edited **while the theme is being switched underneath it**. Today the target theme is captured at edit time so a mid-flight switch cannot misfile the write; that guarantee must survive the rewrite.
- Rapid edits inside the debounce window must still compound into one write, not race.

**Numbers**

- One numeric setting has **no upper bound** (maximum openable file size). **It keeps that absence, deliberately** — it does not get a slider, so it needs no ceiling, and inventing one to enable a control would be exactly the "silent, undeclared bound" FR-034 prohibits.
- Theme **font weights** are numeric but carry **no bounds at all** today.
- A locale whose digit grouping is not a comma must not corrupt the stored value.

**Hidden paths / project settings**

- The user hides a path, then deletes the project — the hidden list goes with it.
- The user hides a path, then the file is deleted on disk. The list still names it; removing it must still work.
- The project settings dialog is **open** when the user switches the active project, or deletes the project it is editing. It must not go on editing a project that is no longer active, and must not write to a project that no longer exists.
- There is **no settings/cog icon token in the theme today** — the existing cog menu draws a hard-coded inline vector, which is precisely the #56 defect. The options icon therefore needs a **new icon token**, which the cog menu (FR-015) will use too.

**OS drop**

- A **folder** is dropped rather than a file.
- **Multiple files** are dropped at once.
- A file is dropped that is **already open** in another panel. The application enforces one buffer per file, so this must focus the existing panel rather than open a second.
- A file is dropped that **exceeds** the maximum openable size.
- A drop happens in a **sub-workspace window**, where the explorer's window-level drag listeners are not mounted (there is no explorer there) — so drag behaviour differs between windows.

---

## Requirements *(mandatory)*

### Theming — token model (#62)

- **FR-001**: The overloaded surface colour token MUST be split into distinct tokens, one per genuine surface **role**. The split MUST at minimum separate: **pane/panel background**, **menu and drop-down surface**, **input and field surface**, and **row hover/active surface**.
- **FR-002**: The overloaded *active*-surface sibling token MUST be audited in the same pass and split on the same role boundaries wherever it too is doing more than one job. **The audit's result MUST be recorded**, whether or not it produces a token — an audit whose outcome is not written down is indistinguishable from an audit that never happened.
- **FR-002a**: The settled token roster is [`contracts/theme-tokens.md`](./contracts/theme-tokens.md). It, not this specification's prose, is the single authority on which tokens exist. FR-001's "at minimum" was written before the audit; the audit has now run.
- **FR-003**: Every new **required** token MUST ship an explicit value in **every bundled theme** — the 14 in the
  shipped theme set **plus the built-in `throng` theme**, which is a real, selectable theme and is what
  the distinctness and contrast guards actually iterate. ("14" throughout this specification means these
  15; the discrepancy was found during Phase 0 research.)

  **Exception — `iconColour` is OPTIONAL and MUST be excluded from this rule.** Its **absence is its
  meaning**: unset signifies *inherit the host control's colour*, which is precisely what makes FR-029
  true (no existing theme changes appearance). Shipping it with an explicit value in every theme would
  make FR-003 and FR-029 contradict each other, and would repaint every bundled theme's icons on the day
  it landed. It is the only optional token, and the all-themes completeness sweep MUST skip it.
- **FR-004**: Every new token MUST have a **hand-written copy entry** (label and description) satisfying the existing copy rules: no banned abbreviations, and a description that is not mechanically derivable from the token's key.
- **FR-005**: Every new token MUST be covered by the **token-completeness test**, so a future token added without a descriptor fails the build.
- **FR-006**: The **theme-distinctness guard** MUST continue to pass, and its calibration constant MUST be **re-derived** against the new token set. The guard MUST NOT be weakened, relaxed or disabled to accommodate the split.
- **FR-007**: The **theme-contrast guard** MUST continue to pass for the themes it gates, and any new foreground/background pairing introduced by the split MUST be added to its enumerated pairings.
- **FR-008**: A theme authored **before** the split MUST still load. Absent new tokens MUST resolve to a defined fallback that preserves the theme's current appearance, and an existing user override MUST NOT be silently discarded. **The fallback MUST be resolved in the theme-resolution layer, not as a CSS `var()` fallback**: the colour-variable emitter merges every theme over the built-in defaults before emitting, so a CSS-level fallback can never fire at runtime and a pre-split theme's custom `surface` would be silently replaced by the *built-in* default for every new token — the precise appearance change this requirement forbids. (Phase 0 research; there is a dead precedent of exactly this mistake already in the codebase.)

### Theming — scrollbars (#63)

- **FR-009**: The theme MUST gain scrollbar tokens — at minimum **track**, **thumb** and **thumb-hover**.
- **FR-010**: Scrollbar theming MUST be applied to **every** scrollable surface in every window, not piecemeal to individual surfaces.
- **FR-011**: The terminal's scrollbar MUST retain its **classic, non-overlay** behaviour, occupying real layout width, so the terminal's fit calculation continues to wrap text before the bar and the final column is never overlapped. This story **recolours** it; it MUST NOT change its layout behaviour.
- **FR-012**: The scrollbar tokens MUST satisfy FR-003 through FR-005 (all themes, copy, completeness).

### Theming — menus (#56)

- **FR-013**: There MUST be exactly **one** in-application menu implementation. The cog drop-down and the Key Bindings editor's menu MUST both be rebuilt on it.

  **There is a third bespoke floating list — the font typeahead — which the source issues did not notice.** It is carved out **on the record** as a **combobox**: a filtered value picker, not a list of actions, so it is not required to *be* the menu. But it MUST take its colours from the menu tokens and it MUST **flip and clamp** like every other floating surface (FR-016), which it does not do today. The guard enforcing this requirement MUST **discover** floating surfaces rather than checking two known class names — a guard that enumerates two of three implementations reports green while this requirement is false.
- **FR-013a**: The shared menu MUST gain **keyboard navigation** (roving focus, arrow keys, Enter to activate) before the cog menu is migrated onto it. The cog menu today is a list of focusable buttons and **is** keyboard-reachable; the shared menu handles Escape only. Migrating one onto the other as it stands would be an **accessibility regression**, which this feature MUST NOT ship. (Phase 0 research; the source issues did not notice this.)
- **FR-014**: Every menu MUST derive its surface, text, border and icon colours from theme tokens, and MUST NOT draw hard-coded inline vector artwork (constitution — Themeable icon controls). **Correction from Phase 0 research**: the bespoke menus are *not*, as issue #56 claims, backgrounded by hard-coded colour literals — they read the theme through `var(--surface, …)` and the literals are dead fallbacks; an existing end-to-end test already proves the cog menu re-themes. What is genuinely wrong, and what this requirement MUST be held to, is: (a) the cog's **inline vector gear**; (b) **no edge flip/clamp** on either bespoke menu; (c) **no shared single-menu-open invariant**; (d) the **token overload** (menus read the same token panes do — FR-001); and (e) ~~unconditional shadow-colour literals~~ — **charge (e) is withdrawn**, deliberately and on the record: a drop shadow is an *occlusion effect* rendered over whatever sits beneath it, black-at-low-alpha in every theme. It is not a surface taking a colour from the theme, and giving it a token would add a colour to 15 themes to express "black, faintly". Shadow literals are therefore **allow-listed by the SC-002 guard, with that reason stated in the test** — not silently tolerated. The **shared** menu remains in scope for the rest: it hard-codes an item-hover foreground colour and draws its submenu arrow as a literal character while the theme ships a `chevron` icon token.
- **FR-014a**: The pane collapse/expand chevrons MUST be resolved from the theme's `chevron` icon token. They are drawn as **hard-coded inline vector artwork** today — a pre-existing violation of the same constitutional rule, in the same class of defect, found during Phase 0 research and fixed in the same pass.
- **FR-014b**: The **window controls** (minimise, maximise, restore, close) and the **Projects pane's "new project" control** MUST likewise resolve from the theme's icon set. All five draw hard-coded inline artwork today. They are named explicitly because **SC-002 claims that *zero* icons in the application draw from an inline vector** — leaving these behind would make that success criterion false on the day it shipped, which is precisely the defect this feature exists to close. New icon tokens are added for the four window controls; the "new project" control uses the existing `add` token. (Icon tokens do not participate in the colour-distinctness metric, so this costs nothing against FR-006.)
- **FR-015**: The cog menu's gear MUST resolve from the active theme's **icon set**, like every other icon in the application. **No such icon token exists today** — the theme has no settings/cog glyph, which is why the menu draws an inline vector. This feature MUST therefore add a **settings icon token**, satisfying FR-003 through FR-005 (every bundled theme — the 14 shipped plus the built-in `throng` theme — copy, completeness). The same token serves the project-settings options icon (FR-040).
- **FR-016**: Every menu MUST **flip and clamp** to remain entirely on-screen when opened near a display edge.
- **FR-017**: The **single-menu-open invariant** MUST hold **within a window**: opening any menu closes any other in that window. Every menu in every window goes through the one shared implementation, so the invariant holds by construction wherever menus exist.

  **"Application-wide" was imprecise, and the imprecision hid work nobody had costed.** throng runs the main window, each sub-workspace and the preferences window as **separate renderer processes**. A menu provider holds one menu state *per renderer*, so a menu opened in the preferences window cannot close one open in the main window without inter-process coordination — which no requirement asked for and which would buy the user nothing.

- **FR-017a**: A menu MUST **close when its window loses focus**. This is what the "application-wide" wording was actually reaching for: the user never sees a menu hanging open in a window they have clicked away from. It costs one event listener and no inter-process message, and it makes the observable behaviour match the intent without inventing a coordination protocol to achieve it.
- **FR-018**: The shared menu MUST be available in the **preferences window**, which does not mount it today.
- **FR-019**: The Key Bindings menu's existing behaviour — removing a bound chord — MUST be preserved, and MUST gain end-to-end coverage. It has **none** today.

### Theming — colour picker (#64)

- **FR-020**: The colour control MUST NOT use the operating system's native colour dialog. It MUST be replaced by a picker built from themed primitives.
- **FR-021**: The picker MUST provide at minimum a **saturation/value area**, a **hue control** and a **hex entry field**, all taking their colours from theme tokens.
- **FR-022**: The picker MUST preserve today's commit semantics: an **optimistic in-memory apply**, a **debounced write**, and a **hot-reload** back through the configuration store. (Phase 0 correction: these are not three mechanisms but one debounced write plus an optimistic reference — there is no undebounced write path for a theme token today.)
- **FR-023**: The picker MUST preserve today's correctness guarantees: the **target theme is captured at edit time**, so switching theme mid-edit cannot misfile a write; and rapid edits within the debounce window compound into a single write. This is the one correctness property that genuinely exists today, and it MUST survive the rewrite.
- **FR-024**: The picker MUST be fully **keyboard-operable**, with a visible focus indicator on every control.
- **FR-025**: The picker MUST be a **single shared control**, used by every colour token in the Themes editor and reusable by the icon-colour control (FR-027).
- **FR-026**: An invalid colour entry MUST be rejected, leaving the last valid value applied, and MUST surface the error on the row — matching the existing numeric-rejection behaviour. **This is net-new behaviour and a live bug fix, not a preserved semantic**: the colour control performs *no* validation today. Both the swatch and the hex field commit on every keystroke, so typing `zzz` into the hex box writes the string `zzz` straight into the theme file on disk. (Phase 0 research.)

### Theming — icon colour (#55)

- **FR-027**: The theme MUST gain an **icon-colour** token, edited with the shared picker (FR-025) and presented beside the icon-pack selector in the Themes editor.
- **FR-028**: The application MUST continue to ship **one** SVG icon set. Black and white variants of the same artwork MUST NOT be introduced.
- **FR-029**: When the icon-colour token is **unset**, icons MUST inherit the colour of the control hosting them, exactly as today — so **no existing theme changes appearance** as a result of this feature.
- **FR-030**: When the icon-colour token is **set**, every icon resolved from the pack, in every window, MUST adopt it.
- **FR-031**: The icon-colour token MUST satisfy FR-004 (copy) and MUST be **editable through the visual editor** (the constitution's configuration-editor-completeness rule is non-negotiable). It is **explicitly exempt from FR-003**: it is the one optional token, and shipping it with a value in every theme would contradict FR-029 and repaint every bundled theme's icons.

- **FR-031a**: An **optional** theme token MUST be surfaced in the editor by a **hand-authored descriptor**, exactly as the **icon-pack selector** already is — not by the derived descriptor registry.

  **This resolves a genuine contradiction.** The theme editor's registry is *derived from the leaves of the built-in theme*, and its completeness audit rejects any descriptor for a token that is not such a leaf. So an optional, unset token gets **no** descriptor and is **uneditable** (violating the constitution) — while giving it a value to make it a leaf would break FR-029 by repainting every bundled theme's icons. Neither horn is acceptable.

  The codebase already solves this exact problem: the **icon pack** is an optional theme field, absent from the derived registry, surfaced by a hand-written descriptor in the Icons section. The icon colour follows that precedent and sits beside it. A test MUST assert every optional token is reachable in the editor, so one cannot silently become uneditable — the derived registry's audit will not catch it.

### Preferences — numeric controls (#53)

- **FR-032**: The editor control vocabulary MUST gain a **slider**. Feature 007 declares that vocabulary *exhaustively*; reconciling that declaration is **out of scope here** and is tracked by **[#79](https://github.com/Bidthedog/throng/issues/79)**, because more than one in-flight feature extends the same sentence and its correct final wording depends on the order they land in. This feature adds its control; it does not arbitrate the declaration.
- **FR-033**: A numeric preference **declaring the slider control** MUST offer a slider **and** a typed field. Both MUST drive the same underlying value, and each MUST reflect edits made through the other. (A numeric that does not declare it keeps the typed field it has today — see FR-034 for which is which, and why.)
- **FR-034**: A slider is an **explicit, opt-in control kind**. A descriptor declaring `slider` MUST also declare a minimum, a maximum **and** a step; a numeric descriptor that does not declare `slider` renders as a typed field, exactly as today. The slider MUST take its bounds and step from that descriptor. It MUST NOT invent a silent, undeclared bound that could clamp a value the user already has.

  **Which numerics become sliders**: font sizes, delays, pane widths and font weights — values a user genuinely *tunes*, where dragging beats typing.

  **Which do not**: the **maximum openable file size** stays **typed-only**, and keeps its absence of an upper bound. This is a deliberate reversal of an earlier draft that gave it a 2 GiB ceiling so it could take a slider. Two things were wrong with that. A slider across 1 KiB–2 GiB has millions of positions and moves in megabyte jumps per pixel — it is a worse control than the text box it replaces. And the ceiling was invented to serve the control rather than because the system has one. FR-034's own prohibition — *do not invent a bound* — applies, and the honest answer is that this value is typed, not dragged.

  **The theme font weights DO gain bounds** (100–900, step 100): that is the actual CSS `font-weight` range, a real property of the system rather than a number chosen to enable a slider.
- **FR-035**: The slider's **step** MUST be read from the descriptor, which MUST declare one scaled to the magnitude of the value's shipped default — so a 13-pixel font size steps by 1 and a 300-millisecond delay steps by 50, not by 1. Most descriptors already declare exactly this, correctly scaled; the step is simply **never read**. This requirement is therefore an *authoring rule for descriptors* plus *making the existing data load-bearing* — **not** a call for a derivation function. Inferring at runtime what the descriptor already states would be speculative generality (Principle VIII, YAGNI) and would let a descriptor and its slider disagree.

  **A test MUST assert the authoring rule holds, not merely that a step exists.** The rule, stated so it can actually be failed: **a slider's step MUST be at least 1% of its declared range** (`step >= (max - min) / 100`, inclusive), giving at most a hundred positions across the drag. A step that is a vanishing fraction of the range yields thousands of indistinguishable positions and is no more usable than no slider at all — the trap a 1024-byte step across a multi-gigabyte range would have set (FR-034).

  Measured against the **range**, not the shipped default, every existing slider descriptor passes — **except one**: the auto-save debounce (0–10000, step 50 = 0.5%). **Its step is widened to 100** as part of this feature. A rule that the codebase does not satisfy is a rule that produces a red bar nobody can fix, and shipping the assertion without the fix would be worse than shipping neither.
- **FR-036**: Adding a slider MUST NOT regress the typed field's current commit behaviour, which commits on **blur and Enter** (not on every keystroke) and reads from the live input rather than a stale render. A slider streams values continuously; the two MUST be reconciled **without** reintroducing the stale-value defect that behaviour was introduced to fix.
- **FR-037**: Numeric values of **five digits or more** MUST be **displayed** with digit grouping (so `10485760` reads as `10,485,760`). Values below that threshold MUST NOT be grouped: a 5000-millisecond delay rendered as `5,000`, or a 1024-byte minimum as `1,024`, reads as a typo rather than a kindness. "Large-magnitude" was undefined in the original wording; this is the settled rule, and it is asserted rather than left to the formatter's locale default.
- **FR-038**: Digit grouping is strictly a **view** concern. A grouping character MUST NEVER reach a stored value, a settings file or a theme file.
- **FR-039**: These controls serve **both** the Settings and Themes editors, which share one numeric control today. Both MUST benefit and neither MUST regress.

### Project settings — hidden paths (#58)

> **Decision (2026-07-13)**: project-scoped values are **not** managed in the Preferences window. They get their own dialog, reached from the File & Folders pane. This keeps the Preferences window purely user-scoped and leaves the settings registry, its completeness audit and feature 015's reset machinery entirely untouched.
>
> **Phase 0 correction — this story is renderer-only.** The specification says the hidden-paths list is append-only and recoverable "only by hand-editing the database". That is true **as user experience** and **false at every layer beneath it**. The `setHidden` operation is already a full **replace**, not an append — the append behaviour comes entirely from the single call site spreading the existing list. And the hidden-paths list is **already** carried to the renderer on the project record, which already holds it in hand. Un-hiding is therefore `setHidden(id, current.filter(p => p !== target))`: **no new inter-process operation, no new daemon method, and no schema change**. The story needs a surface to render the list, and one new icon token. Nothing else.

- **FR-040**: The **File & Folders pane** MUST carry an **options icon** that opens the active project's settings dialog. Per the constitution's themeable-icon-control rule it MUST be an icon — not a text label — resolved from the theme's icon set (the new token added by FR-015) and carrying a hover title naming the action.
- **FR-041**: The options icon MUST be **disabled when no project is active**, carrying a hover title saying why. The dialog MUST NOT be reachable without a project. (The original wording said "absent **or** disabled" — an either/or that no test could meaningfully assert. Disabled-with-a-reason is chosen over absent: a control that vanishes teaches the user nothing, while one that is visibly unavailable explains itself.)
- **FR-042**: The dialog MUST **name the project** it is editing, so the user can never be in doubt which project's settings are on screen.
- **FR-043**: The dialog MUST list the active project's **hidden paths**, and each MUST be **removable**. Removing one MUST make the path reappear in the explorer **without a restart**.
- **FR-043a**: **Every action control this feature introduces MUST be a themed icon with a hover title** — the per-row *remove* control on the hidden-paths list, the *clear* control on the icon-colour row, and any other affordance that performs an action. The constitution's themeable-icon rule is NON-NEGOTIABLE, and its only exception is a **dialog decision button** (confirm/cancel/delete), which a per-row remove affordance is **not**. Suitable tokens (`destroy`, `dismiss`) already ship. This requirement exists because the fifth analyze pass caught this feature — whose whole purpose includes repairing violations of this very rule — about to introduce two fresh ones.
- **FR-044**: The dialog MUST be themed entirely from theme tokens, and MUST use the single confirmation and notification models established by FR-048 — it MUST NOT introduce a further notice idiom. (The original wording, "a sixth idiom", was already moot: nine exist. See FR-048.)
- **FR-045**: The Preferences window's settings registry, its **completeness audit**, and feature 015's **reset/revert machinery** MUST be left **unchanged** by this story. No project-scoped key may be added to the user-settings registry, and no scope concept may be introduced into it.
- **FR-046**: If the active project changes, or the project being edited is deleted, while the dialog is open, the dialog MUST NOT continue editing a stale project and MUST NOT write to a project that no longer exists.
- **FR-047**: The global exclusion setting (user-scoped, in Preferences) and the project's hidden paths (project-scoped, in this dialog) are two independent filters applied at different stages today, with no combining rule. This feature MUST define the **effective set of exclusions** they produce together, rather than leaving it incidental. The dialog MUST make clear that the global exclusions also apply, so the hidden-paths list is never mistaken for the whole story.

  **The effective set is**: *(entries on disk) − (global glob matches) − (project hidden paths)*, with the **globs taking precedence** and being unaffected by un-hiding. The two filters run at different stages — globs when the directory is read, hidden paths when the tree is derived — and this ordering is what produces the trap below.

- **FR-047a**: A path that is **both** hidden **and** matched by a global exclusion glob MUST be shown as such in the dialog. Removing it from the hidden list will **not** make it reappear in the explorer, because the glob excludes it one stage earlier — and a remove button that visibly does nothing is a worse defect than the one this story fixes. (Phase 0 research; the source issue did not notice this interaction.)

### Shell — unified notices (#48)

> **Decision (2026-07-13)**: **two** models, not one. A confirmation is modal and blocking — the user is consenting to a consequence, and the constitution requires its buttons keep text labels because the label *is* the statement of that consequence. A notification is transient and non-blocking. Collapsing them, as issue #48 literally proposes, would put "delete this theme?" in the same auto-dismissing corner widget as "saved". The pain the issue describes is *many idioms for two jobs*; the fix is **one model per job**. The sweep is complete: the non-dismissable restore notice goes too — and so do the four further idioms the Phase 0 survey found (FR-048).

- **FR-048**: The application MUST converge on exactly **two** notice models — **one confirmation model** (modal, blocking, text-labelled decision buttons) and **one notification model** (transient, non-blocking, dismissable).

  **Phase 0 correction — there are NINE idioms today, not five.** Every idiom this specification originally named exists and was described accurately, but the survey found four more. Building only the five named surfaces would leave four behind and make **SC-009 false on the day it shipped**. The full set:

  | # | Idiom | Kind | In original spec? |
  |---|---|---|---|
  | 1 | Inline confirm strip (preferences) | confirmation | ✅ |
  | 2 | Inline notice strip (preferences) | notification | ✅ |
  | 3 | The promise-based modal confirmation | confirmation | ✅ |
  | 4 | The rival modal confirmation (themes surface) | confirmation | ✅ |
  | 5 | Four copy-pasted dismissable error strips (main window) | notification | ✅ |
  | 6 | **A fifth dismissable error strip** (themes surface) | notification | ❌ **missed** |
  | 7 | The non-dismissable restore notice | notification | ✅ |
  | 8 | **A modal message box** (editor notices — file changed / missing) | notification | ❌ **missed** |
  | 9 | **Three n-way decision modals** (application close, dirty close, unsaved open) | confirmation | ❌ **missed** |

- **FR-048a**: The three **n-way decision modals** (#9) MUST be migrated onto the single confirmation model. They are confirmations by every behavioural test — modal, blocking, and their text-labelled buttons state the consequence being consented to. They differ from the binary confirmation only in **arity**. The confirmation model MUST therefore accept an **ordered set of decision choices** (defaulting to accept/cancel) and an optional **details region**, so that one component serves the binary and n-way cases alike. A second component for "the same thing but with three buttons" is the exact duplication this story exists to remove.
- **FR-048b**: The notification model MUST carry a **severity**. A failure MUST persist until dismissed; a success or informational notice MUST dismiss itself after **5 seconds** (long enough to read, short enough not to linger — and a stated number, so a test can actually assert it rather than inventing its own). An error notice that silently auto-vanishes would be a worse defect than the nine idioms being replaced. This is one model with one property — not two models.
- **FR-049**: Every destructive-action confirmation in the application MUST go through the single confirmation model, whose decision buttons MUST retain **text labels** stating the consequence (constitution — the dialog-decision-button exception to the themeable-icon rule).
- **FR-050**: Every failure and success notice MUST go through the single notification model, which MUST be **themed from theme tokens** and **dismissable**.
- **FR-051**: The superseded surfaces MUST be **retired**, so exactly one model of each kind remains in the codebase. Of the nine idioms enumerated in FR-048, **eight are retired and one is promoted**: the promise-based modal confirmation (#3) *becomes* the confirmation model, extended with n-way choices — which is precisely what lets thirteen end-to-end suites keep passing untouched. The eight retired include the four the original specification missed: the **fifth error strip** on the themes surface, the **modal message box** used for editor notices, and the **three n-way decision modals**. They explicitly include the **restore notice**, non-dismissable and hard-coded today.
- **FR-051a**: The notification model MUST take its colours from the theme's **danger** token. Phase 0 research found that `--danger` is a **dead CSS variable** — it is never defined, so every `var(--danger, …)` in the codebase silently renders its literal fallback. Two of the four main-window error strips and the restore notice are hard-coded outright. The dead alias MUST be defined or removed; a notice that cannot be themed is outside the theming system (Principle X).

  **The repair MUST be driven by the discovering guard (FR-051b), not by a hand-written list.** Phase 0 first reported "4 references"; the analyze pass counted **13**, across a **third file** the first count never named. That is the whole thesis of this feature in miniature — a count made by hand is a count that is wrong — and repairing the four would have left nine silently rendering literals.

- **FR-051b**: A **source guard** MUST assert that every CSS custom property referenced anywhere in the renderer is actually defined. It MUST **discover** the references by walking the tree, not check a list. This is what makes the `--danger` class of defect impossible to reintroduce, and it is the guard that found the true count.
- **FR-052**: The distinction between **resetting to shipped defaults** and the **session "revert all" undo** MUST be preserved. They are different operations and MUST remain described differently.
- **FR-053**: The migration MUST **preserve the test identifiers** the broadest existing end-to-end suites depend on rather than renaming them; the confirmation-accept identifier alone is asserted by 13 suites.
- **FR-054**: The confirmation model MUST be available in **every** window — main, sub-workspace and preferences. It is not mounted in the preferences window today, which is precisely why the themes surface had to grow a second, rival confirmation dialog.

### Shell — OS file drop (#60)

> **Decision (2026-07-13)**: **read scope equals write scope**, and feature 006's rule stands. A sub-workspace-owned editor may open files from anywhere **except inside a loaded project**, and may neither open nor save into a project folder. This is Option A, and it also **closes an existing defect**: the load path never applied that rule at all, so a sub-workspace editor could already open a file it would silently refuse to save.

- **FR-055**: An **editor panel** MUST accept a file dropped from the operating system's file manager, and open it.
- **FR-056**: An **untyped panel** MUST accept a dropped file, become an editor panel, and open it — without the user first choosing a panel type.
- **FR-057**: A dropped path MUST be **resolved to its real location** (following symbolic links) **before** any ownership rule is applied. A link MUST NOT be usable to escape a project boundary.
- **FR-058**: A **project-owned** panel MUST accept only files resolving to a location **inside that project's folder**, and MUST reject anything else.
- **FR-059**: A **sub-workspace-owned** panel MUST accept files resolving to a location **outside every loaded project**, and MUST reject any file that resolves to a location inside one. This holds for **every open route that exists**: the operating-system drop, the explorer's open action, and the mount-time restore load. (Phase 0 correction: the original wording named "the panel-type form" as a route. It is not one — the editor panel type takes **no inputs** and can only create an empty document. There is no route by which that form opens a named file.)
- **FR-060**: The **load** path MUST be brought into line with the **save** path, so a file that cannot be **saved** by an editor can no longer be **opened** by it. This is a deliberate behaviour change to already-shipped code, and it removes a trap in which the rejection only surfaced at save time.

  **Phase 0 correction — the load path is half-shipped, not absent.** The original wording says the load path applies no rule and resolves no links. In fact:
  - It **already** refuses a cross-project load for a **project-owned** editor — but on the **raw, unresolved** path, and it skips the check entirely when the owning root is unknown.
  - It applies **no** rule at all to a **sub-workspace-owned** editor. That half is genuinely missing.
  - It resolves **no** symbolic links — correct as stated. And this hole runs **both ways**: a link *inside* a project that resolves *outside* it opens today and fails only at save.

- **FR-061**: A **rejected** drop MUST show a clear affordance explaining the rejection — including, for a sub-workspace panel, that the file belongs to a project. A silent no-op is prohibited.

  **This requires a new rejection reason code, not merely a new call site.** Phase 0 research found that a rejected load is today reported with the same generic reason as an I/O failure, which the renderer classifies as a *missing file* — and that notice is **suppressed** when the user has turned off missing-file warnings. **The silent no-op FR-061 prohibits therefore already exists on the load path**, and cannot be fixed at the user interface alone.

- **FR-061a**: The application MUST **prevent the browser engine's default file-drop behaviour** at the window level. Today nothing does: a file dropped anywhere in the application makes the renderer **navigate away to that file**, destroying the running workspace. This is a live defect found during Phase 0 research, and inviting the user to drag files onto the application makes it far more likely to be hit. It MUST be closed in this feature.
- **FR-062**: Drop handling MUST work in **sub-workspace windows** — separate windows, with their own renderer and **no explorer**, which makes a drop the only file-open affordance available there.
- **FR-063**: Drop handling MUST **coexist** with the two existing drag systems: panel drag-and-drop, and the explorer tree's window-level drag listeners, which currently rewrite the drag cursor for **every** drag over the window without checking whether it is an operating-system file drag.
- **FR-064**: A dropped file **already open** in another panel MUST focus the existing panel, honouring the one-buffer-per-file rule, rather than opening a second copy.
- **FR-065**: The behaviour for **multi-file** and **folder** drops MUST be defined. Default (see Assumptions): a multi-file drop opens each file; a folder drop is rejected.

### Cross-cutting

- **FR-066**: Every user-facing change in this feature MUST ship **end-to-end coverage** exercising it through the running application (constitution, Principle V). This explicitly includes the Key Bindings menu (FR-019), which has none today.
- **FR-066a**: The operating-system drop MUST be built around a **path-taking seam**: extracting a real filesystem path from a dropped file is a one-line adapter over a platform interface, and everything downstream of it MUST be a pure function of that path. This is not decoration — a file object synthesised inside the renderer is **not** an operating-system file, and the platform's path extractor returns **empty** for one. A test that fabricates a drop event therefore **cannot** exercise the real path extraction, and any test claiming otherwise would be asserting a fiction. The seam is what allows the open, reject, focus and sub-workspace behaviours to be verified honestly through the running application; the one-line adapter is the only part that end-to-end coverage cannot reach, and that limitation MUST be stated rather than papered over.
- **FR-067**: Project documentation (README, ROADMAP) MUST be brought current in the same change, per the documentation-currency rule.
- **FR-067a**: The **specifications this feature discharges or contradicts** MUST be reconciled in the same change: feature 015's deliberately relaxed "exactly one confirmation model" criterion, which Story 6 discharges; and feature 006's confinement rule, whose load path this feature repairs so that read scope and write scope now agree. A specification left describing behaviour the code no longer has is a specification that has stopped being true.

### Key Entities

- **Theme token** — a named, themeable value: a colour, a font property or an icon. Currently 33 colour tokens, 41 icon tokens and 9 typography roles. This feature adds **10 colour tokens** (four split surface roles, the menu-item hover, **`accentText`** — the foreground on the accent colour, hard-coded in two places today — three scrollbar tokens, and the optional **icon colour**) and **5 icon tokens** (**settings**, plus the four **window controls** that draw inline vectors today — FR-014b). The authoritative roster is [`contracts/theme-tokens.md`](./contracts/theme-tokens.md); prose counts defer to it.
- **Token copy** — the hand-written label and description for a token, shown in the Themes editor. Governed by rules banning abbreviations and machine-derived descriptions.
- **Bundled theme** — one of the 14 themes shipped with the application (plus the built-in default). Every one must carry a value for every token.
- **Field descriptor** — the declarative record describing how one configurable value is edited: key, label, group, control type, bounds, step. The registry of descriptors is what the completeness test audits. It remains **entirely user-scoped**.
- **Control kind** — the closed vocabulary of editor controls. This feature adds **slider**.
- **Project settings dialog** — **new**. The surface on which project-scoped values are edited, reached from an options icon on the File & Folders pane. Distinct from the Preferences window, which stays user-scoped. It holds the hidden-paths list, and is where future project-scoped settings belong.
- **Notice** — a confirmation, a failure or a success message. **Nine** idioms today (enumerated in FR-048), collapsing to **two models**: one modal confirmation (binary **and** n-way) and one transient notification (severity-bearing).
- **Hidden path** — a project-scoped, exact path the explorer omits from its tree. Append-only today; made removable by this feature.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can change any one of the split surface roles without altering the appearance of any other role — verified by changing the pane background and observing that menus, hovers, inputs and buttons are unchanged.
- **SC-002**: **Zero** surfaces in the application render in a colour that did not come from the active theme. Specifically: no menu, no scrollbar, no colour-picker popup and **no icon** draws from a hard-coded literal, an operating-system default, or an inline vector. This explicitly includes the surfaces the source issues did not mention and Phase 0 found: the pane chevrons, the **window controls**, and the Projects pane's "new project" control (FR-014a, FR-014b). This criterion is verified by a **source guard that discovers** inline artwork and undefined variables across the tree — not by a hand-written list of files, which is how these four were missed in the first place.

  **One stated exception**: `box-shadow`/`text-shadow` literals. A drop shadow is an occlusion effect rendered over whatever sits beneath it — black-at-low-alpha in every theme — not a surface taking a colour from the theme (see FR-014, charge (e), withdrawn on the record). The guard allow-lists them, with that reason written into the test rather than left as a silent gap.
- **SC-003**: Every bundled theme (the 14 shipped themes plus the built-in `throng` theme) carries every token, and the completeness, copy, contrast and distinctness guards all pass — with the distinctness constant **re-derived** rather than relaxed.
- **SC-004**: Switching between **every** bundled theme (the 14 shipped themes plus the built-in `throng` theme — see FR-003) leaves no surface visually stale: every menu, scrollbar and icon repaints. Verified by an end-to-end test that **iterates the whole theme set**, not a single sampled theme.
- **SC-005**: Every menu in **every window** — main, sub-workspace and preferences — flips to stay on-screen when opened within its own dimensions of a display edge. Opening any menu closes any other **in that window**, and a menu closes when its window loses focus (FR-017, FR-017a).
- **SC-006**: The colour picker is fully operable using only the keyboard, and every control in it shows a visible focus indicator.
- **SC-007**: A user can set by dragging **any numeric preference that declares the slider control** — and a discovering guard asserts the converse, that every numeric declaring both bounds *does* declare it, so the set cannot silently shrink. The value that reaches the settings file contains **no** grouping characters, verified by inspecting the file after a slider edit. (This criterion originally said "any **bounded** numeric preference", which contradicted FR-034's opt-in model and would have been false at merge for any bounded numeric left off the list.)
- **SC-008**: A user who hides a path can find it, and un-hide it, entirely through the user interface — via the File & Folders pane's options icon — with the path reappearing in the explorer without a restart. The Preferences window's settings registry, completeness audit and reset machinery are **unchanged**.
- **SC-009**: Exactly **two** notice models exist in the codebase — one modal confirmation and one transient notification. Of the nine idioms (FR-048), **eight are retired and one is promoted**: the promise-based modal confirmation *becomes* the confirmation model, extended with n-way choices. Everything else is gone — the restore notice, the modal message box, the three n-way decision modals, the rival dialog, the strips — and the existing end-to-end suites still pass on their **existing** identifiers.

  ("All nine are gone" was the original wording and is arithmetically false by the design's own construction: one of the nine is the survivor. The distinction matters, because it is *why* thirteen end-to-end suites keep passing untouched.)
- **SC-010**: A file dragged from the operating system's file manager opens in an editor panel — in both the main window and a sub-workspace window — and a file violating the ownership rule is visibly rejected rather than silently ignored.
- **SC-011**: A symbolically-linked path cannot be used to open a file the ownership rule would otherwise forbid.
- **SC-012**: No editor can **open** a file it would refuse to **save**. Read scope and write scope agree, in every window and by every open route.
- **SC-013**: Lint and type-check pass with zero errors and the full test suite is green.

---

## Resolved Decisions

> Three decisions materially changed scope and could not be resolved from the code or from a sensible default. All three were settled on **2026-07-13** and are now written into the requirements above. They are recorded here with the reasoning, because each one contradicts something a source issue asked for.

### Decision 1 — Sub-workspace open scope: keep feature 006's rule, and apply it on load too (FR-058 – FR-060)

Issue #60 asked for "any file, from anywhere on the OS filesystem" on a sub-workspace panel. Feature 006's shipped confinement says the opposite for saving: a sub-workspace-owned editor may only save **outside every loaded project**.

**Resolved**: a sub-workspace-owned editor may **open files from anywhere except inside a project**, and may **neither open nor save into a project folder**. Read scope equals write scope.

This rejects the issue's literal wording in favour of the rule that already ships — but it also **fixes a live defect that neither the issue nor feature 006 noticed**. The load path never applied the outside-all-projects rule *at all*, and never resolved symbolic links. So today a sub-workspace editor can already open a file it will refuse to save, and the user only discovers this at Ctrl+S, with no warning. Aligning load with save closes that trap rather than designing around it. This is a deliberate behaviour change to shipped code, and FR-060 records it as such.

### Decision 2 — Project settings get their own dialog; Preferences stays user-scoped (FR-040 – FR-047)

Issue #58 asked for the hidden-paths list to appear in the Settings editor, "beneath the global `explorer.excludeGlobs`", and correctly observed that this would introduce the editor's first project-scoped row.

**Resolved**: it will **not** go in the Preferences window. Project-scoped values get a **separate project settings dialog**, opened from an **options icon on the File & Folders pane**.

The issue's own framing is what argues against it: it noted that surfacing a SQLite-backed, project-scoped value in a user-scoped editor means "deciding, for the first time, how project scope is presented, how it cascades, and what *reset to default* even means for it" — and called that "a design question worth its own spec". The survey confirmed how deep that goes: the completeness audit **requires** every descriptor's key to be a leaf of the user settings document, and the shipped-defaults record — which is what "reset" reads from — contains **no project data at all**, so the row's reset button could never do anything.

Putting the value where it belongs dissolves all of it. Hidden paths are project data, like the project's name, colour and root folder. The settings registry, its audit and feature 015's reset machinery are all left untouched, and the new dialog becomes the natural home for every future project-scoped setting.

**Consequence**: the options icon needs a **settings icon token**, which the theme does not have. Neither does the cog menu — which is *why* it draws a hard-coded inline vector, the very defect #56 exists to fix. One new token now serves both (FR-015).

### Decision 3 — Two notice models, not one, and sweep the fifth idiom (FR-048 – FR-054)

Issue #48 proposed "a single toast/notification system" covering destructive-action confirmations, failure notices **and** success notices.

**Resolved**: **two** models — one modal confirmation, one transient notification — and the non-dismissable restore notice is migrated too, so nothing is left behind.

A confirmation is modal and blocking: the user is consenting to a consequence, and the constitution explicitly requires its decision buttons keep **text labels**, because the label *is* the statement of the consequence. A toast is transient and non-blocking. Collapsing them would put "delete this theme?" in the same auto-dismissing corner widget as "saved", where it can be missed or dismissed without a decision. The pain the issue actually describes is **many idioms doing two jobs** — the Phase 0 survey counted **nine**, not the five this specification first assumed — and the fix is **one model per job**, not one model for both.

## Assumptions

Where the source issues left a detail open and a sensible default exists, this specification takes it rather than asking:

- **The surface split has four roles** (pane, menu, input, hover/active). The audit may find a fifth; it will not find fewer. The role *boundaries*, not the exact count, are what FR-001 fixes.
- **Old themes keep their appearance.** A pre-split theme's new tokens fall back to the value of the old overloaded token, so nothing changes visually for a user until they choose to differentiate the roles.
- **The icon colour defaults to unset**, meaning inherit. This is what makes FR-029 true: no bundled theme changes appearance when the token is introduced.
- **A multi-file drop opens each file; a folder drop is rejected.** Opening every file in a folder is an unbounded operation with no obvious ceiling, and a folder is not a document.
- **The rejection affordance is a drop-cursor/overlay state on the panel**, reinforced by the notification model from Story 6 — which is precisely why Story 6 precedes Story 9.
- **The unbounded numeric setting** (maximum openable file size) **stays typed-only, with no invented upper bound** — see FR-034. An earlier draft of this assumption said the opposite (give it a ceiling so it can take a slider); the audit found no defensible bound, only one manufactured to justify the control, and a slider spanning kilobytes to gigabytes would be a worse control than the text box it replaced. It gains **digit grouping** instead, which is what actually made `10485760` unreadable.
- **Digit grouping follows the user's locale for display**, and the stored value is always a plain number (FR-038), so locale never affects what is persisted.
- **The terminal's native right-click menu stays native.** It is a deliberate, documented choice providing Copy/Paste, and unifying it is a different problem from unifying throng's own menus.
- **The project settings dialog ships with one setting** — the hidden-paths list. It is a *surface*, not a migration: no existing project field (name, colour, root folder) moves into it in this feature.

---

## Dependencies & Coordination

- **This feature stands alone.** It depends on nothing that is currently unmerged, and no requirement in it waits on another feature's landing. That is a deliberate constraint, not a happy accident: the two places where a cross-feature obligation would otherwise have crept in are both pushed out to their own tracked issues — the control-vocabulary declaration ([#79](https://github.com/Bidthedog/throng/issues/79)) and the terminal flavour settings, which need a control this feature does not build.
- **Feature 015's relaxed criterion.** 015 deliberately reused the existing inline confirm strip and relaxed its own "exactly one confirmation model" success criterion pending #48. Story 6 discharges that deferral, and 015's spec should be reconciled when it does.
- **Feature 017 unblocked #55.** 017 closed #54, routing icon rendering through the pack-aware resolver so the artwork genuinely inherits its colour. Without it, an icon-colour token would have had nothing to drive.
- **Feature 009's guards are load-bearing.** The distinctness and contrast tests react to new colour tokens. Re-deriving the distinctness constant is a **required task** of Story 1, not a test failure to be worked around.
- **Feature 006's confinement rule is upheld, and its load path is repaired.** Decision 1 keeps 006's rule and extends it to the open side, which is a **behaviour change to shipped code**: a sub-workspace editor that could previously open an in-project file no longer can. 006's spec should be reconciled to record that read scope and write scope now agree.
- **The project settings dialog is the home for future project-scoped configuration.** Any later feature that wants a project layer cascading over a user-scoped setting belongs on **this dialog**, not in the Preferences window, and should adopt this surface rather than reopening the question of scope inside the settings registry.
- **Feature 015's reset machinery is untouched.** Decision 2 is what keeps it that way. Had the hidden-paths row gone into Preferences, the shipped-defaults record would have had to grow a project scope — reshaping machinery 015 only just landed.

---

## Out of Scope

- **Reconciling feature 007's control-vocabulary declaration** — tracked by **[#79](https://github.com/Bidthedog/throng/issues/79)**. This feature adds a slider (FR-032); it does not rewrite the sentence in 007 that calls the vocabulary exhaustive, because more than one in-flight feature extends it and the correct final wording depends on the order they land in. Owning that here would make this spec's correctness contingent on another feature's schedule.
- **#75 — The end-to-end flake tail and suite speed.** Handled on its own branch.
- **The v1.0.0 epics** — WSL (#13), the project diff tool (#15), AI coding agents (#17), packaging (#21). Each is its own feature, 019 onwards.
- **The terminal's native context menu.** A deliberate platform choice, not a theming defect.
- **The app-wide keyboard accessibility pass (#26)** and **theme accessibility conformance (#61)**. This feature makes the *new* colour picker keyboard-operable (FR-024), because shipping a new control without that would be a new violation; it does not attempt the app-wide sweep.
- **Explorer-tree OS file operations (#8)** — drag-and-drop and copy/paste on the tree as a native folder view. Story 9 concerns the **editor/untyped panel** as a drop target. The two should share the underlying drop plumbing when #8 lands.
