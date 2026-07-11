# Feature Specification: Focus Contexts & Per-Panel Zoom

**Feature Branch**: `012-focus-contexts-and-zoom`

**Created**: 2026-07-11

**Status**: Draft — clarified 2026-07-11 (ready for planning)

**Depends on**: the dockable pane/panel/tab workspace (feature 002) and the terminal (005) and editor (006) panel types. **Relates to** feature 008 (terminal-session-integrity), which established the per-view character-grid model that this feature's terminal zoom builds on and which explicitly defers "per-panel text zoom [and] keyboard focus scoping" to a later feature — this is that feature. It can be specified and merged independently of 008; where the two meet (a terminal's grid must derive from each view's own text size, never a single global size) this feature honours 008's stated assumption.

**Input**: Reconstructed feature. throng has, so far, treated keyboard focus and text size as effectively global: there is one app-wide zoom (Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+mouse-wheel) that scales the whole window, and no first-class notion of *which panel* is active beyond the browser's own focus. This feature introduces (1) **focus contexts** — a visible, first-class "active panel" within a window, with keyboard input and commands routed to it and movable from the keyboard — and (2) **per-panel text zoom** — the ability to zoom one panel's text independently of every other panel and of the app-wide zoom, persisted with the layout.

---

## Clarifications

### Session 2026-07-11 (provenance)

- Q: Is there a verbatim original prompt for this feature? → A: **No.** The `012-focus-contexts-and-zoom` branch was created on 2026-07-10 as a bare placeholder during the decomposition of the advanced-editor/workspace family into features 008–015; specs were authored only for 008–011. This specification was reconstructed from the sole authoritative scope statement that survives: feature 008's *Out of Scope* line — "Per-panel text zoom, keyboard focus scoping, and terminal-specific key bindings" — and its Assumptions note that per-panel text zoom "is delivered by a later feature; nothing in this feature may assume a single global text size." The two headline capabilities (focus contexts, per-panel zoom) and their boundary against the already-shipped global zoom and multi-window focus/raise group are fixed by that source; the finer decisions were not, and were surfaced as questions and resolved in the Session 2026-07-11 clarification below.

### Session 2026-07-11

- Q: Does per-panel zoom **compose** with the existing app-wide global zoom, or override it for that panel? → A: **Compose on top.** Per-panel(-type) zoom is an *additional* factor applied on top of global zoom; the app-wide global zoom is retained and still scales window chrome and every panel, and the per-panel-type factor further adjusts a panel's content. A panel's *effective* text size = global zoom × its type's per-panel zoom factor.
- Q: At what granularity is a per-panel zoom level remembered? → A: **Per panel type.** One zoom level is shared by all terminal panels and another by all editor panels, persisted per project. Consequence: zooming the active panel changes every panel of the *same type* together; panels of other types and the window chrome are unaffected. (The recommended per-instance option was declined in favour of this simpler type-scoped model.)
- Q: What are the default keyboard chords for **moving focus** between panels/panes? → A: **Directional + cycle.** `Ctrl+Alt+Arrow` moves focus to the adjacent panel in that direction; `Ctrl+`` ` / `Ctrl+Shift+`` ` cycle forward/backward through panels. These are shipped defaults only and are fully rebindable via the Key Bindings editor.
- Q: When a directional move-focus is issued at the edge of the layout with no panel in that direction, what happens? → A: **Stay put.** Focus remains on the current panel — no wrap — with no error raised and the active indication retained.
- Q: What are the per-type zoom bounds and per-step increment (FR-011)? → A: **Match the global zoom.** Per-type zoom reuses the exact step size and minimum/maximum bounds already used by the app-wide global zoom, so the two zooms behave identically; no separate range is introduced.
- Q: In what order does the cycle binding (`Ctrl+`` ` / `Ctrl+Shift+`` `) traverse panels? → A: **Layout order.** Cycling follows a stable spatial order — panes left→right, top→bottom, and tabs in order within a pane — independent of focus history, pairing predictably with the directional `Ctrl+Alt+Arrow` moves.
- Q: How does the active-panel indicator behave when its OS window is not the foreground window? → A: **Persist dimmed.** The indicator stays visible but is drawn in a dimmed *inactive* variant (a distinct theme token from the active-window indicator), so the user still sees which panel will receive input on return without implying the window is focused.

### Revision 2026-07-11 (post-implementation, user-directed)

