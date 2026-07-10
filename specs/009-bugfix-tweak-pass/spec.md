# Feature Specification: Bugfix & Tweak Pass

**Feature Branch**: `009-bugfix-tweak-pass`

**Created**: 2026-07-10

**Status**: ARCHIVED — superseded by features 010 to 014. Never planned, never implemented.

> **This specification is a record, not a work item.**
>
> It captures 14 user stories, 98 functional requirements and 22 clarification decisions gathered
> across one specify pass and two clarify passes. It proved too large to plan or implement as a
> single feature, and was split by code surface into five standalone specifications:
>
> | Feature | Covers | Depends on |
> |---|---|---|
> | `010-terminal-session-integrity` | User Stories 1, 2 | — |
> | `011-theme-content` | User Stories 6, 7, 8 | — |
> | `012-focus-contexts-and-search` | User Stories 3, 14; panel zoom | 010 |
> | `013-shipped-defaults-and-theme-editor` | User Story 5; icon packs; FR-030c | 011 |
> | `014-preferences-and-main-window` | User Stories 4, 9, 10, 11, 12, 13 | 012, 013 |
>
> Each of those five is self-contained: it restates every decision it depends on, and is clarified
> and executed independently. None of them references this document. Read this one only to understand
> **why** a decision was made; read the five to understand **what** is being built.
>
> The constitution amendment originally recorded here as FR-037 was landed separately, as
> constitution v3.12.0 ("Action controls MUST be themeable icons with hover titles"), because it
> gates the Constitution Check of all five successor features.

**Input**: User description: a 24-item bugfix / tweak pass spanning the preferences window, the theme editor, the default theme palettes, main-window terminology and affordances, settings widgets, terminal flavour configuration, and terminal session synchronisation across sub-workspaces. Each item is to be attacked one at a time using test-first development: write a test that reproduces the behaviour, fix, re-test.

---

## Clarifications

### Session 2026-07-10

- Q: When one terminal session is mirrored into a sub-workspace window at a different pixel size, how should the underlying terminal grid be sized? → A: **Smallest common size.** The grid is the minimum columns × rows across all attached views. Every view can render the full grid; larger views show empty padding. No oscillation, no corrupted view.
- Q: When a terminal or editor has keyboard focus, which global bindings still fire? → A: **None.** Focus-scoped bindings shadow global chords entirely. Global bindings resume only after the user releases focus (see the focus-release decision below).
- Q: Which actions are terminal-scoped? → A: **Zoom** (in/out/reset, including modifier+wheel), **clipboard** (copy/paste/select-all), and **scrollback** (line/page scroll, clear, find).
- Q: Which actions are editor-scoped? → A: **Zoom** (in/out/reset, including modifier+wheel), the **existing save family** (save, save all, save as) re-scoped from the coarse pane to the focused editor, and **find/replace/go-to-line**.
- Q: How is focus gained and released? → A: **Clicking a panel body focuses it.** Focus is released by a rebindable `panel.releaseFocus` action defaulting to `F6`, or by clicking a panel header, a tab, a project entry, or the files-and-folders pane. **Escape does NOT release focus** — it is always delivered to the running program, because Escape is a valid and frequently-used key in terminal-hosted applications such as `vim`, `less`, and interactive agents. (This supersedes an earlier decision in this session that made Escape the release key.)
- Q: Should the theme editor keep an in-place rename? → A: **No.** "Save As" replaces "Rename". It copies the current theme to a new name and activates the copy, leaving the original untouched.
- Q: Does the theme editor keep its auto-apply model, or gain an explicit save with a dirty state? → A: **Keep auto-apply.** Edits persist and apply immediately; there is no Save control and no unsaved state. "Save As" branches the current, already-persisted theme.
- Q: What else does the theme toolbar need? → A: Exactly four theme-level actions: **Restore All Themes to Default** (resets every built-in theme to its shipped values and recreates built-in themes the user has deleted; enabled only while a built-in theme is active; presently broken and must be made to work), **Revert Theme** (undoes the current theme's changes made during this preferences-window session; available for built-in and custom themes alike), **Delete** (removes the theme from the user's configuration entirely), and **Save As**.
- Q: How do theme-level actions relate to the existing preferences-level reset and revert? → A: They are **nested one level below**. "Preferences" spans settings, key bindings and themes; the preferences-level controls act across all three, while the theme-level controls act only within the theme editor. The interface must make that hierarchy evident.
- Q: Where do shipped defaults come from? → A: From **immutable artifacts distributed with the application build**, covering themes, settings and key bindings alike. They are the authoritative source for every restore-to-default operation, including recreating deleted built-in themes.
- Q: Are the preferences tabs, section headers and the cog menu themed? → A: **No, and they must be.** They ignore the application's font settings and typography roles.
- Q: What do the font controls need? → A: A **clear-all control** at the trailing edge of each font selection box that empties it, and **notched sliders in 1-point increments** for font sizes, paired with the existing text box.
- Q: What do the key-binding rows need? → A: A **clear-all control** mirroring the font box, and a **reset-to-default control on each individual binding** that restores only that binding.
- Q: Are the bundled icon packs correctly named? → A: **No.** The `throng-svg` pack must be renamed `throng-svg-black`, and a white variant must ship alongside it.
- Q: What does "clear all" mean on a key-binding row? → A: **Per-row.** Each row gets a clear control that removes every chord assigned to that action, leaving it unbound, alongside a reset control that restores only that action's shipped defaults. There is no page-level clear-all; the preferences-level reset already covers starting over.
- Q: Can one action hold more than one chord? → A: **Yes — this is already implemented.** An action holds an ordered list of binding tokens, and a token may be a keyboard chord or a named mouse gesture (for example `Ctrl+=`, `Ctrl++`, `Ctrl+WheelUp`). Mouse-wheel zoom therefore needs no special handling; it is an ordinary bindable token.
- Q: What exactly does the unsaved dot's "flash" mean, and how does it behave under reduced motion? → A: **A slow opacity pulse, never a blink.** The dot cycles between fully and partially opaque — never invisible — on a roughly 1.5-second cycle, synchronised across the projects list, the tab and the panel header. When the operating system requests reduced motion, the dot renders static at full opacity. It never disappears, because an invisible dot reads as "no unsaved changes".
- Q: Where does per-panel zoom live, and how long does it last? → A: **On the panel.** Zoom is stored with the panel in the layout, persists across restarts, and is shared by every view of that panel. It is a property of the panel, not of the terminal or editor inside it: destroying a terminal and starting a new terminal or editor in the same panel reuses the panel's existing zoom.
- Q: Which panel error surfaces gain a dismiss control? → A: **All of them** — the projects sidebar, the sub-workspaces sidebar, the file tree, and the terminal-exit notice. Two further defects were identified in the terminal panel while deciding this: the exit notice does not clear until the panel loses focus, and the "Clear" control is wired to the error state when it should only clear the form. Dismissing an error MUST take effect immediately, and "Clear" MUST be independent of the error.
- Q: What are the canonical removal verbs, and what does each mean? → A: **Four verbs, each tied to a distinct consequence.** *Close* dismisses a view while the underlying thing survives. *Destroy* irreversibly removes a thing and the things it owns. *Remove* unregisters a project from Throng, leaving files on disk untouched. *Delete* destroys something persisted on disk (a theme, a file). The sub-workspace case is spelled out as an explicit matrix (FR-059a) because the same control has different consequences depending on whether the target is project-owned or sub-workspace-owned.
- Q: FR-016 and FR-017 name find, replace and go-to-line actions, but no such surface exists in either the terminal or the editor. Are those widgets built in this pass? → A: **Yes, build them.** The terminal gains a find surface with match navigation and highlighting; the editor gains find, replace and go-to-line. They are specified as User Story 14 rather than left implicit in the binding lists.
- Q: How widely do the automated theme-quality assertions apply? → A: **Distinctness enforced, contrast reported.** Pairwise perceptual distinctness is a hard failure across all bundled themes. Contrast is measured and reported for all of them, but only Bash, SUBNET and Cyberpunk — the themes in scope for this pass — must pass it. Contrast failures in the other bundled themes are recorded as known issues for a later pass, and MUST NOT block this one.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Terminal sessions survive being moved into a sub-workspace (Priority: P1)

