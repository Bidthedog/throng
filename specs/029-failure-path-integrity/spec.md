# Feature Specification: Failure-Path Integrity

**Feature Branch**: `feature/S029-failure-path-replications`

**Created**: 2026-08-07

**Status**: Draft

**Input**: Consolidates four tracked v1.0.0 bugs — #204, #182, #196, #181 — chosen as one set
because they share a single user-visible complaint: **when something goes wrong, throng hands the
user the machine's words instead of its own** — and on one of those paths it deletes their
configuration on the way.

**Feature number**: 029, following 028. 027 and 022 remain deliberate gaps (see the 028 spec).

**Explicitly out of scope**:

- **#195** (the notice-vocabulary sweep). It inventories *every* user-facing string in the
  application and adds a lint guard. This feature fixes the four paths it measured; the
  classification it builds is what that sweep should later consume.
- **#192** (a dev or E2E instance killing the installed instance's daemon). Separate defect,
  separate cause — a machine-wide orphan sweep and a shared dev namespace. This feature makes that
  failure *visible* but does not prevent it.
- **#133** (an in-app manager for daemons and held locks). This feature reports a failure at the
  moment it happens; #133 is the surface for seeing and releasing locks at rest. They share the
  holder-identification machinery.

## Context

Four open v1.0.0 bugs are one defect wearing four costumes: **a failure deep in the stack reaches
the user as whatever raw string happened to be thrown, and on one of those paths it destroys the
user's configuration on the way out.**

Every one of them has been replicated with a failing E2E on this branch before this spec was
written, and the measurements corrected three of the four issue reports. Those corrections are load
bearing — two of them make the fix *smaller* than the issue asks for, and one makes it *different*.
They are recorded here, in the issues, and in each spec file's header.

| Issue | Symptom | Replication |
|---|---|---|
| #204 | A terminal that fails to launch loses its panel type, permanently | `terminal-launch-failure-config.e2e.ts` |
| #182 | A dead daemon turns every action into a raw RPC error, with no indication it has gone | `daemon-death-notice.e2e.ts` |
| #196 | A blocked file operation reports a raw errno and never says what holds the file | `fileop-lock-cause.e2e.ts` |
| #181 | A project whose folder is gone reports raw internal errors | `project-missing-root-wedge.e2e.ts` |

### What the replications changed

- **#204 overstates the loss.** `terminalMemory` survives the failed launch intact — flavour, shell
  arguments, startup command and both remember flags. What is destroyed is the panel's **type**, so
  the form returns pre-filled but unconfirmed and the terminal never comes back. The remedy is
  "stop clearing the type", not "restore the configuration".
- **#204 has a fourth existing spec to reconcile with**, not the three it names. A panel restored
  with a flavour that no longer resolves reverts to the type-selection form *deliberately*, and that
  is asserted today. A missing **flavour** is a configuration the user must re-choose; a missing
  **folder** is not.
- **#196 names the wrong errno.** The measured failure is `EBUSY: resource busy or locked`; the
  issue's `EPERM: operation not permitted` came from a network share. Classification keyed on the
  quoted string would miss the commoner case.
- **#196's own-lock case cannot arise through the daemon's directory lock.** Overlapping project
  roots are forbidden (Constitution, Principle I), so a folder the daemon holds as a project root is
  never visible in another project's tree. The realistic throng holder is a **terminal's shell**
  sitting in the folder.
- **#181 is two claims and only one survives.** The raw-message half reproduces twice over. The
  *wedge* does not: the workspace switches cleanly and both halves of the app agree. Its stated
  cause is also wrong — activating a project is a pure database operation that never looks at the
  folder — and the bare `ENOENT` it quotes is exactly what a dead daemon produces, from the same
  session that produced #182.
- **#182 reproduces verbatim** and needs no correction.

## Clarifications

### Session 2026-08-07