After the initial per-type implementation shipped, the user revised the feature. These
supersede the earlier answers where noted and are all implemented:

- **Zoom granularity → per PANEL INSTANCE (supersedes the earlier "per panel type").**
  Every panel — every terminal and every editor — has its **own** zoom level; zooming
  one panel never affects any other. Stored as `Panel.zoom` on the layout blob (schema
  v3, inherited-by-default). (Reverses the Session 2026-07-11 "per panel type" answer.)
- **Zoom is also reachable from the panel right-click menu** (Zoom In / Out / Reset),
  via themeable action icons (constitution v3.12.0), in addition to the key bindings.
- **Move-focus hardening (FR-015/FR-003):** the move-focus/zoom chords are intercepted
  in the capture phase so a focused terminal (e.g. Git Bash) cannot swallow them, and
  after a move DOM focus (the caret / input routing) is transferred into the target
  panel — so keyboard focus genuinely moves into and out of terminals and editors.
- **Panel-type indication → a small type icon** at the head of each panel's title
  (replacing the "TERMINAL/EDITOR PANEL" text pill); type + flavour move to its tooltip.
- **Terminal working directory in the panel title** (delivered): each terminal's live cwd
  is shown in its header so it stays visible even when a full-screen app hides the prompt.
  Source: the daemon reads each shell's process cwd (Windows PEB walk via an `IProcessCwd`
  OS seam) and pushes `terminal.cwd` updates to the renderer.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The active panel is obvious and receives what I type (Priority: P1)

A developer has several panels open across a split workspace — a terminal, a couple of editors, maybe a panel mirrored from another window. They want to know, at a glance, which panel is "active" — the one that will receive their keystrokes and to which panel commands (zoom, and later context-specific bindings) apply. Today the active panel is whatever the browser happens to have focused, with no consistent, legible indication, and app commands apply globally rather than to a chosen panel.

**Why this priority**: Every other capability in this feature — zooming a panel, moving focus, future per-context key bindings — needs a single, unambiguous answer to "which panel is active?". Without a visible, routable focus context there is no target for any command, and the user cannot tell where their input will go. This is the foundation; it is the MVP.

**Independent Test**: Open a window with at least two panels of different types. Click one, then the other. Assert that exactly one panel is indicated as active at any time, that the indication is legible on every bundled theme, and that keyboard input and a panel-scoped command act on the indicated panel and no other.

**Acceptance Scenarios**:

1. **Given** a window with two or more panels, **When** the user activates one panel, **Then** exactly that panel is shown as the active panel and no other panel carries the active indication.
2. **Given** an active panel, **When** the user types or issues a panel-scoped command, **Then** the input and the command act on the active panel only.
3. **Given** the active-panel indication, **When** any bundled theme is applied, **Then** the indication is drawn from the theme's tokens and is legible against that theme in both its active and dimmed-inactive states.
4. **Given** a window with an active panel, **When** that window loses OS foreground focus (another window comes forward), **Then** the active-panel indicator persists but switches to its dimmed inactive treatment, and returns to the active treatment when the window is brought forward again, without the active panel changing.
5. **Given** an active terminal panel presented in two views, **When** focus moves between those views, **Then** (per feature 008, FR-013) no resize or content reflow is triggered by the focus change alone.

---

### User Story 2 - Zoom text by panel type, independently of the chrome and other types (Priority: P1)

A developer wants their terminal output large and their editor text compact — or the reverse when presenting. Focusing a terminal and zooming it in brings *every* terminal panel up to that size, while every editor panel and the window chrome stay exactly as they were; focusing an editor and zooming it adjusts *all* editors and leaves the terminals alone. They can reset a type back to its default, and when they restart throng or switch away and back, each type is still at the size they left it.

**Why this priority**: This is the headline user-visible value and the specific capability feature 008 deferred. The existing app-wide zoom scales everything at once, which is the wrong tool when only one *kind* of content needs to change. Type-scoped zoom is independently valuable the moment focus contexts exist.

**Independent Test**: Open at least two terminals and two editors. Focus one terminal, zoom it in several steps, and confirm every terminal changed together while every editor and the chrome stayed the same; reset and confirm the terminals return to their default; restart and confirm each type's level persisted.

**Acceptance Scenarios**:

1. **Given** an active panel of a given type, **When** the user issues zoom-in or zoom-out, **Then** every panel of that same type changes text size together and panels of other types and the window chrome are unaffected.
2. **Given** a panel type that has been zoomed, **When** the user issues reset while a panel of that type is active, **Then** that type returns to its default (inherited) text size.
3. **Given** a zoomed panel type, **When** throng is restarted, **Then** panels of that type reopen at the zoom level the type had when the session ended.
4. **Given** a zoomed **terminal** panel, **When** its character grid is measured, **Then** the columns and rows derive from the panel view's own pixel size *and* the terminal type's effective text size, and the terminal never assumes a single global text size across its views.
5. **Given** a zoomed panel shown in more than one view, **When** the user reads both, **Then** each view reflects the same (type-scoped) zoom level consistently.
6. **Given** the zoom-in/zoom-out/reset commands, **When** the user opens the Key Bindings editor, **Then** the commands appear there and are rebindable, distinct from the existing app-wide global-zoom bindings.

---

### User Story 3 - Move focus between panels from the keyboard (Priority: P2)

A developer working without reaching for the mouse wants to move the active panel from the keyboard — to the panel in a given direction (`Ctrl+Alt+Arrow` by default) or cycling forward/backward through panels (`Ctrl+`` ` / `Ctrl+Shift+`` ` by default) — so that their typing and their zoom commands follow them around the workspace. These defaults are rebindable in the Key Bindings editor.