A developer has a long-running interactive program (for example an AI coding assistant) inside a terminal panel. They drag the tab containing that panel into a new sub-workspace window. Today the program is killed, the sub-workspace shows a connection-timeout error, and the original terminal drops back to a bare command prompt. The developer expects the program to keep running, uninterrupted, and to be visible and usable in both windows.

**Why this priority**: This is data loss. A running agent session, a build, or an SSH connection is destroyed with no warning and no recovery. It is the only item in this pass that loses user work.

**Independent Test**: Start a long-lived process in a terminal panel owned by a project. Drag its tab into a new sub-workspace. Assert the process is still alive, its output continues to stream to both views, and no connection error is raised in either window.

**Acceptance Scenarios**:

1. **Given** a terminal panel owned by a project with a running foreground program, **When** the user drags its tab into a new sub-workspace, **Then** the program keeps running, the same session is presented in both windows, and neither window reports a connection error.
2. **Given** a sub-workspace window that is still loading its project list, **When** a terminal panel mounts, **Then** the panel does not connect a session until the ownership of the panel is known, so that it never connects with the wrong working directory.
3. **Given** a terminal panel already connected under one identity, **When** any view requests a connection for that same panel, **Then** the existing session is reused and the running program is never terminated to make room for a replacement.
4. **Given** a terminal whose program takes longer to start than a routine health check, **When** the user opens it, **Then** the connection request is allowed the time it needs and does not fail with a timeout.
5. **Given** a session that has been reconnected after a window move, **When** the user inspects the terminal, **Then** the prior output history is present and the cursor is where the running program left it.

---

### User Story 2 - Terminals render correctly when mirrored at two different sizes (Priority: P1)

A developer views the same terminal panel in the main window and in a sub-workspace window, where the two panels have different pixel dimensions. Today one of the two displays becomes garbled because both views resize a single shared terminal grid, and the last one to resize wins.

**Why this priority**: The display is actively wrong, and the corruption is permanent until the user manually forces a repaint. It makes sub-workspaces unusable for terminals, which is their main purpose.

**Independent Test**: Attach the same terminal session to two views of deliberately different sizes. Assert both render legibly, that the grid equals the smaller view's dimensions, and that neither view oscillates when the other is resized or focused.

**Acceptance Scenarios**:

1. **Given** one terminal session attached to two views of different sizes, **When** both views have finished measuring themselves, **Then** the terminal grid equals the smallest columns and the smallest rows across all attached views.
2. **Given** the smallest attached view, **When** it is enlarged so it is no longer the smallest, **Then** the grid grows to the new smallest view's dimensions exactly once, with no intermediate flicker between the two sizes.
3. **Given** two attached views, **When** the smaller one is closed, **Then** the grid grows to fit the remaining view.
4. **Given** a view larger than the grid, **When** it renders, **Then** the unused area is presented as inert padding using the terminal's own background colour, and no text is clipped or duplicated.
5. **Given** two views repeatedly gaining and losing focus, **When** neither is resized, **Then** no resize is transmitted to the session at all.

---

### User Story 3 - Keyboard focus scopes which bindings fire (Priority: P1)

A developer types inside a terminal running a text editor or an interactive agent. Today, application-wide shortcuts fire out from under them: the pane toggles collide with the terminal multiplexer prefix and readline history, and zoom resizes the whole application instead of the terminal. They expect a focused terminal or editor to own its keystrokes, with its own set of bindings, and expect application bindings to return the moment they leave.

**Why this priority**: It makes terminals unreliable for their primary use. Every terminal-hosted tool fights the application for the same chords.

**Independent Test**: Focus a terminal, press each global chord, and assert no global action fires and the keystroke reaches the running program. Press `F6` and assert every global chord fires again.

**Acceptance Scenarios**:

1. **Given** a terminal panel with keyboard focus, **When** the user presses any application-wide chord, **Then** no application-wide action runs and the keystroke is delivered to the running program.
2. **Given** a terminal panel with keyboard focus, **When** the user presses a zoom chord or uses the modifier-and-wheel gesture, **Then** only that terminal's text size changes and the application zoom is unaffected.
3. **Given** an editor panel with keyboard focus, **When** the user presses a zoom chord or uses the modifier-and-wheel gesture, **Then** only that editor's text size changes.
4. **Given** a focused terminal or editor, **When** the user invokes `panel.releaseFocus` (by default `F6`), **Then** focus is released to the containing panel and application-wide bindings fire again.
5. **Given** a focused terminal running a program that uses Escape, **When** the user presses Escape, **Then** the escape character reaches that program, focus is retained, and no application action fires.
6. **Given** a panel that is merely selected but whose body is not focused, **When** the user presses an application-wide chord, **Then** the application-wide action runs normally.
6a. **Given** a zoomed terminal panel, **When** the application is restarted, **Then** the panel reopens at its stored zoom.
6b. **Given** a zoomed panel hosting a terminal, **When** that terminal is destroyed and an editor is created in the same panel, **Then** the editor renders at the panel's existing zoom.
6c. **Given** a zoomed terminal panel mirrored into a sub-workspace, **When** both views are inspected, **Then** both render at the same text size.
7. **Given** a focused terminal or editor, **When** the user clicks a panel header, a tab, a project entry, or the files-and-folders pane, **Then** focus is released and application-wide bindings fire again.
8. **Given** the key-binding editor, **When** the user lists bindings, **Then** each binding declares the context it applies in — application, terminal, editor, or files-and-folders — and the same chord may be bound once per context without being reported as a conflict.

---

### User Story 4 - The preferences window behaves like a dialog (Priority: P2)

A user opens the preferences window, changes a setting, and presses Escape expecting the window to close, as it does everywhere else in the operating system. Today nothing happens. They also expect Escape inside a text field, a dialog, or the key-capture prompt to dismiss that inner thing first, not the window.

**Why this priority**: Escape-to-close is a universal expectation, and its absence makes the window feel broken. It is self-contained and low-risk.

**Independent Test**: Open preferences, press Escape, assert the window closes and edits are retained. Repeat with focus in a search box, an open dialog, and the key-capture prompt, asserting each time that only the inner element is dismissed.

**Acceptance Scenarios**:

1. **Given** the preferences window with no text field focused and no dialog open, **When** the user presses Escape, **Then** the window closes and all changes made in the session are retained.
2. **Given** focus in any text input — search box, setting value, dialog name field — **When** the user presses Escape, **Then** the input is reverted or blurred, the window stays open, and a second Escape closes the window.
3. **Given** an open dialog, **When** the user presses Escape, **Then** the dialog is cancelled with no side effect and the window stays open.
4. **Given** the key-capture prompt, **When** the user presses Escape with no modifier, **Then** the capture is cancelled and nothing is bound.
5. **Given** the key-capture prompt, **When** the user attempts to bind Escape by itself, **Then** the binding is rejected, because Escape is reserved for cancelling here and for passing through to a focused panel's content elsewhere.

---

### User Story 5 - The theme editor is safe, discoverable, and themed (Priority: P2)

A user managing themes wants destructive actions to ask first, wants to branch a theme under a new name rather than rename it in place, wants to abandon an experiment without losing the theme, and expects the editor's own controls — and the preferences chrome around them — to be drawn with the theme and fonts they are configuring.

