# Feature Specification: Terminal Status-Bar Toggles

**Feature Branch**: `feature/S076-I669-terminal-status-bar-toggles`

**Created**: 2026-11-18

**Status**: Clarified

**Input**: User description: issues [#669](https://github.com/Bidthedog/throng/issues/669) "Status-bar toggles
for a terminal's remember-command and reopen-directory settings" and [#673](https://github.com/Bidthedog/throng/issues/673)
"Ignore attention notifications from a specific terminal panel", grouped as one v1.0.0 milestone entry, "Terminal
status-bar toggles — remember-command, reopen-directory and terminal-notifications toggles on each terminal, saved to
the panel". The milestone entry originally also carried #169 (terminal horizontal scrolling and a word-wrap toggle); that
was dropped at clarification (see Clarifications, Q1).

## Background

The terminal status bar (024 US1, FR-001) was built "to host per-terminal affordances", and so far hosts none: it
shows the shell flavour label and, since 045 FR-167, the hovered link's target. Two issues now want a control on it,
each at its **bottom right**, and each acting on one terminal panel:

| Toggle | Issue | Per-panel value today | Global default today |
|---|---|---|---|
| **Remember the last running command** | #669 | `rememberCommand` (025 FR-015), set on the setup form only | `terminals.defaultRememberCommand` (039 FR-001) |
| **Reopen in the last directory** | #669 | `rememberDirectory` (025 FR-027b), set on the setup form only | `terminals.defaultRememberDirectory` (039 FR-001) |
| **Terminal notifications** | #673 | none | none |

Specified separately they would arrive as three controls with three looks, two persistence rules and two menu
placements. This spec makes them **one toggle row with one persistence model**: each toggle is a per-panel value
stored in the panel's configuration; a panel with no stored value shows and obeys a global preference (039 FR-005a's
read-side resolution); flipping the toggle writes an explicit value; and each toggle has a menu item, so hiding the
status bar (`terminals.showStatusBar`, 024 FR-001b) never strands it.

### Requirements this spec builds on, and what it changes

| Requirement | What it says | This spec |
|---|---|---|
| 024 FR-001 | The terminal bar shows the flavour label "and MUST NOT carry a wrap toggle (FR-003e)" | **Extended** by FR-001: the bar gains a toggle row at its right. The wrap prohibition **stands unchanged** — this spec adds no wrap toggle (Clarifications, Q1) |
| 024 FR-001b / FR-001c | Status-bar visibility preference; hiding a bar hides only that surface | **Unchanged**, and relied on: FR-005 gives every toggle a route that survives the bar being hidden |
| 024 FR-002, FR-003e | No terminal wrap toggle, no "Terminal default word wrap" preference | **Unchanged** |
| 025 FR-015 | The command-memory control lives on the empty-panel setup form | **Extended**: the same per-panel value is also flipped from the status bar and the menu while the terminal runs (FR-010) |
| 025 FR-027b | Directory memory has its own per-panel control; off stops recording and launching into the remembered directory | **Extended** the same way (FR-012). Its "off" semantics are unchanged |
| 025 FR-007 | Exactly two routes edit the **Startup Command**; no third surface | **Not amended.** FR-007 governs the command text; these toggles change only the memory *flags*, which FR-007a already lists as form-edited values. The text is still edited only by FR-007a and FR-007b |
| 039 FR-005a, FR-006 | An absent per-panel value resolves to the global preference, read-side; nothing is written back | **Applied** to all three toggles (FR-003), including the new notifications default for panels created before this feature (Clarifications, Q4); a toggle flip is an explicit user write, not a migration, so FR-006 is not breached |
| 057 FR-008, FR-063, FR-128 | A producer withdraws its own marks; the master switch withdraws only the terminal producer's marks, never a manual Flag | **Extended** by FR-022: turning a panel's notifications off withdraws that panel's terminal-producer marks, and leaves a manual Flag alone |
| 057 FR-060–FR-067a | The seven terminal signals, recognised for every running terminal, including with no window open | **Narrowed** by FR-021: a signal from a panel whose notifications are off raises nothing |
| Constitution VI, "Every panel action is reachable" (v6.0.0) | A hideable route MUST NOT be a command's only route; a toggle's menu item renders its state | **Met** by FR-005 |
| Constitution, Themeable icon controls | Action controls are theme icons with hover titles | **Met** by FR-002 |