**Why this priority**: It makes the focus context usable hands-on-keyboard and is a natural down-payment on full keyboard-only accessibility (tracked separately as issue #26), but the feature still delivers value with mouse-driven focus alone, so it ranks below the foundation and the headline zoom.

**Independent Test**: With several panels open, use only the keyboard to move focus between them and assert the active indication and input routing follow each move, with focus landing on a sensible panel each time.

**Acceptance Scenarios**:

1. **Given** a window with multiple panels, **When** the user issues a move-focus command, **Then** the active panel changes to the intended panel and the active indication and input routing follow it.
2. **Given** a window with multiple panels, **When** the user repeatedly issues the cycle command, **Then** focus advances through the panels in a stable layout order (panes left→right, top→bottom; tabs in order within a pane) regardless of the order they were previously focused, and the reverse-cycle command steps through that same order backwards.
3. **Given** the active panel is at an edge of the layout, **When** the user issues a directional move with no panel in that direction, **Then** focus stays put on the current panel — no wrap — without raising an error and without losing the active indication.
4. **Given** the move-focus commands, **When** the user opens the Key Bindings editor, **Then** the commands appear there and are rebindable.

---

### User Story 4 - Focus and zoom survive layout changes (Priority: P3)

A developer rearranges their workspace — switches tabs, splits a pane, closes a panel, tears a panel off into a sub-workspace and merges it back. Across all of these, a sensible panel stays active and each panel type keeps its zoom level, so the workspace never lands in a state with nothing active or with content silently resized.

**Why this priority**: It hardens the model against real workflows and prevents "dead" states, but the core value is demonstrable without exhaustively covering every layout transition, so it ranks last.

**Independent Test**: Drive each layout transition (tab switch, split, panel close, detach, reattach) and assert that after each one exactly one panel is active, focus is on a reasonable panel, and each panel type retains its zoom level.

**Acceptance Scenarios**:

1. **Given** an active panel, **When** the user switches to another tab and back, **Then** a sensible panel is active in each tab and the terminal and editor zoom levels are unchanged.
2. **Given** an active panel, **When** it is closed, **Then** focus moves to the deterministic fallback panel (the panel preceding it in layout order, per FR-005) rather than leaving the window with nothing active.
3. **Given** a pane split or join, **When** the layout settles, **Then** exactly one panel is active and no panel type's zoom level is lost or altered by the structural change.
4. **Given** a panel torn off into a sub-workspace and later merged back, **When** it settles in each window, **Then** it displays its type's zoom level and a sensible panel is active in each window.

---

### Edge Cases

- What happens when the user tries to zoom past a sensible bound? Zoom is clamped to the **same minimum and maximum as the app-wide global zoom**; commands at the bound are a no-op (or a soft signal) rather than shrinking text to illegibility or growing it without limit.
- What happens to the active-panel indicator when the panel's window is sent to the background (loses OS foreground focus)? The indicator persists but switches to its dimmed inactive treatment; it returns to the active treatment when the window regains foreground focus. The active panel itself does not change.
- What happens to a type's persisted zoom when it is reset while at the default already? Reset is idempotent — a type already at its default stays there with no visible change.
- What happens when a window has no panels at all? There is no active panel and panel-scoped commands (zoom, move-focus) are no-ops until a panel exists.
- What happens when the active panel is destroyed by an external event (e.g. a terminal's owning session ends and its panel is removed)? Focus falls back to the deterministic neighbour defined by FR-005 (the preceding panel in layout order); the window is never left with input routed to a panel that no longer exists.
- What happens when a persisted layout carries no stored zoom level for a type (a layout written before this feature)? Panels of that type open at their default size; the absence of a stored level is not an error and needs no migration.
- What happens when per-panel-type zoom and the app-wide global zoom are both in play? They **compose** (the rule defined in **FR-008**). Global zoom continues to scale chrome and all panels; the per-type factor further adjusts that type's content. A terminal's grid, however, is computed from its **per-type zoom size only** — global zoom raster-scales the rendered result without changing cols/rows (FR-012).

---

## Requirements *(mandatory)*

### Functional Requirements

#### Focus context

- **FR-001**: Each window MUST have at most one **active panel** — the focus context to which keyboard input and panel-scoped commands are routed. At any moment the active panel MUST be unambiguous.
- **FR-002**: The active panel MUST be **visibly indicated** in a way that is legible on every bundled theme, in two states: an **active** treatment when the panel's window is the foreground OS window, and a **dimmed inactive** treatment when it is not (the indicator persists in both states). The indication's colour(s) MUST derive from theme tokens (never hard-coded), consistent with the theming principle, and MUST include **distinct tokens for the active and inactive (dimmed) states**; every such token MUST be exposed in the Themes editor per the configuration-editor-completeness rule (constitution v3.11.0).
- **FR-003**: Activating a panel (by pointer, and — per FR-015 — by keyboard move-focus) MUST make it the active panel and MUST route subsequent keyboard input and panel-scoped commands to it and to no other panel.
- **FR-004**: Changing which panel or which view holds keyboard focus MUST NOT, by itself, cause a terminal resize or any content reflow (this restates and MUST remain consistent with feature 008 FR-013).
- **FR-005**: When the active panel is removed — closed by the user or destroyed by an external event — focus MUST fall back to a **deterministic** surviving panel in the same window: the panel immediately **preceding** the removed one in the tab's layout order (the same depth-first order used by focus-cycle, FR-015), or the one immediately **following** it when the removed panel was first in that order. This ensures the window is never left routing input to a panel that no longer exists, and never left with no active panel while panels remain, and the fallback target is predictable and testable rather than merely "sensible".
- **FR-006**: The focus context MUST be scoped **per window**: the main window and each sub-workspace window each have their own active panel. (This is distinct from, and MUST NOT be conflated with, the existing multi-window focus/raise group, which governs OS window Z-order, not the active panel within a window.)

#### Per-panel zoom

- **FR-007**: A user MUST be able to **zoom the text of the active panel's type** in and out, and **reset** it to its default, via distinct commands invoked against the active panel. These commands MUST change every panel of the active panel's type together, and MUST leave panels of other types and the window chrome unchanged.
- **FR-008**: Zoom level MUST be tracked **per panel type** — one level for terminal panels and one for editor panels — and each type's level MUST be **independent** of the other type's and of the app-wide global zoom, in the sense that changing one type's zoom never changes the other type or the chrome. A panel's **effective text size** MUST be the **composition** of the two: global zoom × its type's per-panel zoom factor (global zoom scales chrome and all content; the per-type factor further adjusts that type's content).
- **FR-009**: Reset MUST return a panel **type** to its **default (inherited) text size** and MUST be idempotent for a type already at its default.
- **FR-010**: Each panel **type's** zoom level MUST be **persisted as part of the per-project layout** and restored on restart, on tab switch, on pane split/join, and — for panels mirrored or torn into sub-workspaces — across detach and reattach. A layout with no stored zoom for a type MUST open panels of that type at their default with no migration required.
- **FR-011**: Per-type zoom MUST reuse the **same per-step increment and the same minimum/maximum bounds as the app-wide global zoom**, so the two zoom mechanisms behave identically; no separate range is introduced. A zoom command at a bound MUST be a no-op (or a soft, non-error signal) and MUST never render text illegibly small or unbounded large.
- **FR-012**: For a **terminal** panel, the character grid (columns and rows) MUST be computed from the panel view's own pixel dimensions **and** the terminal type's **per-type zoom size** (its base font size × the per-type zoom factor, expressed in CSS pixels). The app-wide **global zoom** is a whole-page scale that uniformly rescales the already-rendered terminal and MUST NOT change its columns or rows (it is *not* an input to the grid computation — only the per-type size is). The system MUST NOT assume a single global text size across a terminal's views (honouring feature 008's Assumptions). Where a terminal panel is shown in multiple views, each view MUST reflect the same (type-scoped) zoom level.
- **FR-013**: For **editor** panels, per-type zoom MUST change the rendered text size of the editor panels and MUST NOT alter any file's content, encoding, or line endings.