**Why this priority**: Theme deletion is one-click destructive, restoring defaults does not work at all, and there is no way to undo an experiment. The editor also fails the project's own configuration-completeness standard by hardcoding its icons and by ignoring the font settings in its own chrome.

**Independent Test**: Exercise delete, restore-all-to-default, revert, and save-as from the theme editor, asserting each destructive action raises a modal dialog with an explicit confirm and cancel, that cancel makes no change, that revert restores the session's opening values, and that every control in the toolbar is an icon whose colour derives from the active theme and which exposes a hover title.

**Acceptance Scenarios**:

1. **Given** any theme, **When** the user activates "Delete", **Then** a modal dialog names the theme and requires explicit confirmation; cancelling leaves the theme untouched; confirming removes it from the user's configuration entirely.
2. **Given** a built-in theme is active, **When** the user activates "Restore All Themes to Default" and confirms, **Then** every built-in theme is reset to its shipped values, every built-in theme the user had deleted reappears, and custom themes are untouched.
3. **Given** a custom theme is active, **When** the toolbar is rendered, **Then** "Restore All Themes to Default" is disabled and its hover title explains why.
4. **Given** a theme — built-in or custom — edited during this preferences-window session, **When** the user activates "Revert Theme", **Then** that theme returns to the values it held when the window was opened, and no other theme is affected.
5. **Given** any theme, **When** the user activates "Save As" and supplies a name, **Then** a new theme carrying the current theme's values is created under that name and activated, and the original theme is left exactly as it was.
6. **Given** the "Save As" dialog, **When** the user supplies a name that is empty, already in use, or reserved by a built-in theme, **Then** the save is refused with an explanation and the dialog stays open.
7. **Given** the "Save As" dialog, **When** the user cancels, **Then** no theme is created and the editor returns to its prior state.
8. **Given** the theme editor and the preferences-level reset and revert controls, **When** both are visible, **Then** the interface conveys that the theme-level actions affect only themes while the preferences-level ones span settings, key bindings and themes.
9. **Given** any theme editor toolbar control, **When** it is rendered, **Then** it presents an icon drawn from the theme's icon set, takes its colours from the theme's tokens, and exposes a hover title naming its action.
10. **Given** the theme editor toolbar, **When** it is rendered at any window width, **Then** its controls share a common baseline and none overflows or wraps out of alignment with its label.
11. **Given** a font selection box with several fonts chosen, **When** the user activates its clear-all control, **Then** every font is removed from that box in one action.
12. **Given** any font-size control, **When** it is displayed, **Then** it presents a notched slider in 1-point increments alongside its text box.
13. **Given** the preferences tab labels, the section headers, and the cog menu's drop-down text, **When** the application's font settings change, **Then** all of them follow those settings.
14. **Given** the bundled icon packs, **When** they are listed, **Then** `throng-svg-black` and `throng-svg-white` are both offered, and a theme still naming the former `throng-svg` resolves to the black variant.

---

### User Story 6 - Default themes are visually distinct and on-brand (Priority: P2)

A user browsing the bundled themes finds Bash and Matrix nearly indistinguishable — both are mono-hue green on black. They also expect the SUBNET theme to match the SUBNET brand palette and the Cyberpunk theme to match its reference palette.

**Why this priority**: Bundled themes are the product's first impression, and two of them are placeholders while a third is a near-duplicate.

**Independent Test**: Render each bundled theme and assert Bash uses at least five distinct hues, that no two bundled themes are perceptually near-identical, and that SUBNET and Cyberpunk draw their colours from their reference palettes.

**Acceptance Scenarios**:

1. **Given** the Bash theme, **When** it is applied, **Then** its accent colours span green, magenta, yellow, teal and cyan, echoing a default Git Bash prompt, and it is clearly distinguishable from Matrix.
2. **Given** any pair of bundled themes, **When** their colour sets are compared, **Then** they differ by more than a defined perceptual-distance threshold.
3. **Given** the SUBNET theme, **When** it is applied, **Then** every colour token resolves to a colour from the SUBNET brand palette, with the deep background as the base surface and the neon green and neon cyan reserved for accents and active states.
4. **Given** the Cyberpunk theme, **When** it is applied, **Then** its colour tokens are drawn from its reference palette (near-black base, crimson and deep maroon, bright yellow, and pale teal).
5. **Given** the Bash, SUBNET and Cyberpunk themes, **When** they are applied, **Then** all foreground-on-background pairings meet the project's minimum contrast standard.
6. **Given** any other bundled theme, **When** its contrast is measured, **Then** any shortfall is reported as a known issue without failing the build.

---

### User Story 7 - Theme tokens explain themselves (Priority: P2)

A user editing theme colours sees labels like "App bg" and "Terminal fg" with the description "The 'App bg' colour token." They cannot tell what any token actually affects, so they change colours by trial and error.

**Why this priority**: The theme editor is unusable without this; every other theme improvement in this pass is undermined by it.

**Independent Test**: Read every theme token descriptor and assert that no label or description contains an abbreviation, and that each description names at least one concrete surface or element the token paints.

**Acceptance Scenarios**:

1. **Given** any theme token, **When** its label is displayed, **Then** the label spells words in full — "Background", "Foreground" — and contains no abbreviation.
2. **Given** any theme token, **When** its description is displayed, **Then** the description names the specific surfaces or elements that the token paints, rather than restating the token's own name.
3. **Given** the complete token set, **When** the descriptors are audited, **Then** every token has a hand-written description and none is machine-generated from its identifier.

---

### User Story 8 - The editor gutter is themeable (Priority: P2)

A user themes the application and finds the editor's line-number gutter takes its colours from unrelated tokens, so it cannot be styled independently of the editor body.

**Why this priority**: A visible gap in theme coverage; the project's own standard requires every visual token to be exposed in the editor.

**Independent Test**: Add gutter background and gutter foreground tokens, change each in the theme editor, and assert only the gutter changes.

**Acceptance Scenarios**:

1. **Given** the theme editor, **When** the user browses colour tokens, **Then** distinct tokens exist for the editor gutter background and the editor gutter foreground.
2. **Given** a change to the gutter background token, **When** it is applied, **Then** only the gutter background changes and the editor body background is unaffected.
3. **Given** every bundled theme, **When** it is applied, **Then** it supplies values for both gutter tokens.

---

### User Story 9 - Settings are quicker to read and to set (Priority: P3)

A user adjusting numeric settings must type exact pixel and millisecond values into bare text boxes, and reads large numbers with no digit grouping. They want a notched slider for coarse adjustment while retaining exact typed entry, and grouped digits for legibility.

**Why this priority**: Ergonomics on a working feature. Valuable, but nothing is broken.

**Independent Test**: Drag each slider and assert values snap to the defined increment; type an exact value and assert the slider follows; assert large numbers display with digit grouping and that grouped text parses back correctly.

**Acceptance Scenarios**:

1. **Given** the projects pane maximum width, the file explorer pane maximum width, the tab hover-activate delay, the submenu hover-activate delay, and the auto-save delay, **When** each is displayed, **Then** it presents a notched slider alongside a text box.
2. **Given** any of those sliders, **When** it is dragged, **Then** the value snaps to that setting's declared increment and stays within its declared minimum and maximum.
3. **Given** any of those settings, **When** the user types an exact value into the text box, **Then** the value is accepted verbatim and the slider moves to match it.
4. **Given** any numeric setting whose value has four or more digits, **When** it is displayed, **Then** the digits are grouped using the user's locale separator.
5. **Given** a grouped numeric value, **When** the user edits it, **Then** the grouping does not interfere with typing and the value is parsed correctly on commit.

---

### User Story 10 - Terminal flavours are configurable without hand-writing structured text (Priority: P3)

