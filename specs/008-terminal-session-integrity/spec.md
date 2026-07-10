# Feature Specification: Terminal Session Integrity

**Feature Branch**: `008-terminal-session-integrity`

**Created**: 2026-07-10

**Status**: Clarified — ready for planning

**Depends on**: nothing. This feature may be developed and merged independently.

**Input**: Two defects in terminal panels. (1) Dragging a tab containing a terminal into a new sub-workspace kills the program running inside it; the sub-workspace reports a connection timeout and the original terminal drops back to a bare command prompt. (2) When the same terminal is shown in two windows at different sizes, one of the two displays becomes garbled.

---

## Clarifications

### Session 2026-07-10

- Q: When one terminal session is presented in two views of different pixel sizes, how should the character grid be sized? → A: **Smallest common size.** The grid is the minimum columns and minimum rows across all attached views. Every view can render the whole grid; larger views show inert padding. No oscillation, and no view is ever corrupt.
- Q: What may terminate a terminal session? → A: Only destroying its owning panel, closing the last view of a panel owned by a sub-workspace, or an explicit user request. Never a window move, a re-render, or a change in the panel's resolved identity.
- Q: What happens when establishing a session takes longer than its time budget? → A: The underlying session is left running. The requesting view offers an explicit retry that reattaches to the existing session rather than replacing it.
- Q: How are the several views of one panel identified, where does the grid minimum live, and how is a lost view detected? → A: **View identity and the minimum live in the daemon; detach is explicit.** Attach and resize carry a view id — `attach(panelId, viewId, cols, rows)`, `resize(panelId, viewId, cols, rows)`, `detach(panelId, viewId)`. The daemon tracks each view's dimensions, computes `grid = min(cols), min(rows)` across every attached view of the panel, and issues a single PTY resize. The daemon is the only component that observes every window, so the minimum is unit-testable with no windows open at all. The `detach` message is backed by a window-close notification from the main process, so a crashed or force-closed renderer can never strand a view.
- Q: What exactly stops the launch-key reap that loses the running program — dropping the working directory, refusing to reap, or both? → A: **Both, not either.** `launchKey = [file, args, runAsAdmin]`. Dropping `cwd` means a mirrored panel can never trigger a reap, which is the direct cause of the data loss. Independently, a session that is still running is never reaped, even when a genuine re-type is detected. `file`/`args`/`runAsAdmin` still distinguish a real re-type (different flavour, admin toggle). Belt and braces: either fix alone leaves the defect reachable by another path.
- Q: How is the working directory resolved for a panel mirrored into a sub-workspace, so it can never attach at the wrong root? → A: **Resolve ownership in the window; mirrors reuse regardless.** The sub-workspace window loads the origin project and derives its root, holding a loading state until it resolves (FR-001) — this makes a cold start correct. Separately, because the session already exists keyed by panel, a mirror attach reuses it whatever root it would have computed. Correctness plus safety net.
- Q: What is the session-establishment budget, and how is exceeding it presented? → A: **Attach gets its own budget; a timeout is a retryable "still starting" state, not an error.** `attachTimeoutMs` is separate from and much larger than `pingTimeoutMs` (which stays for health checks). Exceeding it MUST NOT revert the panel to the type-selection form, MUST NOT surface as a hard error, and MUST NOT terminate the session; it renders as a non-fatal "still starting" state carrying a retry affordance. Retry is a plain re-attach, made idempotent by session reuse.
- Q: What form must the retry affordance take? → A: **An action control.** Per constitution v3.12.0 it MUST be a themeable icon with a hover title, taking its icon and colours from theme tokens — not an inline SVG, not a text button. It is not a dialog decision button, so the exception does not apply.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A running program survives being moved into a sub-workspace (Priority: P1)

A developer has a long-running interactive program — an AI coding assistant, a build watcher, an SSH session — inside a terminal panel belonging to a project. They drag the tab containing that panel into a new sub-workspace window. Today the program is killed, the sub-workspace shows a connection timeout, and the original terminal returns to a bare prompt. The developer expects the program to keep running, and to be visible and usable in both windows.

**Why this priority**: This destroys user work. A running agent, a half-finished build, or an authenticated remote session is lost with no warning and no recovery.

**Independent Test**: Start a long-lived process in a terminal panel owned by a project. Drag its tab into a new sub-workspace. Assert the process is still alive, its output continues to stream to both views, and neither window raises a connection error.

**Acceptance Scenarios**:

1. **Given** a terminal panel owned by a project with a running foreground program, **When** the user drags its tab into a new sub-workspace, **Then** the program keeps running, the same session is presented in both windows, and neither window reports a connection error.
2. **Given** a sub-workspace window that has not yet finished loading its project list, **When** a terminal panel mounts inside it, **Then** the panel does not establish a session until the panel's ownership is known, so it can never connect with the wrong working directory.
3. **Given** a terminal panel that already has a live session, **When** any view requests a session for that same panel, **Then** the existing session is reused, and the running program is never terminated to make room for a replacement.
4. **Given** a terminal whose shell takes longer to start than a routine health check, **When** the user opens it, **Then** the request is allowed the time it needs and does not fail with a timeout.
5. **Given** a session-establishment request that exceeds its budget, **When** the failure is surfaced, **Then** the underlying session is still running, and the view offers a retry that reattaches rather than replaces.
6. **Given** a view that has just attached to an existing session, **When** the user inspects it, **Then** the prior output history is present and the display matches the other attached views.

