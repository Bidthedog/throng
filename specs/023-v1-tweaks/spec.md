# Feature Specification: v1.0.0 Tweaks — context-menu, explorer & About polish

**Feature Branch**: `feature/S023-v1-tweaks`

**Created**: 2026-07-22

**Status**: Draft

**Input**: User description: "Pull all \"Tweaks\" for the v1.0.0 milestone, then create a new worktree and create a single spec for all the tweaks."

**Source issues**: #125, #126, #139, #140 (all issues in the `v1.0.0` milestone carrying the `tweak` label).

## Overview

This feature bundles the four remaining v1.0.0 **Tweaks** — small adjustments to existing behaviour that add no new capability but raise consistency, discoverability, and perceived polish. Each is independently shippable:

| Story | Issue | Area | One-liner |
|-------|-------|------|-----------|
| US1 | #125 | context menus | Show a command's keyboard shortcut in brackets next to the menu label |
| US2 | #140 | file explorer | Double-clicking a directory in Single select mode opens it |
| US3 | #126 | context menus | Give context-menu items their icons wherever a token exists |
| US4 | #139 | About dialog | Load the third-party packages list asynchronously |

Because these are Tweaks, the guiding constraint is **no behaviour regressions**: anything that works today must keep working exactly as it does, and each change must degrade gracefully when its inputs are absent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keyboard shortcuts shown on context-menu items (Priority: P1)

A user right-clicks in the app (a tab, a panel handle, the explorer tree, a terminal) and sees, next to each menu label whose command has a keyboard shortcut, that shortcut rendered in brackets — e.g. `Copy (Ctrl+C)`. They learn the binding without opening the keybindings editor.

