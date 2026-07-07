# Feature Specification: Typed Panels — Terminal Panel Type

**Feature Branch**: `005-terminal-panel-type`

**Created**: 2026-06-30

**Status**: Delivered — release-candidate (2026-07-02; post-release convergence through 2026-07-04). See
**Release Status** below for the delivered-vs-deferred boundary accepted for this release, including the
2026-07-04 convergence work (OSC-52 clipboard, reattach hardening, and the FR-025e status-bar ADMIN pill).

**Input**: User description: "Folders [panels] can be one of several different types. I do not want to define them all now, but we need to design around this so we can define the panel type as we go on (and expand this in the future). For this feature, I want to implement the 'Terminal' panel type. When a panel is created, its 'Empty Panel' page should be replaced with a form that lets the user select the type of panel from a drop-down. There should be a 'confirm' and a 'clear' button at the bottom of the form. Once 'confirmed', the panel type cannot be changed. As the user chooses the 'Panel Type', the form will change its inputs based on that type. Design a system that makes this easy to expand in the future. When the 'Terminal' panel type is selected, the options will be: Flavour (dropdown, detected automatically from the current machine) and Startup Params (free text, sensible default per terminal type). The terminal should always start in the project's root directory, and ideally the user is prevented from changing out of it. The actual terminal should be started up as a background process and attached inline inside the panel. Let's get this basic slice working, then see where we go from here."

## Release Status (2026-07-02)

This release ships the full **A→C** slice (typed panels + a live Terminal type) plus the batch-2/3
refinements and the run-as-admin/de-elevation work. Verified: `tsc -b` clean, **397 unit + contract +
integration tests green**, and the terminal/sub-workspace/admin E2E green (the `@admin` integrity suite
verified on an elevated host — 2 passed — for cmd, PowerShell, and Git Bash). The boundary accepted as
**"good enough for release"** is recorded here; deferred items carry forward as tracked tasks in
`tasks.md` (Phase 13 backlog + the Phase 14 convergence record).

**Delivered:**

- **Panel typing (Phase A):** `Panel.kind`+`config`, `PanelBody` dispatcher, the type-selection form
  (dropdown → per-type inputs, Confirm/Clear, validation, lock-on-confirm), persisted in the layout blob.
  *(FR-001…FR-010.)*