A user wants to add a custom terminal flavour and to hide built-in ones. Today the custom-flavour setting is a raw structured-text box with no field prompts, and hiding a built-in flavour requires typing its internal identifier exactly, with no list to choose from and no validation.

**Why this priority**: The capability exists and works; only its configuration surface is unusable, which makes users believe the feature is unimplemented.

**Independent Test**: Add a custom flavour through a structured form, assert it appears in the terminal type list and launches its executable. Hide a built-in flavour by choosing it from a list, assert it disappears from the terminal type list.

**Acceptance Scenarios**:

1. **Given** the custom terminal flavours setting, **When** the user adds an entry, **Then** they are presented with named fields for identifier, display label, executable, arguments, and default startup parameters, each individually validated.
2. **Given** a saved custom flavour, **When** the user creates a terminal panel, **Then** the flavour appears in the type list and selecting it launches the executable it names.
3. **Given** the hidden built-in flavours setting, **When** the user adds an entry, **Then** they choose from a list of the built-in flavours detected on this machine rather than typing an identifier.
4. **Given** a hidden built-in flavour, **When** the user creates a terminal panel, **Then** that flavour is absent from the type list.
5. **Given** a hidden built-in flavour that is no longer detected on this machine, **When** the setting is displayed, **Then** the stale entry is shown as unrecognised and can be removed, rather than being silently dropped or blocking the list.

---

### User Story 11 - Main-window affordances are consistent and informative (Priority: P3)

A user is warned that a file changed on disk but is not told which file. A panel error stays on screen with no way to dismiss it. The unsaved-changes dot is easy to miss. The words used for removing panels, tabs and sub-workspaces vary between "Destroy", "Delete" and "Close" with no discernible rule.

**Why this priority**: A cluster of small, independent papercuts across the main window. Each is low risk and individually shippable.

**Independent Test**: Trigger each affordance and assert: the file-changed warning names the tab, the panel and the full path; the panel error bar carries a dismiss control that removes it; the unsaved dot animates in all three locations; and the removal verbs follow the ownership rule.

**Acceptance Scenarios**:

1. **Given** a file changed on disk beneath an editor with unsaved edits, **When** the warning is shown, **Then** it names the containing tab, the panel, and the file's full path.
2. **Given** any panel or pane showing an error — projects sidebar, sub-workspaces sidebar, file tree, or a terminal-exit notice — **When** the user activates the dismiss control at the trailing edge of the error bar, **Then** the error is removed immediately, without waiting for focus loss or a re-render, and the panel continues to function.
2a. **Given** a terminal panel showing an exit notice with values typed into its panel-type form, **When** the user activates "Clear", **Then** the form's fields are cleared and the exit notice remains visible.
2b. **Given** the same panel, **When** the user dismisses the exit notice, **Then** the notice disappears, any typed form values remain, and the panel-type form is still usable.
3. **Given** an editor with unsaved changes, **When** its indicator dot is displayed in the projects list, on its tab, and on its panel header, **Then** the dot pulses continuously and in step across all three places, never becoming invisible, and stops the moment the changes are saved.
3a. **Given** the operating system requests reduced motion, **When** an unsaved indicator is displayed, **Then** it renders static at full opacity rather than pulsing.
4. **Given** a panel that belongs to a project, **When** it is viewed inside a sub-workspace, **Then** the removal action is worded "Close", and invoking it leaves the panel intact in its project with its terminal session still running.
5. **Given** a panel that belongs to the sub-workspace itself, **When** it is viewed inside that sub-workspace, **Then** the removal action is worded "Destroy", and invoking it terminates its terminal session.
6. **Given** a project in the projects list, **When** its removal action and confirmation dialog are read, **Then** the verb is "Remove" and the dialog states explicitly that no files are deleted.
7. **Given** a tab in a sub-workspace containing both project-owned and sub-workspace-owned panels, **When** the tab is destroyed, **Then** the sub-workspace-owned panels are destroyed and the project-owned panels are only closed, surviving in their projects.
8. **Given** any panel, tab, project, sub-workspace, theme or file, **When** its removal control, tooltip, context-menu entry and confirmation dialog are read together, **Then** all four use the same verb, and that verb is one of Close, Destroy, Remove or Delete.

---

### User Story 12 - New projects open at a predictable folder (Priority: P3)

A user creating projects repeatedly navigates from an arbitrary starting folder each time. They want the picker to open where they last were, and they want to be able to pin it to their profile folder or to a folder of their choosing.

**Why this priority**: A small, contained ergonomic win with a clear default.

**Independent Test**: Create a project from a folder, create another, and assert the picker opens at the previous folder. Change the setting to each of its three modes and assert the picker's starting folder follows.

**Acceptance Scenarios**:

1. **Given** the default configuration, **When** the user opens the new-project folder picker, **Then** it opens at the folder last chosen for a project.
2. **Given** no folder has ever been chosen, **When** the picker opens, **Then** it opens at the user's profile folder.
3. **Given** the setting is "User Profile", **When** the picker opens, **Then** it opens at the user's profile folder regardless of history.
4. **Given** the setting is "Override", **When** the picker opens, **Then** it opens at the configured override folder, which the user selects with a folder picker rather than typing.
5. **Given** the setting is "Override" and the configured folder no longer exists, **When** the picker opens, **Then** it falls back to the user's profile folder and the setting is flagged as unresolvable.

---

### User Story 13 - Key bindings are searchable (Priority: P3)

A user looking for a binding scrolls the whole list. The settings page already has a search box; the key-bindings page has none.

**Why this priority**: Small, isolated, and directly reuses existing behaviour.

**Independent Test**: Type into the key-bindings search box and assert the list filters by action name, description, group and chord, with the same debounce, clear control and empty-state behaviour as the settings page.

**Acceptance Scenarios**:

1. **Given** the key-bindings page, **When** it is displayed, **Then** it presents a search box that behaves identically to the settings page search box.
2. **Given** a search term, **When** it is entered, **Then** only bindings whose action name, description, group or assigned chord match are listed, and empty groups are hidden.
3. **Given** a search term matching nothing, **When** the results are displayed, **Then** an explanatory empty state is shown.
4. **Given** an active search term, **When** the user activates the clear control, **Then** the full list is restored.
5. **Given** the two search boxes, **When** their behaviour is compared, **Then** both are rendered by the same shared component, so a change to one is a change to both.
6. **Given** a binding row holding several tokens, **When** the user activates its clear control, **Then** every token is removed and the action is left unbound, with no other action affected.
7. **Given** a binding row the user has altered, **When** the user activates its reset control, **Then** only that action's shipped default tokens are restored.

---

### User Story 14 - Finding text in terminals and editors (Priority: P2)

A developer wants to search a terminal's scrollback for an error line, and to find, replace and jump to a line inside an editor. Neither surface exists today: the terminal has no search at all, and the editor loads only its default editing keymap.

**Why this priority**: The focus-scoped binding contexts (User Story 3) name these actions, and a binding that resolves to nothing is worse than no binding. Above the cosmetic items, below the three defects that lose work or corrupt the display.

**Independent Test**: With a terminal focused, invoke find, type a term present in the scrollback, and assert matches are highlighted and navigable. With an editor focused, invoke find, replace and go-to-line in turn, asserting each operates only on the focused editor.

**Acceptance Scenarios**:

1. **Given** a focused terminal with text in its scrollback, **When** the user invokes `terminal.find` and types a term, **Then** every match is highlighted, the current match is distinguished from the others, and the user can step forward and backward through them.
2. **Given** an open terminal find surface, **When** the user dismisses it, **Then** highlighting is cleared and keyboard focus returns to the terminal's running program.
3. **Given** a focused editor, **When** the user invokes `editor.find` and types a term, **Then** matches within that editor are highlighted and navigable, and no other editor is affected.
4. **Given** a focused editor, **When** the user invokes `editor.replace`, **Then** they may replace the current match or all matches within that editor.
5. **Given** a focused editor, **When** the user invokes `editor.gotoLine` and supplies a line number, **Then** the caret moves to that line, which is scrolled into view.
6. **Given** a go-to-line request naming a line beyond the end of the document, **When** it is submitted, **Then** it is refused with an explanation rather than moving the caret.
7. **Given** any find or replace surface, **When** it is open, **Then** Escape dismisses that surface — this is the one case where Escape is consumed inside a focused panel, because the surface, not the running program, holds keyboard focus.
8. **Given** a find surface with a term matching nothing, **When** the results are shown, **Then** an explicit no-matches state is presented rather than silence.

---

### Edge Cases

- What happens when the smallest attached terminal view is so small that the grid falls below one column or one row? The grid is clamped to a defined minimum and the offending view scrolls rather than forcing a degenerate grid.
- What happens when a panel is attached in three or more views simultaneously? The smallest-common rule generalises: the minimum across every attached view.
- What happens when a sub-workspace window is closed while it holds the smallest view? The grid grows to the new minimum without disturbing the running program.
- What happens when the user presses Escape in a focused terminal that is running a full-screen text editor? The escape character reaches that editor and focus is retained. Nothing in the application reacts.
- What happens when the release chord is rebound to a chord that a terminal program also uses? The binding is honoured; the release wins, and the program never sees it. The user can rebind again, and the shipped default (`F6`) is restorable from that binding's own reset control.
- What happens when a terminal is focused and the user rebinds `panel.releaseFocus` to nothing at all? Focus can still be released by clicking panel chrome, a tab, a project entry, or the files-and-folders pane.
- What happens when Escape is pressed in the preferences window while both a dialog is open and a text field within it is focused? The innermost element wins: the field first, the dialog second, the window last.
- What happens when a theme is saved-as under the name of a bundled theme? The save is refused; bundled theme names are reserved.
- What happens when the active theme is deleted? The application falls back to the default bundled theme.
- What happens when the user wants to restore defaults while a custom theme is active? "Restore All Themes to Default" is disabled; the user activates a built-in theme first. The disabled control's hover title says so.
- What happens when the active built-in theme is restored while the user has edited it? Its shipped values are reinstated and applied immediately, as with any other theme edit.
- What happens when the user deletes every built-in theme? "Restore All Themes to Default" is unreachable, because it requires a built-in theme to be active. The preferences-level reset remains available and recreates them.
- What happens when "Revert Theme" is invoked on a theme created during this same preferences-window session? It has no prior state to return to; the control is disabled for it.
- What happens when a custom flavour names an executable that does not exist? The flavour is offered in the type list but reports a clear launch error rather than failing silently or timing out.
- What happens when a custom flavour reuses the identifier of a built-in flavour? The custom definition takes precedence, and the settings editor states that it is shadowing a built-in.
- What happens when a numeric setting is typed with the locale's grouping separator in the wrong position? The value is rejected on commit with the prior value retained.
- What happens when a slider's declared increment does not divide evenly into its range? The final notch is the declared maximum.
- What happens when a panel error is dismissed and the same error recurs? The error bar reappears.
- What happens when a find surface is open and the user invokes `panel.releaseFocus`? The surface closes, its highlighting clears, and focus is released to the panel.
- What happens when a terminal's find surface is open and the running program emits new output containing the search term? Highlighting updates to include the new matches; the current match does not move.
- What happens when a panel's zoom is set so large that a terminal view measures fewer than one column? The grid is clamped per FR-011 and that view scrolls.
- What happens when a project-owned panel is Closed from a sub-workspace while it is the only view of a running terminal? The session keeps running, because the panel survives in its project; closing a view never terminates a session.
- What happens when a project is Removed while one of its panels is mirrored in a sub-workspace? The project's panels are destroyed, and the mirroring sub-workspace loses them. No file on disk is touched.
- What happens when the unsaved indicator is shown while reduced motion is requested and then the preference is turned off? The indicator begins pulsing without requiring a restart.
- What happens when the override folder for new projects is on a disconnected removable or network drive? It is treated as non-existent and falls back to the profile folder.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Terminal session synchronisation (User Story 1)

- **FR-001**: A terminal panel MUST NOT establish a session until the panel's ownership — the project or sub-workspace it belongs to, and therefore its working directory — has been resolved. Views MUST present a loading state until then.
- **FR-002**: Establishing a session for a panel that already has a live session MUST reuse that session. The system MUST NOT terminate a running session in order to replace it with an equivalently-identified one.
- **FR-003**: When a terminal panel is mirrored into an additional window, the running program MUST continue without interruption, and output MUST be delivered to every attached view.
- **FR-004**: A session-establishment request MUST be allotted a time budget appropriate to launching an interactive shell, independent of and larger than the budget used for lightweight health checks.
- **FR-005**: When a session-establishment request exceeds its budget, the underlying session MUST NOT be terminated, and the requesting view MUST offer the user an explicit retry that reattaches to the existing session rather than replacing it.
- **FR-006**: On reattachment, a view MUST be presented with the session's prior output history so that its display matches the other attached views.
- **FR-007**: A terminal session MUST only be terminated when its owning panel is destroyed, when the last attached view of a panel owned by a sub-workspace is closed, or on explicit user request. It MUST NOT be terminated as a side effect of a window move, a re-render, or a change to the panel's resolved identity.

#### Terminal sizing across views (User Story 2)

- **FR-008**: A terminal session MUST expose a single grid whose dimensions are the minimum columns and the minimum rows across all currently attached views.
- **FR-009**: The system MUST recompute the grid when a view attaches, detaches, or reports new dimensions, and MUST transmit a resize only when the computed grid actually changes.
- **FR-010**: A view larger than the grid MUST render the grid at its natural size and fill the remainder with inert padding painted in the terminal's background colour. It MUST NOT clip, stretch, or duplicate content.
- **FR-011**: The computed grid MUST be clamped to a minimum of one column and one row; a view smaller than the clamped grid MUST scroll rather than shrink it further.
- **FR-012**: Changing which view has focus MUST NOT, by itself, cause a resize.

#### Focus-scoped key bindings (User Story 3)

- **FR-013**: Every key binding MUST declare exactly one context: application, terminal, editor, or files-and-folders.
- **FR-014**: While a terminal or editor panel body holds keyboard focus, no application-context binding may fire. Only bindings declared in that panel type's context may fire; all other keystrokes MUST be delivered to the panel's content.
- **FR-015**: While no panel body holds keyboard focus, application-context bindings MUST fire as they do today.
- **FR-016**: The terminal context MUST define bindings for: zoom in, zoom out, zoom reset; copy, paste, select all; scroll line up, scroll line down, scroll page up, scroll page down; clear; and find. Their default token lists MUST include the mouse-wheel zoom gestures, as the application-context zoom bindings already do.
- **FR-017**: The editor context MUST define bindings for: zoom in, zoom out, zoom reset; save, save all, save as; and find, replace, go to line. Their default token lists MUST include the mouse-wheel zoom gestures.
- **FR-018**: Zoom in a terminal or editor context MUST change only the text size of the focused panel. Zoom in the application context MUST change only the application text size.
- **FR-018a**: A panel's zoom MUST be stored with the panel, MUST persist across application restarts, and MUST be shared by every view of that panel across every window.
- **FR-018b**: A panel's zoom is a property of the panel, not of the terminal or editor it currently hosts. Destroying that terminal or editor and creating another of either type in the same panel MUST reuse the panel's existing zoom.
- **FR-018c**: Because a panel's font size determines a terminal view's measured columns and rows, all views of one terminal panel MUST render at the same text size. The smallest-common-grid rule (FR-008) therefore varies only with each view's pixel dimensions.
- **FR-019**: Clicking a terminal or editor panel body MUST focus it. Focus MUST be released by a `panel.releaseFocus` action, defined in the terminal and editor contexts and bound by default to `F6`, or by clicking a panel header, a tab, a project entry, or the files-and-folders pane.
- **FR-020**: Escape MUST be delivered to whatever holds keyboard focus inside the panel — the terminal's running program, or the editor's content. It MUST NOT release panel focus, and MUST NOT trigger any application-context action. The sole exception is an open find or replace surface, which itself holds keyboard focus and consumes Escape to dismiss (FR-066h).
- **FR-021**: Escape MUST NOT be bindable to any action, in any context. It is reserved: as a pass-through key inside a focused panel, and as the cancel key for dialogs and key capture in the preferences window.
- **FR-022**: The same chord MAY be bound in more than one context. The conflict detector MUST report a conflict only when two bindings in the *same* context share a chord.
- **FR-023**: The key-bindings editor MUST display each binding's context, and MUST group or allow filtering by it.