**Why this priority**: Highest-value polish of the four — it improves discoverability of every bound command across the whole app, and the change is maintainer-agreed (issue #125) so it is ready to proceed.

**Independent Test**: Open any context menu that contains at least one item whose command has a bound shortcut; confirm the bracketed shortcut appears, reflects the live keybinding configuration, and that items without a binding are unchanged.

**Acceptance Scenarios**:

1. **Given** a context-menu item whose command has one bound shortcut, **When** the menu opens, **Then** the item shows that shortcut in brackets after its label (e.g. `Copy (Ctrl+C)`), in text smaller than the label.
2. **Given** a command with more than one binding, **When** its menu item renders, **Then** only the **first** binding is shown.
3. **Given** a menu item whose command has no bound shortcut, **When** the menu opens, **Then** the item renders exactly as before — no trailing brackets and no layout shift relative to today.
4. **Given** the user has changed a keybinding, **When** the corresponding menu item next renders, **Then** the bracketed shortcut reflects the new binding (never a hard-coded string).

---

### User Story 2 - Double-click a directory to open it in Single select mode (Priority: P2)

In the Files & Folders tree with selection mode set to **Single**, a user double-clicks a directory row and that directory opens (expands/enters) — mirroring how double-clicking a file already opens it. The two gestures become consistent: double-click means "open", whatever the row's kind.

**Why this priority**: Directly fixes an interaction inconsistency users hit routinely while navigating; small, self-contained, and testable in isolation.

**Independent Test**: In Single select mode, double-click a directory row and confirm it opens; double-click a file and confirm it still opens; single-click either and confirm it only selects.

**Acceptance Scenarios**:

1. **Given** Single select mode, **When** the user double-clicks a directory row, **Then** that directory opens (expands/enters).
2. **Given** Single select mode, **When** the user double-clicks a file row, **Then** the file opens with its default action, exactly as today.
3. **Given** Single select mode, **When** the user single-clicks any row, **Then** the row is selected only — it does not open.
4. **Given** any selection mode other than Single, **When** the user interacts with the tree, **Then** behaviour is unchanged from today.

---

### User Story 3 - Icons on context-menu items (Priority: P3)

A user opening any context menu sees an icon next to each action that maps to a known icon token — consistent with surfaces (e.g. the terminal menu) that already show `copy`/`paste` glyphs — instead of a text-only row.

**Why this priority**: Visual consistency polish across many call sites; valuable but lower urgency than the interaction and discoverability fixes, and partly bounded by which icon tokens already exist (icon-token expansion is tracked separately under issue #127).

**Independent Test**: Open each context menu (panel handle, tab, explorer tree, terminal, etc.) and confirm that every action mapping to an existing icon token shows its icon, resolved through the active theme, and that iconless items stay cleanly aligned.

**Acceptance Scenarios**:

1. **Given** a context-menu action that maps to an existing icon token, **When** the menu opens, **Then** the action renders with its icon.
2. **Given** the active theme, **When** an icon renders, **Then** it resolves through the theme's icon tokens (no hard-coded assets) and, if a token is missing, the label still renders intact — never an empty gap or an error.
3. **Given** a menu that mixes icon and legitimately-iconless items, **When** it opens, **Then** spacing/alignment is unchanged for the iconless items (no ragged indentation).
4. **Given** an action for which no suitable token yet exists, **When** the audit is done, **Then** that gap is recorded for the separate icon-token work rather than blocking this change.

---

### User Story 4 - Asynchronous third-party list in the About dialog (Priority: P4)

A user opens "About throng" and the dialog paints immediately with its static content (name, version, etc.); the third-party / open-source packages list loads afterwards, showing a lightweight loading affordance until it populates in place. If the user closes the dialog before the list finishes, the in-flight load is cancelled.

**Why this priority**: Perceived-performance polish with no correctness impact — the dialog already shows the right information; it is simply slower to appear than it should be.

**Independent Test**: Open "About throng" and confirm static content paints without waiting for the list; observe the loading affordance then the populated list; close the dialog mid-load and confirm the load is cancelled and no orphaned work continues; confirm the list content, once loaded, is identical to today's.

**Acceptance Scenarios**:

1. **Given** the About dialog is opened, **When** it appears, **Then** its static content is painted without waiting for the third-party packages list.
2. **Given** the dialog is open and the list is still loading, **When** the load is in progress, **Then** a loading indicator is shown in the list's place.
3. **Given** the list resolves, **When** it is ready, **Then** it populates in place and its content is unchanged from today's list.
4. **Given** the dialog is open and the list has not yet resolved, **When** the user closes the dialog, **Then** the in-flight load is cancelled (no orphaned work continues).

---

### Edge Cases

- **US1**: A command bound to a chord/multi-key sequence — the bracketed text must render the whole first binding, not a truncated fragment. A very long shortcut string must not push the menu to an unreadable width.
- **US1**: A command whose only binding is later unbound — the item must fall back to no brackets, not show a stale shortcut.
- **US2**: Double-click on the chevron/expand affordance of a directory must not double-toggle (open-then-close); the existing expand affordance keeps working.
- **US2**: A double-click that lands across two different rows (pointer moved) must not be treated as an open on either row.
- **US3**: A theme that defines none of the relevant icon tokens must still render every menu item's label with correct alignment.
- **US4**: The packages list fails to load — the failure is surfaced within the dialog (the dialog itself still works); this is explicitly a Tweak, not error-handling for a broken list, so a graceful "couldn't load" state is acceptable and total absence of the list is out of scope to fix here.
- **US4**: The dialog is reopened quickly after being closed mid-load — a fresh load starts cleanly without leaking the cancelled one.

## Requirements *(mandatory)*

### Functional Requirements

**US1 — context-menu shortcuts (#125)**

- **FR-001**: A context-menu item whose command has a bound keyboard shortcut MUST display that shortcut in brackets after the label (e.g. `Copy (Ctrl+C)`).
- **FR-002**: When a command has multiple bindings, the menu item MUST display only the **first** binding.
- **FR-003**: The displayed shortcut MUST be derived from the live keybinding configuration, never a hard-coded string, and MUST update when the binding changes.
- **FR-004**: A context-menu item whose command has no bound shortcut MUST render exactly as it does today — no trailing brackets, no layout shift.
- **FR-005**: The bracketed shortcut text MUST be visually smaller than the menu item's label text.

**US2 — explorer double-click (#140)**

- **FR-006**: In **Single** select mode, double-clicking a directory row MUST open (expand/enter) that directory.
- **FR-007**: In **Single** select mode, double-clicking a file row MUST continue to open it with its default action, unchanged from today.
- **FR-008**: Single-click MUST continue to select the row only (not open it) in Single select mode.
- **FR-009**: Behaviour in all selection modes other than Single MUST be unchanged.

**US3 — context-menu icons (#126)**

- **FR-010**: Every context-menu action that maps to an existing icon token MUST render with its icon; the audit MUST cover all `openMenu(...)` call sites (panel handle, tab, explorer tree, terminal, and any others).
- **FR-011**: Icons MUST resolve through the active theme's icon tokens with no hard-coded assets, and MUST degrade gracefully when a token is missing — a missing icon leaves the label intact, never an empty gap or an error.
- **FR-012**: Menu layout and spacing MUST remain unchanged for items that legitimately stay iconless (no ragged indentation between icon and non-icon rows).
- **FR-013**: Where a common action has no suitable icon token yet, the gap MUST be recorded for the separately-tracked icon-token work rather than blocking this change; such an item may remain iconless.

**US4 — About dialog async list (#139)**

- **FR-014**: The About dialog MUST paint its static content (name, version, etc.) without waiting for the third-party packages list.
- **FR-015**: The third-party packages list MUST load asynchronously and populate in place when ready, showing a loading affordance until then.
- **FR-016**: Closing the dialog before the list resolves MUST cancel the in-flight load so no orphaned work continues.
- **FR-017**: The list content, once loaded, MUST be identical to what the dialog shows today.

**Cross-cutting**

- **FR-018**: No change in this feature may regress existing behaviour; each Tweak MUST be independently verifiable and MUST leave untouched surfaces byte-for-byte identical in behaviour.

### Key Entities

- **Context-menu item**: a labelled, optionally-iconed action row that maps to a command; may have zero or more keyboard bindings. Relevant to US1 and US3.
- **Keybinding**: a mapping from a command to an ordered list of key chords; the *first* entry is the one surfaced in menus (US1).
- **Selection mode**: the explorer tree's row-interaction mode (Single vs. others); governs which gestures open vs. select (US2).
- **Third-party packages list**: the dependency/licence listing shown in the About dialog, loaded independently of the dialog's static content (US4).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In every context menu that contains at least one bound command, 100% of items with a binding show the correct first binding in brackets, and 100% of items without a binding are visually unchanged from before the change.
- **SC-002**: After a user changes a keybinding, the corresponding menu item shows the new shortcut the next time the menu opens — 0% stale shortcuts.
- **SC-003**: In Single select mode, double-clicking a directory opens it in 100% of attempts; single-click never opens; file double-click behaviour is unchanged.
- **SC-004**: Across all audited context menus, every action that maps to an existing icon token renders its icon; no theme causes a missing-icon gap, error, or misaligned row.
- **SC-005**: The About dialog's static content is visible essentially immediately on open (no wait for the packages list), and closing it mid-load leaves no background work running.
- **SC-006**: No existing behaviour regresses — the pre-existing test suites for the affected surfaces stay green, and the four Tweaks are each demonstrable in isolation.

## Assumptions

- The four Tweaks in the `v1.0.0` milestone carrying the `tweak` label (#125, #126, #139, #140) are the complete and intended scope; no other milestone issues are in scope.
- Issue #125 is maintainer-agreed and may proceed through the full lifecycle; the other three are treated as agreed by virtue of being pulled into this bundled spec at the user's request.
- The shared context-menu (`MenuItem` / `ContextMenu`) plumbing already supports an optional `icon` token and shortcut display is an additive render concern — no new menu framework is introduced.
- Expansion of the theme icon-token set is tracked separately (issue #127) and is a **dependency, not a blocker**: US3 reuses existing tokens and records gaps rather than adding new tokens here.
- "First binding" for US1 means the first entry in the command's ordered binding list as the keybinding system already orders them.
- US4's scope is perceived-load and cancellation only; fixing a *failed* or *absent* list is out of scope (that would be a Bug, not a Tweak).
- Each Tweak can ship as its own commit/PR slice if desired, since they are independent; the single spec exists to plan and track them together.