- **Settings & detection (Phase B):** `settings.terminals` (flavours + `disabledBuiltins` + default params),
  the built-in flavour catalogue, the UI-main-owned `IShellDetection` seam, and the `terminal.listFlavours`
  bridge → real Flavour dropdown + per-flavour Startup Params. Detection resolves the **real Git Bash via
  `git.exe`** (never WSL's `System32\bash.exe`) — a portable/non-registry Git install is found. *(FR-011…FR-014, FR-024.)*
- **Live terminal (Phase C):** spawns-if-absent persistent detached daemon, `IPtyHost`/node-pty PTYs,
  xterm.js view over `terminal.*`, daemon→UI notification streaming, reattach-by-panelId with replayed
  scrollback, idle-close/cold-respawn, app-close three-choice prompt, unexpected-exit surfacing, and the
  `IDirectoryLock` project-root lock. *(FR-015, FR-017, FR-018, FR-019, FR-022.)*
- **Lifecycle refinements:** a closed/failed terminal reverts the Panel to the type-selection form
  (`clearPanelType`, FR-020); a synced Terminal Panel mirrors one session across views (FR-021);
  sub-workspace-owned terminals rooted at the user's home, non-draggable-out with a ghost warning, and
  independent focus/colour sync. *(FR-021, FR-028, FR-029, FR-030.)*
- **Run-as-admin / de-elevation (mixed mode):** elevation capability query + ADMIN pill + per-flavour
  run-as-admin flag; in an elevated daemon an **unchecked** terminal runs **de-elevated (User)** and a
  **checked** one runs **Admin** — via a medium-integrity PTY agent (`WindowsDeElevatedLauncher` +
  `PtyAgentHost`). **Verified on an elevated host** for cmd/PowerShell/Git Bash. *(FR-025a, FR-025c.)*

**Also delivered in the finalisation pass (2026-07-02):**

- **No orphaned OS processes (resource hygiene, T134).** Every terminal releases its Windows ConPTY host
  (`conhost.exe`) when it ends by ANY path — panel-destroy, project-delete, app-close "Terminate all",
  natural `exit`, and daemon shutdown. Root cause fixed: the conhost is a *sibling* of the shell under the
  daemon and node-pty 1.1.0 never closes the pseudoconsole for a self-exited shell, so `NodePtyHost` now
  tracks each session's conhost pid and reaps it (and `TerminalService.shutdown()` runs on daemon
  SIGTERM/SIGINT; the de-elevated agent reaps its ptys on disconnect + a daemon-liveness heartbeat).
  Deleting a project now kills its terminals. Verified by `terminal-no-orphans.e2e.ts` (every detected
  flavour × every end path returns the daemon's conhost count to baseline) + a bounded-scrollback /
  no-leaked-subscriber integration test.
- **Elevated-daemon respawn (FR-025b, T126)** — an elevated app retires a running non-elevated daemon and
  respawns it elevated (the daemon reports its integrity via `health.ping`). Injected-seam integration test.
- **Dedicated E2E** for revert-on-exit (FR-020), mirror (FR-021), root-lock (FR-022), and the
  persist-with-removed-flavour arm (FR-019) — `terminal-revert/-mirror/-root-lock/-persistence.e2e.ts`.
- **Verification** — bounded-scrollback flatness + no-leaked-subscriber tests; the zero-OS/DOM import guard
  (auto-covers the new modules) and the `user_version`-stays-current migration assertion already existed.

**Also delivered in post-release convergence (2026-07-04, batches 5–6):**

- **OSC-52 clipboard (T135, FR-014).** xterm `registerOscHandler(52)` → `terminal.writeClipboard`
  (main/preload wiring) so a program in the terminal (e.g. a CLI copying to clipboard) reaches the Electron
  clipboard; unit + `terminal-clipboard.e2e.ts` coverage.
- **Reattach hardening (T135/T136, FR-006/FR-015a).** `attach-serializer.ts` FIFO-serialises
  `terminal.attach`; the daemon reaps-for-replace on a `launchKey`-keyed re-type so a re-typed Panel never
  leaves a stale session. A concurrency defect in the `daemon-elevated-respawn` integration test was traced
  to a shared `BUILD_ID` artifact mutated by parallel files and fixed by forcing the integration/contract
  vitest projects to a single sequential worker.
- **Status-bar ADMIN pill (T137/T138, FR-025e).** When the app runs elevated, the main-window status bar
  shows a red `ADMIN` pill on the right (sourced from the same `terminal.capabilities().elevated` daemon
  signal that gates the run-as-admin checkbox — the renderer never probes the OS) and the active
  `Tab · Panel` context moves to the left; `status-admin-pill.e2e.ts` covers both states.

**Deferred (accepted for this release):**

- **Root confinement — WON'T FIX (infeasible).** Keeping a user *inside* the project root by blocking
  `cd ..` in a live interactive shell cannot be done without a fake shell (any real shell lets the user
  change directory; intercepting keystrokes breaks the shell). The delivered guarantees are: the terminal
  **starts** at the root, and while a terminal is open the daemon **locks** the root (it can't be
  deleted/moved and its path can't be edited — FR-022). `confine.ts` remains an intentional no-op stub.
  *(FR-016 / US4 (P3) — supersedes T123/T124.)*
- **Output coalescing/debounce** (`terminal.output`) — a micro-optimisation deliberately NOT done: it would
  risk the renderer's per-chunk screen-clear detection and the mirror path, and the memory concern it
  targeted is handled by the bounded scrollback (now tested). *(T132 perf half.)*

## Overview

Today every Panel renders an inert **"Empty Panel"** placeholder. This feature gives a Panel an
**assignable type**. A newly created Panel presents a small **type-selection form** instead of the
placeholder: the user picks a **Panel Type** from a dropdown, fills in that type's inputs (which change
as the type changes), and presses **Confirm** (or **Clear** to reset). Once confirmed, the Panel's type
is locked for the life of that Panel.

The system is built to grow: more panel types will be added in future features, but only **one** concrete
type ships here — **Terminal**. A Terminal Panel asks for a **Flavour** (an installed shell detected from
the machine) and **Startup Params** (free text with a sensible per-flavour default), then launches a
live, interactive terminal **inside the Panel**, running in the **project's root folder** as a background
process decoupled from the UI.

This is the first concrete delivery of the terminal capability the constitution has described all along
(Principle III "Detached, Tagged & Persistent Terminals", Principle IV "Native Terminal Support &
Auto-Detection"). It delivers the **full detached-persistent-terminal lifecycle**: the terminal runs in a
**persistent, always-on, detached daemon** that **outlives the UI**, so a terminal with a running process
**survives the application closing** and is **re-attached live (with restored scrollback)** when the
project/app reopens. Terminal **presets** remain out of scope (a separate, unrequested feature).

## Clarifications

### Session 2026-06-30

- Q: After a Terminal Panel's shell process ends (closed by the user or failed), what does the Panel do? → A: The Panel **returns to the type-selection form**, where the user may select a panel type again — the **same** (relaunch Terminal) or a **different** type. A Panel's type is therefore fixed only **while it hosts live content**, not permanently; an empty Panel (no live terminal) is always re-typeable via the form.
- Q: When a Terminal Panel is synced/cloned into a sub-workspace (same panel id, live mirror), how should the terminal behave? → A: Both views **mirror the same single terminal session** — shared scrollback + live output; input from either window is routed to the one PTY.
- Q: What happens if a Terminal Panel's project root folder becomes unavailable (moved/deleted) while in use? → A: **Prevent it.** While a terminal is open in a project, the project root is **locked**: it cannot be moved and the **daemon holds an OS lock (open handle / oplock) on the folder so it cannot be deleted**, and the project's root path cannot be changed. (If a root still becomes genuinely unavailable, e.g. removable media, a new launch/cold-respawn surfaces an error per FR-019.)

### Session 2026-07-01 (post-Phase-C refinements — batch 2)

- Q: Should the Sidebar Pane keep the **Terminals Panel**? → A: **No.** The Terminals Panel is removed
  entirely (it is not useful). The Sidebar Pane hosts **Projects** and **Sub-workspaces** only, with the
  **Sub-workspaces Panel pinned to the bottom** of the pane. Constitution Principle XI is amended to drop
  the Terminals-Panel-in-sidebar requirement.
- Q: Git Bash (and other shells) are detected on one machine but not another — how robust should detection
  be? → A: Detection MUST resolve each shell via **well-known install paths, the PATH, and the registry**
  (e.g. the Git-for-Windows install key), so non-standard/portable installs are still found. The defect is
  that detection today probes **hardcoded paths only**; robustness is a first-class requirement.
- Q: "Run as admin" — a generic OS-level flag or per-flavour? And how is elevation achieved? → A: It is a
  **generic OS-level flag** (one boolean per Terminal Panel, **not** per flavour). Elevation is achieved by
  **launching throng itself as administrator** (elevated app → elevated daemon → elevated PTYs); there is
  **no separate elevation broker**. The "run as admin" checkbox is **enabled only when the
  terminal-hosting daemon is elevated**, otherwise **greyed** with a hover title telling the user to
  relaunch throng as administrator. When the app is elevated, **checked** terminals run **elevated** and
  **unchecked** terminals are **de-elevated** to normal integrity (**mixed mode**). A running admin
  terminal shows a **red-outlined "ADMIN" pill** beside the type and flavour in the panel header.
- Q: Destroying a Panel that exists in both a project and one or more sub-workspaces — what should happen? →
  A: **Panels belong to their originating project, and the cascade is one-directional.** Destroying a Panel
  **in the project** destroys it in the project **and in every sub-workspace** it appears in — open windows
  via a cross-window broadcast, closed/lazy sub-workspaces by stripping the persisted layout — and the
  destroy dialog gains an **extra highlighted warning** naming the affected sub-workspaces. Destroying a
  Panel **inside a sub-workspace** is **local**: it only leaves that sub-workspace; the **project keeps its
  Panel** (and so do any other sub-workspaces). A sub-workspace **emptied** by a project-originated cascade
  is **auto-deleted** (a sub-workspace cannot be empty, Principle XI). *(Revised 2026-07-01: an earlier
  draft made the cascade bidirectional; a sub-workspace destroy no longer removes the project's Panel.)*
- Q: What happens when a Panel is dragged onto the **New-Tab (+)** button? → A: A **new Tab** is created
  containing **only that Panel** (the Panel is **moved** into it, not copied), and the new Tab becomes
  active.
- Q: A cloned/synced Panel (same panel id in the project and a sub-workspace) — how completely are its two
  views synced? → A: **Completely — at the panel level and the terminal level.** While it is **untyped**, the
  **type-selection form** is mirrored live across the windows (selected type + inputs). **Confirming** a type
  in one window types the clone in the other (which then attaches to the one shared session, FR-021). The
  **active/selected** Panel is mirrored. The live terminal session already mirrors (FR-021), and exiting the
  Panel in either window exits it in the other (existing). *(Added 2026-07-01.)*

### Session 2026-07-01 (sub-workspace terminals & lifecycle — batch 3)

- Q: Can a Panel **created inside a sub-workspace** (owned, no project) run a terminal, and where? → A:
  **Yes.** An owned sub-workspace Terminal launches at the user's **default home directory** (it has no
  project root) and takes **no** project-root lock; it otherwise behaves like a project Terminal (streaming,
  reattach, exit-revert, destroy/app-close dialogs). *(FR-028.)*
- Q: Closing the last Panel/Tab in a sub-workspace did nothing — what should happen? → A: It should **close
  the whole sub-workspace** (delete the record, close the window), preceded by a highlighted warning. A
  cloned project Panel closed this way leaves the project's Panel intact (one-directional). *(FR-029.)*
- Q: Can an owned sub-workspace Panel be dragged out of its window? → A: **No** — owned Panels are not
  linked to a project and can only move **within** their sub-workspace. Dragging one beyond the window shows
  a **red invalid-drop warning** on the ghost and the drop is a no-op. *(FR-030.)*
- Note on FR-025c mixed mode: **DELIVERED and verified on an elevated host (2026-07-02).** An unchecked
  terminal in an elevated daemon runs **de-elevated (User)** and a checked one runs **elevated (Admin)** —
  for cmd, PowerShell, and Git Bash. Mechanism: a **medium-integrity PTY agent** process (owns its own
  ConPTY) that the elevated daemon launches de-elevated via shell-token `CreateProcessWithTokenW` and drives
  over a named pipe; unchecked terminals route to it, checked ones stay in the elevated daemon. (The earlier
  in-process relauncher shim was a proven dead end — a de-elevated child can't attach to the elevated
  daemon's ConPTY.) The `@admin` E2E verifying this are elevation-gated (Constitution v3.7.0). The
  elevated-daemon **respawn** (FR-025b, replacing a pre-existing lower-integrity daemon) remains outstanding;
  today the app-elevated → daemon-elevated path is the supported entry.

### Session 2026-07-02 (sync & destroy revisions — batch 4)

- Q: Destroying a cloned Panel inside a sub-workspace keeps the project's Panel but killed its terminal —
  right? → A: **No.** A local sub-workspace destroy of a **cloned** project Panel MUST leave the shared
  terminal session running — the project keeps the Panel **and** its live terminal; only that window's view
  detaches. Only destroying an **owned** sub-workspace Panel (FR-028), or destroying from the project,
  terminates the session. *(FR-026 clarified.)*
- Q: Sub-workspace **colours** don't update in an open window when changed — should they? → A: **Yes.**
  Colour syncs live to an open sub-workspace window exactly like the name/tab/panel counts do (the window's
  dominant accent follows the swatch).
- Q: Selecting a panel in the project view also selects it in the sub-workspace — wanted? → A: **No.** The
  active/selected Panel is **window-local**: sub-workspace focus is completely independent of the main
  window's selection, in both directions. *(FR-027a revised — the earlier active-selection mirror is
  removed.)*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose and lock a Panel's type from an extensible form (Priority: P1)

A user creates a new Panel and, instead of a blank "Empty Panel" body, sees a form. They open the
**Panel Type** dropdown, choose a type, complete the inputs that appear for that type, and press
**Confirm**. The Panel becomes that type. The choice of *type* can never be changed afterwards. If they
change their mind before confirming, **Clear** returns the form to its initial empty state.

**Why this priority**: This is the reusable foundation the user explicitly asked us to "design so it is
easy to expand." Without it, no panel type — including Terminal — can be selected. It is independently
demonstrable even with a single available type, and every future panel type plugs into it unchanged.

**Independent Test**: Create a Panel, confirm it is showing the type-selection form (not "Empty Panel"),
select a type, observe the type-specific inputs appear, press Clear and confirm the form resets, then
press Confirm with a valid selection and confirm the type is applied and the type control is no longer
changeable.

**Acceptance Scenarios**:

1. **Given** a newly created Panel, **When** it renders, **Then** its body shows a type-selection form
   with a **Panel Type** dropdown and **Confirm** / **Clear** actions in place of the "Empty Panel"
   placeholder.
2. **Given** the type-selection form, **When** the user selects a Panel Type, **Then** the form shows the
   inputs specific to that type, and selecting a different type swaps the inputs accordingly.
3. **Given** a partially filled form, **When** the user presses **Clear**, **Then** the type selection and
   all inputs return to the initial empty state.
4. **Given** a valid type and its required inputs, **When** the user presses **Confirm**, **Then** the
   Panel is assigned that type and configuration and the type cannot be changed **while the Panel hosts
   that confirmed live content** (it becomes re-typeable only once the content ends — see US2).
5. **Given** no type selected (or required inputs missing), **When** the user attempts to **Confirm**,
   **Then** confirmation is blocked until a valid type and required inputs are provided.
6. **Given** a confirmed (typed) Panel, **When** the workspace layout is persisted and restored, **Then**
   the Panel reopens with its assigned type and configuration (live terminal-session restoration is
   covered by User Story 3).

---

### User Story 2 - Launch an inline Terminal of a detected flavour in the project root (Priority: P2)

A user selects **Terminal** as the Panel Type. A **Flavour** dropdown lists the shells detected as
installed on their machine; a **Startup Params** free-text field is pre-filled with a sensible default for
the chosen flavour. On **Confirm**, a live, interactive terminal of that flavour opens **inside the
Panel**, already sitting in the active project's root folder, and the user can type commands and read
output as in any terminal.

**Why this priority**: This is the headline value — the first real terminal in throng. It depends on
US1's form but delivers the user's primary requested outcome.

**Independent Test**: With at least one shell installed, create a Panel, choose **Terminal**, confirm the
Flavour dropdown is populated from the machine and Startup Params shows a default, press **Confirm**, then
verify a live terminal appears inside the Panel, accepts input, returns output, and its initial working
directory is the project root.

**Acceptance Scenarios**:

1. **Given** the type-selection form, **When** the user selects **Terminal**, **Then** a **Flavour**
   dropdown (populated from shells detected on the machine) and a **Startup Params** free-text field
   appear.
2. **Given** the Terminal inputs, **When** the user picks a Flavour, **Then** Startup Params is populated
   with that flavour's sensible default value.
3. **Given** a chosen Flavour and Startup Params, **When** the user presses **Confirm**, **Then** a live
   terminal of that flavour starts, is attached inline inside the Panel, and accepts interactive input.
4. **Given** a freshly launched Terminal Panel, **When** it starts, **Then** its working directory is the
   active project's root folder.
5. **Given** a running Terminal Panel, **When** its underlying process exits unexpectedly, **Then** the
   Panel surfaces the failure output and exit code rather than silently going blank (Principle III).
6. **Given** a running Terminal Panel, **When** the user destroys the Panel, **Then** the existing
   "running process" destroy-confirmation flow applies and the terminal is terminated.
7. **Given** a Terminal Panel whose shell process has **ended** (the user closed it, or it failed), **When**
   the process exits, **Then** the Panel returns to the **type-selection form** (surfacing the exit
   code/output on failure, FR-017), and the user may select a panel type again — relaunch **Terminal** or
   choose a **different** type.

---

### User Story 3 - A running terminal survives restart and reattaches live (Priority: P2)

A user starts a long-running command in a Terminal Panel, then closes and reopens the project (or the
whole application). The terminal is **still running** — its process never died with the UI — and the
Panel **re-attaches to the live session**, showing the scrollback that accumulated while the UI was gone
and accepting input again. An **idle** terminal (no running process) is instead closed on exit and
re-created cold (back at the project root) when reopened. If the user closes the application while
terminals have running processes, they are warned and offered three choices: leave them running in the
background, terminate them, or cancel.

**Why this priority**: This is the explicit reason the persistent-daemon path was chosen over a
session-only terminal — watchers, servers, and agents must not die when the UI closes. It is the
defining guarantee of Principle III. It builds on US2's live terminal but is independently demonstrable
(start a process, restart the app, confirm it is still alive and reattached).

**Independent Test**: Launch a Terminal Panel, start a process that keeps running, fully close the
application, reopen it, and confirm the terminal is the same live session (process still running,
scrollback restored, input accepted). Separately, confirm an idle terminal is recreated cold at the
project root, and that closing the app with running terminals shows the three-choice warning.

**Acceptance Scenarios**:

1. **Given** a Terminal Panel whose process is actively running, **When** the application is closed and
   reopened, **Then** the terminal process is still running and the Panel re-attaches to the live session
   with its prior scrollback restored.
2. **Given** an **idle** Terminal Panel (no running process), **When** the application is closed and
   reopened, **Then** the terminal is closed on exit and re-created in a fresh process at the project
   root on reopen.
3. **Given** running terminals, **When** the user closes the application, **Then** they are warned and
   offered exactly three choices: (A) close and leave terminals running in the background, (B) close and
   terminate all terminals, or (C) cancel.
4. **Given** the application is launched while a previous instance's daemon already holds running
   terminals, **When** the UI starts, **Then** it connects to the existing daemon and reattaches rather
   than starting a second daemon or losing the sessions (single-instance).
5. **Given** a terminal that was running, **When** it is reattached after restart, **Then** its durable
   identity (owning project, panel, flavour, working directory) is intact so it is matched back to the
   correct Panel.

---

### User Story 4 - Start in the project root, with the root locked while in use (Priority: P3)

A Terminal Panel always **starts** in its project's root folder. Keeping the user *inside* the root
afterwards (blocking `cd ..` in a live interactive shell) is **not attempted** — it is infeasible without
a fake shell (see Assumptions and FR-016, **WON'T FIX 2026-07-02**). The delivered guard-rail is instead
that **while a terminal is open the project root is locked**: the OS refuses to move or delete the folder
and the app blocks editing the project's root path (FR-022), so the binding context cannot be pulled out
from under a running terminal (reinforcing Principle I project isolation).

**Why this priority**: A guard-rail that strengthens project isolation, but the terminal is valuable
without caging its working directory; the cwd-confinement refinement was assessed and dropped as
infeasible, leaving **start-at-root + the root lock** as the shipped behaviour.

**Independent Test**: Launch a Terminal Panel and confirm its initial working directory is the project
root. While it is open, attempt to delete/move the root folder or change the project's root path and
confirm each is refused; close the terminal and confirm they succeed again.

**Acceptance Scenarios**:

1. **Given** a freshly launched Terminal Panel, **When** it starts, **Then** its working directory is the
   project root (confining the shell there afterwards is out of scope — FR-016 is WON'T FIX).
2. **Given** a project with an open terminal, **When** the user or the OS attempts to move/delete the root
   folder or change the project's root path, **Then** the attempt is refused; once the last terminal
   closes, those operations succeed again (FR-022).

---

### User Story 5 - A streamlined sidebar (Projects + Sub-workspaces) (Priority: P2)

The left Sidebar Pane no longer shows a Terminals Panel. It stacks the **Projects** Panel and the
**Sub-workspaces** Panel, with **Sub-workspaces pinned to the bottom** of the pane, so the two useful
lists are always the ones on screen.

**Why this priority**: A small but user-requested cleanup that removes a non-functional panel and makes
the sidebar's remaining content clearer. Independent of the terminal work.

**Independent Test**: Open the app with a project active, confirm the Sidebar Pane shows exactly two
stacked panels — Projects (top) and Sub-workspaces (bottom) — and no Terminals Panel anywhere.

**Acceptance Scenarios**:

1. **Given** the app with a project active, **When** the Sidebar Pane renders, **Then** it shows the
   Projects Panel and the Sub-workspaces Panel and **no Terminals Panel**.
2. **Given** the Sidebar Pane, **When** it is resized taller/shorter, **Then** the Sub-workspaces Panel
   stays anchored to the bottom of the pane.

---

### User Story 6 - Detect installed shells reliably across machines (Priority: P2)

A user with Git (or any supported shell) installed in a non-default location still sees that flavour in the
Flavour dropdown. Shell detection finds each flavour by checking well-known paths, the PATH, and the
registry — not a single hardcoded path — so the same project works the same on different machines.

**Why this priority**: Directly fixes a reported defect (Git Bash missing on one machine but not another)
and removes machine-to-machine flakiness in a headline flow (US2).

**Independent Test**: With Git installed to a non-default directory (not `%ProgramFiles%\Git`) but present
on PATH or recorded in the registry, open the type-selection form, choose Terminal, and confirm **Git
Bash** appears in the Flavour dropdown.

**Acceptance Scenarios**:

1. **Given** a shell installed only in a non-default location that is on the PATH, **When** flavours are
   detected, **Then** that shell is listed.
2. **Given** Git for Windows recorded in the registry (install path key) but not at the default path,
   **When** flavours are detected, **Then** Git Bash is listed at its registered location.
3. **Given** a shell that is genuinely not installed, **When** flavours are detected, **Then** it is **not**
   listed (no false positives).

---

### User Story 7 - Run a Terminal as administrator (Priority: P2)

When throng is launched as administrator, a user can mark a Terminal Panel **"run as admin"** in the
type-selection form; that terminal starts elevated and is flagged with a red **ADMIN** pill in its header.
When throng is **not** elevated, the option is greyed out with a hint to relaunch as administrator. With an
elevated app, terminals **not** marked admin still run at normal integrity.

**Why this priority**: A frequently needed capability (elevated shells for installs, service control, etc.)
that builds directly on the US2/US3 terminal lifecycle.

**Independent Test**: Launch throng **not** elevated and confirm the "run as admin" checkbox is disabled
with an explanatory hover. Relaunch throng elevated, create a Terminal Panel with "run as admin" checked,
confirm the terminal is elevated (e.g. an admin-only command succeeds) and the header shows a red ADMIN
pill; create a second Terminal Panel **without** the flag and confirm it runs at normal integrity (no
pill).

**Acceptance Scenarios**:

1. **Given** throng running **without** elevation, **When** the Terminal inputs render, **Then** the "run
   as admin" checkbox is **disabled** and its hover title explains that throng must be launched as
   administrator to enable it.
2. **Given** throng running **with** elevation, **When** the user checks "run as admin" and confirms,
   **Then** the terminal starts **elevated** and the panel header shows a **red-outlined ADMIN pill** beside
   the type and flavour.
3. **Given** an elevated throng, **When** the user confirms a Terminal **without** "run as admin",
   **Then** that terminal runs at **normal integrity** (de-elevated) and shows **no** ADMIN pill.
4. **Given** a not-yet-elevated daemon already running, **When** throng is launched **as administrator**,
   **Then** the elevated app ensures the terminal-hosting daemon is elevated (replacing the lower-integrity
   daemon) before admin terminals can be launched.

---

### User Story 8 - Destroying a project Panel removes it from its sub-workspaces (Priority: P1)

A Panel that originates in a project belongs to that project. When the user destroys it **in the project**,
it is removed from the project and from **all** sub-workspaces that mirror it, and its terminal (if any) is
terminated once; the destroy dialog highlights the affected sub-workspaces first. Destroying a Panel **in a
sub-workspace** is **local** — it only leaves that sub-workspace, and the project keeps its Panel.

**Why this priority**: This is a data-integrity fix for a reported bug (a project Panel destroyed from the
project left ghost copies in its sub-workspaces; conversely a sub-workspace destroy must NOT delete the
project's Panel). Stale/ghost Panels undermine the synced-mirror model (FR-021), so it is P1.

**Independent Test**: Sync a Panel from a project into a sub-workspace (same panel id). Destroy it **in the
project** and confirm it disappears from the sub-workspace too, after a highlighted warning naming that
sub-workspace, and that a sub-workspace left empty is deleted. Separately, destroy a mirrored Panel **inside
a sub-workspace** and confirm it leaves only that sub-workspace — the project still shows it.

**Acceptance Scenarios**:

1. **Given** a Panel present in a project and one or more sub-workspaces, **When** the user destroys it **in
   the project**, **Then** it is removed from the project and from **every** sub-workspace that contained it
   (open windows update live; closed/lazy sub-workspaces have it stripped from their persisted layout), and
   its single terminal session (if any) is terminated exactly once.
2. **Given** such a project destroy, **When** the dialog appears, **Then** it shows an **extra highlighted
   warning** naming the sub-workspaces that will lose the Panel.
3. **Given** a sub-workspace whose **last** Panel is removed by a project-originated cascade, **When** the
   cascade completes, **Then** the now-empty sub-workspace is **deleted** (it cannot exist empty).
4. **Given** a Panel mirrored in a project and a sub-workspace, **When** the user destroys it **inside the
   sub-workspace**, **Then** it is removed from that sub-workspace only and the **project keeps** its Panel
   (no upward cascade, no warning).

---

### User Story 9 - Drag a Panel onto "+" to move it into a new Tab (Priority: P3)

While arranging a workspace, the user drags a Panel onto the New-Tab **(+)** button. A new Tab is created
containing **only** that Panel (moved out of its previous Tab), and the new Tab becomes active.

**Why this priority**: A natural, discoverable layout gesture that complements the existing drag-to-split
and drag-to-tab interactions; convenience, not core.

**Independent Test**: With a Tab containing two or more Panels, drag one Panel onto the **(+)** button and
confirm a new active Tab appears containing exactly that one Panel, and the source Tab no longer contains
it (empty split slots collapsed).

**Acceptance Scenarios**:

1. **Given** a Panel being dragged, **When** it is dropped on the New-Tab **(+)** button, **Then** a new
   Tab is created containing **only** that Panel, the Panel is **moved** (removed from its source Tab), and
   the new Tab becomes active.
2. **Given** the Panel's source Tab had other Panels in a split, **When** the Panel is moved out, **Then**
   the emptied split slot collapses and the source Tab remains valid.

---

### User Story 10 - Own a Terminal inside a sub-workspace and close it cleanly (Priority: P2)

A Panel **created inside a sub-workspace** (owned, not linked to any project) can be confirmed as a
Terminal. Because it has no project root, its shell launches at the user's **home directory** and takes
**no** project-root lock, but otherwise behaves like a project Terminal (streaming, reattach, exit-revert,
destroy and app-close prompts). Owned Panels cannot be dragged out of their sub-workspace, and closing the
sub-workspace's last Panel/Tab closes the whole sub-workspace after a warning.

**Why this priority**: Sub-workspaces are first-class windows; a terminal that only works in the main
project window would be a surprising gap. This is the sub-workspace arm of the US2/US3 terminal lifecycle,
covering the batch-3 clarifications (2026-07-01).

**Independent Test**: In a sub-workspace, create a Panel, confirm it as a Terminal, and verify it launches
a live shell at the home directory and takes no project-root lock. Drag it beyond the window and confirm a
red invalid-drop warning with a no-op drop. Close the sub-workspace's last Panel and confirm the whole
sub-workspace closes after a highlighted warning.

**Acceptance Scenarios**:

1. **Given** an owned sub-workspace Panel, **When** it is confirmed as a Terminal, **Then** a live shell
   starts at the user's home directory and **no** project-root lock is taken (FR-028).
2. **Given** a sub-workspace whose **last** Panel or Tab is closed, **When** the user confirms the
   highlighted warning, **Then** the whole sub-workspace is closed (record deleted, window closed); a
   cloned project Panel closed this way leaves the project's Panel intact (FR-029).
3. **Given** an owned sub-workspace Panel dragged **beyond** its window, **When** it is dropped, **Then**
   the drag ghost shows a red invalid-drop warning and the drop is a no-op — the Panel stays put (FR-030).

---

### Edge Cases

- **No shells detected**: If the machine exposes no installable terminal flavours, the Terminal type's
  Flavour dropdown MUST communicate that no flavours are available and MUST NOT offer an empty,
  un-confirmable selection.
- **No active project**: Panels exist only within a project context (Principle I); a Terminal Panel cannot
  be confirmed without an active project root to start in. The form MUST prevent confirming a Terminal in
  the absence of a project root.
- **Flavour becomes unavailable**: A Panel persisted with a flavour that is no longer installed when
  restored MUST surface that the flavour is unavailable rather than failing silently.
- **Startup Params edited then Flavour changed**: Switching Flavour repopulates Startup Params with the
  newly selected flavour's default (see Assumptions for the chosen overwrite behaviour).
- **Process fails to start**: If the terminal cannot be launched (bad params, missing executable), the
  Panel MUST surface the launch error rather than appearing as a blank terminal.
- **Project root in use**: While a project has open terminals its root folder is **locked** (FR-022) — the
  OS refuses to move/delete it and the app blocks changing the project's root path. Should the root still
  become unavailable (e.g. removable media removed), a new launch/cold-respawn surfaces an error (FR-019);
  a terminal already running keeps its existing working directory.

## Requirements *(mandatory)*

### Functional Requirements

#### Panel type system (extensible)

- **FR-001**: A newly created Panel that has no assigned type MUST present a **type-selection form** in its
  body, replacing the "Empty Panel" placeholder.
- **FR-002**: The form MUST provide a **Panel Type** dropdown listing all currently available panel types.
  In this feature the only selectable type is **Terminal**, but the type catalogue MUST be structured so
  that additional types can be registered later **without redesigning the form or the selection flow**.
- **FR-003**: Selecting a Panel Type MUST render the inputs specific to that type; changing the selected
  type MUST replace the displayed inputs with those of the newly selected type.
- **FR-004**: The form MUST provide **Confirm** and **Clear** actions. **Clear** MUST reset the type
  selection and all inputs to the initial empty state. **Confirm** MUST assign the selected type and its
  configuration to the Panel.
- **FR-005**: **Confirm** MUST be blocked while no valid type is selected or any of the selected type's
  required inputs are missing or invalid.
- **FR-006**: While a Panel **hosts confirmed live content** (e.g. a running or restartable terminal), its
  **type MUST be fixed** — the type control MUST NOT be offered and the type cannot be changed. The type is
  **not** permanently immutable: when the Panel's content ends (FR-020), the Panel becomes re-typeable. A
  Panel MUST never hold two confirmed types at once; re-typing always starts from the empty form.
- **FR-007**: A Panel's assigned type and its captured configuration MUST persist with the Panel as part of
  the per-project workspace layout, so a typed Panel restores as the same type when the project reopens.
- **FR-008**: The type-selection experience MUST behave consistently wherever Panels live (main workspace
  and sub-workspace windows), since any Panel can be created in either context.

#### Terminal panel type

> **Numbering note**: there is no FR-009 — the panel-type block ends at FR-008 and the Terminal block
> begins at FR-010. The gap is intentional (FR-009 was never assigned); FR keys are stable, so it is left
> as-is rather than renumbered.

- **FR-010**: The **Terminal** type's configuration MUST include a **Flavour** dropdown. Its options are
  drawn from two sources combined: (a) a **built-in catalogue** of supported flavours that the product
  grows over time (each flavour implemented and detected directly), filtered to those **present on the
  current machine**; and (b) **user-defined flavours** the user has added in configuration. The dropdown
  MUST present the union of available built-in flavours and user-defined flavours.
- **FR-010a**: The user MUST be able to add their own terminal flavours via a **configurable array in
  `settings.json`** (e.g. a label, an executable/command, and default startup params per entry). These
  user-defined flavours appear in the Flavour dropdown alongside the built-in ones, honouring the
  externalised-configuration rule (Principle X). The exact field shape is a planning detail.
- **FR-011**: The **Terminal** type's configuration MUST include a **Startup Params** free-text field that
  is **pre-filled with a sensible default for the selected Flavour** and is freely editable by the user.
- **FR-012**: Selecting or changing the **Flavour** MUST update the **Startup Params** field to that
  flavour's default value (overwrite behaviour per Assumptions).
- **FR-013**: On **Confirm** of a Terminal Panel, the system MUST start a terminal process of the selected
  Flavour, applying the given Startup Params, with its **working directory set to the active project's root
  folder** (Principle IV).
- **FR-014**: The running terminal MUST be **attached inline within the Panel** as a fully interactive
  terminal — the user can read its output and send it input.
- **FR-015**: The terminal process MUST run in the **persistent, detached daemon** — never as a child of
  the UI/renderer — so the UI does not own its lifecycle (Principle III; the daemon/client constraint).
- **FR-015a**: The daemon MUST be a **persistent, always-on background process that outlives the UI**: a
  terminal **with an active running process MUST keep running in the background** when its project or the
  application is closed, and MUST be **re-attached to the UI (live session + restored scrollback)** when
  the project/application is reopened.
- **FR-015b**: A terminal **with no active running process** (idle shell) MUST be **closed** when its
  project or the application is closed, and MUST be **re-created in a fresh process at the project root**
  when reopened (cold respawn).
- **FR-015c**: Each terminal MUST carry a **durable identity/tag** (owning project, owning Panel, flavour,
  working directory, and the metadata needed to restore it) so it is reliably matched back to its Panel
  on restart rather than by guesswork.
- **FR-015d**: The application MUST run as a **single instance**; a UI launch MUST **connect to the
  already-running daemon** (and its live terminals) rather than starting a second daemon or losing
  sessions.
- **FR-015e**: When the application is closed while one or more terminals have **active running
  processes**, the user MUST be warned and offered exactly three choices: (A) close and leave terminals
  running in the background, (B) close and terminate all terminals, or (C) cancel and review.
- **FR-016**: A Terminal Panel MUST be **started in** the project's root folder. *(REVISED 2026-07-02 —
  **confinement is WON'T FIX**: keeping the user inside the root by blocking `cd ..` in a live interactive
  shell is infeasible without a fake shell, so it is not attempted. The related, achievable guarantee — the
  root can't be deleted/moved and its path can't be edited **while a terminal is open** — is delivered as
  **FR-022**.)*
- **FR-017**: If a Terminal Panel's process exits **unexpectedly** (not user-initiated), the Panel MUST
  surface the process's failure output and exit code rather than the terminal vanishing silently
  (Principle III).
- **FR-018**: Destroying a Terminal Panel MUST route through the existing Panel-destroy confirmation flow
  for Panels with a running process, and MUST terminate the terminal (the previously *emulated*
  running-process state becomes a real one).
- **FR-019**: If a terminal **fails to launch**, or its configured **Flavour is unavailable** at restore
  time, the Panel MUST surface the error/unavailability rather than presenting a blank or broken terminal.
- **FR-020**: When a Terminal Panel's shell process **ends** — whether the user closed it (e.g. typed
  `exit`/killed it) or it **failed** — the Panel MUST **return to the type-selection form**, ready for the
  user to select a panel type again (relaunch **Terminal** or choose a **different** type). On an
  unexpected failure the exit code/output (FR-017) MUST remain visible to the user as the form returns. A
  Panel that has reverted to the form is **untyped** again and persists (FR-007) as untyped.
- **FR-021**: When a Terminal Panel is synced/cloned into a sub-workspace (the existing "Sync to" action
  gives every view the **same panel id**), all of its views MUST **mirror the same single terminal
  session**: shared scrollback and live output, with input from **any** view routed to the one underlying
  process. There MUST NOT be a second independent terminal for the mirrored Panel.
- **FR-022**: While a project has **one or more open terminals**, that project's **root folder MUST be
  locked** so it cannot be moved or deleted out from under the running terminals: the **daemon MUST hold an
  OS lock on the root** (an open directory handle / opportunistic lock on Windows) so the operating system
  **refuses deletion or relocation** of the folder, and the application MUST **prevent changing that
  project's root path** while any terminal is open. The lock MUST be released once the project has no more
  open terminals. If the root nonetheless becomes genuinely unavailable (e.g. removable/network media),
  a new launch or cold-respawn MUST surface an error rather than a blank terminal (FR-019). The locking
  mechanism sits behind the OS abstraction (Principle II); Windows is the first target.

#### Sidebar composition (batch 2)

- **FR-023**: The Sidebar Pane MUST NOT contain a Terminals Panel. It MUST stack the **Projects** Panel and
  the **Sub-workspaces** Panel only, with the **Sub-workspaces Panel pinned to the bottom** of the pane
  (it stays anchored to the bottom as the pane is resized). The removal MUST be reflected in the
  constitution (Principle XI) and any spec text that previously required a stacked Terminals Panel.

#### Robust shell detection (batch 2)

- **FR-024**: Shell (flavour) detection MUST resolve each supported built-in shell by checking, in order,
  **well-known install paths, the executable on the PATH, and the platform registry** (for Git for
  Windows, the install-path registry key, including the `HKLM`/`HKCU` and `WOW6432Node` variants), stopping
  at the first that resolves to an existing executable. Detection MUST NOT rely on a single hardcoded path,
  so a shell installed in a non-default/portable location is still detected. A shell that resolves by none
  of these means MUST NOT be listed (no false positives). This behaviour sits behind the `IShellDetection`
  abstraction (Principle II) and MUST be contract-tested.

#### Run a terminal as administrator (batch 2)

- **FR-025**: The Terminal type's configuration MUST include a **generic OS-level "run as admin" boolean**
  (one flag per Terminal Panel, **not** per flavour) captured on the type-selection form and persisted with
  the Panel config (FR-007). The flag MUST be plumbed through the terminal launch path (form → panel config
  → attach contract → daemon → PTY start options) behind the OS abstraction (Principle II).
- **FR-025a**: The "run as admin" control MUST be **enabled only when the terminal-hosting daemon is running
  elevated**. When it is not elevated, the control MUST be **disabled/greyed** and MUST carry a hover title
  explaining that the user must launch throng as administrator to enable it. The renderer MUST learn the
  daemon's elevation state through a dedicated capability query behind the preload bridge (the sandboxed
  renderer MUST NOT probe the OS directly).
- **FR-025b**: When throng is launched **as administrator**, the application MUST ensure the terminal-hosting
  **daemon is elevated** before admin terminals can launch — comparing the running daemon's integrity to the
  app's and, if the daemon is lower-integrity, **retiring and re-spawning it elevated** (an extension of the
  existing build-id/instance handshake), rather than silently attaching to a lower-integrity daemon.
- **FR-025c**: With an elevated daemon, a Terminal confirmed **with** "run as admin" MUST start **elevated**;
  a Terminal confirmed **without** it MUST start at **normal integrity** (**de-elevated** via a filtered /
  shell token), so admin and non-admin terminals can coexist in one elevated session (mixed mode). Detecting
  process elevation and de-elevating a spawn are OS-specific and MUST sit behind an abstraction
  (Principle II), contract-tested; Windows is the first target.
- **FR-025d**: A Terminal Panel running **elevated** MUST display a **red-outlined "ADMIN" pill** in its
  panel header, beside the panel type and flavour labels. A non-elevated terminal MUST NOT display the pill.
- **FR-025e**: When throng is running **elevated** (admin mode), the **main-window status bar** MUST display a
  **red "ADMIN" pill** on its **right** side. Elevation MUST be sourced from the **same daemon-capability
  signal** that gates the "run as admin" control (FR-025a) — the renderer MUST NOT probe the OS directly. To
  make room, the active **Tab · Panel context** moves to the status bar's **left** side (after the project
  path). A non-elevated app MUST NOT display the pill.

