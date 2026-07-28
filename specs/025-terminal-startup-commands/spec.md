# Feature Specification: Terminal Startup Commands & Command Memory

**Feature Branch**: `feature/S025-I12-terminal-startup-commands`

**Created**: 2026-07-27

**Status**: Draft

**Issues**: closes #12 (Terminal presets), #96 (Terminal panels remember their last directory), #113 (Custom terminal flavours are never proven to launch). Related but explicitly out of scope: #104, #17, #18, #133, #14, #67, #106, #107.

**Input**: User description: "I want to implement a feature that allows me to specify which commands each terminal panel should run when they start up, and also a terminal 'memory', remembering the last terminal command that was running when it was killed." — with worked examples for a tab of three terminals (git-bash running `npm run dev`, Windows Terminal running `claude`, cmd running `ping -t bbc.co.uk`), and an opt-in checkbox governing whether the saved command updates itself. Claude Code session resumption was part of the original request and has since been **dropped from this feature** by decision — see Clarifications, Session 2026-07-27 (b) — to be designed separately. Claude is treated here as an ordinary command.

## Overview

A Terminal Panel today captures a **Flavour** and a free-text field of shell *arguments* (such as `-NoLogo`, `/K`, `-i -l`) — currently labelled "Startup Params", renamed to **Shell Arguments** by this feature — then always cold-starts at the project root with a bare prompt. A user who keeps the same terminals running the same commands every session must retype every command after every restart, and re-`cd` every terminal back to where it was working.

This feature gives each Terminal Panel a durable memory of **what it was doing**:

1. a **Startup Command** it runs automatically when its terminal starts;
2. an **opt-in** ability to keep that command up to date by itself, from whatever command actually had control of the terminal when it went away; and
3. the **last working directory** it was pointed at.

Every command is treated alike. An agentic CLI such as Claude Code is just a command a user typed — it is captured and re-run by the same rules as `npm run dev`, with no recognition and no special handling. Agent-aware behaviour is a separate feature.

The constitution already requires this. Principle III mandates that each terminal be tagged with "shell type, working directory, title, layout position, and **launch command/preset**", and that "terminal **presets** (saved shell + working directory + startup command sets) MUST be definable per project and executable by the user when a project opens cold, so an idle project can be reconstituted to a known working state." Today only shell type, title and layout position are honoured. This feature delivers the remaining two — launch command and working directory — with the Panel's own configuration acting as its preset and the Panel's cold start acting as the execution trigger.

## Clarifications

### Session 2026-07-28

- Q: Should directory memory be controllable per Panel, after being settled as always-on? → A: Yes —
  a per-Panel control, **defaulting ON**. The earlier decision survives as the default; the control
  exists because a user asked for it after living with the feature. FR-027a is amended accordingly.
- Q: PowerShell cannot report its working directory at all. Offer shell integration? → A: Yes, as a
  setting **enabled by default**. Measured, not assumed: after a `cd`, only cmd's process working
  directory actually moves; PowerShell, pwsh and Git Bash all stay at their launch directory, so
  they can only be *asked* to report.
- Q: With shell integration off, should the Reopen control still be offered for shells that need
  it? → A: No — disabled, with the reason, exactly as "Run as administrator" behaves when throng is
  not elevated. An offered control that does nothing is a claim the product does not honour.

### Session 2026-07-27 (b)

- Q: Two panels run Claude in the same directory — how is each panel's own session identified? → A: **Scope change — the question is void.** Claude Code integration is dropped from this feature entirely and will be designed separately with its own planning session. An agent CLI is now just an ordinary command: typed, captured and re-run by the same rules as any other, with no recognition and no session handling. (Investigated first and recorded for the future spec: `claude --session-id <uuid>` lets a session identity be assigned at launch, and `--fork-session` documents that a plain `--resume` **reuses** the original id — so a minted uuid would be a stable per-panel handle, immune to the terminal's directory changing or to two Claudes sharing one directory. This removes the need for any transcript-scanning heuristic.)
- Q: How should a failed or skipped capture be made diagnosable? → A: Log every capture decision to diagnostics, **and** show a toast explaining a failure **only when it is not already visible in the terminal output**. If the shell has already reported it on screen, the toast is redundant and MUST NOT appear.
- Q: Is directory memory governed by the same opt-in checkbox as command memory? → A: No — directory memory is **always on and independent**. The checkbox governs only the startup command. Rationale: Principle III makes the working-directory tag mandatory, #96 is specified unconditionally, and a remembered directory cannot execute anything.
- Q: Must command tracking continue while no UI is attached (project closed, terminal still running in the background)? → A: No. Tracking is suspended when the last observer detaches; the **last observed value is frozen** and remains the capture candidate. Accepted defect, chosen deliberately over a slower background cadence: a command that **dies while unobserved** and is then killed uncleanly will be captured as though it were still running.

### Session 2026-07-27