#### Commands & configuration

- **FR-014**: The zoom-in, zoom-out, and zoom-reset commands MUST be registered as **configurable, rebindable key bindings** that appear in the visual Key Bindings editor (constitution v3.11.0 configuration-editor completeness), and MUST be **distinct** from the existing app-wide global-zoom bindings (`zoom.in` / `zoom.out` / `zoom.reset`).
- **FR-015**: The move-focus commands (US3) MUST likewise be registered as configurable, rebindable key bindings that appear in the Key Bindings editor. They MUST ship with these defaults: `Ctrl+Alt+Left/Right/Up/Down` to move focus to the adjacent panel in that direction, and `Ctrl+`` ` / `Ctrl+Shift+`` ` to cycle focus forward/backward through panels. Cycling MUST traverse panels in a stable **layout order** (panes left→right, top→bottom; tabs in order within a pane), independent of focus history. A directional move with no panel in that direction MUST leave focus on the current panel (no wrap) without raising an error.
- **FR-016**: This feature establishes the focus-context routing that later, context-specific (terminal- vs editor-specific) key-binding **sets** will build on. Those context-specific binding sets are **out of scope** here; this feature only establishes the single active-panel context and routes today's global commands (zoom, move-focus) to it.
- **FR-017**: Any interactive **action control** this feature introduces (if a pointer-operable zoom or focus affordance is added) MUST be a themeable icon carrying a hover title, taking its icon and colours from theme tokens, per constitution v3.12.0 — not a text label or inline SVG. (Zoom and move-focus are primarily command/keybinding-driven; this requirement binds only any visible control that is added.)

### Key Entities

- **Focus context (active panel)**: the single panel within a window that receives keyboard input and panel-scoped commands. Exactly one per window (or none when the window has no panels). Not persisted as user data beyond restoring a sensible default on load; distinct from the multi-window focus/raise group.
- **Panel-type zoom level**: a text-size adjustment held **per panel type** (one for terminals, one for editors), stepped and clamped to the **same increment and min/max bounds as the app-wide global zoom**, defaulting to "inherited". Persisted as part of the per-project layout. Composes with the app-wide global zoom **per FR-008** to yield a panel's effective text size.
- **Active-panel indicator**: the visible treatment marking the active panel, with two states — an **active** treatment (its window is foreground) and a **dimmed inactive** treatment (its window is background) — each coloured from its own theme token and exposed in the Themes editor.
- **Panel-scoped commands**: zoom-in / zoom-out / zoom-reset and move-focus — configurable, rebindable key bindings shown in the Key Bindings editor, routed to the active panel, distinct from the existing global-zoom bindings.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a window with multiple panels, exactly one panel is shown as active at any time in 100% of trials. In its **active** state (window foreground) the indication meets **WCAG 2.1 AA non-text contrast (contrast ratio ≥ 3:1)** against the adjacent panel background on all bundled themes. In its **dimmed-inactive** state (window background) it is deliberately de-emphasised and need not meet the full 3:1 — but MUST remain **visually distinguishable** from the panel background at an explicit lower floor of **≥ 1.5:1** on all bundled themes, so the active panel is still identifiable when the window is not foreground.
- **SC-001a**: When a window with an active panel loses OS foreground focus, its active-panel indicator persists in the dimmed inactive state (never disappears and never keeps the foreground treatment) in 100% of trials.
- **SC-002**: Zooming the active panel changes the text size of every panel of that type together and leaves panels of other types and the window chrome unchanged in 100% of trials.
- **SC-003**: Each panel type's zoom level is restored after restart, tab switch, pane split/join, and sub-workspace detach/reattach in 100% of trials.
- **SC-004**: Changing which panel or view holds focus sends zero terminal resize messages while no view changes pixel size, regardless of focus changes (consistent with feature 008 SC-003).
- **SC-005**: A terminal panel that is zoomed renders legibly and reports a grid consistent with its own **per-type zoom size** in 100% of trials, with no view garbled; changing the app-wide global zoom alone leaves the terminal's columns and rows unchanged (per FR-012).
- **SC-006**: When the active panel is closed or destroyed, the deterministic fallback panel (FR-005 — the preceding panel in layout order) becomes active with no window left inputless, in 100% of trials.
- **SC-007**: The zoom and move-focus commands are all discoverable and rebindable in the Key Bindings editor (completeness test passes), and are distinct from the app-wide global-zoom bindings.
- **SC-008**: A user can move focus across all panels in a window and zoom the landed panel using the keyboard alone.
- **SC-008a**: Repeatedly issuing the cycle command visits every panel exactly once per full cycle in a stable layout order that does not depend on prior focus history, and the reverse-cycle command visits them in the exact reverse sequence, in 100% of trials.