- Q: FR-001 keeps a failed terminal's panel type instead of reverting it, removing the escape hatch the automatic revert gave for free. How does a user who no longer wants a terminal there get rid of it? → A: The failure state carries its own Clear control, dropping the panel back to the Panel Type form deliberately.
- Q: One cause breaks the tree, every terminal and every editor at once. How should throng collapse those into one notice? → A: Report the cause once and suppress the casualties — failures carry the cause they were derived from, the first raises the notice, later failures sharing that cause raise nothing. Each affected panel still shows its own in-place failure state.
- Q: FR-018 demotes the raw error text but does not say where it goes. Where? → A: The notice's existing Copy payload, and the diagnostics log. No new control on the notice surface.
- Q: The spec said "background service" while the codebase, issues and logs all say "daemon". Which is canonical for user-facing text? → A: "Daemon", everywhere — no translation layer between what the user reads and what the logs, issues and code call it.
- Q: Where does the daemon restart control live — the status bar, the notice, or both? → A: The status-bar indicator IS the control. The notice only reports what happened, so the action survives the notice being dismissed.

- Q: FR-019 suppresses failures sharing a reported cause, but for how long? → A: While that cause's notice is live. Dismissing or expiring the notice re-arms the cause — the notice's own lifetime is the "already told them" window, so there is no separate clock or correlation id.
- Q: While the daemon is down, should throng disable the actions that cannot work, or let them fail? → A: Let them fail, naming the daemon as the cause and pointing at the status bar. Nothing is disabled — one code path knows about daemon state, rather than every surface subscribing to it.
- Q: SC-002 says "within seconds" but names no number or mechanism. Which? → A: Detect on connection loss — the app already holds a connection and a dead daemon drops it. No polling, no interval to tune. SC-002 becomes a 2-second ceiling.
- Q: How far does throng-holder attribution go when the holding panel is in a detached sub-workspace window? → A: Name the panel AND its window when that window is not the current one. Telling a user "a panel in this window" when it is in another is worse than saying nothing.
- Q: Which failure classes are in scope for FR-011's classification? → A: A closed set of five — held by a process, path missing, permission denied, folder not empty, daemon stopped. Anything unmatched keeps today's raw message unchanged.
- Q: FR-019's first-wins rule makes the notice's wording depend on which failure lost the race. Which wording does the user see? → A: The CAUSE owns the wording. The first failure triggers the notice; the text comes from the cause, and the reporter supplies only the subject. Five causes, five messages, deterministic run to run.
- Q: FR-005 restores flavour, arguments and startup command, but the remembered directory may be a subfolder that is still gone. What then? → A: Fall back to the project root and say so in the terminal. The terminal starts, and the user is not silently working in a different folder from the one they left.
- Q: With several terminals failed in one project, should one action recover them all? → A: No. Retry stays per-panel; reopening the project is the bulk path and already restarts every terminal. No new control, and no automatic cascade.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A terminal that could not start keeps its panel (Priority: P1)

A developer has a project whose root folder is temporarily unavailable — renamed, moved, or on a
disconnected network share. They open throng. Every terminal panel fails to start. They put the
folder back, reopen the project, and their terminals are exactly as they left them.

**Why this priority**: This is the only one of the four that destroys persistent user state.
Everything else is a bad message about a transient problem; this silently deletes configuration in
response to a folder being briefly away, and the loss outlives the session that caused it. A user
who does not notice at the time has no way to recover it later.

**Independent Test**: Configure a terminal, close throng, rename the project root away, launch,
close, rename it back, launch. The terminal is there and running.

**Acceptance Scenarios**:

1. **Given** a project with a configured terminal panel and a root folder that no longer exists,
   **When** the user opens the project, **Then** the panel still presents as a terminal, shows that
   it could not start, and offers to try again.
2. **Given** that failed state, **When** the user restores the folder and reopens the project,
   **Then** the terminal starts with its original flavour, shell arguments and startup command.
3. **Given** a terminal whose shell ran and then exited, **When** it ends, **Then** the panel
   reverts to the type-selection form exactly as it does today.
4. **Given** a panel whose saved terminal flavour no longer exists on this machine, **When** the
   project is opened, **Then** the panel reverts to the type-selection form so the user can choose a
   flavour that does exist.