#### Preferences window (User Story 4)

- **FR-024**: Pressing Escape in the preferences window with no text input focused and no dialog open MUST close the window, retaining all changes made during the session.
- **FR-025**: Pressing Escape while a text input is focused MUST dismiss or blur that input only, leaving the window open.
- **FR-026**: Pressing Escape while a dialog is open MUST cancel that dialog with no side effect, leaving the window open.
- **FR-027**: Pressing Escape during key capture MUST cancel the capture and bind nothing.
- **FR-028**: Escape handling MUST resolve innermost-first: focused input, then open dialog, then the window.

#### Theme editor (User Story 5)

- **FR-029**: The theme editor MUST expose exactly four theme-level actions: "Restore All Themes to Default", "Revert Theme", "Delete", and "Save As".
- **FR-029a**: Deleting a theme MUST require confirmation in a modal dialog that names the theme, and MUST remove the theme from the user's configuration entirely. Cancelling MUST make no change. A deleted built-in theme MUST be recoverable via "Restore All Themes to Default".
- **FR-030**: "Restore All Themes to Default" MUST require confirmation in a modal dialog that states what will be replaced. On confirmation it MUST reset every built-in theme to its shipped values and recreate any built-in theme the user has deleted. It MUST leave custom themes untouched. Cancelling MUST make no change.
- **FR-030a**: "Restore All Themes to Default" MUST be enabled only while a built-in theme is active, and MUST be disabled with an explanatory hover title otherwise. It MUST actually perform the restore; the present control does not.
- **FR-030b**: "Revert Theme" MUST return the current theme to the values it held when the preferences window was opened. It MUST be available for built-in and custom themes alike, and MUST affect only the current theme.
- **FR-030c**: Shipped defaults for themes, settings and key bindings MUST be immutable artifacts distributed with the application build, held separately from the user's writable configuration. They MUST be the authoritative source for every restore-to-default operation.
- **FR-030d**: The theme-level actions of FR-029 MUST be presented as subordinate to the existing preferences-level reset and revert controls, which act across settings, key bindings and themes together. The interface MUST make this hierarchy evident, so a user can tell which scope an action will affect before invoking it.
- **FR-031**: The theme editor MUST offer "Save As" in place of an in-place rename. It MUST present a dialog containing a name field, a save control, and a cancel control.
- **FR-032**: "Save As" MUST create a new theme carrying the current theme's values, activate the new theme, and leave the original theme unchanged.
- **FR-032a**: The theme editor MUST retain its auto-apply model: an edit to a token persists and takes visible effect immediately. There MUST be no save control and no unsaved-changes state.
- **FR-033**: "Save As" MUST reject an empty name, a name already in use, and a name reserved by a bundled theme, explaining the refusal without closing the dialog.
- **FR-034**: Every control in the theme editor toolbar MUST be rendered as an icon drawn from the active theme's icon set, MUST take its colours from theme tokens, and MUST expose a hover title naming its action.
- **FR-035**: The theme editor toolbar MUST align its controls to a common baseline with their labels at every supported window width.
- **FR-036**: Confirmation dialogs in the preferences window MUST be rendered by the same dialog component used by the main window, so the two share behaviour and appearance.

#### Preferences chrome and shared controls (User Stories 4, 5, 9, 13)

- **FR-036a**: The preferences window's tab labels and section headers MUST take their font family, size, weight and typography role from the application's font settings, as the rest of the application does.
- **FR-036b**: The cog menu's drop-down text MUST take its font from the application's font settings.
- **FR-036c**: Every font selection box MUST present a clear-all control at its trailing edge that removes all selected fonts from that box in one action.
- **FR-036d**: Every font-size control MUST be presented as a notched slider in 1-point increments, paired with a text box, both bound to the same value.
- **FR-036e**: The bundled icon pack presently named `throng-svg` MUST be renamed `throng-svg-black`, and a `throng-svg-white` variant MUST ship alongside it. Existing user themes referring to the old name MUST continue to resolve.

#### Project standard (User Story 5)

- **FR-037**: The project constitution MUST be amended to require that every interactive control which performs an action is presented as an icon drawn from the active theme's icon set, with a hover title naming the action, in place of a text label. The amendment MUST be enforced by the code-review gate.

#### Default themes (User Story 6)

- **FR-038**: The Bash theme MUST use a multi-hue palette spanning green, magenta, yellow, teal and cyan, echoing a default Git Bash prompt.
- **FR-039**: No two bundled themes may be closer than a defined perceptual-distance threshold across their colour token sets. This MUST be asserted automatically.
- **FR-040**: The SUBNET theme MUST derive every colour token from the SUBNET brand palette: Neon Core Green `#39FF14`, Neon Cyan `#00EFFF`, Deep Space Blue `#001B40`, Burnt Amber `#FF6F32`, Gunmetal Grey `#4C4C4C`, with supporting accents Warning Orange `#FFA500`, Bright Yellow `#FFE600`, and Midnight Slate `#303841`. Deep Space Blue MUST be the base surface; the neons MUST be reserved for accents and active states.
- **FR-041**: The Cyberpunk theme MUST derive its colour tokens from its reference palette: `#000000`, `#c5003c`, `#880425`, `#f3e600`, `#55ead4`.
- **FR-042**: Contrast MUST be measured automatically for all foreground-on-background pairings of every bundled theme. Bash, SUBNET and Cyberpunk MUST meet the project's minimum contrast standard, and failing to do so MUST fail the build. Contrast shortfalls in the remaining bundled themes MUST be reported as known issues and MUST NOT fail the build.

#### Theme token descriptors (User Story 7)

- **FR-043**: Every theme token MUST carry a hand-written label and description. Labels and descriptions MUST spell words in full — "Background", "Foreground" — and MUST contain no abbreviation.
- **FR-044**: Each description MUST name the concrete surfaces or elements the token paints, and MUST NOT merely restate the token's identifier. This MUST be asserted automatically.

#### Editor gutter theming (User Story 8)

- **FR-045**: The theme MUST define distinct tokens for the editor gutter background and the editor gutter foreground, exposed in the theme editor and supplied by every bundled theme.
- **FR-046**: Changing a gutter token MUST affect only the gutter.

#### Settings widgets (User Story 9)

- **FR-047**: A numeric setting that declares a minimum, a maximum and an increment MUST be presented as a notched slider paired with a text box, both bound to the same value.
- **FR-048**: The slider MUST snap to the declared increment and MUST never produce a value outside the declared bounds. The text box MUST accept any in-bounds value verbatim, including values off a notch.
- **FR-049**: This presentation MUST apply to the projects pane maximum width and the file explorer pane maximum width (increments of 10 pixels), and to the tab hover-activate delay, the submenu hover-activate delay, and the auto-save delay (increments of 10 milliseconds).
- **FR-050**: Numeric settings MUST display their value with the user's locale digit-grouping separator, and MUST parse a grouped value back correctly on commit without interfering with typing.