- Q: When a startup command was captured by memory (not typed by the user), how should it run on the next cold start? → A: Run it with no prompt — identical to a command the user typed. The safeguards are that memory is opt-in per Panel (default off) and the saved command is always visible and editable.
- Q: When several commands are running in a terminal at the moment it ends, which one becomes the saved startup command? → A: The most recently started direct child of the shell. Its own descendants are never separate candidates, and no shell-integration marks are required.
- Q: Where does a user edit a panel's saved startup command after the panel has been created? → A: The pre-filled empty-panel form only — no separate settings dialog and no header-menu entry. There are exactly two edit routes: (1) close the terminal and edit the form, which the Panel shows pre-filled from its saved configuration; or (2) with memory on, simply type the new command in the terminal — a command that takes the foreground (does not immediately return) overrides the saved command. The setting is scoped to the Panel: destroying the Panel destroys it.
- Q: How should the running command be tracked, given each lookup costs a full process-table snapshot? → A: One shared periodic observation covering all terminals, on a bounded, externalised interval, off any path the user waits on. Cost must not scale with terminal count. The accepted trade-off is a stated staleness window: a command younger than one interval may be missed on an unclean kill.
- Q: How should the two fields be labelled so they can't be confused? → A: Rename the existing "Startup Params" to **"Shell Arguments"**, and call the new field **"Startup Command"**. No shared words between the two labels.
- Directive (author, unprompted, same session): the rename must not stop at the label — it must reach the backing identifiers. → All the way down. Every backing variable, persisted Panel-config key and settings key for the existing concept is renamed to say *shell arguments*; everything new says *startup command*. Because persisted keys change, a transparent one-way migration of existing Panel configs and settings files is required — no user action, no data loss.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A terminal starts the command I set it up with (Priority: P1)

A user sets up a Terminal Panel from the empty-panel form. Alongside the Flavour they type a Startup Command — `npm run dev`. On Confirm, the terminal opens, `npm run dev` begins running immediately, and when the user stops it they are left at a working interactive prompt in that shell, not a closed terminal. The command is remembered with the Panel, so reopening the project starts `npm run dev` again without the user typing anything. To change or clear it later the user closes the terminal; the Panel returns to its empty state with the form pre-filled from what it had saved, ready to edit.

**Why this priority**: This is the feature's core value and the only slice that stands alone — command memory exists to keep *this* field up to date. It also satisfies the outstanding half of constitutional Principle III on its own.

**Independent Test**: Create a Terminal Panel with a Startup Command, observe the command run in the opened terminal, stop the command and confirm an interactive prompt remains, then reopen the project and confirm the command runs again. Delivers "my terminals come back doing what they were doing" with nothing else built.

**Acceptance Scenarios**:

1. **Given** an empty Terminal Panel form, **When** the user chooses a flavour, types `npm run dev` as the Startup Command and confirms, **Then** the terminal opens at the project root and `npm run dev` begins running.
2. **Given** a terminal started with a Startup Command, **When** the command finishes or the user stops it, **Then** the shell remains open at an interactive prompt and accepts further input.
3. **Given** a Panel with a saved Startup Command, **When** the project is closed and reopened (cold start), **Then** the same command runs again.
4. **Given** a Panel with a saved Startup Command whose terminal has been closed, **When** the Panel returns to its empty state, **Then** the setup form is pre-filled with that Panel's saved flavour, shell arguments, startup command and memory flag — not reset to defaults.
5. **Given** that pre-filled form, **When** the user changes the command to `ping -t bbc.co.uk` and confirms, **Then** the terminal starts running `ping -t bbc.co.uk` and the next cold start runs it too.
6. **Given** a Panel is destroyed, **When** a new Panel is created in the same position, **Then** it starts from defaults — it MUST NOT inherit the destroyed Panel's startup command, memory flag or remembered directory.
7. **Given** a Panel with an empty Startup Command, **When** its terminal starts, **Then** behaviour is identical to today's — a bare interactive prompt at the project root, with no extra output, delay or injected text.
8. **Given** a Startup Command containing spaces and embedded quotes (e.g. `git commit -m "a message"`), **When** the terminal starts in any built-in flavour, **Then** the command is delivered to the shell intact and runs as typed.
9. **Given** a **user-defined** flavour (not a built-in), **When** a Panel using it is created with a Startup Command, **Then** the terminal launches and the command runs — proving the launch chain end to end (#113).

---

### User Story 2 - My terminal remembers what it was actually running (Priority: P2)

A user ticks "Remember the last running command" on a Terminal Panel. From then on, whatever command has control of that terminal when the terminal goes away becomes the Panel's saved Startup Command. If the user was sitting at a bare prompt with nothing running, the saved command is left exactly as it was — never wiped, never replaced by something that had already finished.

**Why this priority**: This is the "memory" the user asked for and the reason the feature is not just a text field, but it is only useful once US1 exists to receive the value.

**Independent Test**: With the checkbox ticked, start a long-running command, terminate the terminal while it runs, and confirm the Panel's saved Startup Command is now that command. Repeat with the command stopped first and confirm the saved command is unchanged.

**Acceptance Scenarios** (the user's own worked examples, verbatim):

1. **Given** a Panel with memory on, started with `npm run dev`, **When** the terminal is terminated while `npm run dev` is still running, **Then** the saved Startup Command stays `npm run dev`.
2. **Given** a Panel with memory on and an empty Startup Command, **When** the user runs `npm run dev` and the terminal is terminated while it is still running, **Then** the saved Startup Command becomes `npm run dev`.
3. **Given** a Panel with memory on and an empty Startup Command, **When** the user runs `npm run dev`, stops it, and *then* the terminal is terminated, **Then** the saved Startup Command remains empty.
4. **Given** a Panel with memory on, started with `npm run dev`, **When** the user stops `npm run dev` and the terminal is then terminated, **Then** the saved Startup Command remains `npm run dev`.
5. **Given** a Panel with memory on, started with `npm run dev`, **When** the user stops it, starts `ping -t bbc.co.uk`, and the terminal is terminated while that is running, **Then** the saved Startup Command becomes `ping -t bbc.co.uk`.
6. **Given** a Panel with memory **off**, **When** the user runs any command and the terminal is terminated while it runs, **Then** the saved Startup Command is unchanged — only a user edit can change it.
7. **Given** a Panel with memory on and a command running, **When** the application, the daemon or the machine ends abruptly (no orderly shutdown), **Then** the saved Startup Command still becomes that command on next open.

---

### User Story 3 - My terminal comes back where I left it (Priority: P3)

A user works in a subdirectory of the project. When the terminal is next re-created, it starts in that directory rather than back at the project root, so a set of terminals pointed at different parts of a repository does not collapse onto one place after a restart.

**Why this priority**: Closes #96, shares US2's capture point and persistence, and completes the constitutional tag ("working directory" alongside "launch command"). Genuinely useful but the smallest of the four slices.

**Independent Test**: `cd` a terminal into a subdirectory, restart, and confirm the terminal reopens in that subdirectory while a second Panel reopens in its own.

**Acceptance Scenarios**:

1. **Given** a terminal whose working directory is a subdirectory of the project, **When** the daemon is restarted and the terminal cold-starts, **Then** it starts in that subdirectory.
2. **Given** two Panels in different subdirectories, **When** both are re-created, **Then** each restores its own directory and neither collapses onto the other or onto the project root.
3. **Given** a Panel whose remembered directory no longer exists, or now resolves outside the owning project, **When** its terminal is re-created, **Then** it starts at the project root without an error dialog.
4. **Given** a newly-created Panel with no remembered directory, **When** its terminal starts, **Then** it starts at the project root (today's behaviour).
5. **Given** a Panel with both a remembered directory and a Startup Command, **When** its terminal cold-starts, **Then** the command runs *in* the remembered directory.
6. **Given** a Panel with command memory **off**, **When** the user works in a subdirectory and the terminal is re-created, **Then** the directory is still restored — directory memory does not depend on the checkbox.

---

### Edge Cases

- **Several commands running at once.** A shell can have more than one live child (a backgrounded job plus a foreground one; a command that itself spawns children). The captured command is the **most recently started direct child of the shell**; that child's own descendants are its business, not separate candidates.
- **A command that finished long ago.** Never captured. Only a command alive at the moment the terminal ends is a candidate.
- **A busy terminal that is deliberately left running.** Principle III keeps a busy terminal alive when its project or the application closes, re-attaching later. That is not a terminal ending, so it is not a capture point — but the tracked value must already be current so that a later hard kill still captures correctly.
- **A terminal running with nobody watching.** Once the last observer detaches, tracking suspends and the last seen value freezes (FR-019f). If that terminal is later ended by a path throng can observe, a final read corrects the frozen value (FR-019g); if it is killed uncleanly, the frozen value is promoted as-is — including when the command had already died (FR-019h, accepted).
- **"Terminate all" on application close.** This *is* a capture point: every terminal being terminated with something running updates its Panel's saved command.
- **A shell that exits on its own** (the user typed `exit`, or the shell crashed) — treated like any other terminal end; if something was running at that instant it is captured, otherwise the saved command is untouched.
- **Memory turned on mid-life.** Ticking the box on a Panel whose terminal is already running takes effect from that point; it does not retroactively rewrite anything.
- **A command that is itself the startup command.** Capturing `npm run dev` over a saved `npm run dev` is a no-op write, not a duplicate or an append.
- **Startup command that fails immediately** (typo, missing binary). The shell must still be left at a usable interactive prompt with the shell's own error visible — a bad saved command must never produce an unusable Panel the user cannot edit their way out of.
- **A remembered directory on a different drive, a UNC path, or a path that has become a file.** Falls back to the project root.
- **A sub-workspace-owned (rootless) Panel**, which today launches at the user's home directory rather than a project root — the same fallback logic applies with home as the root.
- **A very long or multi-line captured command line.** Captured commands must be bounded and single-line; anything longer or containing control characters is rejected rather than saved.
- **An elevated ("run as admin") terminal.** Command capture must work, or degrade to no capture, but must never cause the elevated terminal to fail to launch.
- **A flavour with no command recipe** (any user-defined flavour that has not declared one) — the universal fallback applies, and the Panel still works.

## Requirements *(mandatory)*

### Functional Requirements

#### A. Startup Command

- **FR-001**: A Terminal Panel MUST accept a **Startup Command** — free text, separate from the existing shell-arguments field — on the empty-panel setup form.
- **FR-002**: The existing **"Startup Params"** field MUST be relabelled **"Shell Arguments"**, and the new field labelled **"Startup Command"**. The two labels MUST share no words, so a user cannot mistake "arguments passed to the shell" for "a command the shell runs".
- **FR-002b**: Every user-visible reference to the old label — settings copy, tooltips, help text, documentation and error messages — MUST be updated together, leaving no surface still calling it "Startup Params".
- **FR-002c**: The rename MUST reach **all the way down**, not just the label. Every backing identifier for this concept — the persisted Panel configuration key, the settings key(s) holding per-flavour defaults, and the names used in the domain, IPC and UI layers — MUST be renamed to match the user-facing terms, in this direction:
  - everything that today names the **existing shell-arguments concept** as *params* / *startup params* / *default params* MUST be renamed to say **shell arguments**;
  - everything introduced for the **new** field MUST say **startup command**;
  - no layer may keep calling it "params" while the UI calls it Shell Arguments, and no identifier may use "startup command" to mean shell arguments or vice versa.

  The two concepts MUST be greppable and unambiguous from any layer: reading an identifier alone MUST be enough to know which of the two it refers to.
- **FR-002d**: Renaming persisted keys MUST come with a **transparent, one-way migration** of existing data. A Panel or settings file written before this feature MUST be read, upgraded and continue to work with **no user action and no data loss** — a user MUST NOT lose a configured shell-arguments value, and MUST NOT be shown an error, a reset panel, or a re-prompt because of the rename.
- **FR-002e**: The migration MUST be safe against a failed or partial config write: if the upgraded value cannot be persisted, the original value MUST remain readable and usable rather than being lost or half-written. Migration MUST be idempotent — running it against already-migrated data MUST be a no-op.
- **FR-002f**: Migration MUST be covered by tests that start from **real pre-feature persisted data** (a Panel config and a settings file using the old keys), not from hand-built objects that already use the new names.
- **FR-003**: The Startup Command MUST be persisted as part of the Panel's configuration and MUST survive application restart, project close/reopen and daemon restart.
- **FR-004**: When a Panel's terminal **cold-starts** and a Startup Command is present, the command MUST run automatically, without user action.
- **FR-005**: After the Startup Command finishes, is interrupted, or fails, the shell MUST remain open at a live interactive prompt.
- **FR-006**: An empty Startup Command MUST produce behaviour identical to the current product — no injected text, no additional output, no measurable extra delay.
- **FR-007**: Users MUST be able to view and edit a Panel's Startup Command **after** creation, without destroying and recreating the Panel. There are exactly two routes, and **no third surface is introduced** — no settings dialog, no panel-header menu entry, no Preferences page:
  - **FR-007a**: When a Panel's terminal is closed and the Panel returns to its empty state, the setup form MUST be **pre-filled from the Panel's saved configuration** (flavour, shell arguments, startup command, memory flag) rather than reset to defaults. Editing there and confirming updates the saved configuration and starts the terminal.
  - **FR-007b**: With memory **on**, typing a new command into the running terminal is itself an edit route: a command that takes the foreground overrides the saved command per FR-016. With memory **off**, this route MUST NOT exist — only FR-007a changes the saved command.
- **FR-007c**: A "command that takes the foreground" means one that does not immediately return. A command that starts and exits before the terminal ends is never a candidate (FR-017) — being *typed* is not what makes a command the saved one; being *alive when the terminal ends* is.
- **FR-007d**: The Startup Command, the memory flag and the remembered directory are scoped to the Panel that owns them. Destroying the Panel MUST destroy them. They MUST NOT outlive the Panel, be inherited by a Panel created in the same position, or be recoverable after the Panel is gone.
- **FR-008**: A Startup Command MUST NOT be run when a Panel **re-attaches** to an already-live terminal — re-attachment resumes a session that is already doing its work.
- **FR-009**: The Startup Command MUST run in the terminal's resolved start directory (see FR-030), not the project root, when the two differ.

#### B. Per-flavour command recipes

- **FR-010**: Each terminal flavour MUST be able to declare **how** a command is handed to it, because shells differ (`cmd` keeps a session open with one switch, PowerShell variants with another, POSIX shells need a re-exec to stay interactive).
- **FR-011**: Recipes MUST NOT be hard-coded to the built-in flavours. A user-defined flavour MUST be able to declare its own recipe through configuration.
- **FR-012**: A **universal fallback** MUST exist for any flavour with no declared recipe: once the shell is ready at its first prompt, the command is delivered to the terminal as though typed, followed by a newline. This path MUST work for any shell throng can host.
- **FR-013**: Every built-in flavour MUST have a verified recipe that (a) runs the command, (b) leaves an interactive shell behind, and (c) preserves a command containing spaces and embedded quotes. The exact invocations MUST be determined and proven during planning, not assumed.
- **FR-014**: A recipe MUST compose with the user's Shell Arguments rather than replacing them, and a flavour's Shell Arguments and its recipe MUST NOT contradict each other (e.g. an argument that makes the shell exit once the command finishes, defeating FR-005).

#### C. Command memory

- **FR-015**: A Terminal Panel MUST offer a per-Panel **opt-in** control on the empty-panel setup form governing whether its saved Startup Command updates itself. It MUST default to **off**. Its scope is the Startup Command **only** — it MUST NOT govern directory memory (FR-027a), and its label MUST NOT imply otherwise.
- **FR-016**: When memory is **on** and a terminal ends by any path with a command running, the Panel's saved Startup Command MUST be replaced by that command.
- **FR-017**: When memory is **on** and a terminal ends with **nothing** running, the Panel's saved Startup Command MUST be left exactly as it was. It MUST NOT be cleared, and MUST NOT be replaced by a command that has already exited.
- **FR-018**: When memory is **off**, the saved Startup Command MUST change only by explicit user edit.
- **FR-019**: The running command MUST be tracked **while the terminal runs**, so that capture survives paths with no orderly shutdown — a killed process, an application crash, a daemon crash, a machine restart.
- **FR-019a**: Tracking MUST use a **single shared observation covering all terminals**, not one per terminal. The cost of tracking MUST NOT scale with the number of open terminals: ten terminals MUST cost no more to track than one.
- **FR-019b**: Tracking MUST NOT block, delay or degrade terminal input/output, terminal startup, or terminal teardown. It MUST NOT run on any path a user waits on.
- **FR-019c**: The observation interval MUST be an externalised, documented setting with a sensible default (Principle X), not a magic value in logic.
- **FR-019d**: The resulting **staleness window** is an accepted trade-off and MUST be stated plainly: a command that starts and then dies with the machine, within one interval, may not be captured. Everything surviving longer than one interval MUST be captured. This bound MUST be asserted by a test rather than assumed.
- **FR-019e**: A tracking observation that fails, times out, or returns nothing MUST leave the last known good value in place and MUST NOT clear it, corrupt it, or end the terminal.
- **FR-019f**: Tracking MUST be **suspended while no UI observer is attached** to a terminal (its project closed but the terminal still running in the background). The last observed value MUST be frozen and retained as the capture candidate; it MUST NOT be cleared on detach. Tracking MUST resume when an observer re-attaches.
- **FR-019g**: On a terminal end that throng is able to observe (any orderly path — user close/kill, panel destroy, project delete, "terminate all", shell exit, daemon shutdown), a **final observation MUST be taken at that moment**, correcting a frozen value before it is promoted. This closes the gap for every path except an unclean kill.
- **FR-019h**: The residual defect MUST be documented as a **known, accepted limitation**, not treated as a bug: a command that dies while its terminal is unobserved, whose terminal is then killed uncleanly (crash, power loss, daemon kill), will be captured as though it were still running, and will be restarted on next open. It MUST NOT be possible for this to cause data loss or an unusable Panel — the worst outcome permitted is an unwanted command running, which the user can stop and edit away (FR-007a).
- **FR-020**: The set of terminal-end paths that trigger capture MUST be stated explicitly and covered by tests: user close/kill of the terminal, Panel destruction, project delete/close, "terminate all" on application close, the shell exiting on its own, and daemon shutdown.
- **FR-021**: Leaving a **busy** terminal running in the background on project/application close (Principle III) MUST NOT be treated as a terminal end, and MUST NOT update the saved command at that moment.
- **FR-022**: When more than one command is running, the captured command MUST be the **most recently started direct child of the shell**. Descendants of that child MUST NOT be treated as separate candidates, and the rule MUST NOT depend on shell-integration marks, prompt hooks, or any per-flavour cooperation — it MUST be derivable from a process snapshot alone, so it works identically for a user-defined flavour.
- **FR-022a**: The candidate set MUST be exactly the shell's direct children. A terminal whose only live processes are grandchildren of the shell (its direct child having exited while leaving its own children behind) MUST be treated as having nothing running, leaving the saved command unchanged (FR-017).
- **FR-023**: A captured command MUST be a single line, bounded in length, and free of control characters; anything that fails these checks MUST be discarded, leaving the saved command unchanged, rather than saved.
- **FR-024**: Capture MUST NOT delay, block, or risk the terminal's own teardown. If the command cannot be determined, the saved command is left unchanged and the terminal ends normally.
- **FR-025**: Capture MUST be observable to the user: after it happens, the new saved command MUST be what the Panel's settings show. It MUST never be a value the user cannot see or edit.
- **FR-026**: Process introspection MUST sit behind the existing OS abstraction; the rules that decide *whether* and *what* to capture MUST be pure, platform-free logic.

#### C2. Observability of capture

- **FR-026a**: Every capture decision MUST be recorded in throng's existing diagnostics log — what was observed, what was promoted, and which rule caused a no-op. A user or maintainer investigating "it forgot my command" MUST be able to answer *which* rule fired from the log alone, without reproducing the problem.
- **FR-026b**: A **failure** MUST additionally raise a toast explaining it — but **only when it is not already visible in the terminal's own output**. The governing question is whether the user has another way to see it:
  - **Toast**: failures of throng's own machinery, which the terminal never shows — a captured command discarded as malformed (FR-023), an observation that could not be taken, a settings migration that could not be persisted (FR-002e), a startup command that could not be delivered to the shell at all.
  - **No toast**: anything the shell itself reported on screen — a mistyped command, a missing binary, a non-zero exit. The terminal has already said it; repeating it is noise.
- **FR-026c**: The **normal no-op is not a failure and MUST NOT toast**: a terminal ending with nothing running (FR-017) is the designed behaviour, not an error, and MUST be silent to the user. It is still logged (FR-026a).
- **FR-026d**: Raising a toast MUST NOT delay or block terminal teardown (FR-024). It is reported after the fact.
- **FR-026e**: When there is no surface on which to show a toast — the Panel is being destroyed, the project is closing, or the application is exiting — the diagnostics entry stands alone and the absent toast MUST NOT be treated as an error or retried.

#### D. Working directory memory (#96)

- **FR-027**: A Terminal Panel MUST remember the last working directory its terminal was pointed at.
- **FR-027a**: Directory memory is **independent of the command-memory checkbox** (FR-015). That
  checkbox governs the Startup Command only; a Panel with command memory off MUST still restore its
  directory.
- **FR-027b**: Directory memory has its **own per-Panel control**, which **defaults to on**
  *(amended — Clarifications, Session 2026-07-28; it was previously specified as always-on with no
  control)*. Absent means on, so a Panel persisted before the control existed keeps remembering, and
  only an explicit opt-out disables it. Switching it off MUST stop the Panel both recording its
  directory and launching into a remembered one.
- **FR-028**: On cold start, a Panel MUST use its remembered directory as the terminal's start directory.
- **FR-029**: Each Panel MUST restore its **own** directory; two Panels MUST NOT collapse onto one another's directory or onto the project root.
- **FR-030**: A remembered directory that no longer exists, is not a directory, or resolves outside the owning project's root MUST fall back to the project root (or, for a rootless sub-workspace Panel, its equivalent) **without** an error dialog.
- **FR-031**: A Panel with no remembered directory MUST start at the project root, exactly as today.
- **FR-032**: Directory memory MUST NOT restore live process state or scrollback. Only the directory.

#### D2. Shell integration — asking a shell to report its directory

Added after implementation revealed the premise of US3 to be false for three of the four built-in
shells. **Measured**: after a `cd`, only `cmd` moves the process working directory that an external
observer can read. PowerShell's `Set-Location` moves its *provider* location; pwsh and Git Bash
likewise leave the process directory at its launch value. No improvement to the OS-level reader can
recover what is not there.

- **FR-032a**: throng MUST be able to ask a shell to **report** its working directory, for shells
  whose real directory cannot be observed from outside.
- **FR-032b**: A reported directory MUST be indistinguishable downstream from an observed one — the
  Panel header and directory memory MUST work identically whichever way the value arrived.
- **FR-032c**: The mechanism MUST be governed by a single setting, **enabled by default**, so a user
  whose shell configuration disagrees with it can switch it off.
- **FR-032d**: Installing it MUST NOT displace a prompt the user already has. Any existing prompt or
  `PROMPT_COMMAND` MUST still run.
- **FR-032e**: Where a shell needs integration and it is **off**, the "reopen in the last directory"
  control MUST be **disabled with its reason stated**, never offered inertly. A control that appears
  available and does nothing is a claim the product does not honour.
- **FR-032f**: A reported directory MUST reach throng in a form comparable with the project root, so
  containment (FR-030) can still be judged.

#### D3. Handing a command to a shell that parses it differently

- **FR-014a**: A Startup Command MUST reach the shell as the user wrote it, including its own
  quoting, for **every** built-in flavour. Two shells needed specific handling, and both were found
  by launching real shells rather than by inspection:
  - PowerShell and pwsh parse a leading quoted string as an **expression**, so a quoted executable
    path fails to parse. They require the call operator, added only when the command begins with a
    quote, and never otherwise.
  - `cmd` never un-escapes a quoted argv entry, so a quoted path arrives backslash-escaped and
    unrecognised. It MUST be handed a verbatim command line instead of an argv array.
- **FR-014b**: Coverage for the Startup Command MUST exercise **every** built-in flavour, including
  a quoted executable path. Single-flavour coverage is what allowed both defects above to ship.

#### E. Agent-agnostic treatment of agent CLIs

- **FR-033**: An agentic CLI — Claude Code included — is treated as **an ordinary command and nothing more**. It is typed, captured, saved and re-run by exactly the same rules as `npm run dev` or `ping`.
- **FR-034**: throng MUST NOT recognise, special-case, inspect, or attach any agent-specific meaning to a command. No agent name may appear in a condition anywhere in this feature.
- **FR-035**: throng MUST NOT read, resolve or depend on any other application's session records, transcripts, or on-disk state.
- **FR-036**: This feature MUST NOT introduce an "AI Agents" settings section, an agent-related preference, or any UI copy implying agent awareness.
- **FR-037**: A captured agent command MUST be saved **verbatim**, exactly as observed (subject only to FR-023's validity checks). If a user typed `claude`, the saved command is `claude` — throng MUST NOT append, rewrite or enrich it with session flags or any other argument.

#### E2. Reporting a terminal's end

- **FR-041a**: A terminal that exits **cleanly** (code 0) MUST NOT raise a notice, whoever ended it.
  Telling a user "Terminal exited (code 0)" after they typed `exit` reports back their own action
  and trains them to dismiss notices unread — which is exactly when a real failure is missed.
- **FR-041b**: Any other end — a non-zero code, a signal, or a code that could not be read — MUST
  still surface with its code, satisfying Principle III. Silence is earned by evidence of a clean
  exit, never assumed.
- **FR-041c**: The decision MUST NOT be taken from "was this end expected", which throng cannot
  determine: its `unexpected` flag means only "throng did not kill it", so a typed `exit` arrives
  marked unexpected.

#### F. Coverage and proof (#113)

- **FR-042**: Automated coverage MUST prove that a **user-defined** terminal flavour actually launches a terminal end to end — the gap #113 records, on the very launch chain this feature extends.
- **FR-043**: That coverage MUST include a user-defined flavour launching **with** a Startup Command.
- **FR-044**: Every user-facing change here (the new field, the checkbox, the post-creation edit surface, the new settings section) MUST ship with E2E coverage, per Principle V.
- **FR-045**: The memory rules in US2's acceptance scenarios MUST each be covered by a test that distinguishes "still running" from "already stopped" — the distinction the whole feature turns on.

#### G. Trust, safety and isolation

- **FR-046**: A saved Startup Command is **persisted user data that is executed on the next launch**. The feature MUST treat it as such: it is never sourced from anywhere but (a) the user typing it, or (b) a command observed running in that user's own terminal with memory explicitly enabled per Panel.
- **FR-047**: throng MUST NOT interpret, rewrite, sanitise-by-guessing, or "improve" a startup command. It is passed to the chosen shell as given; the shell is the interpreter.
- **FR-047a**: A startup command that was captured by memory MUST run on the next cold start exactly as one the user typed — **no confirmation prompt, no "restored command" gate, no distinction in behaviour**. There MUST be no user-visible difference at launch between a typed command and a captured one. The safeguards against an unwanted command are FR-015 (memory is opt-in per Panel and defaults off) and FR-025 (the saved command is always visible and editable), not a prompt.
- **FR-048**: A remembered command or directory MUST NOT escape its project (Principle I) — a Panel's memory belongs to its owning project and MUST NOT leak into another.
- **FR-049**: Existing Panels created before this feature MUST continue to work unchanged — their shell arguments migrated intact (FR-002d), and defaulting to no startup command, memory off, and no remembered directory.

### Key Entities

- **Terminal Panel Configuration**: what a Panel persists in order to reconstitute its terminal — flavour, flavour label, shell arguments, run-as-admin flag (all existing), plus **startup command**, **remember-last-command flag**, and **last working directory** (new).
- **Flavour Command Recipe**: a per-flavour description of how a command is handed to that shell such that it runs and leaves an interactive session behind. Declarable for user-defined flavours; absent means the universal fallback.
- **Observed Running Command**: the command line and identity of the most recently started direct child of a terminal's shell, tracked while the terminal lives; the sole input to a capture decision.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user who sets up three terminals with three different commands in three different flavours can close the project, reopen it, and find all three commands running again, without typing a single command.
- **SC-002**: Restoring that three-terminal working state takes **zero** manual commands after this feature, versus one per terminal before it.
- **SC-003**: All six of the user's worked memory examples (US2, scenarios 1–6) produce the stated saved command, with no exceptions.
- **SC-004**: A terminal whose command was running when the machine was killed without warning still restores that command on next open.
- **SC-005**: Terminals in different subdirectories all reopen in their own directories; none falls back to the project root unless its directory genuinely no longer exists.
- **SC-006**: A user who typed any long-running command — an agent CLI, a watcher, a server — gets that exact command back on next open, with no command treated more specially than another.
- **SC-007**: A Panel with no startup command behaves indistinguishably from today — no added output, no visible delay at terminal start.
- **SC-008**: A user can tell, from the Panel's own settings, exactly what command will run next time — the saved command is never hidden.
- **SC-009**: A bad or now-invalid saved command always leaves a usable terminal the user can edit their way out of; it never produces a dead or blank Panel.
- **SC-010**: The suite proves a user-defined flavour launches — a claim nothing in the product currently tests (#113).
- **SC-011**: A user with ten terminals open notices no difference in responsiveness from a user with one — terminal typing, opening and closing stay as responsive as before the feature, with the same measured cost whether memory is on or off.
- **SC-012**: A command that has been running for longer than one observation interval, in a terminal with a UI attached, is captured on an unclean kill 100% of the time. Two bounded exceptions are accepted and documented: commands younger than one interval (FR-019d), and the frozen-value case in an unobserved terminal (FR-019h).
- **SC-013**: A user upgrading from a build made before this feature keeps every configured shell-arguments value, sees no error, no reset panel and no re-prompt, and needs to do nothing — the rename is invisible to them apart from the new label.
- **SC-014**: Any report of "it forgot my command" can be resolved from the diagnostics log alone, without reproducing it — the log always names which rule caused the no-op.
- **SC-015**: A user is never told twice about the same failure: nothing that the terminal already printed on screen also appears as a toast, and ordinary teardown with nothing running produces no toast at all.

## Assumptions

Recorded defaults chosen where the description did not specify. Each is a decision, reversible at clarification:

1. **Memory defaults to off.** The user described it as a checkbox to be selected, so a Panel does not rewrite its own configuration until asked.
2. **Agent CLIs get no special treatment.** Claude Code and any other agent are ordinary commands here. Agent-aware behaviour — session resumption in particular — is deferred to a separate feature with its own planning session. *(Decided — Clarifications, Session 2026-07-27 (b).)*
3. **The existing "Startup Params" label is renamed** to "Shell Arguments" so the new Startup Command cannot be confused with it, and the rename reaches the backing identifiers and persisted keys as well as the label. *(Confirmed — Clarifications, Session 2026-07-27; see FR-002 through FR-002f.)* This turns a cosmetic change into a data migration, which is accepted deliberately: v1.0.0 has not shipped, so the cost of aligning the names is lowest now and rises permanently after release.
4. **Concurrency rule: most recently started direct child of the shell wins.** The simplest rule that matches "the command that had control", with no shell-integration hooks required. *(Confirmed — Clarifications, Session 2026-07-27; see FR-022/FR-022a.)* Known trade-off, accepted: a foreground job started **before** a background one loses to the newer background job.
5. **A memory-captured command runs automatically on next start, with no confirmation prompt.** Unattended restoration is the entire point; the safeguards are that memory is opt-in per Panel and the saved command is always visible and editable (FR-025). *(Confirmed — Clarifications, Session 2026-07-27; see FR-047a.)*
6. **Startup command and memory are per Panel, not per flavour and not per project.** A reusable named-preset library is out of scope.
7. **Windows only.** Process introspection for macOS/Linux stays with #22/#23.
8. **This feature depends on no other application's internals.** Dropping agent awareness removed the only such dependency, so nothing here can be broken by another product changing its on-disk layout.
9. **The working directory is captured at the same point as the command**, since both describe "what this terminal was doing" — but *not* necessarily by the same mechanism: throng already observes live cwd through its own seam (see Dependencies), so US3 reuses that rather than inventing anything. Both are governed by the same suspend-when-unobserved rule (FR-019f).
10. **Capture applies to the terminal that ends**, per Panel; there is no cross-Panel or global memory. *(Confirmed — Clarifications, Session 2026-07-27.)* The saved command, memory flag and remembered directory live and die with their Panel (FR-007d).
11. **No new editing surface is introduced.** The pre-filled empty-panel form is the whole of it — the empty state a Panel already returns to when its terminal closes becomes the edit screen. *(Confirmed — Clarifications, Session 2026-07-27; see FR-007a/FR-007b.)*

## Out of Scope

Named explicitly so the boundary is reviewable:

- A reusable, named **preset library** applicable across Panels or projects (the constitutional preset requirement is met by the Panel's own configuration).
- **All agent awareness, including Claude Code session resumption** — dropped from this spec by decision, to be designed in its own feature with its own planning session (belongs with #17 / #104; no new issue needed). Specifically deferred: recognising an agent CLI, minting or resolving session identifiers, resuming a session, and any "AI Agents" settings section. Here, an agent is just a command.
- The `agent-third` panel tier and agent-aware UI (#17).
- The Claude Code key-binding and interactive-feature audit (#104).
- Multi-agent handoff (#18).
- An in-app manager for daemon processes and locks (#133) — though the command-line introspection built here is the foundation it will need.
- Terminal flavour catalogue management: renaming, reordering, or the settings control shape (#107, #106, #67, #14).
- Restoring scrollback or live process state across a restart.
- macOS and Linux process introspection (#22, #23).

## Dependencies

- The existing per-terminal descendant-process reporting in the OS abstraction, and the pure busy/idle classification built on it — extended, not replaced, to carry command lines.
- **The existing live working-directory seam.** throng already reads each running terminal's current working directory by pid, batched, on a repeating daemon poll, and publishes per-panel changes so a Panel title can show its live cwd. US3 therefore does **not** need a new mechanism to observe the directory — the directory is already known; what is missing is persisting it against the Panel and using it as the next start directory. That poll is suspended when nothing is observing, which is the behaviour FR-019f now adopts for command tracking too.
- The existing terminal lifecycle rules (Principle III): which terminals are kept alive on close and which are terminated determine every capture point.
- The existing Panel configuration persistence, which already survives restart for flavour, shell arguments and title — and which this feature both extends (new keys) and migrates (renamed keys, FR-002d).
- **No dependency on any other application's internals** (see Assumption 8) — the one such dependency was removed with agent awareness.