5. **Given** a panel showing a start failure, **When** the user no longer wants a terminal there and
   chooses Clear, **Then** the panel returns to the type-selection form, keeping its position and
   title.

---

### User Story 2 - throng says when its daemon has stopped (Priority: P2)

A developer is working when throng's daemon dies — crashed, killed, or retired by another instance.
Instead of the application quietly becoming useless, throng tells them once, plainly, and offers to
restart it.

**Why this priority**: Second only to data loss because the failure is *total and silent*. Terminals
stay on screen accepting no input, layout changes are not saved, and every action fails with a
different unrelated-looking message. The user's mental model — "the app is working" — is wrong in a
way nothing on screen contradicts, so they can lose an afternoon before suspecting the cause.

**Independent Test**: With throng running and a terminal open, end the daemon. A notice appears
naming the cause, and the status bar shows the daemon is not running.

**Acceptance Scenarios**:

1. **Given** a running throng with a live terminal, **When** the daemon stops, **Then** a
   notice appears saying the daemon has stopped.
2. **Given** the daemon has stopped, **When** the user performs any action that needs it, **Then**
   the failure names the stopped daemon as the cause and does not present a raw internal error.
3. **Given** the daemon has stopped, **When** the user looks at the status bar, **Then** its state
   is visible there without having to attempt an action.
4. **Given** the daemon has stopped, **When** the user activates the status-bar indicator, **Then**
   throng attempts a restart and reports whether it succeeded.
5. **Given** the daemon has stopped and the user dismissed the notice, **When** they later decide to
   restart it, **Then** the status-bar indicator is still there and still offers the restart.

---

### User Story 3 - A blocked file operation says what is holding the file (Priority: P3)

A developer renames a folder and it fails. Instead of an errno, they are told the folder is open in
another program — and, where the system can say so, which one. When the holder is throng itself,
they are told that.

**Why this priority**: High frequency, low severity. Nothing is lost and the user can retry, but the
current message actively misleads: "operation not permitted" sends them to check permissions for a
problem that has nothing to do with permissions, and "resource busy or locked" names neither the
resource nor the lock.

**Independent Test**: Hold a folder open with any other process, then rename it from the tree. The
message names the folder and says it is held.

**Acceptance Scenarios**:

1. **Given** a folder held open by another program, **When** the user renames it, **Then** the notice
   names the folder and says it is open in another program.
2. **Given** the same failure, **When** the user looks at the notice, **Then** the raw error text is
   not the headline but is still reachable for diagnostics.
3. **Given** a folder held by one of throng's own terminals, **When** the user renames it, **Then**
   the notice says throng is holding it, rather than "another program".
4. **Given** the system cannot determine which process holds the folder, **When** the failure is
   reported, **Then** the notice says so explicitly rather than falling back to the raw error.

---

### User Story 4 - A project whose folder is gone says so (Priority: P4)

A developer opens a project whose folder they moved, renamed or deleted — a removed git worktree, a
disconnected share. They are told which folder is missing, in those words.

**Why this priority**: Lowest of the four because the user usually knows what they did, and nothing
is lost. It is included because it is the same defect and shares the same remedy — and because two
separate raw messages currently reach the user for one cause.

**Independent Test**: Create a project, close throng, rename its folder away, launch, and enter that
project. The message names the folder and says it is missing.

**Acceptance Scenarios**:

1. **Given** a project whose root folder no longer exists, **When** the user enters it, **Then** a
   notice names the folder and says it could not be found.
2. **Given** the same situation, **When** the failure is reported, **Then** no raw internal error
   text reaches the user.
3. **Given** the same situation, **When** the entry fails, **Then** the file tree and the project
   list never show different projects as the current one.

---

### Edge Cases

- **A folder that returns while throng is running.** The user restores the folder without restarting.
  The failed terminal does NOT recover on its own — it waits for Try again, or for the project to be
  reopened (FR-005). Watching for a path to return is a separate capability and is not built here.
- **Several failures at once.** A missing project root fails the tree, the terminals and the editors
  together. One notice names the cause; each affected panel shows its own failure in place
  (FR-019, FR-019a).