#### Terminal flavour configuration (User Story 10)

- **FR-051**: The custom terminal flavours setting MUST be edited through a structured per-entry form exposing named, individually validated fields for identifier, display label, executable, arguments, and default startup parameters — not a free-form structured-text box.
- **FR-052**: The hidden built-in flavours setting MUST let the user choose entries from a list of the built-in flavours detected on this machine, rather than typing identifiers.
- **FR-053**: A hidden-flavour entry that no longer matches a detected built-in MUST be shown as unrecognised and remain removable, without being silently discarded.
- **FR-054**: A custom flavour whose identifier collides with a built-in MUST take precedence, and the settings editor MUST state that it shadows a built-in.
- **FR-055**: A custom flavour naming a missing executable MUST surface a clear launch error rather than failing silently or exhausting a timeout.

#### Main-window affordances (User Story 11)

- **FR-056**: The file-changed-on-disk warning MUST name the containing tab, the panel, and the file's full path.
- **FR-057**: Every panel-level error surface MUST carry a dismiss control at its trailing edge that removes the error and leaves the panel usable. This covers the projects sidebar error, the sub-workspaces sidebar error, the file-tree error, and the terminal-exit notice. The same error recurring MUST reinstate the bar.
- **FR-057a**: Dismissing an error MUST take effect immediately. No error surface may persist until the panel loses focus, is re-rendered, or is re-typed.
- **FR-057b**: In the terminal panel-type form, the "Clear" control MUST clear the form's fields only. It MUST NOT be the mechanism by which the exit notice or any error state is cleared; those are dismissed by their own control (FR-057). The two concerns MUST be independent, so clearing the form leaves a visible error visible, and dismissing the error leaves typed form values intact.
- **FR-057c**: Dismissing the terminal-exit notice MUST leave the panel-type form usable, so the user can always re-type the panel. It MUST NOT leave a blank, unrecoverable panel.
- **FR-058**: The unsaved-changes indicator MUST pulse continuously wherever it appears — the projects list, the tab, and the panel header — and MUST stop as soon as the changes are saved.
- **FR-058a**: The pulse MUST cycle the indicator's opacity between fully opaque and partially opaque over approximately 1.5 seconds. The indicator MUST NOT become invisible at any point in the cycle, because an absent indicator signifies "no unsaved changes".
- **FR-058b**: The pulse MUST be synchronised across all three locations, so one document's indicator never appears bright in one place and dim in another.
- **FR-058c**: When the operating system requests reduced motion, the indicator MUST render static at full opacity, remaining clearly visible.
- **FR-059**: The application MUST use exactly four removal verbs, each denoting a distinct consequence:
  - **Close** — dismiss a view of something; the thing itself survives, and so does any process it hosts.
  - **Destroy** — irreversibly remove a thing together with everything it owns, terminating any process those things host.
  - **Remove** — unregister a project from Throng. Files on disk are never touched.
  - **Delete** — irreversibly remove something persisted on disk: a theme, or a file or folder in the explorer.
- **FR-059a**: Because the same control has different consequences depending on ownership, the verb MUST be selected per target as follows, and the control, its tooltip and its confirmation dialog MUST all use the selected verb:

  | Target | Where | Verb | Consequence |
  |---|---|---|---|
  | Panel owned by a project | Main window | Destroy | Panel is gone everywhere, including every sub-workspace mirroring it; its terminal session is terminated. |
  | Panel owned by a project | Sub-workspace | Close | Panel leaves this sub-workspace only. It survives in its project, and its terminal session keeps running. |
  | Panel owned by the sub-workspace | Sub-workspace | Destroy | Panel is gone and its terminal session is terminated. |
  | Tab | Main window | Destroy | The tab and every panel it owns are destroyed. |
  | Tab | Sub-workspace | Destroy | The tab is destroyed. Panels it owns are destroyed; project-owned panels within it are merely closed, per the rows above. |
  | Sub-workspace | Anywhere | Destroy | The sub-workspace and the panels it owns are destroyed; project-owned panels it mirrored are merely closed. |
  | Project | Projects list | Remove | The project is unregistered and its panels and tabs are destroyed. **No file on disk is touched.** |
  | Theme | Theme editor | Delete | The theme is removed from the user's configuration. |
  | File or folder | File explorer | Delete | The item is removed from disk. |

- **FR-059b**: A confirmation dialog for a Destroy, Remove or Delete MUST state the consequence, not merely the verb. In particular, the confirmation for removing a project MUST state that no files are deleted.
- **FR-060**: The four verbs of FR-059 MUST be applied consistently everywhere they appear — controls, tooltips, context menus, confirmation dialogs and status messages — replacing the current mixture in which panels, tabs and projects are all "Destroy"ed, a sub-workspace is "Delete"d from the sidebar, and the same sub-workspace is "Close"d when its last panel goes. No other removal verb may be used.

#### New-project folder (User Story 12)

- **FR-061**: The new-project folder picker MUST open at the folder last chosen for a project. The system MUST persist that folder.
- **FR-062**: A setting MUST control the picker's starting folder with three options: "User Profile", "Last Viewed", and "Override". "Last Viewed" MUST be the default.
- **FR-063**: When "Override" is selected, the user MUST choose the override folder with a folder picker, not by typing a path.
- **FR-064**: When the starting folder cannot be resolved — it never existed, or no longer does — the picker MUST fall back to the user's profile folder, and an unresolvable override MUST be flagged in the settings editor.

#### Key-bindings search (User Story 13)

- **FR-065**: The key-bindings page MUST present a search box rendered by the same shared component as the settings page search box.
- **FR-066**: The search MUST filter bindings by action name, description, group and assigned chord; MUST hide groups left empty; MUST offer a clear control; and MUST show an explanatory empty state when nothing matches.
- **FR-066a**: Each key-binding row MUST expose a clear control that removes every token assigned to that action, leaving it unbound. This mirrors the font selection box's clear-all control (FR-036c).
- **FR-066b**: Each key-binding row MUST expose a reset control that restores only that action's shipped default tokens, leaving every other action untouched.
- **FR-066c**: An action holds an ordered list of binding tokens, each of which is a keyboard chord or a named mouse gesture. The key-bindings editor MUST allow adding and removing individual tokens without disturbing the others.

#### Find and replace surfaces (User Story 14)

- **FR-066d**: The terminal MUST provide a find surface, opened by `terminal.find`, that highlights every match in the scrollback, distinguishes the current match, and allows stepping forward and backward through matches.
- **FR-066e**: The editor MUST provide find, replace and go-to-line surfaces, opened by `editor.find`, `editor.replace` and `editor.gotoLine`. Find and replace MUST operate only within the focused editor.
- **FR-066f**: `editor.gotoLine` MUST refuse a line number beyond the end of the document with an explanation, leaving the caret where it was.
- **FR-066g**: Every find or replace surface MUST present an explicit no-matches state, and MUST clear its highlighting when dismissed.
- **FR-066h**: While a find or replace surface holds keyboard focus, Escape MUST dismiss that surface and return focus to the panel's content. This is the sole exception to FR-020, and applies because the surface — not the running program or the document — holds keyboard focus.

#### Cross-cutting

- **FR-067**: Every new configurable option introduced by this feature — the new-project folder mode and its override path, the gutter tokens, and any binding-context metadata — MUST be exposed in the visual preference editors and covered by the existing editor-metadata completeness assertions.
- **FR-068**: Each of the fourteen user stories MUST be delivered test-first: a failing test that demonstrates the current behaviour, then the change, then the passing test.

### Key Entities