---

## Assumptions

- **No verbatim original prompt existed for feature 012.** This specification was reconstructed from feature 008's explicit deferral (its *Out of Scope* and *Assumptions* sections) plus the branch name `012-focus-contexts-and-zoom`. See Clarifications → provenance. The two headline capabilities and the boundary against already-shipped features are firm; the finer decisions (zoom composition, persistence granularity, move-focus defaults, edge behaviour) were resolved in the 2026-07-11 clarification session recorded above.
- The app-wide **global zoom** (Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+wheel), delivered by features 001/003, already exists and is retained; this feature adds a *separate* per-panel-type zoom that **composes on top of** global zoom (per FR-008) and does not remove global zoom.
- **Zoom applies to exactly two panel types — terminal and editor.** Any non-terminal, text-content panel kind (present or future) shares the **editor** zoom bucket; there is no third zoom bucket in this feature. (Panel kinds that render no text are unaffected by per-type zoom.)
- **Move-focus default chords may be pre-empted by graphics drivers.** The default directional chords `Ctrl+Alt+Arrow` collide on some Windows systems with Intel/AMD graphics-driver **display-rotation** hotkeys, which may intercept the combo before throng sees it. Because all chords are **rebindable** via the Key Bindings editor, a user affected by this can reassign the move-focus commands (or disable the driver hotkey); throng does not attempt to override OS/driver-level hotkeys. The clarified default is retained for the common case where the driver hotkey is absent or disabled.
- The multi-window **focus/raise group** (OS Z-order across the main and sub-workspace windows) already exists and is unrelated to this feature's per-window active-panel focus context; the two must not be conflated.
- Panels, panes, tabs, and detached windows are already persisted per project (constitution Principle VI); the two per-type zoom levels (one terminal, one editor) are stored alongside that existing layout state, so no new persistence mechanism or migration is assumed beyond adding those levels to the project's layout record.
- The active panel is a runtime/UI concern restored to a sensible default on load; it is not treated as durable user data that must survive as an exact value across restarts (only the panels and the per-type zoom levels are durable).
- Default key-binding chords for the new commands are shipped as sensible defaults (move-focus: `Ctrl+Alt+Arrow` directional and `Ctrl+`` ` / `Ctrl+Shift+`` ` cycle; zoom: distinct from the app-wide global-zoom bindings) and are fully rebindable through the Key Bindings editor, so the exact defaults are low-lock-in.
- "Panel-scoped command" today means the zoom and move-focus commands introduced here; the broader family of terminal-/editor-specific bindings is a later feature that consumes this one's focus context.

## Out of Scope

- The app-wide **global zoom** and its bindings (already shipped; unchanged here).
- The multi-window **focus/raise group** / OS window Z-order (already shipped; unrelated).
- **Terminal-specific and editor-specific key-binding sets** — the context-specific binding families that build on this feature's focus context. This feature establishes the active-panel context and routing only.
- **Terminal search and scrollback navigation** (feature 013).
- **Full app-wide keyboard-only accessibility** — the cross-cutting pass tracked as issue #26. This feature's keyboard focus movement (US3) is a natural down-payment on it but does not attempt to make every control in throng keyboard-operable.
- Any change to how panels are dragged, cloned, split, or laid out (beyond keeping focus and zoom correct across those changes).
- Independent zoom of window **chrome** or the preferences window (this feature zooms panel *content* only).