- **A failure that recurs on a timer.** A watcher re-reporting an unchanged error is silent while its
  cause's notice stands, and reports again only once that notice has gone (FR-019c, FR-019d).
- **A holder that is throng, in another window.** A folder held by a terminal in a detached
  sub-workspace is attributed to throng, names that terminal, AND names the sub-workspace — because a
  panel title alone sends the user searching the window in front of them (FR-013a).
- **A holder that disappears between the failure and the lookup.** Identifying the holder is
  inherently racy; the report must degrade to "throng could not identify which" rather than to an
  errno or a stale process name.
- **The daemon stops while a modal or a rename is mid-flight.** The in-progress action
  must fail with the stopped daemon as its cause, not with its own unrelated-looking error. It is not
  cancelled and no control is disabled — throng stays interactive and explains (FR-010a, FR-010b).
- **A remembered directory that outlived its folder.** The project root returns but the subfolder the
  terminal was last in does not. It starts in the project root and says so, rather than failing a
  second time on something retrying cannot fix (FR-005a, FR-005b).
- **A daemon that is running but wedged.** Out of scope, and stated so rather than left ambiguous:
  connection-loss detection cannot see it, and a second detector would mean two mechanisms writing
  one state (FR-006b).
- **A project folder on a disconnected network share.** Distinguishable from "deleted" only by the
  error the system returns; both must produce an actionable message.

## Requirements *(mandatory)*

### Functional Requirements

#### Preserving state across a failed start

- **FR-001**: A terminal panel that fails to START or ATTACH MUST keep its panel type and
  configuration, both on screen and in the saved workspace.
- **FR-002**: A terminal whose shell RAN AND THEN EXITED MUST continue to revert to the
  type-selection form, unchanged from today's behaviour.
- **FR-003**: The system MUST distinguish a start failure caused by a **transient environmental
  condition** (the folder is absent) from one caused by a **configuration that can no longer be
  satisfied** (the chosen terminal flavour does not exist on this machine). The first MUST preserve
  the panel type; the second MUST continue to revert it so the user can choose again.
- **FR-004**: A panel whose terminal failed to start MUST present the failure in place, with an
  affordance to try again.
- **FR-004a**: That failure state MUST also offer to CLEAR the panel back to the type-selection form.
  Preserving the panel type (FR-001) removes the escape hatch the automatic revert previously gave
  for free, and a user who no longer wants a terminal in that position must not have to destroy the
  panel — and lose its position and title — to say so. Clearing is then the user's decision rather
  than a side effect of a folder being unavailable, which is the whole distinction this feature
  draws.
- **FR-004b**: Both controls MUST be presented as icons with hover titles, per the Constitution's
  icon-only rule (Principle VI), consistent with the existing retry affordance.
- **FR-004c**: Retry MUST act on ONE panel. throng MUST NOT add a "retry all" control, and a
  successful retry MUST NOT trigger retries on other failed panels. Reopening the project is already
  the bulk path — it restarts every terminal (FR-005) and the user already knows it — so a second
  bulk control would duplicate it, and an automatic cascade would turn one deliberate action into
  several unasked-for ones that can fail again if the cause was only partly resolved.
- **FR-004d**: Retry and Clear MUST each appear as an item in the terminal Panel's menu, alongside
  their icon controls. The Constitution's "Every panel action has a menu item" rule binds a feature
  that adds a panel action to add its menu item **in the same increment** (Principle VI), and FR-004a
  makes clearing a panel a user-invoked action for the first time — today it happens only
  automatically, as a side effect of a terminal ending. An action reachable solely by an icon on a
  transient failure surface is exactly the invisibility that rule exists to prevent.
- **FR-005**: When the cause of a start failure is rectified and the project is reopened, the
  terminal MUST start with its original flavour, shell arguments and startup command.
- **FR-005a**: Where the terminal also remembers a WORKING DIRECTORY and that directory no longer
  exists — a subfolder deleted while the project root was away — the terminal MUST start in the
  project root instead, and MUST say so in the panel. It MUST NOT fail a second time: retrying could
  never succeed, so treating a vanished remembered directory as an ordinary start failure would leave
  the user on a dead loop whose only exit is Clear.