#### Panel ownership & destroy cascade (batch 2)

- **FR-026**: A Panel **belongs to its originating project**, and the destroy cascade is **one-directional**.
  Destroying a Panel **in the project** MUST remove it from the project **and from every sub-workspace that
  contains it** (same panel id, FR-021), and MUST terminate the Panel's terminal session (if any) **exactly
  once**. Open windows MUST update live via a **cross-window "panel destroyed" broadcast** (mirroring the
  existing rename broadcast); closed/lazy sub-workspaces MUST have the Panel **stripped from their persisted
  layout** so it does not reappear when they are next opened. Destroying a Panel **inside a sub-workspace**
  MUST be **local** — it removes the Panel from that sub-workspace only; the project (and any other
  sub-workspace) MUST **keep** its Panel, **including its live terminal session** *(clarified 2026-07-02)*:
  a local sub-workspace destroy of a **cloned** project Panel MUST NOT terminate the shared session (only
  this window's view detaches, FR-021) — only destroying an **owned** sub-workspace Panel (FR-028), or
  destroying from the project, ends the session.
- **FR-026a**: When destroying a Panel **from the project** that also exists in one or more sub-workspaces,
  the destroy-confirmation dialog MUST show an **extra, visually highlighted warning** that names those
  sub-workspaces and states the Panel will be removed from all of them, in addition to the existing
  running-process confirmation. (A **local** sub-workspace destroy needs no such warning — nothing outside
  that sub-workspace is affected.)
- **FR-026b**: If the destroy cascade removes the **last** Panel from a sub-workspace, that now-empty
  sub-workspace MUST be **deleted** (a sub-workspace cannot exist empty — Principle XI). The main project
  workspace MUST always retain at least one Tab with at least one Panel; destroying a project's sole Panel
  MUST remain disallowed, so the cascade cannot leave the project in an invalid state.

#### Drag a panel onto the New-Tab button (batch 2)

- **FR-027**: Dragging a Panel onto the **New-Tab (+)** control MUST create a **new Tab containing only that
  Panel** — the Panel is **moved** out of its source Tab (its emptied split slot collapses; an emptied
  source Tab is pruned per the existing rules) — and the new Tab MUST become the active Tab. The Panel MUST
  NOT be duplicated, and the new Tab MUST NOT contain any additional placeholder Panel.

#### Fully-synced cloned Panels (batch 2)

- **FR-027a**: A cloned/synced Panel (same panel id in the project and one or more sub-workspaces, FR-021)
  MUST sync its **content** across its windows, not only at the terminal-session level:
  - **Type-selection form** — while the Panel is **untyped**, its form draft (the selected Panel Type and
    that type's inputs, e.g. Flavour + Startup Params) MUST mirror **live** across every view; editing the
    form in one window updates it in the others.
  - **Confirmed type** — **confirming** a type in one window MUST type the Panel's clone in every other
    window (which then attaches to the **one shared session**, FR-021 — never a second terminal).
  - **Exit** — exiting/ending the Panel's content in either window MUST end it in the others (already
    delivered via the shared session's exit event, FR-020/021).
  - **Active selection is NOT synced** *(revised 2026-07-02; an earlier draft mirrored it)*: the
    active/selected Panel is **window-local** — sub-workspace focus is completely independent of the main
    window's selection, and selecting a Panel in either window MUST NOT change the other's selection.
  Sync is applied per window without echoing, mirroring the existing cross-window rename/destroy broadcasts;
  the renderer remains sandboxed (the relay goes through the preload bridge → UI main → other windows).

#### Sub-workspace-owned Panels & sub-workspace lifecycle (batch 3, 2026-07-01)

- **FR-028**: A Panel **created inside a sub-workspace** (an *owned* Panel — it carries the sub-workspace's
  synthetic layout id, not a project id, and is not linked to any project) MUST be able to become a
  **Terminal**. Because it has no owning project root, its terminal MUST launch at the **user's default home
  directory**, and it MUST **not** take a project-root lock (FR-022 does not apply — there is no project
  root to protect). An owned Terminal Panel otherwise behaves exactly like a project Terminal Panel
  (streaming, reattach, exit-revert, the destroy confirmation, and the app-close warning all apply).
- **FR-029**: Closing the **last** Panel — or the **last** Tab — of a sub-workspace MUST **close the whole
  sub-workspace**: its record is deleted and its window closes (a sub-workspace cannot exist empty —
  Principle XI, mirroring FR-026b). The close MUST be preceded by a **highlighted warning** in the
  confirmation that names the effect. When the closed Panel is a **cloned project Panel**, only the
  sub-workspace copy is removed (one-directional, FR-026) — the project keeps its Panel. (In the **main**
  window a project always retains its sole Panel/Tab; this behaviour is sub-workspace-only.)
- **FR-030**: An **owned** sub-workspace Panel MUST NOT be draggable **out** of its sub-workspace (into
  another sub-workspace, a new sub-workspace, or the main window); it may be dragged **within** its
  sub-workspace as normal. When such a Panel is dragged **beyond its window**, the drag ghost MUST display a
  **red invalid-drop warning** stating the move is not allowed, and the drop MUST be a no-op (the Panel
  stays put).

### Key Entities

- **Panel Type**: A named, registrable kind a Panel can become (e.g. Terminal). Carries an identity, a
  human label, the set of configuration inputs it requires, and how those inputs are defaulted/validated.
  The catalogue of types is open for extension.
- **Panel Type Assignment**: The binding of a specific Panel to exactly one confirmed Panel Type plus the
  configuration captured at confirmation time. Fixed in *type* **while the Panel hosts live content**;
  cleared back to untyped when that content ends (FR-020), after which the Panel is re-typeable. Persisted
  with the Panel's layout record (a reverted Panel persists as untyped).
- **Terminal Flavour**: A shell a Terminal Panel can run. Sourced either from the **built-in catalogue**
  (supported flavours grown over time, each detected on the machine) or from a **user-defined** entry in
  `settings.json`. Carries a display label, the means to launch it, and a default Startup Params value.
- **Terminal Session**: The live terminal process owned by the **persistent daemon** and bound to a
  confirmed Terminal Panel. Carries a **durable identity/tag** (owning project, owning Panel, flavour,
  working directory = project root, launch params), survives the UI closing while it has a running
  process, and exposes its input/output stream (with scrollback) for re-attachment inline in the Panel —
  to **one or more attached views** at once when the Panel is mirrored across windows (FR-021).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a new Panel, a user can select a type, see its inputs, and confirm it in **under 20
  seconds**, with no path that lets an invalid selection be confirmed.
- **SC-002**: While a Panel hosts confirmed live content, **100%** of attempts to change its type are
  refused (the type control is unavailable); once that content ends, the Panel returns to the type-selection
  form in **100%** of cases (no path leaves an ended Terminal Panel stuck or blank).
- **SC-003**: For a machine with at least one installed shell, the Flavour dropdown lists **every** shell
  the platform exposes as installed and **zero** shells that are not installed.
- **SC-004**: After confirming a Terminal Panel, a live interactive terminal is usable inside the Panel
  within **3 seconds**, and its first reported working directory **is** the project root in **100%** of
  launches.
- **SC-005**: When a terminal process exits unexpectedly, the Panel shows the exit code and failure output
  in **100%** of such cases (no silent disappearance), and the Panel returns to the type-selection form.
- **SC-006**: A terminal running a live process **survives a full application close/reopen in 100%** of
  attempts: the same process is still running and the Panel reattaches with restored scrollback. An idle
  terminal is recreated cold at the project root.
- **SC-007**: Launching the UI while a daemon with running terminals already exists results in **exactly
  one** daemon and reattachment to the existing sessions (never a second daemon, never lost terminals).
- **SC-008**: A Terminal Panel **mirrored** across windows (synced into a sub-workspace) shows **one**
  session in **100%** of cases — output appears in every view and input from any view reaches the single
  process (never a second/independent terminal).
- **SC-009**: While a project has an open terminal, attempts to delete, move, or rename its root folder, or
  to change its root path in-app, are **refused in 100%** of cases; once the project's last terminal closes,
  those operations succeed again.
- **SC-010**: Adding a hypothetical second panel type later requires **no change** to the selection form's
  shared selection/confirm/clear/revert flow (verified by design review / the type-registration seam), only
  the new type's own inputs.
- **SC-011**: Every user-facing behaviour above is covered by passing end-to-end tests through the running
  application before the feature is considered complete (Constitution Principle V).
- **SC-012**: The Sidebar Pane shows exactly the Projects and Sub-workspaces panels (no Terminals Panel) in
  **100%** of sessions, and the Sub-workspaces Panel remains anchored to the bottom of the pane across
  resizes.
- **SC-013**: For a supported shell installed in a non-default location discoverable via PATH or registry,
  the Flavour dropdown lists it in **100%** of cases; shells not installed by any resolution method are
  listed in **0%** of cases.
- **SC-014**: The "run as admin" control is enabled in **100%** of elevated-daemon sessions and disabled
  (with an explanatory hover) in **100%** of non-elevated sessions; a terminal confirmed with the flag runs
  elevated and shows the ADMIN pill, and one confirmed without it runs at normal integrity with no pill, in
  **100%** of cases.
- **SC-015**: Destroying a Panel **in the project** removes it from the project **and every** containing
  sub-workspace (open or persisted) and terminates its terminal exactly once, in **100%** of cases —
  **zero** ghost Panels remain — with the highlighted warning naming the affected sub-workspaces present in
  **100%** of such multi-location destroys. Destroying a Panel **inside a sub-workspace** removes it from
  **only** that sub-workspace in **100%** of cases (the project retains its Panel **and**, for a cloned
  Terminal Panel, its still-running shared session — clarified 2026-07-02).
- **SC-016**: A sub-workspace emptied by a destroy cascade is deleted in **100%** of cases (never left
  empty).
- **SC-017**: Dropping a dragged Panel on the New-Tab (+) control produces a new active Tab containing
  exactly that one Panel (moved, not duplicated, no placeholder) in **100%** of cases.
- **SC-018**: A Panel created inside a sub-workspace can be confirmed as a Terminal and launches a live
  shell at the user's home directory in **100%** of cases, taking **no** project-root lock.
- **SC-019**: Closing the last Panel or last Tab of a sub-workspace closes the whole sub-workspace (record
  deleted, window closed) in **100%** of cases, preceded by the highlighted warning; a cloned project Panel
  closed this way leaves the project's Panel intact in **100%** of cases.
- **SC-020**: Dragging an owned sub-workspace Panel beyond its window shows the red invalid-drop warning and
  leaves the Panel in place in **100%** of cases (never moved out).
- **SC-021**: When the app runs **elevated**, the main-window status bar shows the red ADMIN pill on its
  right and the `Tab · Panel` context on its left in **100%** of elevated sessions, and shows **no** pill in
  **100%** of non-elevated sessions — sourced from the same daemon capability signal as the run-as-admin
  control, never a direct OS probe (FR-025e).

## Assumptions

- **"Folder type" means "Panel type"**: The user's phrasing ("folders can be one of several types")
  refers to the **Panel** entity (Constitution Principle XI), the unit that currently shows "Empty Panel".
  This spec treats the typed entity as the Panel.
- **Flavour catalogue + user config** (confirmed): The product maintains a **built-in catalogue** of
  supported flavours, grown one at a time as each shell is implemented directly, behind the
  OS-abstraction boundary (Principle II). Built-in flavours are filtered to those detected present on the
  machine (Principle IV). In addition, users may **add their own flavours via a configurable array in
  `settings.json`** (Principle X). The Flavour dropdown shows the union. Windows is the first target.
- **Startup Params defaults** (confirmed): Each flavour — built-in or user-defined — carries a documented
  default params value (e.g. PowerShell `-NoLogo`, CMD `/K`, Git Bash `-i -l`), surfaced through injected
  settings (Principle X) so built-in defaults can later be overridden without code changes. The user may
  freely edit the value per Panel before confirming.
- **Flavour change overwrites params**: For simplicity in this slice, switching the selected Flavour
  repopulates Startup Params with the new flavour's default, discarding prior edits to that field.
- **Background process ownership & persistence** (confirmed — full lifecycle in scope): The terminal runs
  in a **persistent, always-on, detached daemon** that **outlives the UI** (Principle III + daemon/client
  constraint). This feature therefore also delivers the daemon-lifecycle work this requires: the UI
  spawning/owning a persistent daemon, single-instance enforcement, the UI auto-reconnecting and
  re-streaming live terminals (with scrollback) on launch, durable terminal tagging, idle-close /
  cold-respawn, and the application-close three-choice warning. (Rationale, confirmed with the user: a
  terminal's interactive session lives behind a PTY master held in its owning process; a child **PID
  alone cannot be re-attached to**, so a persistent holder — the daemon — is the only reliable reattach
  mechanism.)
- **Root confinement is NOT attempted (WON'T FIX, 2026-07-02)**: A live interactive shell always lets the
  user `cd` anywhere; blocking that would require intercepting/rewriting keystrokes, which breaks the shell.
  The terminal **starts** at the project root, and while it is open the daemon **locks** the root against
  deletion/move/path-edit (FR-022) — but the working directory is not caged and is never assumed to be a
  security sandbox.
- **At least one shell exists in practice**: The primary flows assume the machine has at least one
  installable shell; the no-shells case is handled as an explicit edge case, not a primary flow.
- **Terminal presets, multiple concurrent flavours per panel, and non-Terminal panel types** are out of
  scope for this feature (see below).

## Out of Scope

- Any panel type other than **Terminal** (the type system is built to accept them; none other is defined
  here).
- Terminal **presets** (saved shell + working directory + startup command sets) per project — a distinct,
  unrequested feature, deferred to a later increment.
- The combined **edit list / change review** (Principle VII) reacting to terminal-driven file changes.
- Changing a Panel's **type while it hosts live content** (prohibited while a terminal is live; a Panel
  whose content has ended reverts to the form and is re-typeable per FR-020).