## Clarifications

### Session 2026-11-18

- Q1: Does #169 (terminal horizontal scrolling and a word-wrap toggle) belong in this spec? → A: **No — dropped
  entirely.** The maintainer judged terminal horizontal scrolling not a viable solution, and #169 has been closed as
  not planned. This spec carries no word-wrap toggle, no wrap preference, no wrap command, no horizontal-scroll spike
  and no column-width rule. 024 FR-001's and FR-003e's prohibitions on a terminal wrap toggle stand unchanged.
- Q2: With wrap off, what width does the shell see? → **Void** (it concerned #169, dropped under Q1).
- Q3: Is a terminal's wrap state persisted? → **Void** (it concerned #169, dropped under Q1).
- Q4: Does "Terminal notifications by default" reach existing panels? → A: **Yes — read-side resolution.** A
  panel that has never set the value, including every panel created before this feature, resolves to the global
  default at read time, exactly as `rememberCommand` and `rememberDirectory` do under 039 FR-005a. Nothing is written
  back (039 FR-006).
- Q5: Is a terminal with notifications off marked anywhere but its status bar? → A: **No.** The toggle is both the
  visual indicator and the control; with the status bar hidden, the unchecked content-menu item states it. No header
  glyph or other indicator is added.

### Session 2026-11-19

- Q6: Should #673's control be a negative "Ignore" toggle? → A: **No — the maintainer inverted it.** It was specified
  as "Ignore terminal notifications" (per-panel `ignoreNotifications`, `true` = silenced; preference
  `terminals.attention.ignoreByDefault`, shipped off, in Terminal › Attention; command
  `terminal.toggleIgnoreNotifications`; a `bell-off` glyph). It is now a positive **Terminal notifications** toggle:
  per-panel `notifications`, `true` = the terminal may raise marks, toasts and OS notifications, `false` = silenced;
  preference **Terminal notifications by default** (`terminals.defaultNotifications`), shipped **on**, placed in the
  Terminal group directly after `terminals.defaultRememberDirectory` beside the other New Panel seeds, still not gated
  on `terminals.attention.enabled`; command `terminal.toggleNotifications`; icon token `terminalNotifications`, a plain
  Lucide `bell`. All three toggles now read the same way: on means the feature is active.
- Q7: How do the toggles show on and off, and what do they say? → A: On is drawn in the theme's full-contrast text
  colour on the pressed background; off is the muted text colour with a diagonal line struck through the glyph, drawn
  by CSS so a user's own icon set gets it too. The hover title and accessible name read "<setting>: enabled" or
  "<setting>: disabled", followed by " (<chord>)" when one is bound — for example "Terminal notifications: disabled
  (Ctrl+Alt+I)". Recorded in FR-002.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Change what a running terminal remembers, from its status bar (#669, Priority: P1)

A user is running a dev server in a terminal whose panel remembers its last command. They decide they no longer want
it restarted every time throng opens. Today the only route is to close the terminal, which returns the panel to its
setup form, untick the box and start it again. With this story, the bottom right of the terminal's status bar shows
two toggles — **Remember the last running command** and **Reopen in the last directory** — each showing the panel's
current value. One click flips it, the panel's stored configuration changes at once, and the next time the terminal
ends or reopens it behaves accordingly. The same two toggles are checkable items in the terminal's menu.

**Why this priority**: The moment a user wants to change these is while they are working in the terminal, and today
that costs them the running process.

**Independent Test**: With a terminal running `ping` (or any long-lived command) in a panel that remembers its
command, turn Remember command off from the status bar; close and reopen the project; the command is not re-run.
Turn it back on, run another long-lived command, reopen; that command is re-run. Repeat for Reopen directory with a
`cd`. In every case the setup form, when the terminal is closed, shows the value last toggled.

**Acceptance Scenarios**:

1. **Given** a terminal panel, **When** its status bar renders, **Then** a Remember-command toggle and a
   Reopen-directory toggle sit at its bottom right, each showing the panel's current value — the panel's own stored
   value if it has one, otherwise the global preference (039 FR-005a).
2. **Given** a running terminal with Remember command on, **When** the user turns it off and the terminal later ends
   with a command running, **Then** the saved Startup Command is unchanged (025 FR-018).
3. **Given** a running terminal with Remember command off, **When** the user turns it on and the terminal later ends
   with a command running, **Then** that command becomes the saved Startup Command (025 FR-016).
4. **Given** Reopen directory toggled off, **When** the terminal is next started, **Then** it starts in the directory
   it would start in with no remembered directory (025 FR-031), not the last one; toggled on, it starts in the last
   one (025 FR-028).
5. **Given** either toggle has been flipped, **When** throng is restarted, **Then** the toggle shows the flipped value,
   and the panel's setup form (025 FR-007a) shows it too.
6. **Given** a panel with no stored value for a toggle, **When** the user flips it, **Then** the panel stores an
   explicit value, and later changes to the global preference no longer affect that panel (039 FR-005, FR-006).
7. **Given** the terminal status bar is hidden (`terminals.showStatusBar` off), **When** the user opens the terminal's
   menu, **Then** both settings are there as checkable items reflecting the current values, and choosing one does
   exactly what the toggle does.

---

### User Story 2 - Stop one noisy terminal from asking for my attention (#673, Priority: P1)

A user keeps a watcher and a dev server running in a project. Each exits, rings the bell or goes quiet as a matter of
course, and each time 057 marks its panel, tab and project, and may raise a toast or an OS notification. They care
about the other terminals in the project. With this story they turn off **Terminal notifications** on the
noisy panel's status bar: any mark that panel holds is withdrawn, and from then on nothing that happens in that
terminal raises a mark, a toast, a Notifications-panel entry, an OS notification or a taskbar count. The other
terminals are untouched. A Terminal preference, **Terminal notifications by default** (shipped on), chooses
the value for every panel that holds none — new panels and panels created before this feature alike.

**Why this priority**: The only route today is to turn attention off for every terminal (057 FR-063) or to turn a
signal off everywhere (057 FR-061), which silences the terminals the user does care about.

**Independent Test**: In one tab, open two terminals. Turn Terminal notifications off in the first, then make both
ring the bell and exit while another panel has focus. Only the second terminal's panel, tab and project are marked,
and only it raises a toast. Turn Terminal notifications back on in the first; its next bell raises a mark.

**Acceptance Scenarios**:

1. **Given** a new terminal panel and the preference at its shipped value, **When** it renders, **Then** the Terminal
   notifications toggle is on, and the terminal's exits, bells and finished commands raise marks as 057 specifies.
2. **Given** a terminal panel holding an attention mark, **When** the user turns Terminal notifications off, **Then**
   that mark is withdrawn from the panel and from every holder (tab, project, category, taskbar badge), and any toast
   or OS notification it raised is dismissed (057 FR-036).
3. **Given** a terminal with notifications off, **When** any of the seven terminal signals (057's Terminal signals
   table) occurs in it, including while no window is open (057 FR-066), **Then** no mark, toast, Notifications-panel
   entry, OS notification or taskbar count results.
4. **Given** two terminals in the same tab, one with notifications off, **When** both raise signals, **Then** the other
   terminal's panel, the tab and the project are marked as normal.
5. **Given** a terminal with notifications off, **When** the user turns them back on, **Then** the next signal raises
   a mark as normal, and signals that arrived while they were off are not replayed.
6. **Given** a terminal with notifications off, **When** the user chooses **Flag** from its menu (057 FR-125), **Then**
   the panel is flagged; the toggle governs the terminal producer only.
7. **Given** the preference **Terminal notifications by default** turned off, **When** the user creates a terminal
   panel, **Then** its setup form starts with Terminal notifications unticked and the panel starts silenced; a panel
   holding an explicit value keeps it.
8. **Given** the preference turned off, **When** an existing terminal panel that has never set the value is shown,
   **Then** its toggle shows notifications off and its terminal raises no marks; turning the preference back on
   restores it, because nothing was written to the panel (039 FR-005a, FR-006).
9. **Given** the setting has been toggled, **When** throng restarts, **Then** the panel's notifications are still off
   (or on), and the setup form shows the value.

---

### User Story 3 - One row of toggles that look and behave alike (Priority: P2)

The three toggles form one group at the right of the terminal status bar, in a fixed order, each a themeable icon
whose hover title and accessible name state the setting and its current state, each keyboard-reachable, and each with
a checkable item in the same menu section. A narrow panel never pushes a toggle off the bar.

**Why this priority**: It is what makes US1 and US2 one feature instead of two, but each of those stories is valuable
on its own.

**Independent Test**: In a component test, render the status bar for a panel with each toggle on and off, in each of
two themes, at a narrow and a wide width: every toggle is present, in order, with the right pressed state, accessible
name and theme-derived icon colours; tabbing reaches each one; Space and Enter flip it.

**Acceptance Scenarios**:

1. **Given** a terminal status bar, **When** it renders, **Then** the flavour label and link readout stay at the left
   and the toggles sit together at the right, in the order Remember command, Reopen directory, Terminal
   notifications.
2. **Given** any toggle, **When** it is hovered or focused, **Then** its title and accessible name state the setting
   and whether it is enabled, followed by its chord when one is bound (for example "Remember the last running command:
   enabled", or "Terminal notifications: disabled (Ctrl+Alt+I)").
3. **Given** a panel narrowed until the bar cannot hold everything, **When** it renders, **Then** the link readout
   truncates first and no toggle is hidden or overlaps the label.
4. **Given** a theme change, **When** the bar renders, **Then** each toggle's glyph and colours come from the new
   theme's icon set and tokens.

---

### Edge Cases

- **A toggle flipped while the terminal is ending.** The flip and the capture race. The stored flag at the moment the
  capture decision is taken governs; a flip that lands after the decision governs the next terminal end. The toggle
  never shows a value the panel does not hold.
- **A toggle flipped while the panel's terminal is not running** (exited, or dormant under 039's Manual reload). The
  status bar is not shown on a panel in its setup-form state; where the bar is shown over a dormant or exited
  terminal, flipping writes the panel's configuration exactly as on a running one.
- **The same panel shown in two windows** — impossible today (a Panel lives in one place), but a sub-workspace window
  shows the panel's status bar like the main window does, and flips from there persist identically.
- **Remember directory turned off, then on again.** Nothing is cleared on "off" (025 FR-027b stops recording and
  launching, it does not forget). Turning it back on resumes recording; the last remembered directory is still the
  candidate until a new one is recorded, and 025 FR-030's fallback still applies if it has gone.
- **Notifications turned off while a toast from that terminal is on screen, or an OS notification is in the system
  tray.** Both are dismissed with the mark (057 FR-036). An OS notification the operating system has already moved
  into its own history cannot be recalled; throng withdraws what it can and raises nothing new.
- **Notifications off on an exited terminal with a non-zero code.** No Failed mark is raised, but the exit is still
  shown in the panel itself with its code (Principle III: an unexpected exit surfaces its output and code) — the toggle
  silences the attention system, not the terminal's own failure trace (Principle XIII).
- **The toggle and the attention master switch.** With `terminals.attention.enabled` off nothing is raised anyway;
  Terminal notifications is still shown and stored, and takes effect again when the master switch is turned back on.
- **The notifications preference turned off with existing panels.** Every panel that holds no value is silenced at
  once and its terminal-producer marks are withdrawn, as if each had been toggled (Clarifications, Q4); each toggle
  shows the resolved state, so the effect is visible and one click undoes it per panel. Panels holding an explicit
  value are unaffected.
- **A terminal with notifications off and the status bar hidden.** Nothing on the panel header says it is silenced
  (Clarifications, Q5); the unchecked content-menu item is the indicator.
- **A failure of throng's own machinery about a silenced terminal** — a capture discarded as malformed (025 FR-026b),
  a persistence write that fails — is a failure notice, not an attention signal, and is raised as normal.
- **Persisting a flip fails** (config write error). The toggle returns to the stored value and the failure is
  reported through the failure-presentation path (030), naming the setting; the toggle never shows a value that was
  not saved.
- **A layout saved before this feature** opens with no stored value for any toggle; every toggle shows the resolved
  global preference and nothing is written until the user flips one (039 FR-006).
- **A panel destroyed** takes its toggle values with it (025 FR-007d); a panel created in the same position starts
  from the preferences.

## Requirements *(mandatory)*

### Functional Requirements

#### A. The toggle row (all stories)

- **FR-001** *(extends 024 FR-001)*: The terminal status bar MUST carry a group of per-panel toggles at its **right**,
  with the flavour label and the link readout (045 FR-167) at its left. The group's order MUST be Remember the last
  running command, Reopen in the last directory, then Terminal notifications. 024 FR-001's prohibition on a
  wrap toggle stands.
- **FR-002**: Each toggle MUST be a themeable icon control (constitution, Themeable icon controls): a glyph from the
  active icon set, colours from theme tokens, and a pressed state when on. On, the glyph is drawn in the theme's
  full-contrast text colour on the pressed background; off, it is the muted text colour with a diagonal line struck
  through the glyph, drawn by CSS. Each glyph ships plain (a whole bell, not a crossed one) and the line is the off
  state's, so a user's own icon set gets the same treatment (Clarifications, Q7). Each also carries a hover title and
  accessible name of the form "<setting>: enabled" or "<setting>: disabled", followed by " (<chord>)" when a chord is
  bound — for example "Terminal notifications: disabled (Ctrl+Alt+I)". Each MUST be reachable by keyboard and flipped
  by Space and Enter. Each new glyph MUST be an icon token present in every shipped icon set and theme.
- **FR-003** *(applies 039 FR-005a)*: Each toggle MUST show the panel's own stored value when it has one, and
  otherwise the global preference for that setting, resolved at read time. Nothing is written back by resolution.
  This holds for panels created before this feature (Clarifications, Q4).
- **FR-004**: Flipping a toggle MUST write an explicit value to the panel's stored configuration at once, so that it
  survives a restart, is shown by the panel's setup form (025 FR-007a), and is no longer affected by the preference.
  If the write fails, the toggle MUST show the value actually stored, and the failure MUST be reported (030).
- **FR-005** *(constitution VI, v6.0.0)*: Each toggle MUST also be a **checkable item in the terminal's content menu**,
  in its **View & state** section, reflecting the current value and doing exactly what the toggle does. The items
  MUST be present whether or not the terminal status bar is shown.
  *(2026-11-22, the maintainer: "these menu options need icons. Use the same icons as are used in the terminal status
  bar, including those that are crossed out if they are disabled.")* Each item MUST draw its toggle's status-bar icon,
  struck through while the setting is off, exactly as the toggle draws it (FR-002).
  *(Amended 2026-11-28, v1 review, #732: the checkable items are on the terminal panel's **title** menu, View & state (the panel-type group), each showing its bound chord, not the content menu: each is a setting of the panel. Same presence, icons and flip.)*
- **FR-006**: Each toggle MUST be a command listed in the Key Bindings editor with a label and description, **with no
  default chord**. A user who binds one MUST NOT be offered a reserved terminal key (constitution IV).
- **FR-007**: Width pressure MUST NOT hide or overlap any toggle; the link readout truncates first, then the flavour
  label.
- **FR-008**: The toggles MUST act on one panel only. No toggle flip MUST change another panel's value or any global
  preference.

#### B. Remember command and reopen directory (#669)

- **FR-010** *(extends 025 FR-015)*: The **Remember the last running command** toggle MUST flip the same per-panel
  value the setup form's checkbox sets. With it off, the saved Startup Command MUST change only by explicit edit
  (025 FR-018); with it on, a terminal end with a command running MUST capture it (025 FR-016, FR-017). Turning it off
  MUST NOT clear the saved Startup Command or anything else.
- **FR-011**: A flip MUST take effect for the running terminal without restarting it: the capture decision taken at
  that terminal's end MUST read the value current at that moment.
- **FR-012** *(extends 025 FR-027b)*: The **Reopen in the last directory** toggle MUST flip the same per-panel value
  the setup form's checkbox sets, with 025 FR-027b's meaning unchanged. Turning it off MUST NOT clear the remembered
  directory.
- **FR-013**: **Run as administrator** MUST NOT be offered as a toggle: changing it needs a respawn, and 039 FR-008a
  governs it.

#### C. Terminal notifications (#673)

- **FR-020**: A per-panel **Terminal notifications** value MUST exist, stored in the panel's configuration,
  settable from the toggle, the menu item and a checkbox on the terminal setup form. On (`true`) lets the terminal
  raise marks, toasts and OS notifications as 057 specifies; off (`false`) silences it (Clarifications, Q6).
- **FR-021** *(narrows 057 FR-060–FR-067a)*: While a panel's notifications resolve off, none of the seven terminal
  signals from it MUST raise a mark on the panel or any holder, an in-app toast, a Notifications-panel entry, an OS
  notification or a taskbar count. The decision MUST be taken where 057 decides a mark, so marks raised with no window
  open (057 FR-066) obey it too.
- **FR-022** *(extends 057 FR-008)*: A panel's notifications turning off — by its toggle, its menu item, or the global
  default turning off for a panel that holds no value — MUST withdraw every mark the terminal producer holds for that
  panel, with the notifications FR-036 dismisses. It MUST NOT withdraw a manual **Flag** (057 FR-125, FR-128).
- **FR-023**: Turning Terminal notifications back on MUST let the next signal raise a mark as normal. Signals that
  occurred while they were off MUST NOT be replayed or remembered.
- **FR-024**: Turning Terminal notifications off MUST NOT suppress the terminal's own exit display (Principle III),
  nor any failure notice about the panel that is not an attention signal (025 FR-026b, 030).
- **FR-025** *(applies 039 FR-005a)*: A global setting **Terminal notifications by default**
  (`terminals.defaultNotifications`) MUST exist in Preferences, in the **Terminal** group directly after
  `terminals.defaultRememberDirectory` beside the other New Panel seeds, in no subgroup, a toggle with a description,
  shipped **on**, editable in the visual Preferences UI. It is not gated on `terminals.attention.enabled`. It seeds the
  setup form for a new panel and is the resolved value for every panel holding none, including panels created before
  this feature (FR-003; Clarifications, Q4, Q6).
- **FR-026**: A terminal with notifications off MUST NOT be indicated anywhere beyond its status-bar toggle and its
  unchecked content-menu item; no panel-header glyph or other indicator is added (Clarifications, Q5).

#### E. Documentation

- **FR-050**: `docs/preferences.md`, `docs/key-bindings.md` and the terminal sections of the user documentation MUST
  describe the new toggles, setting and commands in the same change (constitution, Documentation currency).

Section D and FR-030–FR-046 (terminal word wrap, #169) were removed at clarification (Q1); those numbers are retired
and not reused.

### Key Entities

- **Terminal panel configuration**: what a terminal panel persists to reconstitute its terminal (025). Gains
  `notifications` beside the existing `rememberCommand` and `rememberDirectory`. Each is optional; absent
  resolves to its global preference (FR-003).
- **Panel toggle**: one setting presented on the status bar and in the content menu — a stored per-panel value, its
  global preference, an icon token, a command id and a label. One shape for all three.
- **Global preferences**: `terminals.defaultRememberCommand` and `terminals.defaultRememberDirectory` (existing, 039),
  and **Terminal notifications by default** (new, US2).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can stop a running terminal's command from being restarted on reopen in **one click**, without
  closing the terminal; today it takes closing the terminal, editing the form and starting it again.
- **SC-002**: 100% of toggle flips survive an application restart and are what the panel's setup form shows.
- **SC-003**: With one terminal in a tab silenced, **zero** marks, toasts, Notifications-panel entries, OS
  notifications or taskbar counts originate from it across all seven signals, while every other terminal in the
  same tab and project raises them exactly as before.
- **SC-004**: Turning Terminal notifications off clears that panel's existing marks from the panel and every holder within the same
  interaction (no further user action).
- **SC-005**: Every toggle is reachable with the status bar hidden, through a checkable menu item showing its state.
- **SC-006**: Every toggle passes the themeable-icon, accessible-name and keyboard checks in each shipped theme.

SC-007 and SC-008 (terminal word wrap, #169) were removed at clarification (Q1).

## Assumptions

- The New Panel setup form is "the panel's settings" the issues refer to; there is no separate panel settings dialog
  (025 FR-007).
- The toggles live in the terminal's **content** menu; the panel header menu is not extended.
- New icon tokens are needed for the three settings (for example a history glyph, a folder glyph and a plain bell
  glyph from the default Lucide set, 069). Adding theme leaves follows the shipped-defaults versioning rule.
- `terminals.showStatusBar` stays in the Terminal group; the toggles are controls, not readouts, so 040's #258 answer
  ("mirror the Status Bar subsection only if the terminal bar gains readouts") is unaffected.
- The status bar is not shown on a panel in its setup-form state, so a toggle never acts on a panel with no terminal
  configuration.
- Testing follows Principle V's lowest-layer rule: rendering, pressed state and keyboard behaviour are component
  tests; the read-side resolution and capture rules are unit tests; the silencing decision is a daemon-side unit or
  integration test; persistence across restart and a toast not appearing are integration tests.