- **FR-005b**: That fallback MUST NOT be silent. A user who left a shell deep in a subtree and finds
  one at the root, with no explanation, has been given a smaller version of the same complaint this
  feature exists to fix.

#### Reporting a stopped daemon

> **Terminology.** "Daemon" is the canonical term in USER-FACING text as well as in code, logs and
> issues. There is no translation layer: what the notice says is what the log says is what the
> `gh issue` says, so a user who reads a log line can match it to what they were told.

- **FR-006**: throng MUST detect that its daemon is no longer available, without
  requiring the user to attempt an action first.
- **FR-006a**: Detection MUST be driven by the LOSS OF THE CONNECTION throng already holds to the
  daemon, not by polling. A daemon that stops drops that connection, so the signal already exists and
  arrives immediately; introducing an interval would add a number to tune and a round trip to pay
  forever, to detect something rare.
- **FR-006b**: A daemon that is running but UNRESPONSIVE is explicitly NOT covered. Connection loss
  cannot see it, and adding a second detector means two mechanisms writing one state that must never
  disagree. If a wedged daemon proves to be a real failure mode in practice, it gets its own issue —
  it is not smuggled in here.
- **FR-007**: throng MUST report a stopped daemon to the user ONCE, in plain terms,
  rather than allowing each dependent action to fail separately.
- **FR-008**: The status bar MUST show the daemon's state, and that indicator MUST BE the restart
  control — activating it attempts a restart. One surface carries both the state and the action, so
  the action is where the user is already looking once they suspect something is wrong.
- **FR-009**: Users MUST be able to restart the daemon from within throng, and MUST be
  told whether the restart succeeded.
- **FR-009a**: The notice raised by FR-007 MUST NOT carry its own restart control. A notice is
  transient; the action must not vanish when it is dismissed, leaving a user who dismissed it with no
  way back except to provoke another failure. The notice reports, the status bar acts.
- **FR-009b**: The status-bar indicator MUST be presented as an icon with a hover title, per the
  Constitution's icon-only rule (Principle VI), and MUST reflect a restart already in flight so it
  cannot be triggered twice.
- **FR-010**: While the daemon is unavailable, any action that depends on it MUST fail
  with the stopped daemon named as the cause, and MUST point the user at the status bar as the way
  to recover.
- **FR-010a**: throng MUST NOT disable, hide or block the controls that depend on the daemon. The
  application stays fully interactive: an attempted action fails and explains why. Disabling them
  would require every surface to subscribe to daemon state and re-enable correctly, and a single
  missed re-enable leaves a control dead after a restart that actually worked — a worse failure than
  the one being prevented. Only the failure reporter needs to know the daemon has stopped.
- **FR-010b**: Work that does NOT need the daemon MUST remain possible while it is down — reading an
  open editor buffer, selecting and copying text already on screen, moving panels. The daemon's
  absence degrades throng; it does not seize it.

#### Saying what actually went wrong

- **FR-011**: A file operation that fails because the target is HELD by a process MUST report a
  human-readable cause, not a raw error code. This MUST be keyed on the class of failure, not on any
  single error string — the same cause is reported under more than one code depending on the holder
  and the location of the path.
- **FR-011a**: The classified set is CLOSED, and is exactly these five:

  | Cause | Reported as |
  |---|---|
  | Held by a process | the folder or file is open in another program, or in throng |
  | Path missing | the folder or file could not be found |
  | Permission denied | the user does not have permission |
  | Folder not empty | the folder still contains items |
  | Daemon stopped | throng's daemon has stopped |

- **FR-011b**: A failure matching NONE of those five MUST keep today's behaviour exactly — the raw
  message, unchanged. A closed set has a completion signal and can be tested to exhaustion; an
  open-ended instruction to classify errors is a sweep, and #195 is where sweeps belong. Passing the
  remainder through unchanged is also what guarantees no regression: nothing that works today can be
  made worse by a classifier that declines to guess.