---

### User Story 2 - The same terminal renders correctly in two different-sized views (Priority: P1)

A developer views one terminal panel in the main window and in a sub-workspace window, where the two panels have different pixel dimensions. Today one of the two displays becomes garbled, because both views resize a single shared character grid and the last one to resize wins.

**Why this priority**: The display is actively wrong, and the corruption persists until the user forces a repaint. It makes sub-workspaces unusable for terminals, which is their principal purpose.

**Independent Test**: Attach one terminal session to two views of deliberately different sizes. Assert both render legibly, that the grid equals the smaller view's dimensions, and that neither view oscillates when the other is resized or focused.

**Acceptance Scenarios**:

1. **Given** one terminal session attached to two views of different sizes, **When** both views have measured themselves, **Then** the grid equals the smallest columns and the smallest rows across all attached views.
2. **Given** the smallest attached view, **When** it is enlarged so it is no longer the smallest, **Then** the grid grows to the new smallest view's dimensions exactly once, with no intermediate flicker.
3. **Given** two attached views, **When** the smaller one is closed, **Then** the grid grows to fit the remaining view.
4. **Given** a view larger than the grid, **When** it renders, **Then** the unused area is inert padding painted in the terminal's background colour, and no text is clipped, stretched or duplicated.
5. **Given** two views repeatedly gaining and losing keyboard focus, **When** neither is resized, **Then** no resize is transmitted to the session at all.
6. **Given** three or more views of one session, **When** the grid is computed, **Then** the minimum is taken across every attached view, not merely two.

---

### Edge Cases