- **Terminal session**: one running program and its output history, identified by the panel it belongs to. Has exactly one grid. May be attached to many views across many windows.
- **Terminal view**: one on-screen presentation of a session inside one window. Reports its own measured dimensions; does not own the grid.
- **Panel ownership**: whether a panel belongs to a project or to a sub-workspace. Determines the working directory, the removal verb, and the session's lifetime.
- **Removal verb**: one of Close, Destroy, Remove or Delete. Selected by the target and its ownership, per FR-059a. Each denotes a distinct consequence; the verb is a promise about what survives.
- **Binding context**: the scope in which a key binding is eligible to fire — application, terminal, editor, or files-and-folders.
- **Key binding**: an action identifier paired with an ordered list of binding tokens. A token is a keyboard chord or a named mouse gesture. An action may hold zero tokens (unbound), one, or many.
- **Shipped defaults**: the immutable, versioned themes, settings and key bindings distributed with the application build. The authoritative source for every restore-to-default operation, and the only way to recreate a deleted built-in theme.
- **Theme token**: one named, user-editable colour, font or icon value, carrying a hand-written label and a description of what it paints.
- **Terminal flavour**: a launchable terminal type — either detected on the machine (built-in) or defined by the user (custom) — identified by an identifier and describing an executable, its arguments, and default startup parameters.
- **Panel zoom**: a text-size multiplier stored with the panel, persisted across restarts, shared by every view of the panel, and outliving whichever terminal or editor the panel currently hosts.
- **Numeric setting descriptor**: a numeric configuration key, its bounds and its increment, from which the slider's notches are derived.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Moving a tab containing a terminal with a running program into a new sub-workspace preserves that program in 100 out of 100 trials, with no connection error surfaced in either window.
- **SC-002**: A terminal session mirrored into two views of different sizes renders legibly in both views in 100% of trials, with zero resize messages sent while neither view changes size.
- **SC-003**: With a terminal focused, none of the application-wide chords produce an application action, and every keystroke is observed by the running program.
- **SC-004**: A user can close the preferences window with a single Escape from any state in which no text field is focused and no dialog is open.
- **SC-005**: No destructive theme action — delete, restore defaults — can be completed without an explicit confirmation step.
- **SC-006**: Every bundled theme is distinguishable from every other at a glance, verified by an automated perceptual-distance check with zero pairs below the threshold. Bash, SUBNET and Cyberpunk additionally pass the minimum contrast standard; contrast shortfalls in other bundled themes are enumerated in a report rather than left undiscovered.
- **SC-007**: Zero theme token labels or descriptions contain an abbreviation, and zero descriptions are machine-generated from the token identifier.
- **SC-008**: A user can set each of the five listed numeric settings to any valid value using only the slider, and to any exact in-bounds value using only the text box.
- **SC-009**: A user can add a working custom terminal flavour, and hide a built-in one, without typing an identifier by hand and without editing structured text.
- **SC-010**: The file-changed-on-disk warning identifies the affected file unambiguously, and a user shown the warning can locate the file without further navigation.
- **SC-011**: Every action control in the theme editor and preferences toolbars presents an icon with a hover title, and zero such controls use a text label.
- **SC-012**: Every user story in this feature is accompanied by at least one test that failed before the change and passes after it.
- **SC-013**: A user who has deleted built-in themes and edited others can return every built-in theme to its shipped state in one confirmed action, with zero custom themes affected.
- **SC-014**: A user can undo an entire theme-editing session with one action, and can reset or unbind any single key binding without affecting any other.
- **SC-015**: Escape reaches the program running in a focused terminal in 100% of presses, and `F6` releases focus in 100% of presses.
- **SC-016**: A user can locate a term in a terminal's scrollback, and find, replace and jump to a line in an editor, without leaving the focused panel and without any application-wide action firing.
- **SC-017**: Every removal control in the application uses one of exactly four verbs, and a user can predict from the verb alone whether a running process is terminated and whether a file on disk is deleted, correctly in every case.
- **SC-018**: Every visible error surface can be dismissed by its own control, and the dismissal is observed immediately rather than on the next focus change.
- **SC-019**: A panel's zoom survives a restart and a change of panel type, and every view of a mirrored panel renders at the same text size.

---

## Assumptions

- **Escape never releases panel focus.** An earlier decision in this session made Escape the release key; it was reversed because Escape is a valid, frequently-used key inside terminal-hosted programs. Focus release is a rebindable action defaulting to `F6`. `Ctrl+Shift+Esc` was rejected as a candidate default because Windows reserves it for Task Manager and the application never receives it.
- Escape retains its cancel role inside the preferences window (FR-024 to FR-028), which has no focusable terminal or editor. The two Escape behaviours therefore never meet.
- The "smallest common size" grid rule (FR-008) is applied across *all* attached views, not just two, and applies equally to views in the same window.
- "Restore All Themes to Default" replaces the built-in themes only and recreates deleted ones; user-created themes are never touched.
- Gating "Restore All Themes to Default" on a built-in theme being active (FR-030a) means it is unreachable if the user deletes every built-in theme. The preferences-level reset is the documented escape hatch for that state. This is accepted rather than solved, because the state is reachable only by deliberately deleting all fourteen built-ins.
- The user described the shipped defaults as JSON packaged into `%APPDATA%` at build time. Recorded here for intent: `%APPDATA%\throng` is currently the application's own writable per-user data (recovery temps, font cache, database), while user configuration lives in `%USERPROFILE%\.throng`. FR-030c therefore requires only that shipped defaults be immutable build artifacts held apart from user configuration; where exactly they are materialised is a planning decision.
- The perceptual-distance threshold (FR-039) and the minimum contrast standard (FR-042) are chosen during planning against a recognised colour-difference metric and accessibility standard respectively; the spec fixes the requirement, not the constant.
- Digit grouping (FR-050) follows the user's operating-system locale rather than a fixed separator.
- Custom terminal flavours are already functional end to end: the merged flavour catalogue that populates the terminal type list is the same catalogue the launch path resolves an executable from. The defect is confined to the configuration surface, which presents the setting as an unlabelled structured-text box. No change to the launch path is required for FR-051.
- The existing modal dialog component used by the main window is reusable in the preferences window; making it available there is a wiring change, not a new component.
- Terminal-context bindings such as copy and paste deliberately use modified chords so that the unmodified interrupt and literal-input keys continue to reach the running program.
- Building the find and replace surfaces (User Story 14) is the largest single addition to this pass. It was made explicit rather than left implicit in FR-016 and FR-017, where it would have been discovered during implementation.
- A find or replace surface is the only thing inside a focused panel that consumes Escape. It can do so because it, rather than the running program or the document, holds keyboard focus while open.
- The pulse period of roughly 1.5 seconds (FR-058a) is well below any flash-rate threshold of accessibility concern, and the indicator never reaches zero opacity, so it cannot be misread as absent mid-cycle.
- "Remove" was chosen over "Delete" for projects (FR-059) specifically because "Delete Project" reads as a promise to delete source code, which Throng never does.
- Bundled theme names are reserved and cannot be taken by a user theme via "Save As".
- Adding gutter tokens changes the theme shape; existing user themes missing those tokens inherit the default values rather than failing to load.
- This work branches from `master`. The spec directory is numbered 009 because 008 is taken by the concurrent `008-advanced-editor` branch, which is not merged.

## Dependencies

- The SUBNET brand palette is sourced from `V:\art\branding\subnet_palette_brand_cut_down.html`, read at specification time and recorded verbatim in FR-040 so the plan does not depend on that drive remaining mounted.
- The Cyberpunk palette is sourced from the "Cyberpunk 2077 UI Colors" reference palette, recorded verbatim in FR-041 for the same reason.
- FR-037 amends the project constitution and must be applied before the code-review gate can enforce it on the rest of this feature.