- **FR-011c**: Permission-denied and folder-not-empty are included though NEITHER was produced by the
  replications. They are the next two failures reachable on the same rename path that this feature
  already touches, and leaving them raw would put an errno directly beside a classified sibling in
  the same notice surface — which reads as a bug rather than as a boundary.
- **FR-012**: Where the system can identify the holding process, the notice MUST name it. Where it
  cannot, the notice MUST say so explicitly rather than degrading to the raw error text.
- **FR-013**: A folder held by throng itself — including by one of its own terminals — MUST be
  attributed to throng, and MUST name the responsible panel by its displayed title where that is
  knowable.
- **FR-013a**: Where the responsible panel lives in a DIFFERENT window from the one reporting the
  failure — a detached sub-workspace — the notice MUST name that window too. Attribution that stops
  at the panel title is actively misleading across windows: a user told "the terminal Build" searches
  the window in front of them, which is the one place it is not. The daemon keys terminals by panel
  id and holds no window concept, so the lookup is unaffected by which window asks.
- **FR-013b**: Naming the panel MUST degrade the same way naming a third-party holder does — if the
  panel cannot be resolved, the notice says throng is holding the folder and that it could not
  identify which panel, rather than falling back to the raw error.
- **FR-014**: Holder identification MUST sit behind the platform abstraction and MUST NOT break a
  non-Windows build.
- **FR-015**: Entering a project whose root folder does not exist MUST produce a notice that names
  the folder and says it could not be found.
- **FR-016**: No user-facing notice MUST carry a raw error code, a raw internal error string, or a
  message whose only subject is the file path inside such a string.
- **FR-017**: Every notice covered by this feature MUST name its subject in prose — the folder, the
  project, the panel — and not rely on a file path embedded in a diagnostic string to identify it.
- **FR-018**: The raw error text MUST remain reachable for diagnostics. It is DEMOTED, not
  discarded. Specifically it MUST appear in BOTH:
  - the notice's existing **Copy** payload, below the human-readable cause, so one gesture yields
    everything a bug report needs; and
  - the **diagnostics log**, so it survives the notice being dismissed.