- What happens when the smallest attached view is so small that the grid would fall below one column or one row? The grid is clamped to a defined minimum, and the offending view scrolls rather than forcing a degenerate grid.
- What happens when a sub-workspace window is closed while it holds the smallest view? The grid grows to the new minimum without disturbing the running program.
- What happens when a view attaches while a program is mid-output? The view receives the prior output history, then the live stream, in order, with nothing lost or duplicated.
- What happens when the daemon is slow to answer and the request times out, and the user then re-types the panel? The existing session must not be reaped. A re-type must not be a licence to kill a running program.
- What happens when two views request a session for the same panel simultaneously? One session is created; the second request attaches to it.
- What happens when a panel owned by a sub-workspace has its last view closed? Its session is terminated, because nothing owns it any more.
- What happens when a panel owned by a project has all its sub-workspace views closed? Its session keeps running, because the panel survives in its project.
- What happens when the working directory cannot be resolved at all (the project's folder has been deleted)? The panel reports a clear error and does not establish a session at an arbitrary fallback directory.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Session lifecycle

- **FR-001**: A terminal panel MUST NOT establish a session until the panel's ownership — the project or sub-workspace it belongs to, and therefore its working directory — has been resolved. Views MUST present a loading state until then.
- **FR-002**: An **implicit** attach for a panel that already has a live session — a mirror opening in another window, a re-render, a reconnect — MUST reuse that running session, whatever launch identity it would compute (including a different working directory). The reuse-versus-terminate decision MUST be driven by the caller's **stated intent**, and MUST NOT be inferred from a launch-identity comparison. Inferring intent from a key — in particular by including the working directory in a reuse key, so a mirror that resolved a different `cwd` looked like a different terminal — is precisely the mechanism that reaped running programs; it is prohibited. A running session MUST NOT be reaped on an implicit attach.
- **FR-003**: When a terminal panel is presented in an additional window, the running program MUST continue without interruption, and its output MUST be delivered to every attached view.
- **FR-004**: A session-establishment (attach) request MUST be allotted its own time budget (`attachTimeoutMs`), appropriate to launching an interactive shell, that is separate from and much larger than the health-check budget (`pingTimeoutMs`); the health-check budget MUST NOT be reused for attach.
- **FR-005**: When a session-establishment request exceeds its budget, the underlying session MUST NOT be terminated, the panel MUST NOT revert to the type-selection form, and the failure MUST NOT surface as a hard error. Instead the requesting view MUST render a non-fatal "still starting" state carrying an explicit retry affordance that reattaches to the existing session (idempotent by session reuse) rather than replacing it.
- **FR-006**: On attaching, a view MUST be presented with the session's prior output history, so its display matches the other attached views.
- **FR-007**: A terminal session MUST only be terminated when its owning panel is destroyed, when the last attached view of a panel owned by a sub-workspace is closed (its `detach` removing the final view), or on **explicit user request**. An **explicit user re-type** — the user deliberately selecting a different terminal for a panel — IS such an explicit request: it MUST terminate the running session and cold-start the newly chosen launch (a user-initiated destroy-then-create), and that explicit intent MUST be signalled by the caller, never inferred from an identity change. A panel owned by a project MUST keep its session running when its last *sub-workspace* view detaches, because the panel survives in its project. A session MUST NOT be terminated as a side effect of a window move, a re-render, a reconnect, or a change to the panel's resolved identity (these are implicit and reuse the running session, FR-002).
- **FR-008**: Concurrent requests to establish a session for the same panel MUST result in exactly one session, with every requester attached to it.
- **FR-008a**: Each `detach(panelId, viewId)` MUST be backed by a window-close notification from the main process, so a crashed or force-closed renderer that never sends its own detach still has its view removed and cannot strand the grid at a departed view's dimensions.

#### Grid sizing across views

- **FR-009**: A terminal session MUST expose a single character grid whose dimensions are the minimum columns and the minimum rows across all currently attached views. Views MUST be identified by a `viewId` carried on `attach` and `resize`; the daemon — the only component that observes every window — MUST own the per-view dimensions and the minimum computation, so it is verifiable with no windows open.
- **FR-010**: The daemon MUST recompute the grid when a view attaches (`attach`), detaches (`detach`), or reports new dimensions (`resize`), and MUST transmit a PTY resize only when the computed grid actually changes.
- **FR-011**: A view larger than the grid MUST render the grid at its natural size and fill the remainder with inert padding painted in the terminal's background colour. It MUST NOT clip, stretch, or duplicate content.
- **FR-012**: The computed grid MUST be clamped to a minimum of one column and one row. A view smaller than the clamped grid MUST scroll rather than shrink it further.
- **FR-013**: Changing which view holds keyboard focus MUST NOT, by itself, cause a resize.

### Key Entities

- **Terminal session**: one running program and its output history, identified by the panel it belongs to and keyed for reuse by its launch identity `[file, args, runAsAdmin]` (never the working directory). Has exactly one character grid. May be attached to many views across many windows.
- **Terminal view**: one on-screen presentation of a session inside one window, identified by a `viewId`. Reports its own measured dimensions on `attach` and `resize`; does not own the grid.
- **Detach message**: `detach(panelId, viewId)`, sent when a view goes away, removing that view from the session's set so the grid is recomputed. Backed by a main-process window-close notification so a crashed renderer's view is still removed.
- **Panel ownership**: whether a panel belongs to a project or to a sub-workspace. Determines the session's working directory and its lifetime (a sub-workspace-owned panel's session ends when its last view detaches; a project-owned panel's session survives its sub-workspace views closing).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Moving a tab containing a terminal with a running program into a new sub-workspace preserves that program in 100 out of 100 trials, with no connection error surfaced in either window.
- **SC-002**: A terminal session presented in two views of different sizes renders legibly in both, in 100% of trials.
- **SC-003**: While neither view changes size, zero resize messages are sent to the session, regardless of focus changes.
- **SC-004**: No sequence of window moves, re-renders, re-types or timeouts terminates a running program, other than the three permitted causes in FR-007.
- **SC-005**: A view that attaches to an existing session shows the same content as every other attached view, with no missing or duplicated output.
- **SC-006**: Opening a terminal whose shell takes several seconds to initialise succeeds without a timeout.

---

## Assumptions

- A terminal session is keyed by its panel. Two windows showing "the same panel" are two views of one session, not two sessions.
- Panels are cloned into sub-workspaces rather than moved, so a panel may legitimately have views in several windows at once. This feature does not change that model; it makes it correct.
- All views of one terminal panel render at the same text size, so a view's measured columns and rows vary only with its pixel dimensions. Per-panel text zoom is out of scope here and is delivered by a later feature; nothing in this feature may assume a single global text size.
- The minimum grid clamp (FR-012) exists to prevent a degenerate grid, not to define a comfortable minimum.
- The time budget for establishing a session (FR-004) is a constant (`attachTimeoutMs`) chosen during planning, separate from and much larger than `pingTimeoutMs`. The specification fixes the requirement — a budget suited to launching a shell, never the health-check budget — not the number.
- The root of the data loss in User Story 1 was **inferring intent** from a launch identity that *included the working directory*: a mirror into a sub-workspace computed a different `cwd`, so the launch looked like a re-type and the running session was reaped. The fix replaces inference with **stated intent** — an implicit attach (mirror / re-render / reconnect) always reuses the running session (FR-002), and only an explicit user re-type, signalled by the caller, terminates and cold-starts (FR-007). Resolving ownership before the first attach (FR-001) additionally makes a cold start correct. Both the intent-based reuse and the ownership resolution are required; either alone leaves the defect reachable by another path.
- FR-005's retry is an action control. Under constitution v3.12.0 it must be a themeable icon with a hover title, taking its icon and colours from theme tokens, unless it is a decision button inside a dialog.

## Out of Scope

- Per-panel text zoom, keyboard focus scoping, and terminal-specific key bindings.
- Terminal search and scrollback navigation.
- Any change to how panels are dragged, cloned, or laid out.
- Any change to terminal flavour configuration.