- **FR-018a**: No new control MUST be added to the notice surface for this. Copy already exists and
  is already the notice's diagnostic escape hatch; an expanding disclosure would change toast height
  and stacking on a surface only recently stabilised (#178, #143).
- **FR-019**: One underlying cause MUST NOT produce a separate notice for each thing it broke. The
  FIRST failure attributable to a cause raises the notice, naming the cause and its subject; further
  failures sharing that cause raise none. Measured on the missing-root path today: two notices, from
  the file tree and from a terminal, for one absent folder.
- **FR-019a**: Suppressing the secondary notices MUST NOT hide which parts of the workspace were
  affected — each panel that could not start still shows its own failure in place (FR-004), so the
  notice answers "why" and the panels answer "what".
> **On the ordering below.** FR-019e is stated before FR-019b–d deliberately: it establishes who owns
> a notice's wording, which the suppression rules that follow all depend on. It is not a numbering
> slip.

- **FR-019e**: The notice's WORDING MUST come from the cause, not from whichever failure reported it
  first. The reporter contributes only the SUBJECT — the project, the folder, the panel. Without this
  the message a user sees depends on a race between the file tree and a terminal, so the same fault
  reads differently run to run and FR-015's "entering the project failed" could never be guaranteed.
  Five causes therefore have five messages, which is also five things to write and test rather than
  one per call site.
- **FR-019b**: A failure whose cause is NOT already reported MUST still raise its own notice.
  Suppression is keyed on the cause, never on the count or on the message text — the two measured
  messages differ, so text-matching would collapse neither.
- **FR-019c**: Suppression MUST last exactly as long as that cause's notice is live. Once the notice
  is dismissed or expires, the cause is RE-ARMED and the next failure attributable to it raises a new
  notice. The notice's own lifetime is the "the user has been told" window, so no separate timer and
  no operation identity are needed — and dismissal, which means "I have dealt with this", correctly
  restores reporting.
- **FR-019d**: A watcher re-reporting an unchanged failure MUST therefore be silent while its notice
  stands, satisfying the recurring-failure edge case through the same rule rather than a second one.

#### Not making it worse

- **FR-020**: A failed project entry MUST NOT leave the file tree and the project list showing
  different projects as the current one. *(This holds today; it is stated so a fix that reroutes the
  failed entry cannot break it.)*

### Key Entities

- **Failure cause**: the human-meaningful reason an operation failed, drawn from the closed set of
  five in FR-011a, derived from the raw error rather than replacing it. Carries the subject it
  applies to, an optional holder (which may be a throng panel and its window), and the raw text it
  was derived from. A failure that matches no cause has none — it is reported as it is today.
- **Daemon state**: whether the daemon is running, and since when. Read by the status
  bar and by the failure reporter.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A terminal configuration survives a project folder being unavailable and restored, in
  100% of cases — no configured terminal is ever lost to a start failure.
- **SC-002**: A user learns their daemon has stopped **within 2 seconds** of it happening, without
  performing any action. A ceiling, not a target — the connection-loss signal (FR-006a) arrives in
  well under that, and the margin covers the notice and status bar rendering.
- **SC-003**: Zero user-facing notices in the covered paths contain a raw error code or internal
  error string.
- **SC-004**: Every notice in the covered paths names the thing it is about — the folder, the
  project, the panel — in its own words.
- **SC-005**: A user shown a blocked file operation can tell, from the notice alone and without
  opening any other tool, whether the holder is throng or something else.
- **SC-006**: One underlying failure produces one notice **while that notice is live**, however many
  parts of the application it breaks. Scoped to the notice's lifetime deliberately, to match FR-019c —
  an absolute reading would forbid the re-arming that dismissal is supposed to cause.
- **SC-007**: Each of the four replication specs on this branch passes without its assertions being
  weakened, and the existing specs that cover the deliberate revert-on-exit and revert-on-missing-
  flavour behaviours remain green.

## Assumptions

- **Windows first.** Holder identification is a Windows capability; the abstraction admits other
  platforms but only Windows is delivered here. Non-Windows builds report "could not identify which".
- **A start failure is reported through the existing in-place failure surface** (the "still starting"
  state with a retry) rather than through a new one. That surface already exists for a slow start and
  is the natural home for a failed one.
- **Recovery is on retry or on reopening the project, not automatic.** A terminal that failed to
  start does not watch for its folder returning. This matches the retry affordance the issue asks
  for; a watching recovery is a larger change and belongs to a separate feature if wanted.
- **The daemon is offered for restart, not restarted automatically.** #182 asks for "a
  way to reconnect or restart it", and an automatic restart risks masking a fault that keeps
  recurring — including the one #192 describes, where another instance retires the daemon.
- **Holder identification ships in reduced form.** *(A DECISION, not an assumption — kept here beside its siblings for readability; its full justification is in the plan's Complexity Tracking.)* The spike RAN and closed. Planning investigated
  the operating-system routes (`research.md` R6) and found none viable without a native addon or FFI,
  which `windows-directory-lock.ts:18` names as a design property to avoid. FR-012's "could not
  identify which" branch is therefore the shipped behaviour for a **third-party** holder, and FR-011
  still holds in full. The finding inverted the issue's assumption: identifying **throng's own**
  holders needs no OS call at all — the daemon already knows its terminals and their working
  directories — so FR-013, the case a user actually hits, ships complete.
- **This feature does not undertake the full notice-vocabulary sweep.** #195 inventories every
  user-facing string in the application; FR-016 and FR-017 apply only to the paths covered here.
  The classification built here is what that sweep should later consume.
- **#192 is out of scope.** A dev or E2E instance killing the installed instance's daemon is a
  separate defect with a separate cause. This feature makes that failure *visible* (FR-006, FR-007)
  but does not prevent it.
- **The reported "wedge" in #181 is treated as not reproducible.** FR-020 is written as a guard
  rather than a fix. If the reporter can supply a session where the two halves genuinely disagree,
  it becomes a defect again.
